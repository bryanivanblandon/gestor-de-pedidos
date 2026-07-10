import { state } from './state.js';
import { cajaTurnosRef, configRef, addDoc, doc, updateDoc, onSnapshot, serverTimestamp, db, arrayUnion, setDoc, getDocs } from './firebase.js';
import { qs, setEmpty, toast, openDialog, closeDialog } from './ui.js';
import { calcPedido, escapeHtml, money, todayISO, shortOrderDescription, openTicketWindow, BUSINESS_NAME } from './utils.js';

const DENOMS = [1, 5, 10, 20, 50, 100, 200, 500, 1000];
const CASH_SHIFT_KEY = 'pos_current_cash_shift_id_v2';
const CASH_LOCAL_KEY = 'pos_local_cash_shift_v2';

function safeJSON(value, fallback = null) {
  try { return JSON.parse(value); } catch { return fallback; }
}

function normalizeStatus(value = '') {
  return String(value || '').trim().toLowerCase();
}

function isOpenStatus(value = '') {
  const status = normalizeStatus(value);
  return ['abierto', 'abierta', 'activo', 'activa', 'open'].includes(status);
}

function isClosedStatus(value = '') {
  const status = normalizeStatus(value);
  return ['cerrado', 'cerrada', 'closed'].includes(status);
}

function shiftSortValue(t = {}) {
  if (typeof t.createdAt?.seconds === 'number') return t.createdAt.seconds;
  if (typeof t.updatedAt?.seconds === 'number') return t.updatedAt.seconds;
  const parsed = Date.parse(t.fecha || '');
  return Number.isNaN(parsed) ? 0 : parsed / 1000;
}

function getStoredShiftId() {
  return state.currentCashShiftId || localStorage.getItem(CASH_SHIFT_KEY) || '';
}

function setCurrentShift(shift) {
  if (!shift) {
    state.currentCashShiftId = '';
    localStorage.removeItem(CASH_SHIFT_KEY);
    localStorage.removeItem(CASH_LOCAL_KEY);
    return;
  }
  state.currentCashShiftId = shift.id;
  localStorage.setItem(CASH_SHIFT_KEY, shift.id);
  localStorage.setItem(CASH_LOCAL_KEY, JSON.stringify(shift));
}

function getLocalShift() {
  const local = safeJSON(localStorage.getItem(CASH_LOCAL_KEY), null);
  if (!local?.id || isClosedStatus(local.estado)) return null;
  return local;
}

function upsertShift(shift) {
  if (!shift?.id) return;
  const idx = state.cajaTurnos.findIndex(t => t.id === shift.id);
  if (idx >= 0) state.cajaTurnos[idx] = { ...state.cajaTurnos[idx], ...shift };
  else state.cajaTurnos.push(shift);
}

function openShifts() {
  return state.cajaTurnos
    .filter(t => isOpenStatus(t.estado))
    .sort((a, b) => shiftSortValue(b) - shiftSortValue(a));
}

export function getActiveShift() {
  const storedId = getStoredShiftId();
  if (storedId) {
    const found = state.cajaTurnos.find(t => t.id === storedId);
    if (found && !isClosedStatus(found.estado)) return found;
    const local = getLocalShift();
    if (local && local.id === storedId) {
      upsertShift(local);
      return local;
    }
  }

  const local = getLocalShift();
  if (local) {
    upsertShift(local);
    return local;
  }

  const remoteOpen = openShifts()[0];
  if (remoteOpen) {
    setCurrentShift(remoteOpen);
    return remoteOpen;
  }

  return null;
}

export function listenCaja() {
  const unsubShifts = onSnapshot(cajaTurnosRef, snap => {
    const remote = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const current = getLocalShift();
    state.cajaTurnos = current ? [current, ...remote.filter(t => t.id !== current.id)] : remote;
    renderCaja();
  }, error => {
    console.error('Caja: error sincronizando turnos:', error);
    toast('Caja no pudo sincronizar con Firebase, pero puedes probar la caja local en este navegador.');
    renderCaja();
  });

  const unsubConfig = onSnapshot(configRef, snap => {
    if (snap.exists()) state.config = { ...state.config, ...snap.data() };
    renderCaja();
  }, error => {
    console.error('Caja: error leyendo configuración:', error);
    renderCaja();
  });

  renderCaja();
  return () => { unsubShifts(); unsubConfig(); };
}

