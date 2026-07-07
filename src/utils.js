export const BUSINESS_NAME = 'ARCA DE LA NUEVA ALIANZA';
export const BUSINESS_WHATSAPP = '50586486539';

export function money(value = 0, currency = 'C$') {
  return `${currency}${Number(value || 0).toFixed(2)}`;
}

export function normalizePhone(phone = '') {
  const digits = String(phone).replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('505')) return digits;
  if (digits.length === 8) return `505${digits}`;
  return digits;
}

export function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export function statusClass(status = 'Pendiente') {
  return String(status)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ñ/g, 'n')
    .replace(/\s+/g, '-');
}

export function calcPedido(pedido = {}) {
  const items = Array.isArray(pedido.items) ? pedido.items : [];
  const subtotal = items.reduce((sum, item) => sum + (Number(item.cantidad || 0) * Number(item.precio || 0)), 0);
  const descuento = Math.max(0, Number(pedido.descuento || 0));
  const total = Math.max(0, Number(pedido.monto_total ?? pedido.total ?? (subtotal - descuento)));
  const totalPagado = Math.max(0, Number(pedido.total_pagado ?? pedido.totalPagado ?? 0));
  const saldo = Math.max(0, total - totalPagado);
  return { subtotal, descuento, total, totalPagado, saldo };
}

export function byDeliveryDate(a, b) {
  return String(a.fecha_entrega || '').localeCompare(String(b.fecha_entrega || ''));
}

export function daysLate(fechaEntrega) {
  if (!fechaEntrega) return 0;
  const today = new Date(todayISO() + 'T00:00:00');
  const due = new Date(fechaEntrega + 'T00:00:00');
  return Math.max(0, Math.floor((today - due) / 86400000));
}

export function getClienteName(cliente) {
  return cliente?.nombre || cliente?.name || 'Cliente sin nombre';
}
