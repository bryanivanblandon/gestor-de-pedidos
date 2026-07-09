import { state } from './state.js';
import { cajaTurnosRef, configRef, addDoc, doc, updateDoc, onSnapshot, serverTimestamp, db, arrayUnion, setDoc } from './firebase.js';
import { qs, setEmpty, toast, openDialog, closeDialog } from './ui.js';
import { calcPedido, escapeHtml, money, todayISO, shortOrderDescription, openTicketWindow, BUSINESS_NAME } from './utils.js';

const DENOMS = [1, 5, 10, 20, 50, 100, 200, 500, 1000];

export function listenCaja() {
  const unsubShifts = onSnapshot(cajaTurnosRef, snap => {
    state.cajaTurnos = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderCaja();
  });
  const unsubConfig = onSnapshot(configRef, snap => {
    if (snap.exists()) state.config = { ...state.config, ...snap.data() };
    renderCaja();
  });
  return () => { unsubShifts(); unsubConfig(); };
}

function shiftSortValue(t = {}) {
  if (typeof t.createdAt?.seconds === 'number') return t.createdAt.seconds;
  const parsed = Date.parse(t.fecha || '');
  return Number.isNaN(parsed) ? 0 : parsed / 1000;
}

export function getActiveShift() {
  return state.cajaTurnos
    .filter(t => t.estado === 'abierto')
    .sort((a, b) => shiftSortValue(b) - shiftSortValue(a))[0] || null;
}

export function getPaymentsForShift(shift = getActiveShift()) {
  if (!shift) return [];
  const rows = [];
  state.pedidos.forEach(p => {
    (p.pagos || []).forEach(pay => {
      const sameShift = pay.turnoId && pay.turnoId === shift.id;
      const legacyToday = !pay.turnoId && (pay.fecha || '').slice(0, 10) === (shift.fecha || todayISO());
      if (sameShift || legacyToday) rows.push({ pedido: p, pago: pay, monto: Number(pay.monto || 0), moneda: p.moneda || 'C$' });
    });
  });
  return rows;
}