export function getPaymentsForShift(shift = getActiveShift()) {
  if (!shift) return [];
  const rows = [];
  state.pedidos.forEach(p => {
    (p.pagos || []).forEach(pay => {
      const sameShift = pay.turnoId && pay.turnoId === shift.id;
      const sameDateNoShift = !pay.turnoId && (pay.fecha || '').slice(0, 10) === (shift.fecha || todayISO());
      if (sameShift || sameDateNoShift) {
        rows.push({
          pedido: p,
          pago: pay,
          monto: Number(pay.monto || 0),
          moneda: p.moneda || 'C$',
          metodo: pay.metodo || 'efectivo'
        });
      }
    });
  });
  return rows;
}

function shiftTotals(shift = getActiveShift()) {
  const tc = Number(shift?.tipoCambio || state.config?.tipoCambio || 36.5);
  const apertura = Number(shift?.apertura || 0);
  const gastos = (shift?.gastos || []).reduce((s, g) => s + Number(g.monto || 0), 0);
  const ingresosManual = (shift?.ingresosManuales || []).reduce((s, g) => s + Number(g.monto || 0), 0);
  const payments = getPaymentsForShift(shift);

  const toCs = r => (r.moneda === '$' ? r.monto * tc : r.monto);
  const efectivo = payments.filter(r => (r.metodo || 'efectivo') === 'efectivo');
  const tarjeta = payments.filter(r => (r.metodo || '') === 'tarjeta');
  const transferencia = payments.filter(r => (r.metodo || '') === 'transferencia');
  const efectivoCs = efectivo.filter(r => r.moneda !== '$').reduce((s, r) => s + r.monto, 0);
  const efectivoUsd = efectivo.filter(r => r.moneda === '$').reduce((s, r) => s + r.monto, 0);
  const tarjetaCs = tarjeta.reduce((s, r) => s + toCs(r), 0);
  const transferenciaCs = transferencia.reduce((s, r) => s + toCs(r), 0);
  const ventasTotalCs = payments.reduce((s, r) => s + toCs(r), 0);
  const efectivoUsdEnCs = efectivoUsd * tc;
  const efectivoEsperado = apertura + efectivoCs + efectivoUsdEnCs + ingresosManual - gastos;

  return { apertura, gastos, ingresosManual, efectivoCs, efectivoUsd, efectivoUsdEnCs, tarjetaCs, transferenciaCs, ventasTotalCs, efectivoEsperado, tipoCambio: tc, payments };
}

export function renderCaja() {
  const view = qs('#view-caja');
  if (!view) return;

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
    status.innerHTML = `
      <div class="cash-state closed">
        <strong>Caja cerrada</strong>
        <span>Abre un turno para registrar ventas, cobros, gastos y hacer cierre con conteo.</span>
      </div>`;
    openPanel.hidden = false;
    activePanel.hidden = true;
    if (closeBtn) closeBtn.disabled = true;
  } else {
    const totals = shiftTotals(shift);
    status.innerHTML = `
      <div class="cash-state open">
        <strong>Caja abierta</strong>
        <span>Turno: ${escapeHtml(shift.id || '')} · Fecha: ${escapeHtml(shift.fecha || todayISO())} · TC: C$${totals.tipoCambio.toFixed(2)}</span>
      </div>
      <div class="cash-formula"><strong>Fórmula:</strong> Apertura + efectivo recibido + ingresos extra - gastos = efectivo esperado.</div>`;
    openPanel.hidden = true;
    activePanel.hidden = false;
    if (closeBtn) closeBtn.disabled = false;
    if (summary) {
      summary.innerHTML = `
        <div class="summary-card"><span>Apertura</span><strong>${money(totals.apertura, 'C$')}</strong></div>
        <div class="summary-card"><span>Efectivo C$</span><strong>${money(totals.efectivoCs, 'C$')}</strong></div>
        <div class="summary-card"><span>Efectivo $</span><strong>${money(totals.efectivoUsd, '$')}</strong><small>${money(totals.efectivoUsdEnCs, 'C$')}</small></div>
        <div class="summary-card"><span>Tarjeta</span><strong>${money(totals.tarjetaCs, 'C$')}</strong><small>No suma al efectivo físico</small></div>
        <div class="summary-card"><span>Transferencia</span><strong>${money(totals.transferenciaCs, 'C$')}</strong><small>No suma al efectivo físico</small></div>
        <div class="summary-card"><span>Ingresos extra</span><strong>${money(totals.ingresosManual, 'C$')}</strong></div>
        <div class="summary-card danger-summary"><span>Gastos</span><strong>-${money(totals.gastos, 'C$')}</strong></div>
        <div class="summary-card expected-summary"><span>Efectivo esperado</span><strong>${money(totals.efectivoEsperado, 'C$')}</strong></div>`;
    }
    renderMovements(shift, totals, movements);
  }

  renderPendingPayments(pendingList);
}

