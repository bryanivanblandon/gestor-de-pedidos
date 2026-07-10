import { state } from './state.js';
import { productosRef, addDoc, doc, updateDoc, onSnapshot, serverTimestamp, db, arrayUnion, increment } from './firebase.js';
import { qs, setEmpty, toast } from './ui.js';
import { escapeHtml, money, todayISO, lineItemQtyForStock } from './utils.js';

export function listenInventario() {
  return onSnapshot(productosRef, snap => {
    state.productos = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderInventario();
    renderProductOptions();
    renderKardexGeneral();
  });
}

export function renderInventario() {
  const list = qs('#inventory-list');
  if (!list) return;
  const search = (state.inventorySearch || '').toLowerCase().trim();
  const rows = state.productos
    .slice()
    .filter(p => `${p.codigo || ''} ${p.nombre || ''} ${p.categoria || ''}`.toLowerCase().includes(search))
    .sort((a, b) => String(a.nombre || '').localeCompare(String(b.nombre || '')));
  renderInventorySummary();
  if (!rows.length) return setEmpty(list, 'No hay productos registrados todavía. Agrega tus productos o materiales principales.');
  list.innerHTML = `
    <div class="report-table-wrap">
      <table class="table report-table">
        <thead><tr><th>Código</th><th>Producto</th><th>Categoría</th><th>Venta</th><th>Stock</th><th>Costo</th><th>Precio</th><th>Margen</th><th>Acciones</th></tr></thead>
        <tbody>${rows.map(productRow).join('')}</tbody>
      </table>
    </div>`;
}

function renderInventorySummary() {
  const el = qs('#inventory-summary');
  if (!el) return;
  const costo = state.productos.reduce((s, p) => s + Number(p.costo || 0) * Number(p.stock || 0), 0);
  const venta = state.productos.reduce((s, p) => s + Number(p.precio || 0) * Number(p.stock || 0), 0);
  const bajo = state.productos.filter(p => Number(p.stock || 0) <= Number(p.stockMin || 0)).length;
  el.innerHTML = `
    <div class="summary-card"><span>Productos</span><strong>${state.productos.length}</strong></div>
    <div class="summary-card"><span>Stock bajo</span><strong>${bajo}</strong></div>
    <div class="summary-card"><span>Costo inventario</span><strong>${money(costo, 'C$')}</strong></div>
    <div class="summary-card"><span>Valor venta</span><strong>${money(venta, 'C$')}</strong></div>`;
}

function productRow(p) {
  const costo = Number(p.costo || 0);
  const precio = Number(p.precio || 0);
  const margen = precio > 0 ? ((precio - costo) / precio) * 100 : 0;
  const stock = Number(p.stock || 0);
  const low = stock <= Number(p.stockMin || 0);
  return `<tr>
    <td><strong>${escapeHtml(p.codigo || '')}</strong></td>
    <td>${escapeHtml(p.nombre || '')}</td>
    <td>${escapeHtml(p.categoria || '-')}</td>
    <td>${p.tipoVenta === 'area_cm2' ? 'cm²' : 'Unidad'}</td>
    <td><span class="status ${low ? 'pendiente' : 'entregado'}">${stock}</span></td>
    <td>${money(costo, 'C$')}</td>
    <td>${money(precio, 'C$')}</td>
    <td>${margen.toFixed(1)}%</td>
    <td>
      <button class="action" data-product-edit="${p.id}">Editar</button>
      <button class="action green" data-product-move="${p.id}">Movimiento</button>
      <button class="action" data-product-kardex="${p.id}">Kardex</button>
    </td>
  </tr>`;
}

export function renderProductOptions() {
  const dl = qs('#product-options');
  if (!dl) return;
  dl.innerHTML = state.productos
    .slice()
    .sort((a, b) => String(a.nombre || '').localeCompare(String(b.nombre || '')))
    .map(p => `<option value="${escapeHtml(optionLabel(p))}"></option>`)
    .join('');
}

export function optionLabel(p) {
  return `${p.codigo || 'SIN-COD'} | ${p.nombre || 'Producto'} | ${money(p.precio || 0, 'C$')}${p.tipoVenta === 'area_cm2' ? ' x cm²' : ''}`;
}

export function findProductByInput(value = '') {
  const text = value.toLowerCase().trim();
  if (!text) return null;
  return state.productos.find(p => optionLabel(p).toLowerCase() === text)
    || state.productos.find(p => String(p.codigo || '').toLowerCase() === text)
    || state.productos.find(p => String(p.nombre || '').toLowerCase() === text)
    || state.productos.find(p => optionLabel(p).toLowerCase().includes(text));
}


function normalizePrefix(text = '') {
  const clean = String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toUpperCase();
  return (clean.slice(0, 3) || 'PRO');
}

