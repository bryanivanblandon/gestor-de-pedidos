import { state } from './state.js';
import { clientesRef, addDoc, doc, updateDoc, onSnapshot, serverTimestamp, db } from './firebase.js';
import { qs, setEmpty, toast } from './ui.js';
import { escapeHtml, getClienteName } from './utils.js';
import { renderAll } from './render.js';

export function listenClientes() {
  return onSnapshot(clientesRef, snap => {
    state.clientes = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const maxId = state.clientes.reduce((max, c) => Math.max(max, Number(c.clienteId || 0)), 0);
    state.nextClientId = maxId + 1;
    resetClientForm(false);
    renderAll();
  });
}

export function renderClientes() {
  const list = qs('#clients-list');
  const search = state.clientSearch.toLowerCase().trim();
  const clientes = state.clientes
    .filter(c => `${c.nombre || ''} ${c.telefono || ''} ${c.clienteId || ''}`.toLowerCase().includes(search))
    .sort((a, b) => getClienteName(a).localeCompare(getClienteName(b)));

  if (!clientes.length) return setEmpty(list, 'Todavía no hay clientes registrados.');

  list.innerHTML = clientes.map(c => {
    const publicId = String(c.clienteId || '').padStart(4, '0');
    const pedidos = state.pedidos.filter(p => p.clienteId === c.id || p.cliente === c.nombre);
    return `
      <article class="record-card">
        <div class="record-head">
          <div>
            <div class="record-title">${escapeHtml(getClienteName(c))}</div>
            <div class="record-sub">ID ${publicId} · WhatsApp: ${escapeHtml(c.telefono || 'Sin número')}</div>
          </div>
          <div class="record-meta">${pedidos.length} pedidos</div>
        </div>
        <div class="record-actions">
          <button class="action" data-client-edit="${c.id}">Editar</button>
          <button class="action" data-client-history="${c.id}">Historial</button>
          <button class="action green" data-client-order="${c.id}">Nuevo pedido</button>
        </div>
      </article>`;
  }).join('');
}

export async function saveClient(event) {
  event.preventDefault();
  const docId = qs('#client-doc-id').value;
  const nombre = qs('#client-name').value.trim();
  const telefono = qs('#client-phone').value.trim();
  if (!nombre || !telefono) return toast('Completa nombre y WhatsApp.');

  if (docId) {
    await updateDoc(doc(db, 'clientes', docId), { nombre, telefono, updatedAt: serverTimestamp() });
    toast('Cliente actualizado.');
  } else {
    await addDoc(clientesRef, { clienteId: state.nextClientId, nombre, telefono, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    toast('Cliente guardado.');
  }
  resetClientForm();
}

export function editClient(id) {
  const c = state.clientes.find(x => x.id === id);
  if (!c) return;
  qs('#client-doc-id').value = c.id;
  qs('#client-public-id').value = String(c.clienteId || '').padStart(4, '0');
  qs('#client-name').value = c.nombre || '';
  qs('#client-phone').value = c.telefono || '';
  qs('#client-form-title').textContent = 'Editar cliente';
  qs('#cancel-client-edit').hidden = false;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

export function resetClientForm(clear = true) {
  if (clear) qs('#client-form').reset();
  qs('#client-doc-id').value = '';
  qs('#client-public-id').value = String(state.nextClientId || 1).padStart(4, '0');
  qs('#client-form-title').textContent = 'Registrar cliente';
  qs('#cancel-client-edit').hidden = true;
}

export function showClientHistory(id) {
  const c = state.clientes.find(x => x.id === id);
  if (!c) return;
  const pedidos = state.pedidos.filter(p => p.clienteId === c.id || p.cliente === c.nombre);
  const body = qs('#detail-body');
  qs('#detail-title').textContent = `Historial: ${getClienteName(c)}`;
  if (!pedidos.length) {
    body.innerHTML = '<div class="empty">Este cliente todavía no tiene pedidos.</div>';
  } else {
    body.innerHTML = `<table class="table"><thead><tr><th>Entrega</th><th>Pedido</th><th>Estado</th><th>Total</th></tr></thead><tbody>${pedidos.map(p => `
      <tr><td>${escapeHtml(p.fecha_entrega || '')}</td><td>${escapeHtml(shortOrderDescription(p))}</td><td>${escapeHtml(normalizeEstado(p.estado || 'Pendiente'))}</td><td>${escapeHtml(p.moneda || 'C$')}${Number(p.monto_total || 0).toFixed(2)}</td></tr>`).join('')}</tbody></table>`;
  }
  qs('#detail-dialog').showModal();
}
