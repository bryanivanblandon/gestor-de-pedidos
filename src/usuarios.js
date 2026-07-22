import { state } from './state.js';
import { usuariosRef, addDoc, doc, updateDoc, onSnapshot, serverTimestamp, db } from './firebase.js';
import { qs, qsa, closeDialog, openDialog, setEmpty, toast } from './ui.js';
import { escapeHtml } from './utils.js';

const INTERNAL_USER_KEY = 'arca_pos_usuario_interno_v1';

export const ROLE_PERMISSIONS = {
  admin: ['dashboard','clientes','pedidos','cobranza','caja','inventario','cotizaciones','reportes','configuracion'],
  usuario: ['dashboard','clientes','pedidos','caja','inventario','cotizaciones'],
};

export function listenUsuarios() {
  return onSnapshot(usuariosRef, snap => {
    state.usuarios = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderUsuarios();
    ensureInternalUser();
  });
}

function readStoredInternalUser() {
  try { return JSON.parse(localStorage.getItem(INTERNAL_USER_KEY) || 'null'); } catch { return null; }
}

function writeStoredInternalUser(user) {
  if (!user) localStorage.removeItem(INTERNAL_USER_KEY);
  else localStorage.setItem(INTERNAL_USER_KEY, JSON.stringify({ id: user.id, usuario: user.usuario, rol: user.rol }));
}

export function ensureInternalUser() {
  const stored = readStoredInternalUser();
  const validStored = stored?.id && (stored.id === 'admin-firebase' || state.usuarios.some(u => u.id === stored.id && u.activo !== false));
  if (validStored && (!state.usuarioInterno || state.usuarioInterno.id === 'admin-firebase')) {
    state.usuarioInterno = stored;
    applyPermissions();
    return;
  }
  if (state.usuarioInterno) {
    applyPermissions();
    return;
  }
  state.usuarioInterno = { id: 'admin-firebase', usuario: 'Administrador', rol: 'admin' };
  applyPermissions();
}

export function hasPermission(view) {
  const role = state.usuarioInterno?.rol || 'admin';
  return (ROLE_PERMISSIONS[role] || ROLE_PERMISSIONS.usuario).includes(view);
}

export function applyPermissions() {
  const user = state.usuarioInterno;
  qsa('[data-view]').forEach(el => {
    const view = el.dataset.view;
    if (!view) return;
    el.hidden = !hasPermission(view);
  });
  qsa('.permiso-admin').forEach(el => { el.hidden = (user?.rol || 'admin') !== 'admin'; });
  const session = qs('#session-user');
  if (session && user) session.textContent = `${session.textContent.split(' · ')[0]} · POS: ${user.usuario || user.nombre || 'usuario'} (${user.rol || 'admin'})`;
  const switchBtn = qs('#internal-switch-button');
  if (switchBtn) switchBtn.textContent = `POS: ${user?.usuario || 'Administrador'}`;
}

export function renderUsuarios() {
  const list = qs('#internal-users-list');
  if (!list) return;
  if (!state.usuarios.length) return setEmpty(list, 'Aún no hay usuarios internos. Crea un administrador y usuarios de venta/operación.');
  list.innerHTML = state.usuarios.map(u => `<article class="record-card compact-record">
    <div class="record-head"><div><div class="record-title">${escapeHtml(u.usuario || '')}</div><div class="record-sub">Nivel: <strong>${escapeHtml(u.rol || 'usuario')}</strong></div></div></div>
    <div class="record-actions"><button class="action" data-user-edit="${u.id}">Editar</button></div>
  </article>`).join('');
}

export async function saveInternalUser(event) {
  event.preventDefault();
  const id = qs('#internal-user-id').value;
  const payload = {
    usuario: qs('#internal-user-name').value.trim(),
    pin: qs('#internal-user-pin').value.trim(),
    rol: qs('#internal-user-role').value || 'usuario',
    activo: true,
    updatedAt: serverTimestamp(),
  };
  if (!payload.usuario || !payload.pin) return toast('Ingresa usuario y PIN.');
  if (id) await updateDoc(doc(db, 'usuarios', id), payload);
  else await addDoc(usuariosRef, { ...payload, createdAt: serverTimestamp() });
  qs('#internal-user-form').reset();
  qs('#internal-user-id').value = '';
  toast('Usuario interno guardado.');
}

export function editInternalUser(id) {
  const u = state.usuarios.find(x => x.id === id);
  if (!u) return;
  qs('#internal-user-id').value = u.id;
  qs('#internal-user-name').value = u.usuario || '';
  qs('#internal-user-pin').value = u.pin || '';
  qs('#internal-user-role').value = u.rol || 'usuario';
}

export function internalLogin(event) {
  event.preventDefault();
  const usuario = qs('#internal-login-name').value.trim().toLowerCase();
  const pin = qs('#internal-login-pin').value.trim();
  const found = state.usuarios.find(u => String(u.usuario || '').toLowerCase() === usuario && String(u.pin || '') === pin && u.activo !== false);
  const err = qs('#internal-login-error');
  if (!found) { err.textContent = 'Usuario o PIN incorrecto.'; err.hidden = false; return; }
  state.usuarioInterno = found;
  writeStoredInternalUser(found);
  err.hidden = true;
  closeDialog('#internal-login-dialog');
  applyPermissions();
  toast(`Bienvenido, ${found.usuario}.`);
}
