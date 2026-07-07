import { state, ESTADOS, ESTADOS_ACTIVOS } from './state.js';
import { pedidosRef, addDoc, doc, updateDoc, deleteDoc, onSnapshot, serverTimestamp, db, arrayUnion, increment } from './firebase.js';
import { qs, openDialog, closeDialog, setEmpty, toast } from './ui.js';
import { byDeliveryDate, calcPedido, escapeHtml, money, statusClass, todayISO, normalizePhone, BUSINESS_NAME } from './utils.js';
import { renderAll } from './render.js';

export function listenPedidos() {
  onSnapshot(pedidosRef, snap => {
    state.pedidos = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderAll();
  });
}

export function renderPedidos() {
  const list = qs('#orders-list');
  const search = state.orderSearch.toLowerCase().trim();
  let pedidos = state.pedidos.filter(p => String(p.estado || 'Pendiente') !== 'Anulado');

  if (state.orderFilter === 'activos') pedidos = pedidos.filter(p => ESTADOS_ACTIVOS.includes(p.estado || 'Pendiente'));
  else if (state.orderFilter !== 'todos') pedidos = pedidos.filter(p => (p.estado || 'Pendiente') === state.orderFilter);

  pedidos = pedidos.filter(p => `${p.cliente || ''} ${p.descripcion || ''} ${p.fecha_entrega || ''}`.toLowerCase().includes(search)).sort(byDeliveryDate);

  if (!pedidos.length) return setEmpty(list, 'No hay pedidos para este filtro.');
  list.innerHTML = pedidos.map(orderCard).join('');
}

export function renderUrgentes() {
  const list = qs('#urgent-orders');
  const pedidos = state.pedidos
    .filter(p => ESTADOS_ACTIVOS.includes(p.estado || 'Pendiente'))
    .sort(byDeliveryDate)
    .slice(0, 5);
  if (!pedidos.length) return setEmpty(list, 'No hay pedidos activos por ahora.');
  list.innerHTML = pedidos.map(orderCard).join('');
}

function orderCard(p) {
  const c = calcPedido(p);
  const estado = p.estado || 'Pendiente';
  return `
    <article class="record-card">
      <div class="record-head">
        <div>
          <span class="status ${statusClass(estado)}">${escapeHtml(estado)}</span>
          <div class="record-title">${escapeHtml(p.cliente || 'Sin cliente')}</div>
          <div class="record-sub">${escapeHtml(p.descripcion || 'Sin descripción')} · Entrega: <strong>${escapeHtml(p.fecha_entrega || 'Sin fecha')}</strong></div>
        </div>
        <div class="record-meta">
          <div>${money(c.total, p.moneda || 'C$')}</div>
          <div class="record-sub">Saldo: ${money(c.saldo, p.moneda || 'C$')}</div>
        </div>
      </div>
      <div class="record-actions">
        <select class="action" data-order-status="${p.id}">${ESTADOS.map(e => `<option ${e === estado ? 'selected' : ''}>${e}</option>`).join('')}</select>
        <button class="action" data-order-detail="${p.id}">Detalle</button>
        <button class="action amber" data-order-edit="${p.id}">Editar</button>
        <button class="action green" data-order-payment="${p.id}">Abono</button>
        <button class="action green" data-order-whatsapp="${p.id}">WhatsApp</button>
        <button class="action red" data-order-cancel="${p.id}">Anular</button>
      </div>
    </article>`;
}

export function populateClientSelect(selectedId = '') {
  const select = qs('#order-client');
  const options = state.clientes
    .slice()
    .sort((a,b) => String(a.nombre || '').localeCompare(String(b.nombre || '')))
    .map(c => `<option value="${c.id}" ${selectedId === c.id ? 'selected' : ''}>${escapeHtml(c.nombre || 'Sin nombre')}</option>`)
    .join('');
  select.innerHTML = `<option value="" disabled ${selectedId ? '' : 'selected'}>Selecciona cliente</option>${options}`;
}

export function openOrderForm(orderId = '') {
  populateClientSelect();
  resetOrderForm(false);
  if (orderId) loadOrderForEdit(orderId);
  else addItemRow(1, '', '');
  openDialog('#order-dialog');
  recalcOrderForm();
}

export function openOrderFormForClient(clientId) {
  openOrderForm('');
  qs('#order-client').value = clientId;
}

export function resetOrderForm(close = true) {
  qs('#order-form').reset();
  qs('#order-doc-id').value = '';
  qs('#order-form-title').textContent = 'Nuevo pedido';
  qs('#order-delivery').value = todayISO();
  qs('#order-status').value = 'Pendiente';
  qs('#order-currency').value = 'C$';
  qs('#items-container').innerHTML = '';
  if (close) closeDialog('#order-dialog');
}