function shiftTotals(shift = getActiveShift()) {
  const tc = Number(state.config?.tipoCambio || 36.5);
  const apertura = Number(shift?.apertura || 0);
  const gastos = (shift?.gastos || []).reduce((s, g) => s + Number(g.monto || 0), 0);
  const ingresosManual = (shift?.ingresosManuales || []).reduce((s, g) => s + Number(g.monto || 0), 0);
  const payments = getPaymentsForShift(shift);
  const pagosCs = payments.filter(r => r.moneda === 'C$').reduce((s, r) => s + r.monto, 0);
  const pagosUsd = payments.filter(r => r.moneda === '$').reduce((s, r) => s + r.monto, 0);
  const usdEnCs = pagosUsd * tc;
  return { apertura, gastos, ingresosManual, pagosCs, pagosUsd, usdEnCs, tipoCambio: tc, efectivoEsperado: apertura + pagosCs + usdEnCs + ingresosManual - gastos };
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
  const tcInput = qs('#cash-exchange-rate');
  if (tcInput && document.activeElement !== tcInput) tcInput.value = Number(state.config?.tipoCambio || 36.5);
  const openCount = state.cajaTurnos.filter(t => t.estado === 'abierto').length;
  if (!status) return;

  if (!shift) {
    status.innerHTML = '<span class="status pendiente">Caja cerrada</span><p>Abre un turno para facturar, cobrar pedidos, registrar gastos y cerrar con conteo de billetes.</p>';
    openPanel.hidden = false;
    activePanel.hidden = true;
  } else {
    const totals = shiftTotals(shift);
    status.innerHTML = `<span class="status activo">Caja abierta</span><p>Turno iniciado el ${escapeHtml(shift.fecha || todayISO())}. Tipo de cambio activo: <strong>C$${totals.tipoCambio.toFixed(2)}</strong> por $1.</p>${openCount > 1 ? '<p class="warning-text">Aviso: hay más de un turno abierto. Cierra el turno activo o usa recuperación administrativa.</p>' : ''}`;
    openPanel.hidden = true;
    activePanel.hidden = false;
    summary.innerHTML = `
      <div class="summary-card"><span>Apertura</span><strong>${money(totals.apertura, 'C$')}</strong></div>
      <div class="summary-card"><span>Cobros C$</span><strong>${money(totals.pagosCs, 'C$')}</strong></div>
      <div class="summary-card"><span>Cobros $</span><strong>${money(totals.pagosUsd, '$')}</strong></div>
      <div class="summary-card"><span>Dólares en C$</span><strong>${money(totals.usdEnCs, 'C$')}</strong></div>
      <div class="summary-card"><span>Gastos</span><strong>${money(totals.gastos, 'C$')}</strong></div>
      <div class="summary-card"><span>Efectivo esperado</span><strong>${money(totals.efectivoEsperado, 'C$')}</strong></div>`;
    const pagos = getPaymentsForShift(shift).map(r => `<tr><td>${escapeHtml(r.pago.fecha || '')}</td><td>Cobro</td><td>${escapeHtml(r.pedido.cliente || '')} · ${escapeHtml(shortOrderDescription(r.pedido))}</td><td>${money(r.monto, r.moneda)}</td><td><button class="action" data-order-ticket="${r.pedido.id}">Ticket</button></td></tr>`).join('');
    const gastos = (shift.gastos || []).map(g => `<tr><td>${escapeHtml(g.fecha || '')}</td><td>Gasto</td><td>${escapeHtml(g.concepto || '')}</td><td>${money(g.monto, 'C$')}</td><td><button class="action" data-expense-ticket="${g.id || ''}">Ticket</button></td></tr>`).join('');
    const ingresos = (shift.ingresosManuales || []).map(g => `<tr><td>${escapeHtml(g.fecha || '')}</td><td>Ingreso extra</td><td>${escapeHtml(g.concepto || '')}</td><td>${money(g.monto, 'C$')}</td><td>-</td></tr>`).join('');
    movements.innerHTML = (pagos || gastos || ingresos) ? `<div class="report-table-wrap"><table class="table"><thead><tr><th>Fecha</th><th>Tipo</th><th>Concepto</th><th>Monto</th><th>Ticket</th></tr></thead><tbody>${pagos}${ingresos}${gastos}</tbody></table></div>` : '<div class="empty">No hay movimientos en este turno.</div>';
  }

  const pending = state.pedidos
    .filter(p => (p.estado || 'Pendiente') !== 'Anulado' && calcPedido(p).saldo > 0)
    .sort((a, b) => String(a.fecha_entrega || '').localeCompare(String(b.fecha_entrega || '')));
  if (!pending.length) return setEmpty(pendingList, 'No hay facturas pendientes por cobrar.');
  pendingList.innerHTML = pending.map(p => {
    const c = calcPedido(p);
    return `<article class="record-card compact-record">
      <div class="record-head"><div><div class="record-title">${escapeHtml(p.cliente || 'Sin cliente')}</div><div class="record-sub">${escapeHtml(shortOrderDescription(p))} · Entrega: ${escapeHtml(p.fecha_entrega || '')}</div></div><div class="record-meta"><div>${money(c.saldo, p.moneda || 'C$')}</div><div class="record-sub">Saldo</div></div></div>
      <div class="record-actions"><button class="action green" data-order-payment="${p.id}">Cobrar / abonar</button><button class="action" data-order-detail="${p.id}">Detalle</button><button class="action" data-order-ticket="${p.id}">Ticket</button></div>
    </article>`;
  }).join('');
}

export async function saveExchangeRate() {
  const value = Number(qs('#cash-exchange-rate').value || 0);
  if (value <= 0) return toast('Ingresa un tipo de cambio válido.');
  await setDoc(configRef, { tipoCambio: value, updatedAt: serverTimestamp() }, { merge: true });
  toast('Tipo de cambio actualizado.');
}