function generateProductCode(category = '', name = '', currentId = '') {
  const prefix = normalizePrefix(category || name);
  const max = state.productos
    .filter(p => p.id !== currentId && String(p.codigo || '').toUpperCase().startsWith(prefix))
    .map(p => Number(String(p.codigo || '').replace(prefix, '').replace(/\D/g, '') || 0))
    .reduce((a, b) => Math.max(a, b), 0);
  return `${prefix}${String(max + 1).padStart(3, '0')}`;
}

export function previewNextProductCode() {
  const codeInput = qs('#product-code');
  if (!codeInput) return;
  const id = qs('#product-doc-id')?.value || '';
  if (id) return;
  const category = qs('#product-category')?.value || '';
  const name = qs('#product-name')?.value || '';
  codeInput.value = generateProductCode(category, name);
}

export async function saveProduct(event) {
  event.preventDefault();
  const id = qs('#product-doc-id').value;
  const precio = Number(qs('#product-price').value || 0);
  const costo = Number(qs('#product-cost').value || 0);
  const stock = Number(qs('#product-stock').value || 0);
  const payload = {
    codigo: id ? qs('#product-code').value.trim().toUpperCase() : generateProductCode(qs('#product-category').value.trim(), qs('#product-name').value.trim()),
    nombre: qs('#product-name').value.trim(),
    categoria: qs('#product-category').value.trim(),
    tipoVenta: qs('#product-sale-type')?.value || 'unidad',
    costo,
    precio,
    stock,
    stockMin: Number(qs('#product-stock-min').value || 0),
    margen: precio > 0 ? ((precio - costo) / precio) * 100 : 0,
    updatedAt: serverTimestamp(),
  };
  if (!payload.nombre) return toast('Ingresa el nombre del producto.');
  if (id) {
    await updateDoc(doc(db, 'productos', id), payload);
    toast('Producto actualizado.');
  } else {
    await addDoc(productosRef, { ...payload, kardex: [{ tipo: 'inicial', cantidad: stock, fecha: todayISO(), nota: 'Stock inicial' }], createdAt: serverTimestamp() });
    toast('Producto agregado al inventario.');
  }
  resetProductForm();
}

