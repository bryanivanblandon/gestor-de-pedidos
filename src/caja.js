import { state } from './state.js';
import { cajaTurnosRef, configRef, addDoc, doc, updateDoc, onSnapshot, serverTimestamp, db, arrayUnion, setDoc, getDocs, auth } from './firebase.js';
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

function normalizeShiftStatus(value = '') {
  return String(value || '').trim().toLowerCase();
}

function localIgnoredShiftIds() {
  try { return JSON.parse(localStorage.getItem('posIgnoredShiftIds') || '[]'); } catch { return []; }
}

function ignoredShiftIds() {
  const remote = Array.isArray(state.config?.ignoredShiftIds) ? state.config.ignoredShiftIds : [];
  return Array.from(new Set([...remote, ...localIgnoredShiftIds()]));
}

function isIgnoredShift(t = {}) {
  return ignoredShiftIds().includes(t.id);
}

function isOpenShift(t = {}) {
  const status = normalizeShiftStatus(t.estado);
  return (status === 'abierto' || status === 'abierta' || status === 'activo' || status === 'activa' || status === 'open') && !isIgnoredShift(t);
}

function isClosedShift(t = {}) {
  const status = normalizeShiftStatus(t.estado);
  return status === 'cerrado' || status === 'cerrada' || status === 'closed';
}

export function getActiveShift() {
  return state.cajaTurnos
    .filter(isOpenShift)
    .sort((a, b) => shiftSortValue(b) - shiftSortValue(a))[0] || null;
}

async function fetchOpenShiftsFromFirestore(includeIgnored = false) {
  const snap = await getDocs(cajaTurnosRef);
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(t => {
      const status = normalizeShiftStatus(t.estado);
      const open = status === 'abierto' || status === 'abierta' || status === 'activo' || status === 'activa' || status === 'open';
      return includeIgnored ? open : (open && !isIgnoredShift(t));
    })
    .sort((a, b) => shiftSortValue(b) - shiftSortValue(a));
}

