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
  return normalizeEstado(status)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ñ/g, 'n')
    .replace(/\s+/g, '-');
}

export function normalizeEstado(status = 'Pendiente') {
  const value = String(status || 'Pendiente');
  if (['En diseño', 'En producción', 'Listo'].includes(value)) return 'Activo';
  return value;
}

export function shortOrderDescription(pedido = {}) {
  if (pedido.descripcion) return pedido.descripcion;
  const items = Array.isArray(pedido.items) ? pedido.items : [];
  if (!items.length) return 'Pedido sin detalle';
  const first = items[0]?.descripcion || 'Producto';
  return items.length > 1 ? `${first} + ${items.length - 1} más` : first;
}


export function lineItemTotal(item = {}) {
  const qty = Number(item.cantidad || 0);
  const price = Number(item.precio || 0);
  if (item.tipoVenta === 'area_cm2') {
    const ancho = Number(item.ancho || 0);
    const alto = Number(item.alto || 0);
    return qty * ancho * alto * price;
  }
  return qty * price;
}

export function lineItemQtyForStock(item = {}) {
  const qty = Number(item.cantidad || 0);
  if (item.tipoVenta === 'area_cm2') return qty * Number(item.ancho || 0) * Number(item.alto || 0);
  return qty;
}

export function calcPedido(pedido = {}) {
  const items = Array.isArray(pedido.items) ? pedido.items : [];
  const subtotal = items.reduce((sum, item) => sum + lineItemTotal(item), 0);
  const descuentoTipo = pedido.descuentoTipo || pedido.tipo_descuento || 'monto';
  const descuentoValor = Math.max(0, Number(pedido.descuentoValor ?? pedido.descuento_valor ?? pedido.descuento ?? 0));
  const descuento = descuentoTipo === 'porcentaje' ? Math.min(subtotal, subtotal * (Math.min(descuentoValor, 100) / 100)) : Math.min(subtotal, descuentoValor);
  const total = Math.max(0, Number(pedido.monto_total ?? pedido.total ?? (subtotal - descuento)));
  const totalPagado = Math.max(0, Number(pedido.total_pagado ?? pedido.totalPagado ?? 0));
  const saldo = Math.max(0, total - totalPagado);
  return { subtotal, descuento, descuentoTipo, descuentoValor, total, totalPagado, saldo };
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

export function openTicketWindow(bodyHtml = '', title = 'ticket') {
  const win = window.open('', '_blank', 'width=380,height=650');
  if (!win) return alert('El navegador bloqueó la ventana de impresión. Permite ventanas emergentes para imprimir tickets.');
  win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>
    @page { size: 80mm auto; margin: 4mm; }
    * { box-sizing: border-box; }
    body { width: 72mm; margin: 0 auto; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11px; color: #111; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 3px 0; border-bottom: 1px dashed #aaa; vertical-align: top; text-align: left; }
    hr { border: 0; border-top: 1px dashed #111; margin: 8px 0; }
    .right { text-align: right; }
    .ticket-center { text-align: center; }
    .ticket-total { text-align: right; font-weight: 700; line-height: 1.55; }
    .no-print { margin: 10px 0; display: flex; gap: 8px; }
    button { padding: 8px 10px; border: 0; border-radius: 8px; background: #111827; color: #fff; font-weight: 700; }
    @media print { .no-print { display: none; } body { width: 72mm; } }
  </style></head><body><div class="no-print"><button onclick="window.print()">Imprimir</button><button onclick="window.close()">Cerrar</button></div>${bodyHtml}</body></html>`);
  win.document.close();
  win.focus();
}
