import { state } from './state.js';
import { cajaTurnosRef, configRef, addDoc, doc, updateDoc, onSnapshot, serverTimestamp, db, setDoc, getDocs } from './firebase.js';
import { qs, setEmpty, toast, openDialog, closeDialog } from './ui.js';
import { calcPedido, escapeHtml, money, todayISO, shortOrderDescription, openTicketWindow, BUSINESS_NAME } from './utils.js';

const DENOMS = [1, 5, 10, 20, 50, 100, 200, 500, 1000];
const SHIFT_ID_KEY = 'pos_cash_active_shift_id_v4';
const SHIFT_LOCAL_KEY = 'pos_cash_active_shift_v4';
const CLOSED_LOCAL_KEY = 'pos_cash_closed_shifts_v4';
const IGNORED_LOCAL_KEY = 'pos_cash_ignored_shift_ids_v4';
let closingInProgress = false;

function nowISO() { return new Date().toISOString(); }
function normalize(value = '') { return String(value || '').trim().toLowerCase(); }
function isOpenStatus(value = '') { return ['abierto', 'abierta', 'activo', 'activa', 'open'].includes(normalize(value)); }
function ignoredShiftIds() { return safeParse(localStorage.getItem(IGNORED_LOCAL_KEY), []); }
function rememberIgnoredShift(id) { if (!id) return; const ids = Array.from(new Set([...ignoredShiftIds(), id])); localStorage.setItem(IGNORED_LOCAL_KEY, JSON.stringify(ids)); }
function isIgnoredShift(t = {}) { return ignoredShiftIds().includes(t.id); }
function isOpenShift(t = {}) { return isOpenStatus(t.estado) && !isIgnoredShift(t); }
function isClosedStatus(value = '') { return ['cerrado', 'cerrada', 'closed'].includes(normalize(value)); }
function safeParse(raw, fallback) { try { return JSON.parse(raw); } catch { return fallback; } }
function activeId() { return state.currentCashShiftId || localStorage.getItem(SHIFT_ID_KEY) || ''; }
function storedShift() {
  const shift = safeParse(localStorage.getItem(SHIFT_LOCAL_KEY), null);
  if (!shift?.id || isClosedStatus(shift.estado)) return null;
  return shift;
}
function setStoredShift(shift) {
  if (!shift || isClosedStatus(shift.estado)) {
    state.currentCashShiftId = '';
    localStorage.removeItem(SHIFT_ID_KEY);
    localStorage.removeItem(SHIFT_LOCAL_KEY);
    return;
  }
  state.currentCashShiftId = shift.id;
  localStorage.setItem(SHIFT_ID_KEY, shift.id);
  localStorage.setItem(SHIFT_LOCAL_KEY, JSON.stringify(shift));
}
function saveClosedLocal(shift) {
  const list = safeParse(localStorage.getItem(CLOSED_LOCAL_KEY), []);
  const next = [{ ...shift, estado: 'cerrado' }, ...list.filter(t => t.id !== shift.id)].slice(0, 30);
  localStorage.setItem(CLOSED_LOCAL_KEY, JSON.stringify(next));
}
function upsertShift(shift) {
  if (!shift?.id) return;
  const i = state.cajaTurnos.findIndex(t => t.id === shift.id);
  if (i >= 0) state.cajaTurnos[i] = { ...state.cajaTurnos[i], ...shift };
  else state.cajaTurnos.unshift(shift);
}
function mergeById(a = [], b = []) {
  const map = new Map();
  [...a, ...b].forEach(x => { if (x?.id) map.set(x.id, { ...(map.get(x.id) || {}), ...x }); });
  return Array.from(map.values());
}
function sortShifts(list = []) {
  return [...list].sort((a, b) => {
    const av = a.createdAt?.seconds || Date.parse(a.createdAtLocal || a.fecha || '') / 1000 || 0;
    const bv = b.createdAt?.seconds || Date.parse(b.createdAtLocal || b.fecha || '') / 1000 || 0;
    return bv - av;
  });
}
function normalizeMethod(method = 'efectivo') {
  const m = normalize(method);
  if (m.includes('tarjeta')) return 'tarjeta';
  if (m.includes('transfer')) return 'transferencia';
  return 'efectivo';
}