function renderMovements(shift, totals, container) {
  if (!container) return;
  const pagos = totals.payments.map(r => `<tr><td>${escapeHtml(r.pago.fecha || '')}</td><td>Cobro ${escapeHtml(r.metodo || 'efectivo')}</td><td>${escapeHtml(r.pedido.cliente || '')} · ${escapeHtml(shortOrderDescription(r.pedido))}</td><td>${money(r.monto, r.moneda)}</td><td><button class="action" data-order-ticket="${r.pedido.id}">Ticket</button></td></tr>`).join('');
  const ingresos = (shift.ingresosManuales || []).map(g => `<tr><td>${escapeHtml(g.fecha || '')}</td><td>Ingreso extra</td><td>${escapeHtml(g.concepto || '')}</td><td>${money(g.monto, 'C$')}</td><td>-</td></tr>`).join('');
  const gastos = (shift.gastos || []).map(g => `<tr><td>${escapeHtml(g.fecha || '')}</td><td>Gasto</td><td>${escapeHtml(g.concepto || '')}</td><td>-${money(g.monto, 'C$')}</td><td><button class="action" data-expense-ticket="${g.id || ''}">Ticket</button></td></tr>`).join('');
  container.innerHTML = (pagos || ingresos || gastos)
    ? `<div class="report-table-wrap"><table class="table"><thead><tr><th>Fecha</th><th>Tipo</th><th>Concepto</th><th>Monto</th><th>Ticket</th></tr></thead><tbody>${pagos}${ingresos}${gastos}</tbody></table></div>`
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
    return `<article class="record-card compact-record">
      <div class="record-head"><div><div class="record-title">${escapeHtml(p.cliente || 'Sin cliente')}</div><div class="record-sub">${escapeHtml(shortOrderDescription(p))} · Entrega: ${escapeHtml(p.fecha_entrega || '')}</div></div><div class="record-meta"><div>${money(c.saldo, p.moneda || 'C$')}</div><div class="record-sub">Saldo</div></div></div>
      <div class="record-actions"><button class="action green" data-order-payment="${p.id}">Cobrar / abonar</button><button class="action" data-order-detail="${p.id}">Detalle</button><button class="action" data-order-ticket="${p.id}">Ticket</button></div>
    </article>`;
  }).join('');
}

export async function saveExchangeRate() {
  const value = Number(qs('#cash-exchange-rate')?.value || 0);
  if (value <= 0) return toast('Ingresa un tipo de cambio válido.');
  state.config = { ...state.config, tipoCambio: value };
  renderCaja();
  try {
    await setDoc(configRef, { tipoCambio: value, updatedAt: serverTimestamp() }, { merge: true });
    toast('Tipo de cambio actualizado.');
  } catch (error) {
    console.error('No se pudo guardar TC:', error);
    toast('Tipo de cambio actualizado localmente. Firebase no permitió guardar config.');
  }
}

