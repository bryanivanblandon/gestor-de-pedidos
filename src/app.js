import { state } from './state.js';
import { auth, signInAnonymously, onAuthStateChanged } from './firebase.js';
import { qs, qsa, showView, closeDialog, setSyncStatus, toast } from './ui.js';
import { listenClientes, saveClient, editClient, resetClientForm, showClientHistory } from './clientes.js';
import {
  listenPedidos,
  openOrderForm,
  openOrderFormForClient,
  resetOrderForm,
  addItemRow,
  recalcOrderForm,
  saveOrder,
  updateOrderStatus,
  cancelOrder,
  openPaymentForm,
  savePayment,
  sendWhatsApp,
  showOrderDetail
} from './pedidos.js';
import { generateReport } from './reportes.js';

let started = false;

function boot() {
  bindNavigation();
  bindForms();
  bindDynamicActions();
  authStart();
}

function authStart() {
  onAuthStateChanged(auth, user => {
    if (user && !started) {
      started = true;
      setSyncStatus('Conectado', true);
      listenClientes();
      listenPedidos();
    }
    if (!user) signInAnonymously(auth).catch(err => {
      console.error(err);
      setSyncStatus('Error de conexión');
      toast('No se pudo conectar con Firebase.');
    });
  });
}

function bindNavigation() {
  qsa('[data-view]').forEach(btn => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.action;
      if (action === 'close-order-form') closeDialog('#order-dialog');
      showView(btn.dataset.view);
    });
  });

  qsa('[data-action="open-order-form"]').forEach(btn => btn.addEventListener('click', () => openOrderForm()));
  qsa('[data-action="close-order-form"]').forEach(btn => btn.addEventListener('click', () => resetOrderForm(true)));
  qsa('[data-action="close-payment-form"]').forEach(btn => btn.addEventListener('click', () => closeDialog('#payment-dialog')));
  qsa('[data-action="close-detail"]').forEach(btn => btn.addEventListener('click', () => closeDialog('#detail-dialog')));

  qs('#order-search').addEventListener('input', e => {
    state.orderSearch = e.target.value;
    import('./pedidos.js').then(m => m.renderPedidos());
  });

  qs('#client-search').addEventListener('input', e => {
    state.clientSearch = e.target.value;
    import('./clientes.js').then(m => m.renderClientes());
  });

  qs('#order-filters').addEventListener('click', e => {
    const button = e.target.closest('[data-filter]');
    if (!button) return;
    state.orderFilter = button.dataset.filter;
    qsa('#order-filters .chip').forEach(b => b.classList.toggle('active', b === button));
    import('./pedidos.js').then(m => m.renderPedidos());
  });

  qsa('[data-report]').forEach(btn => btn.addEventListener('click', () => generateReport(btn.dataset.report)));
}

function bindForms() {
  qs('#client-form').addEventListener('submit', saveClient);
  qs('#cancel-client-edit').addEventListener('click', () => resetClientForm());
  qs('#order-form').addEventListener('submit', saveOrder);
  qs('#payment-form').addEventListener('submit', savePayment);
  qs('#add-item').addEventListener('click', () => addItemRow());
  ['#order-discount', '#order-initial-payment'].forEach(id => qs(id).addEventListener('input', recalcOrderForm));
}

function bindDynamicActions() {
  document.addEventListener('click', e => {
    const target = e.target.closest('button');
    if (!target) return;

    if (target.dataset.clientEdit) editClient(target.dataset.clientEdit);
    if (target.dataset.clientHistory) showClientHistory(target.dataset.clientHistory);
    if (target.dataset.clientOrder) openOrderFormForClient(target.dataset.clientOrder);

    if (target.dataset.orderEdit) openOrderForm(target.dataset.orderEdit);
    if (target.dataset.orderDetail) showOrderDetail(target.dataset.orderDetail);
    if (target.dataset.orderPayment) openPaymentForm(target.dataset.orderPayment);
    if (target.dataset.orderWhatsapp) sendWhatsApp(target.dataset.orderWhatsapp);
    if (target.dataset.orderCancel) cancelOrder(target.dataset.orderCancel);
  });

  document.addEventListener('change', e => {
    const select = e.target.closest('select[data-order-status]');
    if (!select) return;
    updateOrderStatus(select.dataset.orderStatus, select.value);
  });
}

boot();