function snapshotShift() {
  const local = storedShift();
  if (local) {
    upsertShift(local);
    return local;
  }
  const id = activeId();
  if (id) {
    const found = state.cajaTurnos.find(t => t.id === id && isOpenShift(t));
    if (found) {
      setStoredShift(found);
      return found;
    }
  }
  const remote = sortShifts(state.cajaTurnos.filter(isOpenShift))[0] || null;
  if (remote) setStoredShift(remote);
  return remote;
}

export function getActiveShift() {
  return snapshotShift();
}

async function persistShift(shift, { silent = false } = {}) {
  if (!shift?.id) return false;
  const clean = {
    estado: shift.estado || 'abierto',
    fecha: shift.fecha || todayISO(),
    apertura: Number(shift.apertura || 0),
    tipoCambio: Number(shift.tipoCambio || state.config?.tipoCambio || 36.5),
    gastos: shift.gastos || [],
    ingresosManuales: shift.ingresosManuales || [],
    cobros: shift.cobros || [],
    cierre: shift.cierre ?? null,
    conteo: shift.conteo || {},
    dolaresContados: Number(shift.dolaresContados || 0),
    diferencia: Number(shift.diferencia || 0),
    cierreAdministrativo: !!shift.cierreAdministrativo,
    updatedAtLocal: nowISO(),
    updatedAt: serverTimestamp()
  };
  if (String(shift.id).startsWith('local-')) return false;
  try {
    await setDoc(doc(db, 'cajaTurnos', shift.id), clean, { merge: true });
    return true;
  } catch (error) {
    console.error('Caja: no se pudo sincronizar turno:', error);
    if (!silent) toast('Caja guardada localmente. Firebase no permitió sincronizar todavía.');
    return false;
  }
}

export function listenCaja() {
  const unsubShifts = onSnapshot(cajaTurnosRef, snap => {
    const remote = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const local = storedShift();
    state.cajaTurnos = local ? mergeById(remote, [local]) : remote;
    renderCaja();
  }, error => {
    console.error('Caja: error leyendo Firebase:', error);
    const local = storedShift();
    if (local) upsertShift(local);
    renderCaja();
  });

  const unsubConfig = onSnapshot(configRef, snap => {
    if (snap.exists()) state.config = { ...state.config, ...snap.data() };
    renderCaja();
  }, error => {
    console.warn('Caja: no se pudo leer config:', error);
    renderCaja();
  });

  const local = storedShift();
  if (local) upsertShift(local);
  renderCaja();
  return () => { unsubShifts(); unsubConfig(); };
}

export function getPaymentsForShift(shift = getActiveShift()) {
  if (!shift) return [];
  const rows = [];
  const seen = new Set();
  function push(row) {
    const pay = row.pago || {};
    const key = pay.cashId || pay.id || `${row.pedido?.id || pay.pedidoId || ''}|${pay.fecha || ''}|${pay.metodo || ''}|${row.monto || pay.monto || 0}`;
    if (seen.has(key)) return;
    seen.add(key);
    rows.push(row);
  }
  (shift.cobros || []).forEach(c => {
    const pedido = state.pedidos.find(p => p.id === c.pedidoId) || { id: c.pedidoId || '', cliente: c.cliente || 'Venta / cobro', moneda: c.moneda || 'C$', descripcion: c.descripcion || c.nota || 'Cobro' };
    push({ pedido, pago: c, monto: Number(c.monto || 0), moneda: c.moneda || pedido.moneda || 'C$', metodo: normalizeMethod(c.metodo) });
  });
  state.pedidos.forEach(p => {
    (p.pagos || []).forEach(pay => {
      const sameShift = pay.turnoId && pay.turnoId === shift.id;
      if (sameShift) push({ pedido: p, pago: pay, monto: Number(pay.monto || 0), moneda: pay.moneda || p.moneda || 'C$', metodo: normalizeMethod(pay.metodo) });
    });
  });
  return rows;
}

