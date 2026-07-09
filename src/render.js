import { state, ESTADOS_ACTIVOS } from './state.js';
import { qs } from './ui.js';
import { calcPedido, money, normalizeEstado } from './utils.js';
import { renderClientes } from './clientes.js';
import { renderPedidos, renderUrgentes, populateClientSelect } from './pedidos.js';
import { renderCobranza } from './cobranza.js';
import { renderReportPreview, populateReportClients } from './reportes.js';
import { renderCaja, getActiveShift } from './caja.js';
import { renderInventario, renderProductOptions } from './inventario.js';
import { renderCotizaciones, populateQuoteClientSelect } from './cotizaciones.js';
import { renderUsuarios, applyPermissions } from './usuarios.js';

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
  renderInventario();
  renderProductOptions();
  renderCotizaciones();
  populateQuoteClientSelect(qs('#quote-client')?.value || '');
  renderUsuarios();
  applyPermissions();
}

function renderDashboard() {
  const active = state.pedidos.filter(p => ESTADOS_ACTIVOS.includes(normalizeEstado(p.estado || 'Pendiente'))).length;
  const delivered = state.pedidos.filter(p => normalizeEstado(p.estado || '') === 'Entregado').length;
  const debts = state.pedidos.filter(p => (p.estado || 'Pendiente') !== 'Anulado' && calcPedido(p).saldo > 0);
  const pendingCs = debts.filter(p => (p.moneda || 'C$') === 'C$').reduce((s, p) => s + calcPedido(p).saldo, 0);
  const pendingUsd = debts.filter(p => (p.moneda || 'C$') === '$').reduce((s, p) => s + calcPedido(p).saldo, 0);

  const lowStock = state.productos.filter(p => Number(p.stock || 0) <= Number(p.stockMin || 0)).length;
  qs('#summary-cards').innerHTML = `
    <div class="summary-card"><span>Clientes</span><strong>${state.clientes.length}</strong></div>
    <div class="summary-card"><span>Pedidos activos</span><strong>${active}</strong></div>
    <div class="summary-card"><span>Entregados</span><strong>${delivered}</strong></div>
    <div class="summary-card"><span>Por cobrar</span><strong>${money(pendingCs, 'C$')} / ${money(pendingUsd, '$')}</strong></div>
    <div class="summary-card"><span>Productos</span><strong>${state.productos.length}</strong></div>
    <div class="summary-card"><span>Stock bajo</span><strong>${lowStock}</strong></div>`;

  const gate = qs('#dashboard-cash-gate');
  const shift = getActiveShift();
  if (gate) {
    gate.innerHTML = shift
      ? `<div class="cash-gate open"><div><strong>Caja abierta</strong><span>Turno activo desde ${shift.fecha || ''}. Puedes facturar y cobrar.</span></div><button class="secondary" data-view="caja">Ver caja</button></div>`
      : `<div class="cash-gate closed"><div><strong>Caja cerrada</strong><span>Antes de vender o cobrar, abre tu turno de caja.</span></div><button class="primary" data-view="caja">Abrir turno</button></div>`;
  }
}