function loadOrderForEdit(orderId) {
  const p = state.pedidos.find(x => x.id === orderId);
  if (!p) return;
  qs('#order-doc-id').value = p.id;
  qs('#order-form-title').textContent = 'Editar pedido';
  qs('#order-client').value = p.clienteId || state.clientes.find(c => c.nombre === p.cliente)?.id || '';
  qs('#order-currency').value = p.moneda || 'C$';
  qs('#order-delivery').value = p.fecha_entrega || todayISO();
  qs('#order-status').value = p.estado || 'Pendiente';
  qs('#order-description').value = p.descripcion || '';
  qs('#order-discount').value = Number(p.descuento || 0);
  qs('#order-initial-payment').value = Number(p.total_pagado || 0);
  qs('#items-container').innerHTML = '';
  (p.items?.length ? p.items : [{ cantidad: 1, descripcion: p.descripcion || '', precio: p.monto_total || 0 }]).forEach(i => addItemRow(i.cantidad, i.descripcion, i.precio));
}

export function addItemRow(cantidad = 1, descripcion = '', precio = '') {
  const row = document.createElement('div');
  row.className = 'item-row';
  row.innerHTML = `
    <input class="item-qty" type="number" min="1" step="1" value="${Number(cantidad || 1)}" aria-label="Cantidad" />
    <input class="item-desc" value="${escapeHtml(descripcion || '')}" placeholder="Producto / detalle" aria-label="Producto" />
    <input class="item-price" type="number" min="0" step="0.01" value="${precio ?? ''}" placeholder="Precio" aria-label="Precio" />
    <button type="button" class="remove-item" title="Eliminar fila">×</button>`;
  qs('#items-container').appendChild(row);
  row.querySelectorAll('input').forEach(input => input.addEventListener('input', recalcOrderForm));
  row.querySelector('.remove-item').addEventListener('click', () => { row.remove(); recalcOrderForm(); });
}

export function recalcOrderForm() {
  const { subtotal, total, saldo } = getFormTotals();
  qs('#order-subtotal').textContent = subtotal.toFixed(2);
  qs('#order-total').textContent = total.toFixed(2);
  qs('#order-balance').textContent = saldo.toFixed(2);
}

function getItemsFromForm() {
  return Array.from(document.querySelectorAll('.item-row')).map(row => ({
    cantidad: Number(row.querySelector('.item-qty').value || 0),
    descripcion: row.querySelector('.item-desc').value.trim(),
    precio: Number(row.querySelector('.item-price').value || 0),
  })).filter(item => item.cantidad > 0 && item.descripcion);
}

function getFormTotals() {
  const items = getItemsFromForm();
  const subtotal = items.reduce((sum, item) => sum + item.cantidad * item.precio, 0);
  const descuento = Number(qs('#order-discount').value || 0);
  const total = Math.max(0, subtotal - descuento);
  const abono = Number(qs('#order-initial-payment').value || 0);
  const saldo = Math.max(0, total - abono);
  return { items, subtotal, descuento, total, abono, saldo };
}

export async function saveOrder(event) {
  event.preventDefault();
  const id = qs('#order-doc-id').value;
  const client = state.clientes.find(c => c.id === qs('#order-client').value);
  const totals = getFormTotals();
  if (!client) return toast('Selecciona un cliente.');
  if (!totals.items.length) return toast('Agrega al menos un producto.');

  const payload = {
    clienteId: client.id,
    cliente: client.nombre,
    telefono: client.telefono || '',
    moneda: qs('#order-currency').value,
    fecha_entrega: qs('#order-delivery').value,
    descripcion: qs('#order-description').value.trim(),
    estado: qs('#order-status').value,
    items: totals.items,
    subtotal: totals.subtotal,
    descuento: totals.descuento,
    monto_total: totals.total,
    total_pagado: totals.abono,
    saldo: totals.saldo,
    updatedAt: serverTimestamp(),
  };

  if (id) {
    await updateDoc(doc(db, 'pedidos', id), payload);
    toast('Pedido actualizado.');
  } else {
    await addDoc(pedidosRef, { ...payload, pagos: totals.abono > 0 ? [{ monto: totals.abono, fecha: todayISO(), nota: 'Abono inicial' }] : [], createdAt: serverTimestamp() });
    toast('Pedido guardado.');
  }
  resetOrderForm(true);
}

