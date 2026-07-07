import { state } from './state.js';

export function qs(selector, root = document) { return root.querySelector(selector); }
export function qsa(selector, root = document) { return Array.from(root.querySelectorAll(selector)); }

export function toast(message = 'Acción realizada') {
  const el = qs('#toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.hidden = true; }, 2800);
}

export function setSyncStatus(text, ok = false) {
  const el = qs('#sync-status');
  el.textContent = text;
  el.style.color = ok ? '#166534' : '#64748b';
}

export function showView(name) {
  state.currentView = name;
  qsa('.view').forEach(v => v.classList.remove('active'));
  qs(`#view-${name}`)?.classList.add('active');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

export function openDialog(selector) {
  const dialog = qs(selector);
  if (!dialog.open) dialog.showModal();
}

export function closeDialog(selector) {
  const dialog = qs(selector);
  if (dialog?.open) dialog.close();
}

export function setEmpty(container, text) {
  container.innerHTML = `<div class="empty">${text}</div>`;
}