export async function openCashShift(event) {
  event.preventDefault();
  if (getActiveShift()) return toast('Ya hay una caja abierta en este navegador. Ciérrala antes de abrir otra.');

  const apertura = Number(qs('#cash-opening-amount')?.value || 0);
  const tipoCambio = Number(qs('#cash-exchange-rate')?.value || state.config?.tipoCambio || 36.5);
  if (apertura < 0 || tipoCambio <= 0) return toast('Revisa apertura y tipo de cambio.');

  const tempId = `local-${Date.now()}`;
  const localShift = { id: tempId, estado: 'abierto', fecha: todayISO(), apertura, tipoCambio, gastos: [], ingresosManuales: [], local: true };
  upsertShift(localShift);
  setCurrentShift(localShift);
  state.config = { ...state.config, tipoCambio };
  renderCaja();

  try {
    const ref = await addDoc(cajaTurnosRef, { estado: 'abierto', fecha: todayISO(), apertura, tipoCambio, gastos: [], ingresosManuales: [], createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    const saved = { ...localShift, id: ref.id, local: false };
    state.cajaTurnos = state.cajaTurnos.filter(t => t.id !== tempId);
    upsertShift(saved);
    setCurrentShift(saved);
    try { await setDoc(configRef, { tipoCambio, updatedAt: serverTimestamp() }, { merge: true }); } catch {}
    renderCaja();
    toast('Caja abierta. Ya puedes registrar gastos y cobros.');
  } catch (error) {
    console.error('No se pudo crear turno en Firebase:', error);
    toast('Caja abierta solo en este navegador. Firebase no permitió crear el turno; revisa reglas después.');
  }
}

export async function addCashExpense(event) {
  event.preventDefault();
  const shift = getActiveShift();
  if (!shift) return toast('Primero abre caja.');
  const concepto = qs('#cash-expense-concept')?.value.trim();
  const monto = Number(qs('#cash-expense-amount')?.value || 0);
  if (!concepto || monto <= 0) return toast('Ingresa concepto y monto válido.');
  const gasto = { id: crypto.randomUUID(), concepto, monto, fecha: todayISO() };
  const updated = { ...shift, gastos: [...(shift.gastos || []), gasto], updatedAtLocal: new Date().toISOString() };
  upsertShift(updated);
  setCurrentShift(updated);
  renderCaja();
  qs('#cash-expense-form')?.reset();

  if (!String(shift.id).startsWith('local-')) {
    try {
      await updateDoc(doc(db, 'cajaTurnos', shift.id), { gastos: arrayUnion(gasto), updatedAt: serverTimestamp() });
    } catch (error) {
      console.error('No se pudo guardar gasto en Firebase:', error);
      toast('Gasto guardado localmente. Firebase no permitió sincronizarlo.');
      return;
    }
  }
  toast('Gasto registrado.');
  printExpenseTicket(gasto.id, gasto);
}

export async function addManualIncome(event) {
  event.preventDefault();
  const shift = getActiveShift();
  if (!shift) return toast('Primero abre caja.');
  const concepto = qs('#cash-income-concept')?.value.trim();
  const monto = Number(qs('#cash-income-amount')?.value || 0);
  if (!concepto || monto <= 0) return toast('Ingresa concepto y monto válido.');
  const ingreso = { id: crypto.randomUUID(), concepto, monto, fecha: todayISO() };
  const updated = { ...shift, ingresosManuales: [...(shift.ingresosManuales || []), ingreso], updatedAtLocal: new Date().toISOString() };
  upsertShift(updated);
  setCurrentShift(updated);
  renderCaja();
  qs('#cash-income-form')?.reset();

  if (!String(shift.id).startsWith('local-')) {
    try {
      await updateDoc(doc(db, 'cajaTurnos', shift.id), { ingresosManuales: arrayUnion(ingreso), updatedAt: serverTimestamp() });
    } catch (error) {
      console.error('No se pudo guardar ingreso en Firebase:', error);
      toast('Ingreso guardado localmente. Firebase no permitió sincronizarlo.');
      return;
    }
  }
  toast('Ingreso registrado.');
}

export function closeCashShift() {
  const shift = getActiveShift();
  if (!shift) return toast('No hay caja abierta.');
  const totals = shiftTotals(shift);
  const expected = qs('#close-expected');
  const label = qs('#close-exchange-label');
  if (expected) expected.textContent = money(totals.efectivoEsperado, 'C$');
  if (label) label.textContent = `Dólares a C$ con TC ${totals.tipoCambio.toFixed(2)}`;
  qs('#cash-close-form')?.reset();
  renderCloseTotal();
  openDialog('#cash-close-dialog');
}

export function renderCloseTotal() {
  const counts = DENOMS.reduce((sum, d) => sum + d * Number(qs(`#denom-${d}`)?.value || 0), 0);
  const usd = Number(qs('#close-usd-amount')?.value || 0);
  const tc = Number(getActiveShift()?.tipoCambio || state.config?.tipoCambio || 36.5);
  const total = counts + usd * tc;
  const totalEl = qs('#close-counted-total');
  if (totalEl) totalEl.textContent = money(total, 'C$');
  return { counts, usd, tc, total };
}

function collectDenominations() {
  return DENOMS.reduce((acc, d) => {
    acc[d] = Number(qs(`#denom-${d}`)?.value || 0);
    return acc;
  }, {});
}

export async function confirmCloseCashShift(event) {
  event.preventDefault();
  const shift = getActiveShift();
  if (!shift) return toast('No hay caja abierta.');
  const totals = shiftTotals(shift);
  const counted = renderCloseTotal();
  const diferencia = counted.total - totals.efectivoEsperado;
  const closedPayload = {
    estado: 'cerrado',
    cierre: counted.total,
    conteo: collectDenominations(),
    dolaresContados: counted.usd,
    tipoCambioCierre: counted.tc,
    diferencia,
    totales: totals,
    closedAtLocal: new Date().toISOString()
  };

  const closedShift = { ...shift, ...closedPayload };
  upsertShift(closedShift);
  setCurrentShift(null);
  renderCaja();
  closeDialog('#cash-close-dialog');

  if (!String(shift.id).startsWith('local-')) {
    try {
      await updateDoc(doc(db, 'cajaTurnos', shift.id), { ...closedPayload, closedAt: serverTimestamp(), updatedAt: serverTimestamp() });
    } catch (error) {
      console.error('No se pudo cerrar en Firebase:', error);
      toast(`Caja cerrada localmente. Firebase no permitió actualizar. Diferencia: ${money(diferencia, 'C$')}`);
      return;
    }
  }
  toast(`Caja cerrada. Diferencia: ${money(diferencia, 'C$')}`);
}

export async function forceCloseActiveShift() {
  const shift = getActiveShift();
  if (shift) {
    setCurrentShift(null);
    state.cajaTurnos = state.cajaTurnos.map(t => t.id === shift.id ? { ...t, estado: 'cerrado', cierreAdministrativo: true } : t);
    renderCaja();
    if (!String(shift.id).startsWith('local-')) {
      try {
        await updateDoc(doc(db, 'cajaTurnos', shift.id), { estado: 'cerrado', cierreAdministrativo: true, updatedAt: serverTimestamp() });
      } catch (error) {
        console.warn('No se pudo cerrar administrativamente en Firebase:', error);
      }
    }
    toast('Caja destrabada en este navegador. Ya puedes abrir una nueva.');
    return;
  }

  try {
    const snap = await getDocs(cajaTurnosRef);
    const opened = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(t => isOpenStatus(t.estado));
    for (const t of opened) {
      try { await updateDoc(doc(db, 'cajaTurnos', t.id), { estado: 'cerrado', cierreAdministrativo: true, updatedAt: serverTimestamp() }); } catch {}
    }
    state.cajaTurnos = state.cajaTurnos.map(t => isOpenStatus(t.estado) ? { ...t, estado: 'cerrado', cierreAdministrativo: true } : t);
    setCurrentShift(null);
    renderCaja();
    toast('Recuperación aplicada. Ya puedes abrir una caja nueva.');
  } catch (error) {
    console.error('Recuperación no pudo leer Firebase:', error);
    setCurrentShift(null);
    renderCaja();
    toast('Caja local destrabada. Firebase no permitió leer turnos.');
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
