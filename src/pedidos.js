import { state, ESTADOS, ESTADOS_ACTIVOS } from './state.js';
import { pedidosRef, addDoc, doc, updateDoc, deleteDoc, onSnapshot, serverTimestamp, db, arrayUnion, increment } from './firebase.js';
import { qs, openDialog, closeDialog, setEmpty, toast } from './ui.js';
import { byDeliveryDate, calcPedido, escapeHtml, money, statusClass, todayISO, normalizePhone, BUSINESS_NAME, normalizeEstado, shortOrderDescription, openTicketWindow, lineItemTotal, lineItemBaseTotal, lineItemDiscountAmount, lineItemQtyForStock } from './utils.js';
import { findProductByInput, optionLabel, adjustInventoryForOrder } from './inventario.js';
import { getActiveShift, registerCashReceipt } from './caja.js';
import { renderAll } from './render.js';

export function listenPedidos() {
  return onSnapshot(pedidosRef, snap => {
    state.pedidos = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderAll();
  });
}

export function renderPedidos() {
  const list = qs('#orders-list');
  const search = state.orderSearch.toLowerCase().trim();
  let pedidos = state.pedidos.filter(p => normalizeEstado(p.estado || 'Pendiente') !== 'Anulado');

  if (state.orderFilter === 'activos') pedidos = pedidos.filter(p => ESTADOS_ACTIVOS.includes(normalizeEstado(p.estado || 'Pendiente')));
  else if (state.orderFilter !== 'todos') pedidos = pedidos.filter(p => normalizeEstado(p.estado || 'Pendiente') === state.orderFilter);

  pedidos = pedidos.filter(p => `${p.cliente || ''} ${shortOrderDescription(p)} ${p.fecha_entrega || ''}`.toLowerCase().includes(search)).sort(byDeliveryDate);

  if (!pedidos.length) return setEmpty(list, 'No hay pedidos para este filtro.');
  list.innerHTML = pedidos.map(orderCard).join('');
}

export function renderUrgentes() {
  const list = qs('#urgent-orders');
  const pedidos = state.pedidos
    .filter(p => ESTADOS_ACTIVOS.includes(normalizeEstado(p.estado || 'Pendiente')))
    .sort(byDeliveryDate)
    .slice(0, 5);
  if (!pedidos.length) return setEmpty(list, 'No hay pedidos activos por ahora.');
  list.innerHTML = pedidos.map(orderCard).join('');
}

