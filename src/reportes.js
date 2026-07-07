import { state, ESTADOS, ESTADOS_ACTIVOS } from './state.js';
import { calcPedido, money, BUSINESS_NAME, todayISO, escapeHtml, daysLate, byDeliveryDate } from './utils.js';
import { toast, qs } from './ui.js';

const reportState = {
  type: 'produccion',
  dateField: 'fecha_entrega',
  start: '',
  end: '',
  status: 'activos',
  currency: 'todas',
  clientId: 'todos',
  payment: 'todos',
  search: '',
};

function getPdf() {
  const lib = window.jspdf;
  if (!lib?.jsPDF) {
    toast('No se cargó la librería PDF. Revisa tu conexión.');
    return null;
  }
  return new lib.jsPDF({ unit: 'mm', format: 'letter' });
}

function getDateValue(pedido, field = 'fecha_entrega') {
  if (field === 'fecha_entrega') return pedido.fecha_entrega || '';
  const value = pedido[field];
  if (!value) return '';
  if (typeof value === 'string') return value.slice(0, 10);
  if (typeof value?.toDate === 'function') return value.toDate().toISOString().slice(0, 10);
  if (value?.seconds) return new Date(value.seconds * 1000).toISOString().slice(0, 10);
  return '';
}

function getOrderStatus(p) {
  return p.estado || 'Pendiente';
}

function getSelectedClientName() {
  if (reportState.clientId === 'todos') return 'Todos los clientes';
  const client = state.clientes.find(c => c.id === reportState.clientId);
  return client?.nombre || 'Cliente seleccionado';
}

function sortReportRows(a, b) {
  const aDate = getDateValue(a, reportState.dateField) || a.fecha_entrega || '';
  const bDate = getDateValue(b, reportState.dateField) || b.fecha_entrega || '';
  return String(aDate).localeCompare(String(bDate)) || byDeliveryDate(a, b);
}

export function setupReportEvents() {
  const ids = ['#report-type', '#report-date-field', '#report-start', '#report-end', '#report-status', '#report-currency', '#report-client', '#report-payment', '#report-search'];
  ids.forEach(id => {
    const el = qs(id);
    if (!el) return;
    el.addEventListener('input', syncReportFilters);
    el.addEventListener('change', syncReportFilters);
  });

  qs('#report-download')?.addEventListener('click', () => generateCurrentReport());
  qs('#report-clear')?.addEventListener('click', clearReportFilters);

  document.addEventListener('click', e => {
    const card = e.target.closest('[data-report-type]');
    if (!card) return;
    selectReportType(card.dataset.reportType);
  });
}