export function getPaymentsForShift(shift = getActiveShift()) {
  if (!shift) return [];
  const rows = [];
  state.pedidos.forEach(p => {
    (p.pagos || []).forEach(pay => {
      const sameShift = pay.turnoId && pay.turnoId === shift.id;
      const legacyToday = !pay.turnoId && (pay.fecha || '').slice(0, 10) === (shift.fecha || todayISO());
      if (sameShift || legacyToday) rows.push({ pedido: p, pago: pay, monto: Number(pay.monto || 0), moneda: p.moneda || 'C$', metodo: pay.metodo || 'efectivo' });
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
  const byMethod = method => payments.filter(r => (r.metodo || 'efectivo') === method);
  const efectivo = byMethod('efectivo');
  const tarjeta = byMethod('tarjeta');
  const transferencia = byMethod('transferencia');
  const pagosEfectivoCs = efectivo.filter(r => r.moneda === 'C$').reduce((s, r) => s + r.monto, 0);
  const pagosEfectivoUsd = efectivo.filter(r => r.moneda === '$').reduce((s, r) => s + r.monto, 0);
  const tarjetaCs = tarjeta.reduce((s, r) => s + (r.moneda === '$' ? r.monto * tc : r.monto), 0);
  const transferenciaCs = transferencia.reduce((s, r) => s + (r.moneda === '$' ? r.monto * tc : r.monto), 0);
  const usdEnCs = pagosEfectivoUsd * tc;
  const ventasTotalCs = payments.reduce((s, r) => s + (r.moneda === '$' ? r.monto * tc : r.monto), 0);
  return {
    apertura,
    gastos,
    ingresosManual,
    pagosCs: pagosEfectivoCs,
    pagosUsd: pagosEfectivoUsd,
    usdEnCs,
    tarjetaCs,
    transferenciaCs,
    ventasTotalCs,
    tipoCambio: tc,
    efectivoEsperado: apertura + pagosEfectivoCs + usdEnCs + ingresosManual - gastos
  };
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
  const openCount = state.cajaTurnos.filter(isOpenShift).length;
  const ignoredCount = ignoredShiftIds().length;
  if (!status) return;

  if (!shift) {
    status.innerHTML = `<span class="status pendiente">Caja cerrada</span><p>Abre un turno para facturar, cobrar pedidos, registrar gastos y cerrar con conteo de billetes.</p>${ignoredCount ? `<p class="warning-text">Hay ${ignoredCount} turno(s) antiguos ignorados por recuperación. Ya no bloquean la caja, pero conviene revisarlos luego en Firebase.</p>` : ''}`;
    openPanel.hidden = false;
    activePanel.hidden = true;
  } else {
    const totals = shiftTotals(shift);
    status.innerHTML = `<span class="status activo">Caja abierta</span><p>Turno iniciado el ${escapeHtml(shift.fecha || todayISO())}. Tipo de cambio activo: <strong>C$${totals.tipoCambio.toFixed(2)}</strong> por $1.</p>${openCount > 1 ? '<p class="warning-text">Aviso: hay más de un turno abierto. Cierra el turno activo o usa recuperación administrativa.</p>' : ''}${ignoredCount ? `<p class="warning-text">Se ignoraron ${ignoredCount} turno(s) antiguos que no se pudieron cerrar automáticamente.</p>` : ''}`;
    openPanel.hidden = true;
    activePanel.hidden = false;
    summary.innerHTML = `
      <div class="summary-card"><span>Apertura</span><strong>${money(totals.apertura, 'C$')}</strong></div>
      <div class="summary-card"><span>Efectivo C$</span><strong>${money(totals.pagosCs, 'C$')}</strong></div>
      <div class="summary-card"><span>Efectivo $</span><strong>${money(totals.pagosUsd, '$')}</strong></div>
      <div class="summary-card"><span>Tarjeta</span><strong>${money(totals.tarjetaCs, 'C$')}</strong></div>
      <div class="summary-card"><span>Transferencia</span><strong>${money(totals.transferenciaCs, 'C$')}</strong></div>
      <div class="summary-card"><span>Ingresos extra</span><strong>${money(totals.ingresosManual, 'C$')}</strong></div>
      <div class="summary-card danger-summary"><span>Gastos</span><strong>-${money(totals.gastos, 'C$')}</strong></div>
      <div class="summary-card expected-summary"><span>Efectivo esperado</span><strong>${money(totals.efectivoEsperado, 'C$')}</strong><small>Apertura + efectivo + ingresos - gastos. Tarjeta/transferencia no suman al efectivo.</small></div>`;
    const pagos = getPaymentsForShift(shift).map(r => `<tr><td>${escapeHtml(r.pago.fecha || '')}</td><td>Cobro ${escapeHtml(r.metodo || 'efectivo')}</td><td>${escapeHtml(r.pedido.cliente || '')} · ${escapeHtml(shortOrderDescription(r.pedido))}</td><td>${money(r.monto, r.moneda)}</td><td><button class="action" data-order-ticket="${r.pedido.id}">Ticket</button></td></tr>`).join('');
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
  const localShift = getActiveShift();
  if (localShift) return toast('Ya hay una caja abierta.');
  const remoteOpen = await fetchOpenShiftsFromFirestore();
  if (remoteOpen.length) {
    state.cajaTurnos = mergeCajaTurnos(state.cajaTurnos, remoteOpen);
    renderCaja();
    const details = remoteOpen.map(t => `• ${t.id} (${t.estado || 'sin estado'} · ${t.fecha || 'sin fecha'})`).join('\n');
    const ok = confirm(`Firebase todavía muestra ${remoteOpen.length} turno(s) viejo(s) abiertos:\n${details}\n\n¿Quieres ignorarlos y abrir un turno nuevo? Esto NO borra esos documentos, solo evita que bloqueen la caja.`);
    if (!ok) return toast('No se abrió caja. Usa recuperación administrativa o ignora el turno viejo.');
    await persistIgnoredShiftIds(remoteOpen.map(t => t.id));
    state.cajaTurnos = state.cajaTurnos.map(t => remoteOpen.some(r => r.id === t.id) ? { ...t, ignoradoPorRecuperacion: true } : t);
  }
  const apertura = Number(qs('#cash-opening-amount').value || 0);
  const tipoCambio = Number(qs('#cash-exchange-rate')?.value || state.config?.tipoCambio || 36.5);
  await saveExchangeRate();
  const newShift = { estado: 'abierto', fecha: todayISO(), apertura, tipoCambio, gastos: [], ingresosManuales: [], createdAt: serverTimestamp(), updatedAt: serverTimestamp() };
  const ref = await addDoc(cajaTurnosRef, newShift);
  upsertLocalShift({ id: ref.id, ...newShift, createdAt: { seconds: Math.floor(Date.now() / 1000) } });
  qs('#cash-opening-amount').value = '0';
  toast('Caja abierta. Ya puedes registrar ventas, gastos y cerrar turno.');
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
  upsertLocalShift({ ...shift, gastos: [...(shift.gastos || []), gasto] });
  qs('#cash-expense-form').reset();
  toast('Gasto registrado. Disminuye el efectivo esperado del turno.');
  printExpenseTicket(gasto.id, gasto);
}

export async function addManualIncome(event) {
  event.preventDefault();
  const shift = getActiveShift();
  if (!shift) return toast('Primero debes abrir caja.');
  const concepto = qs('#cash-income-concept').value.trim();
  const monto = Number(qs('#cash-income-amount').value || 0);
  if (!concepto || monto <= 0) return toast('Ingresa concepto y monto válido.');
  const ingreso = { id: crypto.randomUUID(), concepto, monto, fecha: todayISO() };
  await updateDoc(doc(db, 'cajaTurnos', shift.id), { ingresosManuales: arrayUnion(ingreso), updatedAt: serverTimestamp() });
  upsertLocalShift({ ...shift, ingresosManuales: [...(shift.ingresosManuales || []), ingreso] });
  qs('#cash-income-form').reset();
  toast('Ingreso extra registrado. Aumenta el efectivo esperado del turno.');
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
  upsertLocalShift({ ...shift, estado: 'cerrado', cierre: counted.total, conteo: collectDenominations(), dolaresContados: counted.usd, tipoCambioCierre: counted.tc, diferencia, totales: totals });
  closeDialog('#cash-close-dialog');
  toast(`Caja cerrada. Diferencia: ${money(diferencia, 'C$')}`);
}


function mergeCajaTurnos(current = [], fetched = []) {
  const map = new Map(current.map(t => [t.id, t]));
  fetched.forEach(t => map.set(t.id, { ...(map.get(t.id) || {}), ...t }));
  return Array.from(map.values());
}

function upsertLocalShift(shift) {
  state.cajaTurnos = mergeCajaTurnos(state.cajaTurnos, [shift]);
  renderCaja();
}


async function persistIgnoredShiftIds(ids = []) {
  const unique = Array.from(new Set([...(ignoredShiftIds()), ...ids.filter(Boolean)]));
  state.config = { ...state.config, ignoredShiftIds: unique };
  try { localStorage.setItem('posIgnoredShiftIds', JSON.stringify(unique)); } catch (error) { console.warn('No pude guardar ignoredShiftIds en localStorage:', error); }
  try {
    await setDoc(configRef, { ignoredShiftIds: unique, updatedAt: serverTimestamp() }, { merge: true });
  } catch (error) {
    console.warn('No pude guardar ignoredShiftIds en config:', error);
  }
}

export async function forceCloseActiveShift() {
  const user = auth.currentUser;
  if (!user) {
    return toast('No hay sesión principal de Firebase activa. Cierra sesión, vuelve a entrar con correo/contraseña y prueba de nuevo.');
  }

  const localOpen = state.cajaTurnos.filter(isOpenShift);
  let openShifts = [];

  try {
    const remoteOpen = await fetchOpenShiftsFromFirestore(true);
    openShifts = mergeCajaTurnos(localOpen, remoteOpen).filter(isOpenShift);
  } catch (error) {
    console.error('Error leyendo turnos para recuperación:', error);
    const code = error?.code || '';
    if (code.includes('permission-denied')) {
      return toast('Firebase rechazó la lectura de cajaTurnos. Publica las reglas firestore.rules incluidas en el ZIP y vuelve a iniciar sesión.');
    }
    return toast(`No pude leer los turnos desde Firebase (${code || 'error desconocido'}). Revisa internet y sesión.`);
  }

  if (!openShifts.length) {
    state.cajaTurnos = state.cajaTurnos.map(t => isClosedShift(t) ? t : { ...t, estado: normalizeShiftStatus(t.estado) || 'cerrado' });
    renderCaja();
    return toast('No encontré turnos abiertos en Firebase. La vista fue refrescada.');
  }

  const details = openShifts.map(t => `• ${t.id} (${t.estado || 'sin estado'} · ${t.fecha || 'sin fecha'})`).join('\n');
  const ok = confirm(`Se encontraron ${openShifts.length} turno(s) abierto(s):\n${details}\n\nEsto los cerrará administrativamente sin conteo de billetes. ¿Continuar?`);
  if (!ok) return;

  const failed = [];
  const hidden = [];
  for (const shift of openShifts) {
    try {
      const totals = shiftTotals(shift);
      const payload = {
        estado: 'cerrado',
        cierre: totals.efectivoEsperado,
        diferencia: 0,
        cierreAdministrativo: true,
        notaCierre: 'Cierre administrativo por recuperación de turno trabado',
        totales: totals,
        closedAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      };
      try {
        await updateDoc(doc(db, 'cajaTurnos', shift.id), payload);
      } catch (error) {
        if (String(error?.code || '').includes('not-found')) {
          await setDoc(doc(db, 'cajaTurnos', shift.id), payload, { merge: true });
        } else {
          throw error;
        }
      }
    } catch (error) {
      console.error(`No se pudo cerrar turno ${shift.id}:`, error);
      failed.push({ id: shift.id, code: error?.code || 'error', message: error?.message || '' });
      hidden.push(shift.id);
    }
  }

  if (hidden.length) {
    await persistIgnoredShiftIds(hidden);
  }

  state.cajaTurnos = state.cajaTurnos.map(t => {
    if (openShifts.some(s => s.id === t.id) && !hidden.includes(t.id)) return { ...t, estado: 'cerrado', cierreAdministrativo: true };
    if (hidden.includes(t.id)) return { ...t, ignoradoPorRecuperacion: true };
    return t;
  });

  await new Promise(resolve => setTimeout(resolve, 300));
  try {
    state.cajaTurnos = mergeCajaTurnos(state.cajaTurnos, await fetchOpenShiftsFromFirestore(true));
  } catch (error) {
    console.warn('No se pudo refrescar después del cierre:', error);
  }
  renderCaja();

  if (failed.length) {
    const permission = failed.some(f => String(f.code).includes('permission-denied'));
    const msg = failed.map(f => `${f.id}: ${f.code}`).join(' | ');
    if (hidden.length) {
      toast(`No pude cerrar ${hidden.length} turno(s), pero fueron ignorados para que la caja ya no quede bloqueada. ${permission ? 'Revisa tus reglas de Firebase.' : msg}`);
    } else if (permission) {
      toast('Firebase negó el cierre. Debes publicar firestore.rules en Firebase Console. Detalle: ' + msg);
    } else {
      toast('Algunos turnos no se pudieron cerrar: ' + msg);
    }
    return;
  }

  toast('Turno(s) cerrado(s) administrativamente. Ya puedes abrir una caja nueva.');
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