function orderCard(p) {
  const c = calcPedido(p);
  const estado = normalizeEstado(p.estado || 'Pendiente');
  return `
    <article class="record-card">
      <div class="record-head">
        <div>
          <span class="status ${statusClass(estado)}">${escapeHtml(estado)}</span>
          <div class="record-title">${escapeHtml(p.cliente || 'Sin cliente')}</div>
          <div class="record-sub">${escapeHtml(shortOrderDescription(p))} · Entrega: <strong>${escapeHtml(p.fecha_entrega || 'Sin fecha')}</strong></div>
        </div>
        <div class="record-meta">
          <div>${money(c.total, p.moneda || 'C$')}</div>
          <div class="record-sub">Saldo: ${money(c.saldo, p.moneda || 'C$')}</div>
        </div>
      </div>
      <div class="record-actions">
        <select class="action" data-order-status="${p.id}">${ESTADOS.map(e => `<option ${e === estado ? 'selected' : ''}>${e}</option>`).join('')}</select>
        <button class="action" data-order-detail="${p.id}">Detalle</button>
        <button class="action" data-order-ticket="${p.id}">Ticket</button>
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
  qs('#order-status').value = normalizeEstado(p.estado || 'Pendiente');
  qs('#order-discount-type').value = p.descuentoTipo || p.tipo_descuento || 'monto';
  qs('#order-discount').value = Number(p.descuentoValor ?? p.descuento_valor ?? p.descuento ?? 0);
  qs('#order-initial-payment').value = Number(p.total_pagado || 0);
  qs('#items-container').innerHTML = '';
  (p.items?.length ? p.items : [{ cantidad: 1, descripcion: p.descripcion || '', precio: p.monto_total || 0 }]).forEach(i => addItemRow(i.cantidad, i.descripcion, i.precio, i.productoId || '', i.codigo || '', i.tipoVenta || 'unidad', i.ancho || 0, i.alto || 0, !!i.manual, i.descuentoLineaTipo || 'monto', Number(i.descuentoLineaValor || 0)));
}

export function addItemRow(cantidad = 1, descripcion = '', precio = '', productoId = '', codigo = '', tipoVenta = 'unidad', ancho = 0, alto = 0, manual = false, descuentoLineaTipo = 'monto', descuentoLineaValor = 0) {
  const product = productoId ? state.productos.find(p => p.id === productoId) : null;
  const isManual = manual || (!productoId && descripcion);
  const row = document.createElement('div');
  row.className = 'item-row pos-item-row';
  row.dataset.productId = productoId || '';
  row.dataset.productCode = codigo || product?.codigo || '';
  row.dataset.tipoVenta = tipoVenta || product?.tipoVenta || 'unidad';
  row.dataset.manual = isManual ? 'true' : 'false';
  row.innerHTML = `
    <select class="item-kind" aria-label="Tipo de línea"><option value="inventario" ${!isManual ? 'selected' : ''}>Inventario</option><option value="manual" ${isManual ? 'selected' : ''}>Manual</option></select>
    <input class="item-qty" type="number" min="1" step="1" value="${Number(cantidad || 1)}" aria-label="Cantidad" />
    <input class="item-product-search" list="product-options" value="${escapeHtml(product ? optionLabel(product) : '')}" placeholder="Buscar inventario por código o nombre" aria-label="Buscar producto" />
    <input class="item-desc" value="${escapeHtml(descripcion || product?.nombre || '')}" placeholder="Descripción del producto o servicio" aria-label="Producto" ${isManual ? '' : 'readonly'} />
    <input class="item-width area-input" type="number" min="0" step="0.01" value="${Number(ancho || 0)}" placeholder="Ancho cm" aria-label="Ancho cm" />
    <input class="item-height area-input" type="number" min="0" step="0.01" value="${Number(alto || 0)}" placeholder="Alto cm" aria-label="Alto cm" />
    <input class="item-price" type="number" min="0" step="0.0001" value="${product ? (precio ?? product?.precio ?? '') : (isManual ? Number(precio || 0) : '')}" placeholder="Precio" aria-label="Precio" ${product || isManual ? '' : 'disabled'} />
    <select class="item-line-discount-type" aria-label="Tipo de descuento por línea"><option value="monto" ${descuentoLineaTipo !== 'porcentaje' ? 'selected' : ''}>Desc/u C$</option><option value="porcentaje" ${descuentoLineaTipo === 'porcentaje' ? 'selected' : ''}>Desc %</option></select>
    <input class="item-line-discount" type="number" min="0" step="0.01" value="${Number(descuentoLineaValor || 0)}" placeholder="Desc. unit." aria-label="Descuento unitario" />
    <span class="line-total">0.00</span>
    <button type="button" class="remove-item" title="Eliminar fila">×</button>`;
  qs('#items-container').appendChild(row);
  row.querySelector('.item-kind').addEventListener('change', () => toggleRowMode(row));
  row.querySelector('.item-product-search').addEventListener('change', () => applyProductToRow(row));
  row.querySelector('.item-product-search').addEventListener('blur', () => applyProductToRow(row));
  row.querySelectorAll('input, select').forEach(input => input.addEventListener('input', recalcOrderForm));
  row.querySelector('.remove-item').addEventListener('click', () => { row.remove(); recalcOrderForm(); });
  toggleRowMode(row, true);
  updateAreaVisibility(row);
  recalcOrderForm();
}

function toggleRowMode(row, keepValues = false) {
  const manual = row.querySelector('.item-kind')?.value === 'manual';
  row.dataset.manual = manual ? 'true' : 'false';
  const search = row.querySelector('.item-product-search');
  const desc = row.querySelector('.item-desc');
  const price = row.querySelector('.item-price');
  if (manual) {
    row.dataset.productId = '';
    row.dataset.productCode = '';
    search.value = '';
    search.disabled = true;
    desc.readOnly = false;
    price.disabled = false;
    if (!keepValues && !desc.value) desc.value = '';
  } else {
    search.disabled = false;
    desc.readOnly = true;
    if (!row.dataset.productId) {
      desc.value = '';
      price.value = '';
      price.disabled = true;
    }
  }
  recalcOrderForm();
}

function updateAreaVisibility(row) {
  row.classList.toggle('area-mode', row.dataset.tipoVenta === 'area_cm2');
}

function applyProductToRow(row) {
  if (row.dataset.manual === 'true') return;
  const search = row.querySelector('.item-product-search');
  const product = findProductByInput(search.value);
  if (!product) {
    row.dataset.productId = '';
    row.dataset.productCode = '';
    row.dataset.tipoVenta = 'unidad';
    row.querySelector('.item-desc').value = '';
    row.querySelector('.item-price').value = '';
    row.querySelector('.item-price').disabled = true;
    updateAreaVisibility(row);
    recalcOrderForm();
    return;
  }
  row.dataset.productId = product.id;
  row.dataset.productCode = product.codigo || '';
  row.dataset.tipoVenta = product.tipoVenta || 'unidad';
  row.dataset.manual = 'false';
  row.querySelector('.item-kind').value = 'inventario';
  row.querySelector('.item-product-search').value = optionLabel(product);
  row.querySelector('.item-desc').value = product.nombre || '';
  row.querySelector('.item-desc').readOnly = true;
  row.querySelector('.item-price').value = Number(product.precio || 0);
  row.querySelector('.item-price').disabled = false;
  updateAreaVisibility(row);
  recalcOrderForm();
}

export function recalcOrderForm() {
  const { subtotal, total, saldo } = getFormTotals();
  qs('#order-subtotal').textContent = subtotal.toFixed(2);
  qs('#order-total').textContent = total.toFixed(2);
  qs('#order-balance').textContent = saldo.toFixed(2);
  document.querySelectorAll('#items-container .item-row').forEach(row => {
    const item = { cantidad: Number(row.querySelector('.item-qty').value || 0), tipoVenta: row.dataset.tipoVenta || 'unidad', ancho: Number(row.querySelector('.item-width')?.value || 0), alto: Number(row.querySelector('.item-height')?.value || 0), precio: Number(row.querySelector('.item-price').value || 0), descuentoLineaTipo: row.querySelector('.item-line-discount-type')?.value || 'monto', descuentoLineaValor: Number(row.querySelector('.item-line-discount')?.value || 0) };
    const totalEl = row.querySelector('.line-total');
    if (totalEl) totalEl.textContent = lineItemTotal(item).toFixed(2);
  });
}

function getItemsFromForm() {
  return Array.from(document.querySelectorAll('#items-container .item-row')).map(row => ({
    cantidad: Number(row.querySelector('.item-qty').value || 0),
    productoId: row.dataset.productId || '',
    codigo: row.dataset.productCode || '',
    tipoVenta: row.dataset.tipoVenta || 'unidad',
    descripcion: row.querySelector('.item-desc').value.trim(),
    ancho: Number(row.querySelector('.item-width')?.value || 0),
    alto: Number(row.querySelector('.item-height')?.value || 0),
    precio: Number(row.querySelector('.item-price').value || 0),
    descuentoLineaTipo: row.querySelector('.item-line-discount-type')?.value || 'monto',
    descuentoLineaValor: Number(row.querySelector('.item-line-discount')?.value || 0),
    manual: row.dataset.manual === 'true',
  })).filter(item => item.cantidad > 0 && item.descripcion && (item.productoId || item.manual));
}

function getFormTotals() {
  const items = getItemsFromForm();
  const subtotal = items.reduce((sum, item) => sum + lineItemTotal(item), 0);
  const descuentoTipo = qs('#order-discount-type')?.value || 'monto';
  const descuentoValor = Math.max(0, Number(qs('#order-discount').value || 0));
  const descuento = descuentoTipo === 'porcentaje'
    ? Math.min(subtotal, subtotal * (Math.min(descuentoValor, 100) / 100))
    : Math.min(subtotal, descuentoValor);
  const total = Math.max(0, subtotal - descuento);
  const abono = Number(qs('#order-initial-payment').value || 0);
  const safeAbono = Math.min(Math.max(0, abono), total);
  const saldo = Math.max(0, total - safeAbono);
  return { items, subtotal, descuento, descuentoTipo, descuentoValor, total, abono: safeAbono, saldo };
}

export async function saveOrder(event) {
  event.preventDefault();
  const id = qs('#order-doc-id').value;
  const client = state.clientes.find(c => c.id === qs('#order-client').value);
  const totals = getFormTotals();
  if (!client) return toast('Selecciona un cliente.');
  if (!totals.items.length) return toast('Agrega al menos un producto de inventario o una línea manual con descripción y precio.');
  if (totals.abono > 0 && !getActiveShift()) return toast('Para recibir abono inicial primero debes abrir caja.');

  const payload = {
    clienteId: client.id,
    cliente: client.nombre,
    telefono: client.telefono || '',
    moneda: qs('#order-currency').value,
    fecha_entrega: qs('#order-delivery').value,
    descripcion: shortOrderDescription({ items: totals.items }),
    estado: qs('#order-status').value,
    items: totals.items,
    subtotal: totals.subtotal,
    descuento: totals.descuento,
    descuentoTipo: totals.descuentoTipo,
    descuentoValor: totals.descuentoValor,
    monto_total: totals.total,
    total_pagado: totals.abono,
    saldo: totals.saldo,
    updatedAt: serverTimestamp(),
  };

  if (id) {
    const oldOrder = state.pedidos.find(x => x.id === id) || null;
    await updateDoc(doc(db, 'pedidos', id), payload);
    await adjustInventoryForOrder(oldOrder, payload);
    toast('Pedido actualizado.');
  } else {
    const shift = getActiveShift();
    const metodoPagoInicial = qs('#order-initial-payment-method')?.value || 'efectivo';
    const initialCashId = totals.abono > 0 ? crypto.randomUUID() : '';
    const pagos = totals.abono > 0 ? [{ cashId: initialCashId, monto: totals.abono, moneda: payload.moneda, fecha: todayISO(), nota: 'Abono inicial', metodo: metodoPagoInicial, turnoId: shift?.id || '' }] : [];
    const ref = await addDoc(pedidosRef, { ...payload, pagos, turnoId: shift?.id || '', createdAt: serverTimestamp() });
    if (totals.abono > 0) {
      await registerCashReceipt({
        cashId: initialCashId,
        pedidoId: ref.id,
        cliente: payload.cliente,
        descripcion: payload.descripcion,
        monto: totals.abono,
        moneda: payload.moneda,
        metodo: metodoPagoInicial,
        nota: 'Abono inicial'
      });
    }
    await adjustInventoryForOrder(null, payload);
    toast('Pedido guardado.');
    printOrderTicket({ ...payload, id: ref.id, pagos });
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
  qs('#payment-info').innerHTML = `<strong>${escapeHtml(p.cliente || '')}</strong><br>Pedido: ${escapeHtml(shortOrderDescription(p))}<br>Total: ${money(c.total, p.moneda || 'C$')} · Pagado: ${money(c.totalPagado, p.moneda || 'C$')} · Saldo: <strong>${money(c.saldo, p.moneda || 'C$')}</strong>`;
  qs('#payment-amount').value = '';
  qs('#payment-method').value = 'efectivo';
  qs('#payment-amount').max = c.saldo;
  openDialog('#payment-dialog');
}

export async function savePayment(event) {
  event.preventDefault();
  const id = qs('#payment-order-id').value;
  const p = state.pedidos.find(x => x.id === id);
  const amount = Number(qs('#payment-amount').value || 0);
  const metodo = qs('#payment-method')?.value || 'efectivo';
  if (!p || amount <= 0) return toast('Ingresa un monto válido.');
  if (!getActiveShift()) return toast('Para cobrar o abonar primero debes abrir caja.');
  const c = calcPedido(p);
  if (amount > c.saldo) return toast('El abono no puede ser mayor al saldo.');

  const cashId = crypto.randomUUID();
  const activeShift = getActiveShift();
  await updateDoc(doc(db, 'pedidos', id), {
    total_pagado: increment(amount),
    pagos: arrayUnion({ cashId, monto: amount, moneda: p.moneda || 'C$', fecha: todayISO(), nota: 'Abono registrado', metodo, turnoId: activeShift?.id || '' }),
    updatedAt: serverTimestamp()
  });
  await registerCashReceipt({
    cashId,
    pedidoId: id,
    cliente: p.cliente || '',
    descripcion: shortOrderDescription(p),
    monto: amount,
    moneda: p.moneda || 'C$',
    metodo,
    nota: 'Abono registrado'
  });
  closeDialog('#payment-dialog');
  toast('Abono registrado y sumado en caja.');
}

function discountLabel(type = 'monto', value = 0, currency = 'C$') {
  const amount = Number(value || 0);
  if (!amount) return '';
  return type === 'porcentaje' ? `${amount}%` : money(amount, currency);
}

function lineDiscountText(item, currency = 'C$') {
  const amount = lineItemDiscountAmount(item);
  if (!amount) return '';
  const label = discountLabel(item.descuentoLineaTipo || 'monto', item.descuentoLineaValor || 0, currency);
  return `
   Descuento unitario: ${label} (-${money(amount, currency)})`;
}

export function sendWhatsApp(orderId) {
  const p = state.pedidos.find(x => x.id === orderId);
  if (!p) return;
  const client = state.clientes.find(c => c.id === p.clienteId) || state.clientes.find(c => c.nombre === p.cliente) || {};
  const phone = normalizePhone(client.telefono || p.telefono || '');
  if (!phone) return toast('Este cliente no tiene WhatsApp válido. Revisa que tenga 8 dígitos o código 505.');
  const c = calcPedido(p);
  const detail = (p.items || []).map(item => `• ${item.cantidad || 1} x ${item.descripcion || 'Producto'} - ${money(lineItemTotal(item), p.moneda || 'C$')}${lineDiscountText(item, p.moneda || 'C$')}`).join('\n');
  const statusLine = c.saldo > 0
    ? `Saldo pendiente: *${money(c.saldo, p.moneda || 'C$')}*`
    : 'Estado de pago: *Cancelado* ✅';
  const message = `Hola *${p.cliente || client.nombre || ''}*, le saluda *${BUSINESS_NAME}*.

✨ *Detalle de su pedido*
${detail || shortOrderDescription(p)}

📅 Entrega: *${p.fecha_entrega || 'por confirmar'}*
📌 Estado: *${normalizeEstado(p.estado || 'Pendiente')}*

💵 Subtotal: *${money(c.subtotal, p.moneda || 'C$')}*
🏷️ Descuento: *${money(c.descuento, p.moneda || 'C$')}*
💰 Total: *${money(c.total, p.moneda || 'C$')}*
✅ Abonado: *${money(c.totalPagado, p.moneda || 'C$')}*
${statusLine}

Gracias por su preferencia. Bendiciones.`;
  window.open(`https://wa.me/${phone}?text=${encodeURIComponent(message)}`, '_blank', 'noopener');
}