export function selectReportType(type = 'produccion') {
  reportState.type = type;
  const typeSelect = qs('#report-type');
  if (typeSelect) typeSelect.value = type;

  if (type === 'produccion') {
    reportState.status = 'activos';
    reportState.payment = 'todos';
  }
  if (type === 'cobranza') {
    reportState.status = 'no-anulados';
    reportState.payment = 'pendiente';
  }
  if (type === 'ventas') {
    reportState.status = 'no-anulados';
    reportState.payment = 'todos';
  }

  syncFormFromState();
  renderReportPreview();
  document.querySelector('#report-preview-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function syncReportFilters() {
  reportState.type = qs('#report-type')?.value || reportState.type;
  reportState.dateField = qs('#report-date-field')?.value || 'fecha_entrega';
  reportState.start = qs('#report-start')?.value || '';
  reportState.end = qs('#report-end')?.value || '';
  reportState.status = qs('#report-status')?.value || 'todos';
  reportState.currency = qs('#report-currency')?.value || 'todas';
  reportState.clientId = qs('#report-client')?.value || 'todos';
  reportState.payment = qs('#report-payment')?.value || 'todos';
  reportState.search = (qs('#report-search')?.value || '').trim().toLowerCase();
  renderReportPreview();
}

function syncFormFromState() {
  const setters = {
    '#report-type': reportState.type,
    '#report-date-field': reportState.dateField,
    '#report-start': reportState.start,
    '#report-end': reportState.end,
    '#report-status': reportState.status,
    '#report-currency': reportState.currency,
    '#report-client': reportState.clientId,
    '#report-payment': reportState.payment,
    '#report-search': reportState.search,
  };
  Object.entries(setters).forEach(([selector, value]) => {
    const el = qs(selector);
    if (el) el.value = value;
  });
}

function clearReportFilters() {
  reportState.type = 'produccion';
  reportState.dateField = 'fecha_entrega';
  reportState.start = '';
  reportState.end = '';
  reportState.status = 'activos';
  reportState.currency = 'todas';
  reportState.clientId = 'todos';
  reportState.payment = 'todos';
  reportState.search = '';
  syncFormFromState();
  renderReportPreview();
}

export function populateReportClients() {
  const select = qs('#report-client');
  if (!select) return;
  const current = select.value || reportState.clientId;
  select.innerHTML = '<option value="todos">Todos los clientes</option>' + state.clientes
    .slice()
    .sort((a, b) => String(a.nombre || '').localeCompare(String(b.nombre || '')))
    .map(c => `<option value="${c.id}">${escapeHtml(c.nombre || 'Sin nombre')}</option>`)
    .join('');
  select.value = state.clientes.some(c => c.id === current) ? current : 'todos';
  reportState.clientId = select.value;
}

export function renderReportPreview() {
  populateReportClients();
  const summaryEl = qs('#report-summary');
  const previewEl = qs('#report-preview');
  const titleEl = qs('#report-preview-title');
  const downloadBtn = qs('#report-download');
  if (!summaryEl || !previewEl) return;

  const rows = getFilteredOrders();
  const totals = getTotals(rows);
  const title = getReportTitle();
  if (titleEl) titleEl.textContent = title;
  if (downloadBtn) downloadBtn.disabled = rows.length === 0;

  summaryEl.innerHTML = renderSummary(totals, rows.length);
  previewEl.innerHTML = rows.length ? renderTable(rows) : '<div class="empty">No hay información para estos filtros.</div>';
}

function getReportTitle() {
  const map = {
    produccion: 'Vista previa: reporte de producción',
    cobranza: 'Vista previa: reporte de cobranza',
    ventas: 'Vista previa: reporte de ventas',
  };
  return map[reportState.type] || 'Vista previa del reporte';
}

function getFilteredOrders() {
  let rows = state.pedidos.slice();

  if (reportState.type === 'produccion') rows = rows.filter(p => ESTADOS_ACTIVOS.includes(getOrderStatus(p)));
  if (reportState.type === 'cobranza') rows = rows.filter(p => getOrderStatus(p) !== 'Anulado' && calcPedido(p).saldo > 0);
  if (reportState.type === 'ventas') rows = rows.filter(p => getOrderStatus(p) !== 'Anulado');

  if (reportState.status === 'activos') rows = rows.filter(p => ESTADOS_ACTIVOS.includes(getOrderStatus(p)));
  else if (reportState.status === 'no-anulados') rows = rows.filter(p => getOrderStatus(p) !== 'Anulado');
  else if (reportState.status !== 'todos') rows = rows.filter(p => getOrderStatus(p) === reportState.status);

  if (reportState.currency !== 'todas') rows = rows.filter(p => (p.moneda || 'C$') === reportState.currency);
  if (reportState.clientId !== 'todos') rows = rows.filter(p => p.clienteId === reportState.clientId);

  if (reportState.payment === 'pendiente') rows = rows.filter(p => calcPedido(p).saldo > 0);
  if (reportState.payment === 'pagado') rows = rows.filter(p => calcPedido(p).saldo <= 0);

  if (reportState.start) rows = rows.filter(p => {
    const date = getDateValue(p, reportState.dateField);
    return date && date >= reportState.start;
  });
  if (reportState.end) rows = rows.filter(p => {
    const date = getDateValue(p, reportState.dateField);
    return date && date <= reportState.end;
  });

  if (reportState.search) {
    rows = rows.filter(p => `${p.cliente || ''} ${p.descripcion || ''} ${p.fecha_entrega || ''} ${p.estado || ''}`.toLowerCase().includes(reportState.search));
  }

  return rows.sort(sortReportRows);
}

function getTotals(rows) {
  return rows.reduce((acc, p) => {
    const c = calcPedido(p);
    const currency = p.moneda || 'C$';
    const target = currency === '$' ? acc.usd : acc.cs;
    target.total += c.total;
    target.pagado += c.totalPagado;
    target.saldo += c.saldo;
    if (c.saldo > 0) acc.pendientes += 1;
    return acc;
  }, {
    cs: { total: 0, pagado: 0, saldo: 0 },
    usd: { total: 0, pagado: 0, saldo: 0 },
    pendientes: 0,
  });
}

function renderSummary(totals, count) {
  return `
    <div class="summary-card"><span>Registros</span><strong>${count}</strong></div>
    <div class="summary-card"><span>Total C$</span><strong>${money(totals.cs.total, 'C$')}</strong></div>
    <div class="summary-card"><span>Saldo C$</span><strong>${money(totals.cs.saldo, 'C$')}</strong></div>
    <div class="summary-card"><span>Total $</span><strong>${money(totals.usd.total, '$')}</strong></div>
    <div class="summary-card"><span>Saldo $</span><strong>${money(totals.usd.saldo, '$')}</strong></div>
    <div class="summary-card"><span>Con saldo</span><strong>${totals.pendientes}</strong></div>`;
}

function renderTable(rows) {
  return `
    <div class="report-table-wrap">
      <table class="table report-table">
        <thead>
          <tr>
            <th>Fecha</th>
            <th>Cliente</th>
            <th>Pedido</th>
            <th>Estado</th>
            <th>Total</th>
            <th>Pagado</th>
            <th>Saldo</th>
            <th>Atraso</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(p => {
            const c = calcPedido(p);
            const currency = p.moneda || 'C$';
            const late = daysLate(p.fecha_entrega || '');
            return `<tr>
              <td>${escapeHtml(getDateValue(p, reportState.dateField) || p.fecha_entrega || '')}</td>
              <td>${escapeHtml(p.cliente || 'Sin cliente')}</td>
              <td>${escapeHtml(p.descripcion || '')}</td>
              <td>${escapeHtml(getOrderStatus(p))}</td>
              <td>${money(c.total, currency)}</td>
              <td>${money(c.totalPagado, currency)}</td>
              <td><strong>${money(c.saldo, currency)}</strong></td>
              <td>${late ? `${late} días` : '-'}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`;
}

export function generateReport(type) {
  selectReportType(type);
  generateCurrentReport();
}

export function generateCurrentReport() {
  syncReportFilters();
  const rows = getFilteredOrders();
  if (!rows.length) return toast('No hay datos para descargar con estos filtros.');
  const pdf = getPdf();
  if (!pdf) return;

  const title = getReportTitle().replace('Vista previa: ', '');
  const totals = getTotals(rows);
  let y = header(pdf, title, rows.length);

  pdf.setFontSize(9);
  pdf.setFont(undefined, 'bold');
  pdf.text('Resumen', 14, y); y += 5;
  pdf.setFont(undefined, 'normal');
  pdf.text(`Cliente: ${getSelectedClientName()} | Estado: ${labelStatus(reportState.status)} | Moneda: ${labelCurrency(reportState.currency)}`, 14, y); y += 5;
  pdf.text(`Desde: ${reportState.start || 'sin inicio'} | Hasta: ${reportState.end || 'sin fin'} | Pago: ${labelPayment(reportState.payment)}`, 14, y); y += 6;
  pdf.text(`Total C$: ${totals.cs.total.toFixed(2)} | Pagado C$: ${totals.cs.pagado.toFixed(2)} | Saldo C$: ${totals.cs.saldo.toFixed(2)}`, 14, y); y += 5;
  pdf.text(`Total $: ${totals.usd.total.toFixed(2)} | Pagado $: ${totals.usd.pagado.toFixed(2)} | Saldo $: ${totals.usd.saldo.toFixed(2)}`, 14, y); y += 8;

  y = drawTableHeader(pdf, y);
  rows.forEach(p => {
    const c = calcPedido(p);
    const currency = p.moneda || 'C$';
    const pedido = pdf.splitTextToSize(String(p.descripcion || ''), 58);
    const rowHeight = Math.max(8, pedido.length * 4 + 2);
    y = pageBreak(pdf, y, rowHeight + 8);
    if (y < 28) y = drawTableHeader(pdf, y);

    pdf.setFont(undefined, 'normal');
    pdf.setFontSize(8);
    pdf.text(String(getDateValue(p, reportState.dateField) || p.fecha_entrega || ''), 14, y);
    pdf.text(pdf.splitTextToSize(String(p.cliente || ''), 35), 34, y);
    pdf.text(pedido, 76, y);
    pdf.text(String(getOrderStatus(p)), 136, y);
    pdf.text(money(c.total, currency), 160, y);
    pdf.text(money(c.saldo, currency), 184, y, { align: 'right' });
    y += rowHeight;
  });

  pdf.save(`${reportState.type}-${todayISO()}.pdf`);
}

function header(pdf, title, count) {
  pdf.setFontSize(16);
  pdf.setFont(undefined, 'bold');
  pdf.text(BUSINESS_NAME, 14, 17);
  pdf.setFontSize(11);
  pdf.setFont(undefined, 'normal');
  pdf.text(`${title} | Generado: ${todayISO()} | Registros: ${count}`, 14, 25);
  pdf.line(14, 30, 202, 30);
  return 38;
}

function drawTableHeader(pdf, y) {
  y = pageBreak(pdf, y, 10);
  pdf.setFillColor(245, 247, 251);
  pdf.rect(14, y - 4, 188, 8, 'F');
  pdf.setFontSize(8);
  pdf.setFont(undefined, 'bold');
  pdf.text('Fecha', 14, y);
  pdf.text('Cliente', 34, y);
  pdf.text('Pedido', 76, y);
  pdf.text('Estado', 136, y);
  pdf.text('Total', 160, y);
  pdf.text('Saldo', 184, y, { align: 'right' });
  return y + 8;
}

function pageBreak(pdf, y, needed = 12) {
  if (y + needed <= 262) return y;
  pdf.addPage();
  return 18;
}

function labelStatus(value) {
  if (value === 'activos') return 'Activos';
  if (value === 'no-anulados') return 'No anulados';
  if (value === 'todos') return 'Todos';
  return value || 'Todos';
}

function labelCurrency(value) {
  if (value === 'todas') return 'Todas';
  return value;
}

function labelPayment(value) {
  if (value === 'pendiente') return 'Con saldo pendiente';
  if (value === 'pagado') return 'Pagados';
  return 'Todos';
}