export async function registerCashReceipt({ pedidoId = '', cliente = '', descripcion = '', monto = 0, moneda = 'C$', metodo = 'efectivo', nota = 'Cobro registrado', cashId = '' } = {}) {
  const shift = getActiveShift();
  const amount = Number(monto || 0);
  if (!shift || amount <= 0) return null;
  const id = cashId || crypto.randomUUID();
  const cobro = { id, cashId: id, pedidoId, cliente, descripcion, monto: amount, moneda, metodo: normalizeMethod(metodo), nota, fecha: todayISO(), createdAtLocal: nowISO(), turnoId: shift.id };
  if (!(shift.cobros || []).some(c => c.cashId === id || c.id === id)) {
    const updated = { ...shift, cobros: [...(shift.cobros || []), cobro], updatedAtLocal: nowISO() };
    upsertShift(updated);
    setStoredShift(updated);
    renderCaja();
    await persistShift(updated, { silent: true });
  }
  return cobro;
}

function shiftTotals(shift = getActiveShift()) {
  const tc = Number(shift?.tipoCambio || state.config?.tipoCambio || 36.5);
  const apertura = Number(shift?.apertura || 0);
  const gastos = (shift?.gastos || []).reduce((s, g) => s + Number(g.monto || 0), 0);
  const ingresosManual = (shift?.ingresosManuales || []).reduce((s, g) => s + Number(g.monto || 0), 0);
  const payments = getPaymentsForShift(shift);
  const toCs = r => r.moneda === '$' ? Number(r.monto || 0) * tc : Number(r.monto || 0);
  const efectivo = payments.filter(r => normalizeMethod(r.metodo) === 'efectivo');
  const tarjeta = payments.filter(r => normalizeMethod(r.metodo) === 'tarjeta');
  const transferencia = payments.filter(r => normalizeMethod(r.metodo) === 'transferencia');
  const efectivoCs = efectivo.filter(r => r.moneda !== '$').reduce((s, r) => s + Number(r.monto || 0), 0);
  const efectivoUsd = efectivo.filter(r => r.moneda === '$').reduce((s, r) => s + Number(r.monto || 0), 0);
  const efectivoUsdEnCs = efectivoUsd * tc;
  const tarjetaCs = tarjeta.reduce((s, r) => s + toCs(r), 0);
  const transferenciaCs = transferencia.reduce((s, r) => s + toCs(r), 0);
  const ventasTotalCs = payments.reduce((s, r) => s + toCs(r), 0);
  const efectivoEsperado = apertura + efectivoCs + efectivoUsdEnCs + ingresosManual - gastos;
  return { apertura, gastos, ingresosManual, efectivoCs, efectivoUsd, efectivoUsdEnCs, tarjetaCs, transferenciaCs, ventasTotalCs, efectivoEsperado, tipoCambio: tc, payments };
}

