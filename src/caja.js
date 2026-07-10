import { state } from './state.js';
import { cajaTurnosRef, configRef, doc, setDoc, getDocs, onSnapshot, serverTimestamp, db } from './firebase.js';
import { qs, setEmpty, toast, openDialog, closeDialog } from './ui.js';
import { calcPedido, escapeHtml, money, todayISO, shortOrderDescription, openTicketWindow, BUSINESS_NAME } from './utils.js';

const DENOMS = [1, 5, 10, 20, 50, 100, 200, 500, 1000];
const ACTIVE_KEY = 'arca_pos_caja_activa_final_v1';
const CLOSED_KEY = 'arca_pos_cajas_cerradas_final_v1';
const CONFIG_KEY = 'arca_pos_config_v1';

let remoteShifts = [];
let closingBusy = false;
let handlersAttached = false;

function nowISO() { return new Date().toISOString(); }
function asNumber(value, fallback = 0) {
  const n = Number(String(value ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : fallback;
}
function safeParse(raw, fallback) {
  try { return raw ? JSON.parse(raw) : fallback; } catch { return fallback; }
}
function normalizeMethod(method = 'efectivo') {
  const value = String(method || 'efectivo').toLowerCase();
  if (value.includes('tarjeta')) return 'tarjeta';
  if (value.includes('transfer')) return 'transferencia';
  return 'efectivo';
}
function isOpen(status = '') {
  return ['abierto', 'abierta', 'activo', 'activa', 'open'].includes(String(status || '').toLowerCase().trim());
}
function makeId(prefix = 'caja') {
  if (crypto?.randomUUID) return `${prefix}-${crypto.randomUUID()}`;
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}
function sanitizeShift(shift = {}) {
  return {
    id: shift.id || makeId('caja'),
    estado: shift.estado || 'abierto',
    fecha: shift.fecha || todayISO(),
    apertura: asNumber(shift.apertura, 0),
    tipoCambio: asNumber(shift.tipoCambio, state.config?.tipoCambio || 36.5),
    cobros: Array.isArray(shift.cobros) ? shift.cobros : [],
    gastos: Array.isArray(shift.gastos) ? shift.gastos : [],
    ingresosManuales: Array.isArray(shift.ingresosManuales) ? shift.ingresosManuales : [],
    conteo: shift.conteo || {},
    dolaresContados: asNumber(shift.dolaresContados, 0),
    cierre: shift.cierre ?? null,
    diferencia: shift.diferencia ?? null,
    cierreAdministrativo: !!shift.cierreAdministrativo,
    totales: shift.totales || null,
    createdAtLocal: shift.createdAtLocal || nowISO(),
    updatedAtLocal: nowISO(),
    closedAtLocal: shift.closedAtLocal || null,
  };
}
function readActiveShift() {
  const shift = safeParse(localStorage.getItem(ACTIVE_KEY), null);
  if (!shift || !shift.id || !isOpen(shift.estado)) return null;
  return sanitizeShift(shift);
}
function writeActiveShift(shift) {
  if (!shift || !shift.id || !isOpen(shift.estado)) {
    localStorage.removeItem(ACTIVE_KEY);
    state.currentCashShift = null;
    state.currentCashShiftId = '';
    return null;
  }
  const clean = sanitizeShift(shift);
  localStorage.setItem(ACTIVE_KEY, JSON.stringify(clean));
  state.currentCashShift = clean;
  state.currentCashShiftId = clean.id;
  return clean;
}
function readClosedShifts() {
  return safeParse(localStorage.getItem(CLOSED_KEY), []);
}
function saveClosedShift(shift) {
  const clean = { ...sanitizeShift(shift), estado: 'cerrado' };
  const list = [clean, ...readClosedShifts().filter(t => t.id !== clean.id)].slice(0, 200);
  localStorage.setItem(CLOSED_KEY, JSON.stringify(list));
  return clean;
}
function refreshState() {
  const active = readActiveShift();
  const closed = readClosedShifts();
  const map = new Map();
  remoteShifts.forEach(t => t?.id && map.set(t.id, t));
  closed.forEach(t => t?.id && map.set(t.id, t));
  if (active) map.set(active.id, active);
  state.cajaTurnos = Array.from(map.values());
  state.currentCashShift = active;
  state.currentCashShiftId = active?.id || '';
}
async function persistShift(shift, silent = true) {
  if (!shift?.id) return false;
  try {
    await setDoc(doc(db, 'cajaTurnos', shift.id), { ...shift, updatedAt: serverTimestamp() }, { merge: true });
    return true;
  } catch (error) {
    console.warn('Caja guardada localmente, Firebase no sincronizó:', error);
    if (!silent) toast('Caja guardada en este navegador. Firebase no sincronizó ahora.');
    return false;
  }
}
function clearOldCashKeys() {
  // Limpia llaves anteriores que podían bloquear la caja.
  [
    'arca_pos_caja_activa_v1',
    'arca_pos_caja_activa_v2',
    'arca_pos_caja_activa_v3',
  ].forEach(key => localStorage.removeItem(key));
}

function bind(selector, eventName, handler) {
  const el = qs(selector);
  if (!el) return;
  const attr = `data-caja-${eventName}-bound`;
  if (el.getAttribute(attr) === '1') return;
  el.setAttribute(attr, '1');
  el.addEventListener(eventName, event => {
    event.preventDefault();
    event.stopPropagation();
    handler(event);
  });
}

function attachCashHandlers(force = false) {
  if (handlersAttached && !force) return;
  bind('#cash-open-form', 'submit', openCashShift);
  bind('#cash-expense-form', 'submit', addCashExpense);
  bind('#cash-income-form', 'submit', addManualIncome);
  bind('#cash-close', 'click', closeCashShift);
  bind('#cash-force-close', 'click', forceCloseActiveShift);
  bind('#cash-exchange-save', 'click', saveExchangeRate);
  bind('#cash-close-form', 'submit', confirmCloseCashShift);
  bind('#cash-confirm-close', 'click', confirmCloseCashShift);
  bind('#cash-close-cancel', 'click', () => closeDialog('#cash-close-dialog'));
  document.querySelectorAll('.denom-input, #close-usd-amount').forEach(input => {
    if (input.getAttribute('data-caja-input-bound') === '1') return;
    input.setAttribute('data-caja-input-bound', '1');
    input.addEventListener('input', renderCloseTotal);
  });
  handlersAttached = true;
}

export function listenCaja() {
  clearOldCashKeys();
  const localConfig = safeParse(localStorage.getItem(CONFIG_KEY), {});
  state.config = { ...state.config, ...localConfig };
  refreshState();
  attachCashHandlers(true);
  renderCaja();

  const unsubShifts = onSnapshot(cajaTurnosRef, snap => {
    remoteShifts = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    refreshState();
    renderCaja();
  }, error => console.warn('Caja: no pude leer turnos remotos:', error));

  const unsubConfig = onSnapshot(configRef, snap => {
    if (snap.exists()) {
      state.config = { ...state.config, ...snap.data() };
      localStorage.setItem(CONFIG_KEY, JSON.stringify({ tipoCambio: state.config.tipoCambio || 36.5 }));
      renderCaja();
    }
  }, error => console.warn('Caja: no pude leer configuración:', error));

  return () => { try { unsubShifts(); } catch {} try { unsubConfig(); } catch {} };
}

export function getActiveShift() {
  return readActiveShift();
}

export function getPaymentsForShift(shift = getActiveShift()) {
  if (!shift) return [];
  const rows = [];
  const seen = new Set();
  const push = row => {
    const p = row.pago || {};
    const key = p.cashId || p.id || `${p.pedidoId || row.pedido?.id || ''}-${p.fecha || ''}-${p.metodo || ''}-${p.monto || row.monto || 0}`;
    if (seen.has(key)) return;
    seen.add(key);
    rows.push(row);
  };

  (shift.cobros || []).forEach(c => {
    const pedido = state.pedidos.find(p => p.id === c.pedidoId) || {
      id: c.pedidoId || '',
      cliente: c.cliente || 'Venta / cobro',
      moneda: c.moneda || 'C$',
      items: [{ descripcion: c.descripcion || c.nota || 'Cobro' }],
    };
    push({ pedido, pago: c, monto: asNumber(c.monto, 0), moneda: c.moneda || pedido.moneda || 'C$', metodo: normalizeMethod(c.metodo) });
  });

  state.pedidos.forEach(p => {
    (p.pagos || []).forEach(pay => {
      if (pay.turnoId === shift.id) {
        push({ pedido: p, pago: pay, monto: asNumber(pay.monto, 0), moneda: pay.moneda || p.moneda || 'C$', metodo: normalizeMethod(pay.metodo) });
      }
    });
  });

  return rows;
}

export async function registerCashReceipt({ pedidoId = '', cliente = '', descripcion = '', monto = 0, moneda = 'C$', metodo = 'efectivo', nota = 'Cobro registrado', cashId = '' } = {}) {
  const shift = getActiveShift();
  const amount = asNumber(monto, 0);
  if (!shift || amount <= 0) return null;
  const id = cashId || makeId('cobro');
  if ((shift.cobros || []).some(c => c.cashId === id || c.id === id)) return null;
  const cobro = {
    id,
    cashId: id,
    pedidoId,
    cliente,
    descripcion,
    monto: amount,
    moneda,
    metodo: normalizeMethod(metodo),
    nota,
    fecha: todayISO(),
    createdAtLocal: nowISO(),
    turnoId: shift.id,
  };
  const updated = writeActiveShift({ ...shift, cobros: [...(shift.cobros || []), cobro] });
  refreshState();
  renderCaja();
  await persistShift(updated);
  return cobro;
}

function shiftTotals(shift = getActiveShift()) {
  const tipoCambio = asNumber(shift?.tipoCambio, state.config?.tipoCambio || 36.5);
  const apertura = asNumber(shift?.apertura, 0);
  const gastos = (shift?.gastos || []).reduce((sum, g) => sum + asNumber(g.monto, 0), 0);
  const ingresosManual = (shift?.ingresosManuales || []).reduce((sum, i) => sum + asNumber(i.monto, 0), 0);
  const payments = getPaymentsForShift(shift);
  const toCs = r => r.moneda === '$' ? asNumber(r.monto, 0) * tipoCambio : asNumber(r.monto, 0);
  const efectivo = payments.filter(r => normalizeMethod(r.metodo) === 'efectivo');
  const tarjeta = payments.filter(r => normalizeMethod(r.metodo) === 'tarjeta');
  const transferencia = payments.filter(r => normalizeMethod(r.metodo) === 'transferencia');
  const efectivoCs = efectivo.filter(r => r.moneda !== '$').reduce((s, r) => s + asNumber(r.monto, 0), 0);
  const efectivoUsd = efectivo.filter(r => r.moneda === '$').reduce((s, r) => s + asNumber(r.monto, 0), 0);
  const efectivoUsdEnCs = efectivoUsd * tipoCambio;
  const tarjetaCs = tarjeta.reduce((s, r) => s + toCs(r), 0);
  const transferenciaCs = transferencia.reduce((s, r) => s + toCs(r), 0);
  const ventasTotalCs = payments.reduce((s, r) => s + toCs(r), 0);
  const efectivoEsperado = apertura + efectivoCs + efectivoUsdEnCs + ingresosManual - gastos;
  return { apertura, gastos, ingresosManual, efectivoCs, efectivoUsd, efectivoUsdEnCs, tarjetaCs, transferenciaCs, ventasTotalCs, efectivoEsperado, tipoCambio, payments };
}

export function renderCaja() {
  if (!qs('#view-caja')) return;
  refreshState();
  attachCashHandlers();

  const shift = getActiveShift();
  const status = qs('#cash-status');
  const openPanel = qs('#cash-open-panel');
  const activePanel = qs('#cash-active-panel');
  const pendingList = qs('#cash-pending-list');
  const movements = qs('#cash-movements');
  const summary = qs('#cash-summary');
  const closeBtn = qs('#cash-close');
  const tcInput = qs('#cash-exchange-rate');

  if (tcInput && document.activeElement !== tcInput) tcInput.value = asNumber(state.config?.tipoCambio, 36.5).toFixed(2);
  if (!status || !openPanel || !activePanel) return;

  if (!shift) {
    status.innerHTML = '<div class="cash-state closed"><strong>Caja cerrada</strong><span>Abre un turno para registrar ventas, cobros, gastos y cierre.</span></div>';
    openPanel.hidden = false;
    activePanel.hidden = true;
    if (closeBtn) closeBtn.disabled = true;
    if (summary) summary.innerHTML = '';
    if (movements) movements.innerHTML = '';
  } else {
    const totals = shiftTotals(shift);
    status.innerHTML = `<div class="cash-state open"><strong>Caja abierta</strong><span>Turno: ${escapeHtml(shift.id)} · Fecha: ${escapeHtml(shift.fecha || todayISO())} · TC: C$${totals.tipoCambio.toFixed(2)}</span></div><div class="cash-formula"><strong>Fórmula:</strong> Apertura + efectivo recibido + ingresos extra - gastos = efectivo esperado.</div>`;
    openPanel.hidden = true;
    activePanel.hidden = false;
    if (closeBtn) closeBtn.disabled = false;
    if (summary) summary.innerHTML = `
      <div class="summary-card"><span>Apertura</span><strong>${money(totals.apertura, 'C$')}</strong></div>
      <div class="summary-card"><span>Efectivo C$</span><strong>${money(totals.efectivoCs, 'C$')}</strong></div>
      <div class="summary-card"><span>Efectivo $</span><strong>${money(totals.efectivoUsd, '$')}</strong><small>${money(totals.efectivoUsdEnCs, 'C$')}</small></div>
      <div class="summary-card"><span>Tarjeta</span><strong>${money(totals.tarjetaCs, 'C$')}</strong><small>No suma al efectivo físico</small></div>
      <div class="summary-card"><span>Transferencia</span><strong>${money(totals.transferenciaCs, 'C$')}</strong><small>No suma al efectivo físico</small></div>
      <div class="summary-card"><span>Ingresos extra</span><strong>${money(totals.ingresosManual, 'C$')}</strong></div>
      <div class="summary-card danger-summary"><span>Gastos</span><strong>-${money(totals.gastos, 'C$')}</strong></div>
      <div class="summary-card expected-summary"><span>Efectivo esperado</span><strong>${money(totals.efectivoEsperado, 'C$')}</strong></div>`;
    renderMovements(shift, totals, movements);
  }
  renderPendingPayments(pendingList);
}

function renderMovements(shift, totals, container) {
  if (!container) return;
  const pagos = totals.payments.map(r => `<tr><td>${escapeHtml(r.pago.fecha || '')}</td><td>Cobro ${escapeHtml(normalizeMethod(r.metodo))}</td><td>${escapeHtml(r.pedido.cliente || '')} · ${escapeHtml(shortOrderDescription(r.pedido))}</td><td>${money(r.monto, r.moneda)}</td><td><button class="action" data-order-ticket="${r.pedido.id}">Ticket</button></td></tr>`).join('');
  const ingresos = (shift.ingresosManuales || []).map(i => `<tr><td>${escapeHtml(i.fecha || '')}</td><td>Ingreso extra</td><td>${escapeHtml(i.concepto || '')}</td><td>${money(i.monto, 'C$')}</td><td>-</td></tr>`).join('');
  const isAdmin = (state.usuarioInterno?.rol || 'admin') === 'admin';
  const gastos = (shift.gastos || []).map(g => `<tr><td>${escapeHtml(g.fecha || '')}</td><td>Gasto</td><td>${escapeHtml(g.concepto || '')}</td><td>-${money(g.monto, 'C$')}</td><td class="table-actions"><button class="action" data-expense-ticket="${g.id}">Ticket</button>${isAdmin ? `<button class="action amber" data-expense-edit="${g.id}">Editar</button><button class="action red" data-expense-delete="${g.id}">Eliminar</button>` : ''}</td></tr>`).join('');
  container.innerHTML = (pagos || ingresos || gastos)
    ? `<div class="report-table-wrap"><table class="table"><thead><tr><th>Fecha</th><th>Tipo</th><th>Concepto</th><th>Monto</th><th>Acciones</th></tr></thead><tbody>${pagos}${ingresos}${gastos}</tbody></table></div>`
    : '<div class="empty">No hay movimientos en este turno.</div>';
}

function renderPendingPayments(container) {
  if (!container) return;
  const pending = state.pedidos
    .filter(p => (p.estado || 'Pendiente') !== 'Anulado' && calcPedido(p).saldo > 0)
    .sort((a, b) => String(a.fecha_entrega || '').localeCompare(String(b.fecha_entrega || '')));
  if (!pending.length) return setEmpty(container, 'No hay facturas pendientes por cobrar.');
  container.innerHTML = pending.map(p => {
    const c = calcPedido(p);
    return `<article class="record-card compact-record"><div class="record-head"><div><div class="record-title">${escapeHtml(p.cliente || 'Sin cliente')}</div><div class="record-sub">${escapeHtml(shortOrderDescription(p))} · Entrega: ${escapeHtml(p.fecha_entrega || '')}</div></div><div class="record-meta"><div>${money(c.saldo, p.moneda || 'C$')}</div><div class="record-sub">Saldo</div></div></div><div class="record-actions"><button class="action green" data-order-payment="${p.id}">Cobrar / abonar</button><button class="action" data-order-detail="${p.id}">Detalle</button><button class="action" data-order-ticket="${p.id}">Ticket</button></div></article>`;
  }).join('');
}

export async function saveExchangeRate(event) {
  event?.preventDefault?.();
  const value = asNumber(qs('#cash-exchange-rate')?.value, 0);
  if (value <= 0) return toast('Ingresa un tipo de cambio válido.');
  state.config = { ...state.config, tipoCambio: value };
  localStorage.setItem(CONFIG_KEY, JSON.stringify({ tipoCambio: value }));
  renderCaja();
  try { await setDoc(configRef, { tipoCambio: value, updatedAt: serverTimestamp() }, { merge: true }); } catch {}
  toast('Tipo de cambio actualizado.');
}

export async function openCashShift(event) {
  event?.preventDefault?.();
  const current = getActiveShift();
  if (current) return toast('Ya hay una caja abierta. Ciérrala antes de abrir otra.');
  const apertura = asNumber(qs('#cash-opening-amount')?.value, 0);
  const tipoCambio = asNumber(qs('#cash-exchange-rate')?.value, state.config?.tipoCambio || 36.5);
  if (apertura < 0 || tipoCambio <= 0) return toast('Revisa apertura y tipo de cambio.');
  const shift = writeActiveShift({
    id: makeId('caja'),
    estado: 'abierto',
    fecha: todayISO(),
    apertura,
    tipoCambio,
    cobros: [],
    gastos: [],
    ingresosManuales: [],
    createdAtLocal: nowISO(),
  });
  state.config = { ...state.config, tipoCambio };
  localStorage.setItem(CONFIG_KEY, JSON.stringify({ tipoCambio }));
  refreshState();
  renderCaja();
  toast('Caja abierta. Ya puedes registrar gastos y cobros.');
  await persistShift(shift, true);
  try { await setDoc(configRef, { tipoCambio, updatedAt: serverTimestamp() }, { merge: true }); } catch {}
}

export async function addCashExpense(event) {
  event?.preventDefault?.();
  const shift = getActiveShift();
  if (!shift) return toast('Primero abre caja.');
  const concepto = qs('#cash-expense-concept')?.value.trim();
  const monto = asNumber(qs('#cash-expense-amount')?.value, 0);
  if (!concepto || monto <= 0) return toast('Ingresa concepto y monto válido.');
  const gasto = { id: makeId('gasto'), concepto, monto, fecha: todayISO(), createdAtLocal: nowISO() };
  const updated = writeActiveShift({ ...shift, gastos: [...(shift.gastos || []), gasto] });
  qs('#cash-expense-form')?.reset();
  refreshState();
  renderCaja();
  toast('Gasto registrado.');
  await persistShift(updated, true);
}

function requireAdminExpenseAction() {
  if ((state.usuarioInterno?.rol || 'admin') !== 'admin') {
    toast('Solo el administrador puede editar o eliminar gastos.');
    return false;
  }
  return true;
}

export async function editCashExpense(expenseId) {
  if (!requireAdminExpenseAction()) return;
  const shift = getActiveShift();
  if (!shift) return toast('No hay caja abierta.');
  const gasto = (shift.gastos || []).find(g => g.id === expenseId);
  if (!gasto) return toast('No encontré ese gasto.');
  const concepto = prompt('Editar concepto del gasto:', gasto.concepto || '');
  if (concepto === null) return;
  const montoText = prompt('Editar monto del gasto C$:', String(gasto.monto || 0));
  if (montoText === null) return;
  const monto = asNumber(montoText, 0);
  if (!concepto.trim() || monto <= 0) return toast('Concepto y monto deben ser válidos.');
  const gastos = (shift.gastos || []).map(g => g.id === expenseId ? { ...g, concepto: concepto.trim(), monto, editado: true, editadoEn: nowISO() } : g);
  const updated = writeActiveShift({ ...shift, gastos });
  refreshState();
  renderCaja();
  toast('Gasto actualizado.');
  await persistShift(updated, true);
}

export async function deleteCashExpense(expenseId) {
  if (!requireAdminExpenseAction()) return;
  const shift = getActiveShift();
  if (!shift) return toast('No hay caja abierta.');
  const gasto = (shift.gastos || []).find(g => g.id === expenseId);
  if (!gasto) return toast('No encontré ese gasto.');
  if (!confirm(`¿Eliminar este gasto?\n\n${gasto.concepto || ''} - ${money(gasto.monto, 'C$')}`)) return;
  const updated = writeActiveShift({ ...shift, gastos: (shift.gastos || []).filter(g => g.id !== expenseId) });
  refreshState();
  renderCaja();
  toast('Gasto eliminado.');
  await persistShift(updated, true);
}

export async function addManualIncome(event) {
  event?.preventDefault?.();
  const shift = getActiveShift();
  if (!shift) return toast('Primero abre caja.');
  const concepto = qs('#cash-income-concept')?.value.trim();
  const monto = asNumber(qs('#cash-income-amount')?.value, 0);
  if (!concepto || monto <= 0) return toast('Ingresa concepto y monto válido.');
  const ingreso = { id: makeId('ingreso'), concepto, monto, fecha: todayISO(), createdAtLocal: nowISO() };
  const updated = writeActiveShift({ ...shift, ingresosManuales: [...(shift.ingresosManuales || []), ingreso] });
  qs('#cash-income-form')?.reset();
  refreshState();
  renderCaja();
  toast('Ingreso registrado.');
  await persistShift(updated, true);
}

export function closeCashShift(event) {
  event?.preventDefault?.();
  const shift = getActiveShift();
  if (!shift) return toast('No hay caja abierta.');
  const totals = shiftTotals(shift);
  if (qs('#close-expected')) qs('#close-expected').textContent = money(totals.efectivoEsperado, 'C$');
  if (qs('#close-exchange-label')) qs('#close-exchange-label').textContent = `Dólares a C$ con TC ${totals.tipoCambio.toFixed(2)}`;
  qs('#cash-close-form')?.reset();
  renderCloseTotal();
  openDialog('#cash-close-dialog');
}

export function renderCloseTotal() {
  const counts = DENOMS.reduce((sum, d) => sum + d * asNumber(qs(`#denom-${d}`)?.value, 0), 0);
  const usd = asNumber(qs('#close-usd-amount')?.value, 0);
  const tc = asNumber(getActiveShift()?.tipoCambio, state.config?.tipoCambio || 36.5);
  const total = counts + usd * tc;
  if (qs('#close-counted-total')) qs('#close-counted-total').textContent = money(total, 'C$');
  return { counts, usd, tc, total };
}
function collectDenominations() {
  return DENOMS.reduce((acc, d) => {
    acc[d] = asNumber(qs(`#denom-${d}`)?.value, 0);
    return acc;
  }, {});
}
async function finalizeClose({ administrativo = false } = {}) {
  if (closingBusy) return;
  closingBusy = true;
  try {
    const shift = getActiveShift();
    if (!shift) {
      writeActiveShift(null);
      refreshState();
      renderCaja();
      toast('No hay caja abierta.');
      return;
    }
    const totals = shiftTotals(shift);
    const counted = administrativo ? { total: totals.efectivoEsperado, usd: 0, tc: totals.tipoCambio } : renderCloseTotal();
    const diferencia = counted.total - totals.efectivoEsperado;
    const closedShift = saveClosedShift({
      ...shift,
      estado: 'cerrado',
      cierre: counted.total,
      conteo: administrativo ? {} : collectDenominations(),
      dolaresContados: counted.usd,
      tipoCambioCierre: counted.tc,
      diferencia,
      cierreAdministrativo: administrativo,
      totales: totals,
      closedAtLocal: nowISO(),
    });
    writeActiveShift(null);
    closeDialog('#cash-close-dialog');
    refreshState();
    renderCaja();
    toast(administrativo ? 'Caja cerrada administrativamente.' : `Caja cerrada. Diferencia: ${money(diferencia, 'C$')}`);
    await persistShift(closedShift, true);
  } finally {
    closingBusy = false;
  }
}

export async function confirmCloseCashShift(event) {
  event?.preventDefault?.();
  await finalizeClose({ administrativo: false });
}

export async function forceCloseActiveShift(event) {
  event?.preventDefault?.();
  if (!confirm('¿Cerrar administrativamente o destrabar la caja de este navegador?')) return;
  const shift = getActiveShift();
  if (shift) {
    await finalizeClose({ administrativo: true });
    return;
  }
  writeActiveShift(null);
  clearOldCashKeys();
  refreshState();
  renderCaja();
  toast('Caja local destrabada. Ya puedes abrir un turno nuevo.');
  try {
    const snap = await getDocs(cajaTurnosRef);
    await Promise.all(snap.docs.map(d => {
      const data = d.data();
      if (!isOpen(data.estado)) return Promise.resolve();
      return setDoc(doc(db, 'cajaTurnos', d.id), { estado: 'cerrado', cierreAdministrativo: true, updatedAt: serverTimestamp() }, { merge: true });
    }));
  } catch (error) {
    console.warn('No se pudo limpiar caja remota:', error);
  }
}

export function printExpenseTicket(expenseId, fallback = null) {
  const shift = getActiveShift();
  const gasto = fallback || (shift?.gastos || []).find(g => g.id === expenseId);
  if (!gasto) return toast('No encontré el gasto para imprimir.');
  openTicketWindow(`
    <div class="ticket-center"><strong>${BUSINESS_NAME}</strong><br><small>Comprobante de gasto / salida</small></div>
    <hr>
    <p><strong>Fecha:</strong> ${escapeHtml(gasto.fecha || todayISO())}<br><strong>Concepto:</strong> ${escapeHtml(gasto.concepto || '')}</p>
    <p class="ticket-total">Salida de caja: ${money(gasto.monto, 'C$')}</p>
    <hr><p>Firma: ____________________</p>
  `, `ticket-gasto-${expenseId}`);
}