export async function updateOrderStatus(id, estado) {
  await updateDoc(doc(db, 'pedidos', id), { estado, updatedAt: serverTimestamp() });
  toast(`Estado cambiado a ${estado}.`);
}

export async function cancelOrder(id) {
  const ok = confirm('¿Seguro que deseas anular este pedido? No se eliminará, solo quedará anulado.');
  if (!ok) return;
  await updateDoc(doc(db, 'pedidos', id), { estado: 'Anulado', updatedAt: serverTimestamp() });
  toast('Pedido anulado.');
}

export async function deleteOrderForever(id) {
  const ok = confirm('Esto eliminará el pedido para siempre. ¿Continuar?');
  if (!ok) return;
  await deleteDoc(doc(db, 'pedidos', id));
  toast('Pedido eliminado.');
}

export function openPaymentForm(orderId) {
  const p = state.pedidos.find(x => x.id === orderId);
  if (!p) return;
  const c = calcPedido(p);
  qs('#payment-order-id').value = orderId;
  qs('#payment-info').innerHTML = `<strong>${escapeHtml(p.cliente || '')}</strong><br>Pedido: ${escapeHtml(p.descripcion || '')}<br>Total: ${money(c.total, p.moneda || 'C$')} · Pagado: ${money(c.totalPagado, p.moneda || 'C$')} · Saldo: <strong>${money(c.saldo, p.moneda || 'C$')}</strong>`;
  qs('#payment-amount').value = '';
  qs('#payment-amount').max = c.saldo;
  openDialog('#payment-dialog');
}

export async function savePayment(event) {
  event.preventDefault();
  const id = qs('#payment-order-id').value;
  const p = state.pedidos.find(x => x.id === id);
  const amount = Number(qs('#payment-amount').value || 0);
  if (!p || amount <= 0) return toast('Ingresa un monto válido.');
  const c = calcPedido(p);
  if (amount > c.saldo) return toast('El abono no puede ser mayor al saldo.');

  await updateDoc(doc(db, 'pedidos', id), {
    total_pagado: increment(amount),
    pagos: arrayUnion({ monto: amount, fecha: todayISO(), nota: 'Abono registrado' }),
    updatedAt: serverTimestamp()
  });
  closeDialog('#payment-dialog');
  toast('Abono registrado.');
}

export function sendWhatsApp(orderId) {
  const p = state.pedidos.find(x => x.id === orderId);
  if (!p) return;
  const phone = normalizePhone(p.telefono || state.clientes.find(c => c.id === p.clienteId || c.nombre === p.cliente)?.telefono || '');
  if (!phone) return toast('Este cliente no tiene WhatsApp.');
  const c = calcPedido(p);
  const message = `Hola *${p.cliente}*, le saludamos de *${BUSINESS_NAME}*.\n\nPedido: *${p.descripcion}*\nEntrega: ${p.fecha_entrega}\nTotal: *${money(c.total, p.moneda || 'C$')}*\nAbonado: *${money(c.totalPagado, p.moneda || 'C$')}*\nSaldo pendiente: *${money(c.saldo, p.moneda || 'C$')}*\n\nGracias por su preferencia.`;
  window.open(`https://wa.me/${phone}?text=${encodeURIComponent(message)}`, '_blank');
}

export function showOrderDetail(orderId) {
  const p = state.pedidos.find(x => x.id === orderId);
  if (!p) return;
  const c = calcPedido(p);
  qs('#detail-title').textContent = `Pedido de ${p.cliente || 'cliente'}`;
  qs('#detail-body').innerHTML = `
    <p><strong>Estado:</strong> ${escapeHtml(p.estado || 'Pendiente')}</p>
    <p><strong>Entrega:</strong> ${escapeHtml(p.fecha_entrega || '')}</p>
    <p><strong>Descripción:</strong> ${escapeHtml(p.descripcion || '')}</p>
    <table class="table"><thead><tr><th>Cant.</th><th>Producto</th><th>Precio</th><th>Total</th></tr></thead><tbody>${(p.items || []).map(item => `<tr><td>${item.cantidad}</td><td>${escapeHtml(item.descripcion)}</td><td>${money(item.precio, p.moneda || 'C$')}</td><td>${money(Number(item.cantidad || 0) * Number(item.precio || 0), p.moneda || 'C$')}</td></tr>`).join('')}</tbody></table>
    <p><strong>Total:</strong> ${money(c.total, p.moneda || 'C$')} · <strong>Pagado:</strong> ${money(c.totalPagado, p.moneda || 'C$')} · <strong>Saldo:</strong> ${money(c.saldo, p.moneda || 'C$')}</p>
  `;
  qs('#detail-dialog').showModal();
}
