import { state } from './state.js';
import { cotizacionesRef, pedidosRef, clientesRef, addDoc, doc, updateDoc, onSnapshot, serverTimestamp, db } from './firebase.js';
import { qs, openDialog, closeDialog, setEmpty, toast } from './ui.js';
import { calcPedido, escapeHtml, money, todayISO, shortOrderDescription, lineItemTotal, BUSINESS_NAME, openTicketWindow } from './utils.js';
import { findProductByInput, optionLabel, adjustInventoryForOrder } from './inventario.js';
import { printOrderTicket } from './pedidos.js';
import { getActiveShift } from './caja.js';

export function listenCotizaciones() {
  return onSnapshot(cotizacionesRef, snap => {
    state.cotizaciones = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderCotizaciones();
  });
}

export function populateQuoteClientSelect(selectedId = '') {
  const select = qs('#quote-client'); if (!select) return;
  const options = state.clientes.slice().sort((a,b)=>String(a.nombre||'').localeCompare(String(b.nombre||''))).map(c => `<option value="${c.id}" ${selectedId===c.id?'selected':''}>${escapeHtml(c.nombre||'Sin nombre')}</option>`).join('');
  select.innerHTML = `<option value="" disabled ${selectedId?'':'selected'}>Selecciona cliente</option>${options}`;
}


