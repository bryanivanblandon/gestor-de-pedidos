import { state } from './state.js';
import { qs, setEmpty } from './ui.js';
import { calcPedido, daysLate, escapeHtml, money, normalizeEstado, shortOrderDescription } from './utils.js';

export function getDebts() {
  return state.pedidos
    .filter(p => normalizeEstado(p.estado || 'Pendiente') !== 'Anulado')
    .map(p => ({ ...p, calc: calcPedido(p), late: daysLate(p.fecha_entrega) }))
    .filter(p => p.calc.saldo > 0)
    .sort((a, b) => b.late - a.late || String(a.fecha_entrega || '').localeCompare(String(b.fecha_entrega || '')));
}

export function renderCobranza() {
  const debts = getDebts();
  const summary = qs('#debt-summary');
  const list = qs('#debt-list');
  const totalCs = debts.filter(d => (d.moneda || 'C$') === 'C$').reduce((s, d) => s + d.calc.saldo, 0);
  const totalUsd = debts.filter(d => (d.moneda || 'C$') === '$').reduce((s, d) => s + d.calc.saldo, 0);
  const atrasados = debts.filter(d => d.late > 0).length;

  summary.innerHTML = `
    <div class="summary-card"><span>Pendiente C$</span><strong>${money(totalCs, 'C$')}</strong></div>
    <div class="summary-card"><span>Pendiente $</span><strong>${money(totalUsd, '$')}</strong></div>
    <div class="summary-card"><span>Clientes / pedidos</span><strong>${debts.length}</strong></div>
    <div class="summary-card"><span>Atrasados</span><strong>${atrasados}</strong></div>`;

  if (!debts.length) return setEmpty(list, 'No hay saldos pendientes.');

  list.innerHTML = debts.map(d => `
    <article class="record-card">
      <div class="record-head">
        <div>
          <div class="record-title">${escapeHtml(d.cliente || 'Sin cliente')}</div>
          <div class="record-sub">${escapeHtml(shortOrderDescription(d))} · Entrega: <strong>${escapeHtml(d.fecha_entrega || '')}</strong>${d.late ? ` · <strong>${d.late} días tarde</strong>` : ''}</div>
        </div>
        <div class="record-meta">
          <div>${money(d.calc.saldo, d.moneda || 'C$')}</div>
          <div class="record-sub">Total: ${money(d.calc.total, d.moneda || 'C$')}</div>
        </div>
      </div>
      <div class="record-actions">
        <button class="action green" data-order-payment="${d.id}">Registrar abono</button>
        <button class="action green" data-order-whatsapp="${d.id}">WhatsApp</button>
        <button class="action" data-order-detail="${d.id}">Detalle</button>
      </div>
    </article>`).join('');
}
