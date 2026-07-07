import { state, ESTADOS_ACTIVOS } from './state.js';
import { calcPedido, money, BUSINESS_NAME, todayISO } from './utils.js';
import { getDebts } from './cobranza.js';
import { toast } from './ui.js';

function getPdf() {
  const lib = window.jspdf;
  if (!lib?.jsPDF) {
    toast('No se cargó la librería PDF. Revisa tu conexión.');
    return null;
  }
  return new lib.jsPDF();
}

function header(pdf, title) {
  pdf.setFontSize(17);
  pdf.text(BUSINESS_NAME, 14, 18);
  pdf.setFontSize(12);
  pdf.text(`${title} - ${todayISO()}`, 14, 27);
  pdf.line(14, 32, 196, 32);
  return 42;
}

function pageBreak(pdf, y) {
  if (y <= 278) return y;
  pdf.addPage();
  return 18;
}

export function generateReport(type) {
  if (type === 'produccion') return generateProduccion();
  if (type === 'cobranza') return generateCobranza();
  if (type === 'ventas') return generateVentas();
}

function generateProduccion() {
  const pdf = getPdf();
  if (!pdf) return;
  let y = header(pdf, 'Reporte de producción');
  const data = state.pedidos.filter(p => ESTADOS_ACTIVOS.includes(p.estado || 'Pendiente')).sort((a,b) => String(a.fecha_entrega || '').localeCompare(String(b.fecha_entrega || '')));

  if (!data.length) pdf.text('No hay pedidos activos.', 14, y);
  data.forEach(p => {
    y = pageBreak(pdf, y);
    pdf.setFont(undefined, 'bold');
    pdf.setFontSize(10);
    pdf.text(`[${p.estado || 'Pendiente'}] ${p.fecha_entrega || ''} - ${p.cliente || ''}`, 14, y);
    y += 6;
    pdf.setFont(undefined, 'normal');
    pdf.text(pdf.splitTextToSize(p.descripcion || '', 175), 16, y);
    y += 10;
  });
  pdf.save(`reporte-produccion-${todayISO()}.pdf`);
}

function generateCobranza() {
  const pdf = getPdf();
  if (!pdf) return;
  let y = header(pdf, 'Reporte de cobranza');
  const debts = getDebts();
  let totalCs = 0;
  let totalUsd = 0;

  if (!debts.length) pdf.text('No hay saldos pendientes.', 14, y);
  debts.forEach(p => {
    y = pageBreak(pdf, y);
    const saldo = p.calc.saldo;
    if ((p.moneda || 'C$') === '$') totalUsd += saldo; else totalCs += saldo;
    pdf.setFontSize(10);
    pdf.setFont(undefined, 'bold');
    pdf.text(`${p.cliente || ''} - ${money(saldo, p.moneda || 'C$')}`, 14, y);
    y += 6;
    pdf.setFont(undefined, 'normal');
    pdf.text(`Entrega: ${p.fecha_entrega || ''} | Pedido: ${p.descripcion || ''}`, 16, y);
    y += 8;
  });
  y += 4;
  y = pageBreak(pdf, y);
  pdf.setFont(undefined, 'bold');
  pdf.text(`TOTAL C$: ${totalCs.toFixed(2)}`, 14, y);
  pdf.text(`TOTAL $: ${totalUsd.toFixed(2)}`, 14, y + 7);
  pdf.save(`reporte-cobranza-${todayISO()}.pdf`);
}

function generateVentas() {
  const pdf = getPdf();
  if (!pdf) return;
  let y = header(pdf, 'Resumen de ventas');
  const valid = state.pedidos.filter(p => (p.estado || '') !== 'Anulado');
  const ventasCs = valid.filter(p => (p.moneda || 'C$') === 'C$').reduce((s, p) => s + calcPedido(p).total, 0);
  const ventasUsd = valid.filter(p => (p.moneda || 'C$') === '$').reduce((s, p) => s + calcPedido(p).total, 0);
  const pagadoCs = valid.filter(p => (p.moneda || 'C$') === 'C$').reduce((s, p) => s + calcPedido(p).totalPagado, 0);
  const pagadoUsd = valid.filter(p => (p.moneda || 'C$') === '$').reduce((s, p) => s + calcPedido(p).totalPagado, 0);

  pdf.setFontSize(12);
  pdf.text(`Pedidos válidos: ${valid.length}`, 14, y); y += 10;
  pdf.text(`Ventas C$: ${ventasCs.toFixed(2)} | Cobrado C$: ${pagadoCs.toFixed(2)}`, 14, y); y += 8;
  pdf.text(`Ventas $: ${ventasUsd.toFixed(2)} | Cobrado $: ${pagadoUsd.toFixed(2)}`, 14, y);
  pdf.save(`resumen-ventas-${todayISO()}.pdf`);
}