export function editProduct(id) {
  const p = state.productos.find(x => x.id === id);
  if (!p) return;
  qs('#product-doc-id').value = p.id;
  qs('#product-code').value = p.codigo || '';
  qs('#product-name').value = p.nombre || '';
  qs('#product-category').value = p.categoria || '';
  qs('#product-sale-type').value = p.tipoVenta || 'unidad';
  qs('#product-cost').value = Number(p.costo || 0);
  qs('#product-price').value = Number(p.precio || 0);
  qs('#product-stock').value = Number(p.stock || 0);
  qs('#product-stock-min').value = Number(p.stockMin || 0);
  qs('#product-form-title').textContent = 'Editar producto';
  qs('#cancel-product-edit').hidden = false;
  qs('#view-inventario').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

export function resetProductForm() {
  qs('#product-form')?.reset();
  if (qs('#product-sale-type')) qs('#product-sale-type').value = 'unidad';
  if (qs('#product-code')) qs('#product-code').value = generateProductCode('', '');
  qs('#product-doc-id').value = '';
  qs('#product-form-title').textContent = 'Nuevo producto';
  qs('#cancel-product-edit').hidden = true;
}

export async function addInventoryMovement(id) {
  const p = state.productos.find(x => x.id === id);
  if (!p) return;
  const tipo = prompt('Tipo de movimiento: entrada, salida o ajuste', 'entrada');
  if (!tipo) return;
  const normalized = tipo.toLowerCase().includes('sal') ? 'salida' : tipo.toLowerCase().includes('aju') ? 'ajuste' : 'entrada';
  const cantidad = Number(prompt('Cantidad', '1') || 0);
  if (!cantidad) return toast('Cantidad inválida.');
  const nota = prompt('Concepto / nota', '') || 'Movimiento manual';
  const delta = normalized === 'salida' ? -Math.abs(cantidad) : Math.abs(cantidad);
  await updateDoc(doc(db, 'productos', id), {
    stock: increment(delta),
    kardex: arrayUnion({ tipo: normalized, cantidad: delta, fecha: todayISO(), nota }),
    updatedAt: serverTimestamp(),
  });
  toast('Movimiento registrado en kardex.');
}


export function renderKardexGeneral() {
  const container = qs('#kardex-table');
  if (!container) return;
  const productSelect = qs('#kardex-product-filter');
  if (productSelect) {
    const current = productSelect.value || state.kardexProducto || 'todos';
    productSelect.innerHTML = '<option value="todos">Todos los productos</option>' + state.productos
      .slice()
      .sort((a, b) => String(a.nombre || '').localeCompare(String(b.nombre || '')))
      .map(p => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.codigo || '')} · ${escapeHtml(p.nombre || '')}</option>`)
      .join('');
    productSelect.value = state.productos.some(p => p.id === current) ? current : 'todos';
    state.kardexProducto = productSelect.value;
  }

  const search = String(state.kardexSearch || '').toLowerCase().trim();
  const typeFilter = state.kardexTipo || 'todos';
  const productFilter = state.kardexProducto || 'todos';
  const rows = [];
  state.productos.forEach(p => {
    (p.kardex || []).forEach((k, index) => {
      const row = {
        productoId: p.id,
        codigo: p.codigo || '',
        producto: p.nombre || '',
        categoria: p.categoria || '',
        fecha: k.fecha || '',
        tipo: k.tipo || '',
        cantidad: Number(k.cantidad || 0),
        nota: k.nota || '',
        stockActual: Number(p.stock || 0),
        index,
      };
      rows.push(row);
    });
  });
  const filtered = rows
    .filter(r => productFilter === 'todos' || r.productoId === productFilter)
    .filter(r => typeFilter === 'todos' || String(r.tipo || '').toLowerCase() === typeFilter)
    .filter(r => !search || `${r.codigo} ${r.producto} ${r.categoria} ${r.tipo} ${r.nota} ${r.fecha}`.toLowerCase().includes(search))
    .sort((a, b) => String(b.fecha || '').localeCompare(String(a.fecha || '')) || String(a.producto).localeCompare(String(b.producto)));

  const entradas = filtered.filter(r => r.cantidad > 0).reduce((s, r) => s + r.cantidad, 0);
  const salidas = Math.abs(filtered.filter(r => r.cantidad < 0).reduce((s, r) => s + r.cantidad, 0));

  container.innerHTML = `
    <div class="summary-grid compact-grid">
      <div class="summary-card"><span>Movimientos</span><strong>${filtered.length}</strong></div>
      <div class="summary-card"><span>Entradas</span><strong>${entradas}</strong></div>
      <div class="summary-card"><span>Salidas</span><strong>${salidas}</strong></div>
    </div>
    ${filtered.length ? `<div class="report-table-wrap"><table class="table report-table"><thead><tr><th>Fecha</th><th>Código</th><th>Producto</th><th>Categoría</th><th>Tipo</th><th>Cantidad</th><th>Nota</th><th>Stock actual</th></tr></thead><tbody>${filtered.map(r => `<tr><td>${escapeHtml(r.fecha)}</td><td><strong>${escapeHtml(r.codigo)}</strong></td><td>${escapeHtml(r.producto)}</td><td>${escapeHtml(r.categoria || '-')}</td><td><span class="status ${r.cantidad < 0 ? 'pendiente' : 'entregado'}">${escapeHtml(r.tipo)}</span></td><td>${r.cantidad}</td><td>${escapeHtml(r.nota)}</td><td>${r.stockActual}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">No hay movimientos que coincidan con los filtros.</div>'}
  `;
}

export function showKardex(id) {
  const p = state.productos.find(x => x.id === id);
  if (!p) return;
  qs('#detail-title').textContent = `Kardex: ${p.nombre || p.codigo}`;
  const rows = (p.kardex || []).slice().reverse();
  qs('#detail-body').innerHTML = rows.length ? `
    <p><strong>Stock actual:</strong> ${Number(p.stock || 0)}</p>
    <table class="table"><thead><tr><th>Fecha</th><th>Tipo</th><th>Cantidad</th><th>Nota</th></tr></thead><tbody>
      ${rows.map(k => `<tr><td>${escapeHtml(k.fecha || '')}</td><td>${escapeHtml(k.tipo || '')}</td><td>${Number(k.cantidad || 0)}</td><td>${escapeHtml(k.nota || '')}</td></tr>`).join('')}
    </tbody></table>` : '<div class="empty">Este producto todavía no tiene movimientos.</div>';
  document.querySelector('#detail-dialog').showModal();
}

export async function adjustInventoryForOrder(oldOrder = null, newOrder = null) {
  const oldItems = oldOrder?.items || [];
  const newItems = newOrder?.items || [];
  const deltas = new Map();
  oldItems.forEach(item => {
    if (!item.productoId) return;
    deltas.set(item.productoId, (deltas.get(item.productoId) || 0) + lineItemQtyForStock(item));
  });
  newItems.forEach(item => {
    if (!item.productoId) return;
    deltas.set(item.productoId, (deltas.get(item.productoId) || 0) - lineItemQtyForStock(item));
  });
  const tasks = [];
  for (const [productId, delta] of deltas.entries()) {
    if (!delta) continue;
    const nota = newOrder?.cliente ? `Pedido de ${newOrder.cliente}` : 'Ajuste por pedido';
    tasks.push(updateDoc(doc(db, 'productos', productId), {
      stock: increment(delta),
      kardex: arrayUnion({ tipo: delta < 0 ? 'salida' : 'entrada', cantidad: delta, fecha: todayISO(), nota }),
      updatedAt: serverTimestamp(),
    }));
  }
  await Promise.all(tasks);
}