export function printOrderTicket(orderId) {
  const p = typeof orderId === 'object' ? orderId : state.pedidos.find(x => x.id === orderId);
  if (!p) return toast('No encontré el pedido para imprimir.');
  const c = calcPedido(p);
  const currency = p.moneda || 'C$';
  const rows = (p.items || []).map(item => { const base = lineItemBaseTotal(item); const disc = lineItemDiscountAmount(item); return `<tr><td>${Number(item.cantidad || 0)}</td><td>${escapeHtml(item.descripcion || '')}${item.manual ? '<br><small>Manual / servicio</small>' : ''}${item.tipoVenta === 'area_cm2' ? `<br><small>${Number(item.ancho || 0)}×${Number(item.alto || 0)} cm</small>` : ''}${disc ? `<br><small>Desc. unitario: ${escapeHtml(discountLabel(item.descuentoLineaTipo || 'monto', item.descuentoLineaValor || 0, currency))} (-${money(disc, currency)})</small>` : ''}</td><td class="right"><small>Bruto ${money(base, currency)}</small><br>${money(lineItemTotal(item), currency)}</td></tr>`; }).join('');
  openTicketWindow(`
    <div class="ticket-center"><strong>${BUSINESS_NAME}</strong><br><small>Ticket de pedido / factura</small></div>
    <hr>
    <p><strong>Cliente:</strong> ${escapeHtml(p.cliente || '')}<br><strong>Entrega:</strong> ${escapeHtml(p.fecha_entrega || '')}<br><strong>Estado:</strong> ${escapeHtml(normalizeEstado(p.estado || 'Pendiente'))}</p>
    <table><thead><tr><th>Cant</th><th>Producto</th><th class="right">Total</th></tr></thead><tbody>${rows}</tbody></table>
    <hr>
    <p class="ticket-total">Subtotal: ${money(c.subtotal, currency)}<br>Descuento: ${money(c.descuento, currency)}<br>Total: ${money(c.total, currency)}<br>Abonado: ${money(c.totalPagado, currency)}<br>Saldo: ${money(c.saldo, currency)}</p>
    <p class="ticket-center">Gracias por su preferencia</p>
  `, `ticket-pedido-${orderId}`);
}