export function renderCaja() {
  if (!qs('#view-caja')) return;
  const shift = getActiveShift();
  const status = qs('#cash-status');
  const openPanel = qs('#cash-open-panel');
  const activePanel = qs('#cash-active-panel');
  const pendingList = qs('#cash-pending-list');
  const movements = qs('#cash-movements');
  const summary = qs('#cash-summary');
  const closeBtn = qs('#cash-close');
  const tcInput = qs('#cash-exchange-rate');
  if (tcInput && document.activeElement !== tcInput) tcInput.value = Number(state.config?.tipoCambio || 36.5).toFixed(2);
  if (!status || !openPanel || !activePanel) return;

  if (!shift) {
    status.innerHTML = `<div class="cash-state closed"><strong>Caja cerrada</strong><span>Abre un turno para registrar ventas, cobros, gastos y hacer cierre con conteo.</span></div>`;
    openPanel.hidden = false;
    activePanel.hidden = true;
    if (closeBtn) closeBtn.disabled = true;
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
  const ingresos = (shift.ingresosManuales || []).map(g => `<tr><td>${escapeHtml(g.fecha || '')}</td><td>Ingreso extra</td><td>${escapeHtml(g.concepto || '')}</td><td>${money(g.monto, 'C$')}</td><td>-</td></tr>`).join('');
  const isAdmin = (state.usuarioInterno?.rol || 'admin') === 'admin';
  const gastos = (shift.gastos || []).map(g => `<tr><td>${escapeHtml(g.fecha || '')}</td><td>Gasto</td><td>${escapeHtml(g.concepto || '')}</td><td>-${money(g.monto, 'C$')}</td><td class="table-actions"><button class="action" data-expense-ticket="${g.id || ''}">Ticket</button>${isAdmin ? `<button class="action amber" data-expense-edit="${g.id || ''}">Editar</button><button class="action red" data-expense-delete="${g.id || ''}">Eliminar</button>` : ''}</td></tr>`).join('');
  container.innerHTML = (pagos || ingresos || gastos) ? `<div class="report-table-wrap"><table class="table"><thead><tr><th>Fecha</th><th>Tipo</th><th>Concepto</th><th>Monto</th><th>Acciones</th></tr></thead><tbody>${pagos}${ingresos}${gastos}</tbody></table></div>` : '<div class="empty">No hay movimientos en este turno.</div>';
}

function renderPendingPayments(container) {
  if (!container) return;
  const pending = state.pedidos.filter(p => (p.estado || 'Pendiente') !== 'Anulado' && calcPedido(p).saldo > 0).sort((a, b) => String(a.fecha_entrega || '').localeCompare(String(b.fecha_entrega || '')));
  if (!pending.length) return setEmpty(container, 'No hay facturas pendientes por cobrar.');
  container.innerHTML = pending.map(p => {
    const c = calcPedido(p);
    return `<article class="record-card compact-record"><div class="record-head"><div><div class="record-title">${escapeHtml(p.cliente || 'Sin cliente')}</div><div class="record-sub">${escapeHtml(shortOrderDescription(p))} · Entrega: ${escapeHtml(p.fecha_entrega || '')}</div></div><div class="record-meta"><div>${money(c.saldo, p.moneda || 'C$')}</div><div class="record-sub">Saldo</div></div></div><div class="record-actions"><button class="action green" data-order-payment="${p.id}">Cobrar / abonar</button><button class="action" data-order-detail="${p.id}">Detalle</button><button class="action" data-order-ticket="${p.id}">Ticket</button></div></article>`;
  }).join('');
}

export async function saveExchangeRate() {
  const value = Number(qs('#cash-exchange-rate')?.value || 0);
  if (value <= 0) return toast('Ingresa un tipo de cambio válido.');
  state.config = { ...state.config, tipoCambio: value };
  renderCaja();
  try { await setDoc(configRef, { tipoCambio: value, updatedAt: serverTimestamp() }, { merge: true }); toast('Tipo de cambio actualizado.'); }
  catch (error) { console.warn(error); toast('Tipo de cambio actualizado localmente.'); }
}

export async function openCashShift(event) {
  event.preventDefault();
  if (getActiveShift()) return toast('Ya hay una caja abierta. Ciérrala antes de abrir otra.');
  const apertura = Number(qs('#cash-opening-amount')?.value || 0);
  const tipoCambio = Number(qs('#cash-exchange-rate')?.value || state.config?.tipoCambio || 36.5);
  if (apertura < 0 || tipoCambio <= 0) return toast('Revisa apertura y tipo de cambio.');
  const localShift = { id: `local-${Date.now()}`, estado: 'abierto', fecha: todayISO(), apertura, tipoCambio, gastos: [], ingresosManuales: [], cobros: [], createdAtLocal: nowISO(), updatedAtLocal: nowISO(), local: true };
  upsertShift(localShift);
  setStoredShift(localShift);
  state.config = { ...state.config, tipoCambio };
  renderCaja();
  try {
    const ref = await addDoc(cajaTurnosRef, { estado: 'abierto', fecha: todayISO(), apertura, tipoCambio, gastos: [], ingresosManuales: [], cobros: [], createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    const saved = { ...localShift, id: ref.id, local: false };
    state.cajaTurnos = state.cajaTurnos.filter(t => t.id !== localShift.id);
    upsertShift(saved);
    setStoredShift(saved);
    await persistShift(saved, { silent: true });
    try { await setDoc(configRef, { tipoCambio, updatedAt: serverTimestamp() }, { merge: true }); } catch {}
    renderCaja();
    toast('Caja abierta. Ya puedes registrar gastos y cobros.');
  } catch (error) {
    console.error('No se pudo crear turno remoto:', error);
    toast('Caja abierta localmente. Firebase no permitió crear el turno remoto.');
  }
}

export async function addCashExpense(event) {
  event.preventDefault();
  const shift = getActiveShift();
  if (!shift) return toast('Primero abre caja.');
  const concepto = qs('#cash-expense-concept')?.value.trim();
  const monto = Number(qs('#cash-expense-amount')?.value || 0);
  if (!concepto || monto <= 0) return toast('Ingresa concepto y monto válido.');
  const gasto = { id: crypto.randomUUID(), concepto, monto, fecha: todayISO(), createdAtLocal: nowISO() };
  const updated = { ...shift, gastos: [...(shift.gastos || []), gasto], updatedAtLocal: nowISO() };
  upsertShift(updated);
  setStoredShift(updated);
  qs('#cash-expense-form')?.reset();
  renderCaja();
  await persistShift(updated, { silent: false });
  renderCaja();
  toast('Gasto registrado.');
  printExpenseTicket(gasto.id, gasto);
}

function requireAdminExpenseAction() {
  if ((state.usuarioInterno?.rol || 'admin') !== 'admin') { toast('Solo el administrador puede editar o eliminar gastos.'); return false; }
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
  const montoTxt = prompt('Editar monto del gasto C$:', String(gasto.monto || 0));
  if (montoTxt === null) return;
  const monto = Number(String(montoTxt).replace(',', '.'));
  if (!concepto.trim() || monto <= 0) return toast('Concepto y monto deben ser válidos.');
  const gastos = (shift.gastos || []).map(g => g.id === expenseId ? { ...g, concepto: concepto.trim(), monto, editado: true, editadoEn: nowISO() } : g);
  const updated = { ...shift, gastos, updatedAtLocal: nowISO() };
  upsertShift(updated);
  setStoredShift(updated);
  renderCaja();
  await persistShift(updated, { silent: false });
  toast('Gasto actualizado.');
}
export async function deleteCashExpense(expenseId) {
  if (!requireAdminExpenseAction()) return;
  const shift = getActiveShift();
  if (!shift) return toast('No hay caja abierta.');
  const gasto = (shift.gastos || []).find(g => g.id === expenseId);
  if (!gasto) return toast('No encontré ese gasto.');
  if (!confirm(`¿Eliminar este gasto?\n\n${gasto.concepto || ''} - ${money(gasto.monto, 'C$')}`)) return;
  const updated = { ...shift, gastos: (shift.gastos || []).filter(g => g.id !== expenseId), updatedAtLocal: nowISO() };
  upsertShift(updated);
  setStoredShift(updated);
  renderCaja();
  await persistShift(updated, { silent: false });
  toast('Gasto eliminado.');
}

export async function addManualIncome(event) {
  event.preventDefault();
  const shift = getActiveShift();
  if (!shift) return toast('Primero abre caja.');
  const concepto = qs('#cash-income-concept')?.value.trim();
  const monto = Number(qs('#cash-income-amount')?.value || 0);
  if (!concepto || monto <= 0) return toast('Ingresa concepto y monto válido.');
  const ingreso = { id: crypto.randomUUID(), concepto, monto, fecha: todayISO(), createdAtLocal: nowISO() };
  const updated = { ...shift, ingresosManuales: [...(shift.ingresosManuales || []), ingreso], updatedAtLocal: nowISO() };
  upsertShift(updated);
  setStoredShift(updated);
  qs('#cash-income-form')?.reset();
  renderCaja();
  await persistShift(updated, { silent: false });
  toast('Ingreso registrado.');
}

export function closeCashShift() {
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
  const counts = DENOMS.reduce((sum, d) => sum + d * Number(qs(`#denom-${d}`)?.value || 0), 0);
  const usd = Number(qs('#close-usd-amount')?.value || 0);
  const tc = Number(getActiveShift()?.tipoCambio || state.config?.tipoCambio || 36.5);
  const total = counts + usd * tc;
  if (qs('#close-counted-total')) qs('#close-counted-total').textContent = money(total, 'C$');
  return { counts, usd, tc, total };
}
function collectDenominations() {
  return DENOMS.reduce((acc, d) => { acc[d] = Number(qs(`#denom-${d}`)?.value || 0); return acc; }, {});
}
async function closeShiftCore({ administrativo = false } = {}) {
  if (closingInProgress) return;
  closingInProgress = true;
  try {
    const shift = getActiveShift();
    if (!shift) {
      setStoredShift(null);
      renderCaja();
      toast('No hay caja abierta. Si estaba trabada, ya se limpió localmente.');
      return;
    }
    const totals = shiftTotals(shift);
    const counted = administrativo ? { total: totals.efectivoEsperado, usd: 0, tc: totals.tipoCambio } : renderCloseTotal();
    const diferencia = counted.total - totals.efectivoEsperado;
    const closedShift = {
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
      updatedAtLocal: nowISO()
    };
    rememberIgnoredShift(shift.id);
    upsertShift(closedShift);
    saveClosedLocal(closedShift);
    setStoredShift(null);
    closeDialog('#cash-close-dialog');
    renderCaja();
    await persistShift(closedShift, { silent: true });
    toast(administrativo ? 'Caja cerrada administrativamente. Ya puedes abrir una nueva.' : `Caja cerrada. Diferencia: ${money(diferencia, 'C$')}`);
  } finally {
    closingInProgress = false;
  }
}

export async function confirmCloseCashShift(event) {
  event?.preventDefault?.();
  await closeShiftCore({ administrativo: false });
}

export async function forceCloseActiveShift() {
  if (!confirm('¿Cerrar administrativamente la caja abierta o destrabar caja local?')) return;
  const shift = getActiveShift();
  if (shift) {
    await closeShiftCore({ administrativo: true });
    return;
  }
  try {
    const snap = await getDocs(cajaTurnosRef);
    const opened = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(isOpenShift);
    for (const t of opened) {
      rememberIgnoredShift(t.id);
      await setDoc(doc(db, 'cajaTurnos', t.id), { estado: 'cerrado', cierreAdministrativo: true, updatedAt: serverTimestamp() }, { merge: true });
    }
    state.cajaTurnos = state.cajaTurnos.map(t => isOpenShift(t) ? { ...t, estado: 'cerrado', cierreAdministrativo: true } : t);
    setStoredShift(null);
    renderCaja();
    toast('Recuperación aplicada. Ya puedes abrir una caja nueva.');
  } catch (error) {
    console.error('Recuperación falló:', error);
    setStoredShift(null);
    renderCaja();
    toast('Caja local destrabada. Firebase no permitió revisar turnos.');
  }
}

export function printExpenseTicket(expenseId, fallback = null) {
  const shift = getActiveShift();
  const gasto = fallback || (shift?.gastos || []).find(g => g.id === expenseId);
  if (!gasto) return toast('No encontré el gasto para imprimir.');
  openTicketWindow(`<div class="ticket-center"><strong>${BUSINESS_NAME}</strong><br><small>Comprobante de gasto / salida</small></div><hr><p><strong>Fecha:</strong> ${escapeHtml(gasto.fecha || todayISO())}<br><strong>Concepto:</strong> ${escapeHtml(gasto.concepto || '')}</p><p class="ticket-total">Salida de caja: ${money(gasto.monto, 'C$')}</p><hr><p>Firma: ____________________</p>`, `ticket-gasto-${expenseId}`);
}