export async function addClientFromQuote() {
  const nombre = prompt('Nombre del cliente para la cotización:');
  if (nombre === null) return;
  const cleanName = nombre.trim();
  if (!cleanName) return toast('Escribe el nombre del cliente.');
  const telefono = prompt(`WhatsApp de ${cleanName}:`, '');
  if (telefono === null) return;
  const cleanPhone = telefono.trim();
  if (!cleanPhone) return toast('Escribe el WhatsApp del cliente.');
  const maxId = state.clientes.reduce((max, c) => Math.max(max, Number(c.clienteId || 0)), 0);
  const ref = await addDoc(clientesRef, { clienteId: maxId + 1, nombre: cleanName, telefono: cleanPhone, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
  state.clientes.push({ id: ref.id, clienteId: maxId + 1, nombre: cleanName, telefono: cleanPhone });
  populateQuoteClientSelect(ref.id);
  toast('Cliente agregado y seleccionado en la cotización.');
}

export function openQuoteForm(id = '') {
  populateQuoteClientSelect();
  resetQuoteForm(false);
  if (id) loadQuoteForEdit(id); else addQuoteItemRow();
  openDialog('#quote-dialog');
  recalcQuoteForm();
}

export function resetQuoteForm(close = true) {
  qs('#quote-form')?.reset();
  qs('#quote-doc-id').value = '';
  qs('#quote-form-title').textContent = 'Nueva cotización';
  qs('#quote-valid-until').value = todayISO();
  qs('#quote-status').value = 'Borrador';
  qs('#quote-items-container').innerHTML = '';
  if (close) closeDialog('#quote-dialog');
}

function loadQuoteForEdit(id) {
  const q = state.cotizaciones.find(x => x.id === id); if (!q) return;
  qs('#quote-doc-id').value = q.id;
  qs('#quote-form-title').textContent = 'Editar cotización';
  qs('#quote-client').value = q.clienteId || '';
  qs('#quote-currency').value = q.moneda || 'C$';
  qs('#quote-valid-until').value = q.validaHasta || todayISO();
  qs('#quote-status').value = q.estado || 'Borrador';
  qs('#quote-discount-type').value = q.descuentoTipo || 'monto';
  qs('#quote-discount').value = Number(q.descuentoValor || 0);
  qs('#quote-notes').value = q.notas || '';
  qs('#quote-items-container').innerHTML = '';
  (q.items || []).forEach(i => addQuoteItemRow(i));
}

export function addQuoteItemRow(item = {}) {
  const product = item.productoId ? state.productos.find(p => p.id === item.productoId) : null;
  const isManual = !!item.manual || (!item.productoId && item.descripcion);
  const row = document.createElement('div');
  row.className = 'item-row pos-item-row';
  row.dataset.productId = item.productoId || '';
  row.dataset.productCode = item.codigo || product?.codigo || '';
  row.dataset.tipoVenta = item.tipoVenta || product?.tipoVenta || 'unidad';
  row.dataset.manual = isManual ? 'true' : 'false';
  row.innerHTML = `
    <select class="item-kind"><option value="inventario" ${!isManual ? 'selected' : ''}>Inventario</option><option value="manual" ${isManual ? 'selected' : ''}>Manual</option></select>
    <input class="item-qty" type="number" min="1" step="1" value="${Number(item.cantidad || 1)}" aria-label="Cantidad" />
    <input class="item-product-search" list="product-options" value="${escapeHtml(product ? optionLabel(product) : '')}" placeholder="Buscar inventario" />
    <input class="item-desc" value="${escapeHtml(item.descripcion || product?.nombre || '')}" placeholder="Descripción del producto o servicio" ${isManual ? '' : 'readonly'} />
    <input class="item-width area-input" type="number" min="0" step="0.01" value="${Number(item.ancho || 0)}" placeholder="Ancho cm" />
    <input class="item-height area-input" type="number" min="0" step="0.01" value="${Number(item.alto || 0)}" placeholder="Alto cm" />
    <input class="item-price" type="number" min="0" step="0.0001" value="${product ? (item.precio ?? product?.precio ?? '') : (isManual ? Number(item.precio || 0) : '')}" placeholder="Precio" ${product || isManual ? '' : 'disabled'} />
    <span class="line-total">0.00</span>
    <button type="button" class="remove-item">×</button>`;
  qs('#quote-items-container').appendChild(row);
  row.querySelector('.item-kind').addEventListener('change', () => toggleQuoteRowMode(row));
  row.querySelector('.item-product-search').addEventListener('change', () => applyProduct(row));
  row.querySelector('.item-product-search').addEventListener('blur', () => applyProduct(row));
  row.querySelectorAll('input, select').forEach(i => i.addEventListener('input', recalcQuoteForm));
  row.querySelector('.remove-item').addEventListener('click', () => { row.remove(); recalcQuoteForm(); });
  toggleQuoteRowMode(row, true);
  updateAreaVisibility(row);
  recalcQuoteForm();
}

function toggleQuoteRowMode(row, keepValues = false) {
  const manual = row.querySelector('.item-kind')?.value === 'manual';
  row.dataset.manual = manual ? 'true' : 'false';
  const search = row.querySelector('.item-product-search');
  const desc = row.querySelector('.item-desc');
  const price = row.querySelector('.item-price');
  if (manual) {
    row.dataset.productId = ''; row.dataset.productCode = '';
    search.value = ''; search.disabled = true;
    desc.readOnly = false; price.disabled = false;
  } else {
    search.disabled = false; desc.readOnly = true;
    if (!row.dataset.productId) { desc.value = ''; price.value = ''; price.disabled = true; }
  }
  recalcQuoteForm();
}

function applyProduct(row) {
  if (row.dataset.manual === 'true') return;
  const product = findProductByInput(row.querySelector('.item-product-search').value);
  if (!product) { row.dataset.productId = ''; row.dataset.productCode = ''; row.dataset.tipoVenta = 'unidad'; row.querySelector('.item-desc').value = ''; row.querySelector('.item-price').value = ''; row.querySelector('.item-price').disabled = true; updateAreaVisibility(row); recalcQuoteForm(); return; }
  row.dataset.productId = product.id; row.dataset.productCode = product.codigo || ''; row.dataset.tipoVenta = product.tipoVenta || 'unidad'; row.dataset.manual = 'false';
  row.querySelector('.item-kind').value = 'inventario';
  row.querySelector('.item-product-search').value = optionLabel(product);
  row.querySelector('.item-desc').value = product.nombre || '';
  row.querySelector('.item-desc').readOnly = true;
  row.querySelector('.item-price').value = Number(product.precio || 0);
  row.querySelector('.item-price').disabled = false;
  updateAreaVisibility(row); recalcQuoteForm();
}
function updateAreaVisibility(row) { row.classList.toggle('area-mode', row.dataset.tipoVenta === 'area_cm2'); }
function getItems() { return Array.from(document.querySelectorAll('#quote-items-container .item-row')).map(row => ({ cantidad:Number(row.querySelector('.item-qty').value||0), productoId: row.dataset.productId || '', codigo: row.dataset.productCode || '', tipoVenta: row.dataset.tipoVenta || 'unidad', descripcion: row.querySelector('.item-desc').value.trim(), ancho:Number(row.querySelector('.item-width').value||0), alto:Number(row.querySelector('.item-height').value||0), precio:Number(row.querySelector('.item-price').value||0), manual: row.dataset.manual === 'true' })).filter(i => i.cantidad > 0 && i.descripcion && (i.productoId || i.manual)); }
function totals() { const items=getItems(); const subtotal=items.reduce((s,i)=>s+lineItemTotal(i),0); const tipo=qs('#quote-discount-type').value; const valor=Math.max(0,Number(qs('#quote-discount').value||0)); const descuento=tipo==='porcentaje'?Math.min(subtotal, subtotal*Math.min(valor,100)/100):Math.min(subtotal, valor); return {items, subtotal, descuentoTipo:tipo, descuentoValor:valor, descuento, total:Math.max(0,subtotal-descuento)}; }
export function recalcQuoteForm() { const t=totals(); qs('#quote-subtotal').textContent=t.subtotal.toFixed(2); qs('#quote-total').textContent=t.total.toFixed(2); document.querySelectorAll('#quote-items-container .item-row').forEach(row=>{ const item={cantidad:Number(row.querySelector('.item-qty').value||0), tipoVenta:row.dataset.tipoVenta||'unidad', ancho:Number(row.querySelector('.item-width').value||0), alto:Number(row.querySelector('.item-height').value||0), precio:Number(row.querySelector('.item-price').value||0)}; row.querySelector('.line-total').textContent=lineItemTotal(item).toFixed(2); }); }

export async function saveQuote(event) {
  event.preventDefault(); const id=qs('#quote-doc-id').value; const client=state.clientes.find(c=>c.id===qs('#quote-client').value); const t=totals();
  if(!client) return toast('Selecciona un cliente.'); if(!t.items.length) return toast('Agrega al menos un producto de inventario o una línea manual con descripción y precio.');
  const payload={ clienteId:client.id, cliente:client.nombre, telefono:client.telefono||'', moneda:qs('#quote-currency').value, validaHasta:qs('#quote-valid-until').value, estado:qs('#quote-status').value, items:t.items, subtotal:t.subtotal, descuento:t.descuento, descuentoTipo:t.descuentoTipo, descuentoValor:t.descuentoValor, monto_total:t.total, notas:qs('#quote-notes').value.trim(), updatedAt:serverTimestamp() };
  if(id) { await updateDoc(doc(db,'cotizaciones',id), payload); toast('Cotización actualizada.'); }
  else { await addDoc(cotizacionesRef,{...payload, createdAt:serverTimestamp()}); toast('Cotización guardada.'); }
  resetQuoteForm(true);
}

export function renderCotizaciones() {
  const list=qs('#quotes-list'); if(!list) return; const search=(state.quoteSearch||'').toLowerCase().trim();
  const rows=state.cotizaciones.slice().filter(q=>`${q.cliente||''} ${shortOrderDescription(q)} ${q.estado||''}`.toLowerCase().includes(search)).sort((a,b)=>String(b.validaHasta||'').localeCompare(String(a.validaHasta||'')));
  if(!rows.length) return setEmpty(list,'No hay cotizaciones todavía.');
  list.innerHTML=rows.map(q=>{ const c=calcPedido(q); return `<article class="record-card"><div class="record-head"><div><span class="status activo">${escapeHtml(q.estado||'Borrador')}</span><div class="record-title">${escapeHtml(q.cliente||'Sin cliente')}</div><div class="record-sub">${escapeHtml(shortOrderDescription(q))} · Válida hasta: ${escapeHtml(q.validaHasta||'')}</div></div><div class="record-meta"><div>${money(c.total,q.moneda||'C$')}</div><div class="record-sub">Cotización</div></div></div><div class="record-actions"><button class="action" data-quote-ticket="${q.id}">Ver / imprimir</button><button class="action amber" data-quote-edit="${q.id}">Editar</button>${q.pedidoId || q.convertida ? '<span class="status entregado">Convertida</span>' : `<button class="action green" data-quote-convert="${q.id}">Convertir a pedido</button>`}</div></article>`}).join('');
}

export function printQuoteTicket(id) { const q=state.cotizaciones.find(x=>x.id===id); if(!q) return; const c=calcPedido(q); const currency=q.moneda||'C$'; const rows=(q.items||[]).map(i=>`<tr><td>${Number(i.cantidad||0)}</td><td>${escapeHtml(i.descripcion||'')}${i.tipoVenta==='area_cm2'?`<br><small>${i.ancho}×${i.alto} cm</small>`:''}</td><td class="right">${money(lineItemTotal(i),currency)}</td></tr>`).join(''); openTicketWindow(`<div class="ticket-center"><strong>${BUSINESS_NAME}</strong><br><small>Cotización</small></div><hr><p><strong>Cliente:</strong> ${escapeHtml(q.cliente||'')}<br><strong>Válida hasta:</strong> ${escapeHtml(q.validaHasta||'')}</p><table><thead><tr><th>Cant</th><th>Producto</th><th class="right">Total</th></tr></thead><tbody>${rows}</tbody></table><hr><p class="ticket-total">Subtotal: ${money(c.subtotal,currency)}<br>Descuento: ${money(c.descuento,currency)}<br>Total: ${money(c.total,currency)}</p><p>${escapeHtml(q.notas||'')}</p>`,`cotizacion-${id}`); }

export async function convertQuoteToOrder(id) {
  const q = state.cotizaciones.find(x => x.id === id);
  if (!q) return;
  if (q.pedidoId || q.convertida === true) return toast('Esta cotización ya fue convertida. No se puede duplicar.');
  const c = calcPedido(q);
  const initial = prompt(`¿Cuánto abonará al convertir? Saldo total: ${money(c.total, q.moneda || 'C$')}`, '0');
  if (initial === null) return;
  const abono = Number(initial || 0);
  if (abono < 0 || abono > c.total) return toast('El abono debe ser entre 0 y el total de la cotización.');
  if (abono > 0 && !getActiveShift()) return toast('Para recibir abono primero debes abrir caja.');
  let metodo = 'efectivo';
  if (abono > 0) {
    const methodInput = prompt('Método de pago del abono: efectivo, tarjeta o transferencia', 'efectivo');
    if (methodInput === null) return;
    metodo = ['efectivo', 'tarjeta', 'transferencia'].includes(String(methodInput).toLowerCase().trim()) ? String(methodInput).toLowerCase().trim() : 'efectivo';
  }
  const ok = confirm('¿Convertir esta cotización en pedido/factura?');
  if (!ok) return;
  const shift = getActiveShift();
  const pagos = abono > 0 ? [{ monto: abono, fecha: todayISO(), nota: 'Abono al convertir cotización', metodo, turnoId: shift?.id || '' }] : [];
  const payload = { clienteId:q.clienteId, cliente:q.cliente, telefono:q.telefono||'', moneda:q.moneda||'C$', fecha_entrega:todayISO(), descripcion:shortOrderDescription(q), estado:'Pendiente', items:q.items||[], subtotal:c.subtotal, descuento:c.descuento, descuentoTipo:q.descuentoTipo||'monto', descuentoValor:q.descuentoValor||0, monto_total:c.total, total_pagado:abono, saldo:Math.max(0, c.total - abono), pagos, cotizacionId:id, turnoId: shift?.id || '', createdAt:serverTimestamp(), updatedAt:serverTimestamp() };
  const ref = await addDoc(pedidosRef, payload);
  await adjustInventoryForOrder(null, payload);
  await updateDoc(doc(db,'cotizaciones',id), { estado:'Convertida', convertida:true, pedidoId:ref.id, abonoConvertido:abono, updatedAt:serverTimestamp() });
  toast('Cotización convertida a pedido.');
  printOrderTicket({...payload,id:ref.id});
}