export async function openCashShift(event) {
  event.preventDefault();
  if (getActiveShift()) return toast('Ya hay una caja abierta.');
  const apertura = Number(qs('#cash-opening-amount').value || 0);
  await saveExchangeRate();
  await addDoc(cajaTurnosRef, { estado: 'abierto', fecha: todayISO(), apertura, tipoCambio: Number(qs('#cash-exchange-rate')?.value || state.config?.tipoCambio || 36.5), gastos: [], ingresosManuales: [], createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
  qs('#cash-opening-amount').value = '0';
  toast('Caja abierta.');
}

export async function addCashExpense(event) {
  event.preventDefault();
  const shift = getActiveShift();
  if (!shift) return toast('Primero debes abrir caja.');
  const concepto = qs('#cash-expense-concept').value.trim();
  const monto = Number(qs('#cash-expense-amount').value || 0);
  if (!concepto || monto <= 0) return toast('Ingresa concepto y monto válido.');
  const gasto = { id: crypto.randomUUID(), concepto, monto, fecha: todayISO() };
  await updateDoc(doc(db, 'cajaTurnos', shift.id), { gastos: arrayUnion(gasto), updatedAt: serverTimestamp() });
  qs('#cash-expense-form').reset();
  toast('Gasto registrado.');
  printExpenseTicket(gasto.id, gasto);
}

export async function addManualIncome(event) {
  event.preventDefault();
  const shift = getActiveShift();
  if (!shift) return toast('Primero debes abrir caja.');
  const concepto = qs('#cash-income-concept').value.trim();
  const monto = Number(qs('#cash-income-amount').value || 0);
  if (!concepto || monto <= 0) return toast('Ingresa concepto y monto válido.');
  await updateDoc(doc(db, 'cajaTurnos', shift.id), { ingresosManuales: arrayUnion({ id: crypto.randomUUID(), concepto, monto, fecha: todayISO() }), updatedAt: serverTimestamp() });
  qs('#cash-income-form').reset();
  toast('Ingreso extra registrado.');
}

export function closeCashShift() {
  const shift = getActiveShift();
  if (!shift) return toast('No hay caja abierta.');
  const totals = shiftTotals(shift);
  qs('#close-expected').textContent = money(totals.efectivoEsperado, 'C$');
  qs('#close-exchange-label').textContent = `Dólares a C$ con TC ${totals.tipoCambio.toFixed(2)}`;
  qs('#cash-close-form').reset();
  renderCloseTotal();
  openDialog('#cash-close-dialog');
}

export function renderCloseTotal() {
  const counts = DENOMS.reduce((sum, d) => sum + d * Number(qs(`#denom-${d}`)?.value || 0), 0);
  const usd = Number(qs('#close-usd-amount')?.value || 0);
  const tc = Number(state.config?.tipoCambio || 36.5);
  const total = counts + usd * tc;
  qs('#close-counted-total').textContent = money(total, 'C$');
  return { counts, usd, tc, total };
}

export async function confirmCloseCashShift(event) {
  event.preventDefault();
  const shift = getActiveShift();
  if (!shift) return toast('No hay caja abierta.');
  const totals = shiftTotals(shift);
  const counted = renderCloseTotal();
  const diferencia = counted.total - totals.efectivoEsperado;
  await updateDoc(doc(db, 'cajaTurnos', shift.id), {
    estado: 'cerrado',
    cierre: counted.total,
    conteo: collectDenominations(),
    dolaresContados: counted.usd,
    tipoCambioCierre: counted.tc,
    diferencia,
    totales: totals,
    closedAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
  closeDialog('#cash-close-dialog');
  toast(`Caja cerrada. Diferencia: ${money(diferencia, 'C$')}`);
}


export async function forceCloseActiveShift() {
  const shift = getActiveShift();
  if (!shift) return toast('No hay turno abierto para cerrar.');
  const ok = confirm('Esto cerrará administrativamente el turno abierto sin conteo de billetes. Úsalo solo para recuperar una caja trabada. ¿Continuar?');
  if (!ok) return;
  const totals = shiftTotals(shift);
  await updateDoc(doc(db, 'cajaTurnos', shift.id), {
    estado: 'cerrado',
    cierre: totals.efectivoEsperado,
    diferencia: 0,
    cierreAdministrativo: true,
    notaCierre: 'Cierre administrativo por recuperación de turno trabado',
    totales: totals,
    closedAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
  toast('Turno cerrado administrativamente. Ya puedes abrir una caja nueva.');
}

function collectDenominations() {
  return DENOMS.reduce((acc, d) => {
    acc[d] = Number(qs(`#denom-${d}`)?.value || 0);
    return acc;
  }, {});
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