export function showOrderDetail(orderId) {
  const p = state.pedidos.find(x => x.id === orderId);
  if (!p) return;
  const c = calcPedido(p);
  qs('#detail-title').textContent = `Pedido de ${p.cliente || 'cliente'}`;
  qs('#detail-body').innerHTML = `
    <p><strong>Estado:</strong> ${escapeHtml(normalizeEstado(p.estado || 'Pendiente'))}</p>
    <p><strong>Entrega:</strong> ${escapeHtml(p.fecha_entrega || '')}</p>
    <table class="table"><thead><tr><th>Cant.</th><th>Producto</th><th>Precio</th><th>Desc. línea</th><th>Total</th></tr></thead><tbody>${(p.items || []).map(item => `<tr><td>${item.cantidad}</td><td>${escapeHtml(item.descripcion)}</td><td>${money(item.precio, p.moneda || 'C$')}</td><td>${lineItemDiscountAmount(item) ? `${escapeHtml(discountLabel(item.descuentoLineaTipo || 'monto', item.descuentoLineaValor || 0, p.moneda || 'C$'))}<br><small>-${money(lineItemDiscountAmount(item), p.moneda || 'C$')}</small>` : '-'}</td><td>${money(lineItemTotal(item), p.moneda || 'C$')}</td></tr>`).join('')}</tbody></table>
    <p><strong>Subtotal:</strong> ${money(c.subtotal, p.moneda || 'C$')} · <strong>Descuento:</strong> ${money(c.descuento, p.moneda || 'C$')}</p>
    <p><strong>Total:</strong> ${money(c.total, p.moneda || 'C$')} · <strong>Pagado:</strong> ${money(c.totalPagado, p.moneda || 'C$')} · <strong>Saldo:</strong> ${money(c.saldo, p.moneda || 'C$')}</p>
    <button class="primary" type="button" data-order-ticket="${p.id}">Imprimir ticket 80mm</button>
  `;
  qs('#detail-dialog').showModal();
}
