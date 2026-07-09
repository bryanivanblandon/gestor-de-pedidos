import { state, ESTADOS_ACTIVOS } from './state.js';
import { qs } from './ui.js';
import { calcPedido, money, normalizeEstado } from './utils.js';
import { renderClientes } from './clientes.js';
import { renderPedidos, renderUrgentes, populateClientSelect } from './pedidos.js';
import { renderCobranza } from './cobranza.js';
import { renderReportPreview, populateReportClients } from './reportes.js';
import { renderCaja } from './caja.js';

export function renderAll() {
  renderDashboard();
  renderClientes();
  renderPedidos();
  renderUrgentes();
  renderCobranza();
  populateClientSelect(qs('#order-client')?.value || '');
  populateReportClients();
  renderReportPreview();
  renderCaja();
}

function renderDashboard() {
  const active = state.pedidos.filter(p => ESTADOS_ACTIVOS.includes(normalizeEstado(p.estado || 'Pendiente'))).length;
  const delivered = state.pedidos.filter(p => normalizeEstado(p.estado || '') === 'Entregado').length;
  const debts = state.pedidos.filter(p => (p.estado || 'Pendiente') !== 'Anulado' && calcPedido(p).saldo > 0);
  const pendingCs = debts.filter(p => (p.moneda || 'C$') === 'C$').reduce((s, p) => s + calcPedido(p).saldo, 0);
  const pendingUsd = debts.filter(p => (p.moneda || 'C$') === '$').reduce((s, p) => s + calcPedido(p).saldo, 0);

  qs('#summary-cards').innerHTML = `
    <div class="summary-card"><span>Clientes</span><strong>${state.clientes.length}</strong></div>
    <div class="summary-card"><span>Pedidos activos</span><strong>${active}</strong></div>
    <div class="summary-card"><span>Entregados</span><strong>${delivered}</strong></div>
    <div class="summary-card"><span>Por cobrar</span><strong>${money(pendingCs, 'C$')} / ${money(pendingUsd, '$')}</strong></div>`;
}
