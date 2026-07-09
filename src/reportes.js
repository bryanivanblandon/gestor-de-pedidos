import { state, ESTADOS_ACTIVOS } from './state.js';
import { calcPedido, money, BUSINESS_NAME, todayISO, escapeHtml, daysLate, byDeliveryDate, normalizeEstado, shortOrderDescription } from './utils.js';
import { toast, qs } from './ui.js';

const reportState = {
  type: 'produccion', dateField: 'fecha_entrega', start: '', end: '', status: 'activos', currency: 'todas', clientId: 'todos', payment: 'todos', search: '',
};

function getPdf() {
  const lib = window.jspdf;
  if (!lib?.jsPDF) { toast('No se cargó la librería PDF. Revisa tu conexión.'); return null; }
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
function getOrderStatus(p) { return normalizeEstado(p.estado || 'Pendiente'); }

export function setupReportEvents() {
  ['#report-type','#report-date-field','#report-start','#report-end','#report-status','#report-currency','#report-client','#report-payment','#report-search'].forEach(id => {
    const el = qs(id); if (!el) return; el.addEventListener('input', syncReportFilters); el.addEventListener('change', syncReportFilters);
  });
  qs('#report-download')?.addEventListener('click', () => generateCurrentReport());
  qs('#report-clear')?.addEventListener('click', clearReportFilters);
  document.addEventListener('click', e => { const card = e.target.closest('[data-report-type]'); if (card) selectReportType(card.dataset.reportType); });
}

export function selectReportType(type = 'produccion') {
  reportState.type = type;
  const typeSelect = qs('#report-type'); if (typeSelect) typeSelect.value = type;
  if (type === 'produccion') { reportState.status = 'activos'; reportState.payment = 'todos'; }
  if (type === 'cobranza') { reportState.status = 'no-anulados'; reportState.payment = 'pendiente'; }
  if (['ventas','gastos','inventario','cotizaciones'].includes(type)) { reportState.status = 'no-anulados'; reportState.payment = 'todos'; }
  syncFormFromState(); renderReportPreview(); document.querySelector('#report-preview-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
function syncFormFromState() { Object.entries({'#report-type':reportState.type,'#report-date-field':reportState.dateField,'#report-start':reportState.start,'#report-end':reportState.end,'#report-status':reportState.status,'#report-currency':reportState.currency,'#report-client':reportState.clientId,'#report-payment':reportState.payment,'#report-search':reportState.search}).forEach(([sel,val])=>{ const el=qs(sel); if(el) el.value=val; }); }
function clearReportFilters() { Object.assign(reportState, { type:'produccion', dateField:'fecha_entrega', start:'', end:'', status:'activos', currency:'todas', clientId:'todos', payment:'todos', search:'' }); syncFormFromState(); renderReportPreview(); }

export function populateReportClients() {
  const select = qs('#report-client'); if (!select) return;
  const current = select.value || reportState.clientId;
  select.innerHTML = '<option value="todos">Todos los clientes</option>' + state.clientes.slice().sort((a,b)=>String(a.nombre||'').localeCompare(String(b.nombre||''))).map(c=>`<option value="${c.id}">${escapeHtml(c.nombre||'Sin nombre')}</option>`).join('');
  select.value = state.clientes.some(c => c.id === current) ? current : 'todos'; reportState.clientId = select.value;
}

export function renderReportPreview() {
  populateReportClients();
  const summaryEl = qs('#report-summary'), previewEl = qs('#report-preview'), titleEl = qs('#report-preview-title'), btn = qs('#report-download');
  if (!summaryEl || !previewEl) return;
  const rows = getCurrentRows(); const title = getReportTitle();
  if (titleEl) titleEl.textContent = title; if (btn) btn.disabled = rows.length === 0;
  summaryEl.innerHTML = renderSummary(rows); previewEl.innerHTML = rows.length ? renderTable(rows) : '<div class="empty">No hay información para estos filtros.</div>';
}

function getReportTitle() { return ({produccion:'Vista previa: reporte de producción', cobranza:'Vista previa: reporte de cobranza', ventas:'Vista previa: reporte de ventas', gastos:'Vista previa: reporte de gastos de caja', inventario:'Vista previa: reporte de inventario', cotizaciones:'Vista previa: reporte de cotizaciones'}[reportState.type] || 'Vista previa del reporte'); }

function getCurrentRows() { if (reportState.type === 'gastos') return getExpenseRows(); if (reportState.type === 'inventario') return getInventoryRows(); if (reportState.type === 'cotizaciones') return getQuoteRows(); return getFilteredOrders(); }

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
  if (reportState.start) rows = rows.filter(p => (getDateValue(p, reportState.dateField) || '') >= reportState.start);
  if (reportState.end) rows = rows.filter(p => (getDateValue(p, reportState.dateField) || '') <= reportState.end);
  if (reportState.search) rows = rows.filter(p => `${p.cliente||''} ${shortOrderDescription(p)} ${p.fecha_entrega||''} ${getOrderStatus(p)}`.toLowerCase().includes(reportState.search));
  return rows.sort((a,b)=>String(getDateValue(a, reportState.dateField)||a.fecha_entrega||'').localeCompare(String(getDateValue(b, reportState.dateField)||b.fecha_entrega||'')) || byDeliveryDate(a,b));
}

function getExpenseRows() {
  let rows = [];
  state.cajaTurnos.forEach(t => (t.gastos || []).forEach(g => rows.push({ ...g, turnoFecha: t.fecha || '', turnoId: t.id })));
  if (reportState.start) rows = rows.filter(g => (g.fecha || '') >= reportState.start);
  if (reportState.end) rows = rows.filter(g => (g.fecha || '') <= reportState.end);
  if (reportState.search) rows = rows.filter(g => `${g.fecha||''} ${g.concepto||''}`.toLowerCase().includes(reportState.search));
  return rows.sort((a,b)=>String(a.fecha||'').localeCompare(String(b.fecha||'')));
}
function getInventoryRows() {
  let rows = state.productos.slice();
  if (reportState.search) rows = rows.filter(p => `${p.codigo||''} ${p.nombre||''} ${p.categoria||''}`.toLowerCase().includes(reportState.search));
  return rows.sort((a,b)=>String(a.nombre||'').localeCompare(String(b.nombre||'')));
}
function getQuoteRows() {
  let rows = state.cotizaciones.slice();
  if (reportState.clientId !== 'todos') rows = rows.filter(q => q.clienteId === reportState.clientId);
  if (reportState.currency !== 'todas') rows = rows.filter(q => (q.moneda || 'C$') === reportState.currency);
  if (reportState.start) rows = rows.filter(q => (q.validaHasta || '') >= reportState.start);
  if (reportState.end) rows = rows.filter(q => (q.validaHasta || '') <= reportState.end);
  if (reportState.search) rows = rows.filter(q => `${q.cliente||''} ${shortOrderDescription(q)} ${q.estado||''}`.toLowerCase().includes(reportState.search));
  return rows.sort((a,b)=>String(a.validaHasta||'').localeCompare(String(b.validaHasta||'')));
}

function renderSummary(rows) {
  if (reportState.type === 'gastos') {
    const total = rows.reduce((s,g)=>s+Number(g.monto||0),0);
    return `<div class="summary-card"><span>Gastos</span><strong>${rows.length}</strong></div><div class="summary-card"><span>Total salidas</span><strong>${money(total,'C$')}</strong></div>`;
  }
  if (reportState.type === 'inventario') {
    const costo = rows.reduce((s,p)=>s+Number(p.costo||0)*Number(p.stock||0),0); const venta = rows.reduce((s,p)=>s+Number(p.precio||0)*Number(p.stock||0),0); const bajo = rows.filter(p=>Number(p.stock||0)<=Number(p.stockMin||0)).length;
    return `<div class="summary-card"><span>Productos</span><strong>${rows.length}</strong></div><div class="summary-card"><span>Stock bajo</span><strong>${bajo}</strong></div><div class="summary-card"><span>Costo</span><strong>${money(costo,'C$')}</strong></div><div class="summary-card"><span>Valor venta</span><strong>${money(venta,'C$')}</strong></div>`;
  }
  if (reportState.type === 'cotizaciones') { const total = rows.reduce((s,q)=>s+calcPedido(q).total,0); const aprobadas=rows.filter(q=>q.estado==='Aprobada').length; return `<div class="summary-card"><span>Cotizaciones</span><strong>${rows.length}</strong></div><div class="summary-card"><span>Aprobadas</span><strong>${aprobadas}</strong></div><div class="summary-card"><span>Total cotizado</span><strong>${money(total,'C$')}</strong></div>`; }
  const totals = rows.reduce((acc,p)=>{ const c=calcPedido(p); const target=(p.moneda||'C$')==='$'?acc.usd:acc.cs; target.total+=c.total; target.pagado+=c.totalPagado; target.saldo+=c.saldo; if(c.saldo>0) acc.pendientes++; return acc; }, {cs:{total:0,pagado:0,saldo:0}, usd:{total:0,pagado:0,saldo:0}, pendientes:0});
  return `<div class="summary-card"><span>Registros</span><strong>${rows.length}</strong></div><div class="summary-card"><span>Total C$</span><strong>${money(totals.cs.total,'C$')}</strong></div><div class="summary-card"><span>Saldo C$</span><strong>${money(totals.cs.saldo,'C$')}</strong></div><div class="summary-card"><span>Total $</span><strong>${money(totals.usd.total,'$')}</strong></div><div class="summary-card"><span>Saldo $</span><strong>${money(totals.usd.saldo,'$')}</strong></div><div class="summary-card"><span>Con saldo</span><strong>${totals.pendientes}</strong></div>`;
}

function renderTable(rows) {
  if (reportState.type === 'gastos') return `<div class="report-table-wrap"><table class="table report-table"><thead><tr><th>Fecha</th><th>Concepto</th><th>Monto</th><th>Turno</th></tr></thead><tbody>${rows.map(g=>`<tr><td>${escapeHtml(g.fecha||'')}</td><td>${escapeHtml(g.concepto||'')}</td><td>${money(g.monto,'C$')}</td><td>${escapeHtml(g.turnoFecha||'')}</td></tr>`).join('')}</tbody></table></div>`;
  if (reportState.type === 'inventario') return `<div class="report-table-wrap"><table class="table report-table"><thead><tr><th>Código</th><th>Producto</th><th>Categoría</th><th>Stock</th><th>Costo</th><th>Precio</th><th>Margen</th></tr></thead><tbody>${rows.map(p=>{const precio=Number(p.precio||0), costo=Number(p.costo||0), margen=precio>0?((precio-costo)/precio)*100:0; return `<tr><td>${escapeHtml(p.codigo||'')}</td><td>${escapeHtml(p.nombre||'')}</td><td>${escapeHtml(p.categoria||'')}</td><td>${Number(p.stock||0)}</td><td>${money(costo,'C$')}</td><td>${money(precio,'C$')}</td><td>${margen.toFixed(1)}%</td></tr>`}).join('')}</tbody></table></div>`;
  if (reportState.type === 'cotizaciones') return `<div class="report-table-wrap"><table class="table report-table"><thead><tr><th>Válida hasta</th><th>Cliente</th><th>Detalle</th><th>Estado</th><th>Total</th></tr></thead><tbody>${rows.map(q=>{const c=calcPedido(q), currency=q.moneda||'C$'; return `<tr><td>${escapeHtml(q.validaHasta||'')}</td><td>${escapeHtml(q.cliente||'')}</td><td>${escapeHtml(shortOrderDescription(q))}</td><td>${escapeHtml(q.estado||'')}</td><td>${money(c.total,currency)}</td></tr>`}).join('')}</tbody></table></div>`;
  return `<div class="report-table-wrap"><table class="table report-table"><thead><tr><th>Fecha</th><th>Cliente</th><th>Pedido</th><th>Estado</th><th>Total</th><th>Pagado</th><th>Saldo</th><th>Atraso</th></tr></thead><tbody>${rows.map(p=>{const c=calcPedido(p), currency=p.moneda||'C$', late=daysLate(p.fecha_entrega||''); return `<tr><td>${escapeHtml(getDateValue(p,reportState.dateField)||p.fecha_entrega||'')}</td><td>${escapeHtml(p.cliente||'Sin cliente')}</td><td>${escapeHtml(shortOrderDescription(p))}</td><td>${escapeHtml(getOrderStatus(p))}</td><td>${money(c.total,currency)}</td><td>${money(c.totalPagado,currency)}</td><td><strong>${money(c.saldo,currency)}</strong></td><td>${late?`${late} días`:'-'}</td></tr>`}).join('')}</tbody></table></div>`;
}

export function generateReport(type) { selectReportType(type); generateCurrentReport(); }
export function generateCurrentReport() {
  syncReportFilters(); const rows = getCurrentRows(); if (!rows.length) return toast('No hay datos para generar con estos filtros.'); const pdf = getPdf(); if (!pdf) return;
  const title = getReportTitle().replace('Vista previa: ', ''); let y = header(pdf, title, rows.length);
  pdf.setFontSize(9); pdf.text(`Filtros: desde ${reportState.start || 'sin inicio'} hasta ${reportState.end || 'sin fin'} | búsqueda: ${reportState.search || 'sin búsqueda'}`, 14, y); y += 8;
  y = drawRows(pdf, rows, y);
  const url = pdf.output('bloburl'); window.open(url, '_blank', 'noopener'); toast('PDF abierto en el navegador. Desde ahí puedes imprimir o descargar.');
}
function header(pdf, title, count) { pdf.setFontSize(16); pdf.setFont(undefined,'bold'); pdf.text(BUSINESS_NAME,14,17); pdf.setFontSize(11); pdf.setFont(undefined,'normal'); pdf.text(`${title} | Generado: ${todayISO()} | Registros: ${count}`,14,25); pdf.line(14,30,202,30); return 38; }
function drawRows(pdf, rows, y) {
  pdf.setFontSize(8); pdf.setFont(undefined,'bold'); pdf.text(reportState.type === 'inventario' ? 'Código / producto' : 'Fecha / cliente',14,y); pdf.text('Detalle',62,y); pdf.text('Monto / stock',184,y,{align:'right'}); y += 6; pdf.setFont(undefined,'normal');
  rows.forEach(row => { y = pageBreak(pdf,y,12); if(reportState.type==='gastos'){ pdf.text(String(row.fecha||''),14,y); pdf.text(pdf.splitTextToSize(String(row.concepto||''),100),62,y); pdf.text(money(row.monto,'C$'),184,y,{align:'right'}); }
    else if(reportState.type==='inventario'){ pdf.text(String(row.codigo||''),14,y); pdf.text(pdf.splitTextToSize(String(row.nombre||''),100),62,y); pdf.text(`${Number(row.stock||0)} · ${money(row.precio,'C$')}`,184,y,{align:'right'}); }
    else if(reportState.type==='cotizaciones'){ const c=calcPedido(row), currency=row.moneda||'C$'; pdf.text(String(row.validaHasta||''),14,y); pdf.text(pdf.splitTextToSize(String(row.cliente||''),42),32,y); pdf.text(pdf.splitTextToSize(String(shortOrderDescription(row)),78),76,y); pdf.text(money(c.total,currency),184,y,{align:'right'}); }
    else { const c=calcPedido(row), currency=row.moneda||'C$'; pdf.text(String(getDateValue(row,reportState.dateField)||row.fecha_entrega||''),14,y); pdf.text(pdf.splitTextToSize(String(row.cliente||''),42),32,y); pdf.text(pdf.splitTextToSize(String(shortOrderDescription(row)),78),76,y); pdf.text(money(c.saldo,currency),184,y,{align:'right'}); } y += 9; }); return y;
}
function pageBreak(pdf,y,needed=12){ if(y+needed<=262) return y; pdf.addPage(); return 18; }
