import { state } from './state.js';
import { cajaTurnosRef, addDoc, doc, updateDoc, onSnapshot, serverTimestamp, db, arrayUnion } from './firebase.js';
import { qs, setEmpty, toast } from './ui.js';
import { calcPedido, escapeHtml, money, todayISO, shortOrderDescription } from './utils.js';

export function listenCaja() {
  return onSnapshot(cajaTurnosRef, snap => {
    state.cajaTurnos = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderCaja();
  });
}

export function getActiveShift() {
  return state.cajaTurnos.find(t => t.estado === 'abierto') || null;
}

export function getTodayPayments() {
  const today = todayISO();
  const rows = [];
  state.pedidos.forEach(p => {
    (p.pagos || []).forEach(pay => {
      if ((pay.fecha || '').slice(0, 10) === today) {
        rows.push({ pedido: p, pago: pay, monto: Number(pay.monto || 0), moneda: p.moneda || 'C$' });
      }
    });
  });
  return rows;
}

function shiftTotals(shift = getActiveShift()) {
  const apertura = Number(shift?.apertura || 0);
  const gastos = (shift?.gastos || []).reduce((s, g) => s + Number(g.monto || 0), 0);
  const ingresosManual = (shift?.ingresosManuales || []).reduce((s, g) => s + Number(g.monto || 0), 0);
  const pagosCs = getTodayPayments().filter(r => r.moneda === 'C$').reduce((s, r) => s + r.monto, 0);
  const pagosUsd = getTodayPayments().filter(r => r.moneda === '$').reduce((s, r) => s + r.monto, 0);
  return { apertura, gastos, ingresosManual, pagosCs, pagosUsd, efectivoEsperado: apertura + pagosCs + ingresosManual - gastos };
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
  if (!status) return;

  if (!shift) {
    status.innerHTML = '<span class="status pendiente">Caja cerrada</span><p>Abre un turno para registrar gastos y controlar el efectivo del día.</p>';
    openPanel.hidden = false;
    activePanel.hidden = true;
  } else {
    const totals = shiftTotals(shift);
    status.innerHTML = `<span class="status activo">Caja abierta</span><p>Turno iniciado el ${escapeHtml(shift.fecha || todayISO())}. Todo abono registrado hoy alimenta la caja.</p>`;
    openPanel.hidden = true;
    activePanel.hidden = false;
    summary.innerHTML = `
      <div class="summary-card"><span>Apertura</span><strong>${money(totals.apertura, 'C$')}</strong></div>
      <div class="summary-card"><span>Ventas/abonos C$</span><strong>${money(totals.pagosCs, 'C$')}</strong></div>
      <div class="summary-card"><span>Ventas/abonos $</span><strong>${money(totals.pagosUsd, '$')}</strong></div>
      <div class="summary-card"><span>Gastos</span><strong>${money(totals.gastos, 'C$')}</strong></div>
      <div class="summary-card"><span>Ingresos extra</span><strong>${money(totals.ingresosManual, 'C$')}</strong></div>
      <div class="summary-card"><span>Efectivo esperado C$</span><strong>${money(totals.efectivoEsperado, 'C$')}</strong></div>`;
    const gastos = (shift.gastos || []).map(g => `<tr><td>${escapeHtml(g.fecha || '')}</td><td>Gasto</td><td>${escapeHtml(g.concepto || '')}</td><td>${money(g.monto, 'C$')}</td></tr>`).join('');
    const ingresos = (shift.ingresosManuales || []).map(g => `<tr><td>${escapeHtml(g.fecha || '')}</td><td>Ingreso extra</td><td>${escapeHtml(g.concepto || '')}</td><td>${money(g.monto, 'C$')}</td></tr>`).join('');
    movements.innerHTML = (gastos || ingresos) ? `<div class="report-table-wrap"><table class="table"><thead><tr><th>Fecha</th><th>Tipo</th><th>Concepto</th><th>Monto</th></tr></thead><tbody>${ingresos}${gastos}</tbody></table></div>` : '<div class="empty">No hay gastos ni ingresos extra en este turno.</div>';
  }

  const pending = state.pedidos
    .filter(p => (p.estado || 'Pendiente') !== 'Anulado' && calcPedido(p).saldo > 0)
    .sort((a, b) => String(a.fecha_entrega || '').localeCompare(String(b.fecha_entrega || '')));
  if (!pending.length) return setEmpty(pendingList, 'No hay facturas pendientes por cobrar.');
  pendingList.innerHTML = pending.map(p => {
    const c = calcPedido(p);
    return `<article class="record-card compact-record">
      <div class="record-head"><div><div class="record-title">${escapeHtml(p.cliente || 'Sin cliente')}</div><div class="record-sub">${escapeHtml(shortOrderDescription(p))} · Entrega: ${escapeHtml(p.fecha_entrega || '')}</div></div><div class="record-meta"><div>${money(c.saldo, p.moneda || 'C$')}</div><div class="record-sub">Saldo</div></div></div>
      <div class="record-actions"><button class="action green" data-order-payment="${p.id}">Cobrar / abonar</button><button class="action" data-order-detail="${p.id}">Detalle</button></div>
    </article>`;
  }).join('');
}

export async function openCashShift(event) {
  event.preventDefault();
  if (getActiveShift()) return toast('Ya hay una caja abierta.');
  const apertura = Number(qs('#cash-opening-amount').value || 0);
  await addDoc(cajaTurnosRef, { estado: 'abierto', fecha: todayISO(), apertura, gastos: [], ingresosManuales: [], createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
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
  await updateDoc(doc(db, 'cajaTurnos', shift.id), { gastos: arrayUnion({ concepto, monto, fecha: todayISO() }), updatedAt: serverTimestamp() });
  qs('#cash-expense-form').reset();
  toast('Gasto registrado.');
}

export async function addManualIncome(event) {
  event.preventDefault();
  const shift = getActiveShift();
  if (!shift) return toast('Primero debes abrir caja.');
  const concepto = qs('#cash-income-concept').value.trim();
  const monto = Number(qs('#cash-income-amount').value || 0);
  if (!concepto || monto <= 0) return toast('Ingresa concepto y monto válido.');
  await updateDoc(doc(db, 'cajaTurnos', shift.id), { ingresosManuales: arrayUnion({ concepto, monto, fecha: todayISO() }), updatedAt: serverTimestamp() });
  qs('#cash-income-form').reset();
  toast('Ingreso extra registrado.');
}

export async function closeCashShift() {
  const shift = getActiveShift();
  if (!shift) return toast('No hay caja abierta.');
  const totals = shiftTotals(shift);
  const contado = Number(prompt(`Efectivo esperado: ${money(totals.efectivoEsperado, 'C$')}\n¿Cuánto efectivo real hay en caja?`, totals.efectivoEsperado.toFixed(2)) || 0);
  const diferencia = contado - totals.efectivoEsperado;
  const ok = confirm(`Cerrar caja?\nContado: ${money(contado, 'C$')}\nDiferencia: ${money(diferencia, 'C$')}`);
  if (!ok) return;
  await updateDoc(doc(db, 'cajaTurnos', shift.id), { estado: 'cerrado', cierre: contado, diferencia, totales: totals, closedAt: serverTimestamp(), updatedAt: serverTimestamp() });
  toast('Caja cerrada.');
}
