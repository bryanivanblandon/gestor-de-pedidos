import { state } from './state.js';
import { auth, signInWithEmailAndPassword, signOut, onAuthStateChanged, sendPasswordResetEmail, setPersistence, browserLocalPersistence } from './firebase.js';
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
  showOrderDetail,
  printOrderTicket
} from './pedidos.js';
import { generateReport, setupReportEvents } from './reportes.js';
import { listenCaja, openCashShift, addCashExpense, addManualIncome, closeCashShift, saveExchangeRate, renderCloseTotal, confirmCloseCashShift, printExpenseTicket, editCashExpense, deleteCashExpense, forceCloseActiveShift } from './caja.js';
import { listenInventario, saveProduct, resetProductForm, editProduct, addInventoryMovement, showKardex, previewNextProductCode } from './inventario.js';
import { listenCotizaciones, openQuoteForm, resetQuoteForm, addQuoteItemRow, recalcQuoteForm, saveQuote, renderCotizaciones, printQuoteTicket, convertQuoteToOrder, addClientFromQuote } from './cotizaciones.js';
import { listenUsuarios, saveInternalUser, editInternalUser, internalLogin, ensureInternalUser, applyPermissions } from './usuarios.js';
import { resetTestData } from './mantenimiento.js';

let started = false;
let unsubscribers = [];

function boot() {
  // El login debe quedar activo aunque alguna pieza del POS falle al cargar.
  bindAuthForms();
  authStart();
  try {
    bindNavigation();
    bindForms();
    bindDynamicActions();
    setupReportEvents();
  } catch (error) {
    console.error('Error iniciando módulos del POS:', error);
    showLoginError(`El sistema cargó con un error interno: ${error?.message || error}. Sube esta versión y recarga con Ctrl + F5.`);
  }
}


function enterAuthenticatedApp(user) {
  const privateEls = qsa('.app-private');
  const loginView = qs('#login-view');
  const sessionUser = qs('#session-user');

  if (loginView) loginView.hidden = true;
  privateEls.forEach(el => { el.hidden = false; });
  state.usuarioInterno = { id: 'admin-firebase', usuario: 'Administrador', rol: 'admin' };
  if (sessionUser) sessionUser.textContent = `Sesión: ${user?.email || 'usuario autorizado'} · POS: Administrador`;
  setSyncStatus('Conectado', true);
  applyPermissions();
  showView('dashboard');

  if (!started) {
    started = true;
    try {
      unsubscribers = [listenClientes(), listenPedidos(), listenCaja(), listenInventario(), listenCotizaciones(), listenUsuarios()].filter(Boolean);
    } catch (error) {
      console.error('Error cargando datos en tiempo real:', error);
      toast(`Entraste, pero hubo un error cargando datos: ${error?.message || 'revisa Firebase'}.`);
    }
  }
}

function withTimeout(promise, ms = 12000) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout-login')), ms))
  ]);
}

function authStart() {
  onAuthStateChanged(auth, user => {
    const privateEls = qsa('.app-private');
    const loginView = qs('#login-view');
    const sessionUser = qs('#session-user');

    if (user) {
      enterAuthenticatedApp(user);
      return;
    }

    privateEls.forEach(el => { el.hidden = true; });
    loginView.hidden = false;
    if (started) {
      unsubscribers.forEach(unsub => { try { unsub(); } catch (err) { console.warn(err); } });
      unsubscribers = [];
    }
    state.clientes = [];
    state.pedidos = [];
    state.cajaTurnos = [];
    state.productos = [];
    state.cotizaciones = [];
    state.usuarios = [];
    state.usuarioInterno = null;
    started = false;
    setSyncStatus('Sin sesión');
  });
}

function friendlyAuthError(error) {
  const code = error?.code || '';
  if (code.includes('invalid-credential') || code.includes('wrong-password') || code.includes('user-not-found')) return 'Correo o contraseña incorrectos.';
  if (code.includes('too-many-requests')) return 'Demasiados intentos. Espera unos minutos e intenta de nuevo.';
  if (code.includes('network-request-failed')) return 'Problema de conexión. Revisa internet e intenta de nuevo.';
  if (code.includes('operation-not-allowed')) return 'Activa el proveedor Correo/Contraseña en Firebase Authentication.';
  if (code.includes('unauthorized-domain')) return 'Este dominio de Vercel no está autorizado en Firebase. Agrégalo en Authentication > Settings > Authorized domains.';
  if (code.includes('email-already-in-use')) return 'Ese correo ya existe.';
  return `No se pudo iniciar sesión. Detalle: ${code || 'error desconocido'}.`;
}

function showLoginError(message) {
  const box = qs('#login-error');
  box.textContent = message;
  box.hidden = false;
}

function bindAuthForms() {
  qs('#login-form')?.addEventListener('submit', async event => {
    event.preventDefault();
    const email = qs('#login-email').value.trim();
    const password = qs('#login-password').value;
    const errorBox = qs('#login-error');
    errorBox.hidden = true;

    const submitButton = event.submitter;
    if (submitButton) { submitButton.disabled = true; submitButton.textContent = 'Entrando…'; }
    try {
      const credential = await withTimeout(signInWithEmailAndPassword(auth, email, password), 12000);
      if (credential?.user) {
        enterAuthenticatedApp(credential.user);
      }
      toast('Sesión iniciada.');
    } catch (error) {
      console.error(error);
      if (error?.message === 'timeout-login') {
        showLoginError('Firebase no respondió al iniciar sesión. Revisa internet, dominio autorizado en Firebase y recarga con Ctrl + F5. El botón ya no quedará trabado.');
      } else {
        showLoginError(friendlyAuthError(error));
      }
    } finally {
      if (submitButton) { submitButton.disabled = false; submitButton.textContent = 'Entrar al sistema'; }
    }
  });

  qs('#reset-password')?.addEventListener('click', async () => {
    const email = qs('#login-email').value.trim();
    if (!email) return showLoginError('Escribe tu correo para enviarte el enlace de recuperación.');
    try {
      await sendPasswordResetEmail(auth, email);
      showLoginError('Te envié un correo para restablecer la contraseña.');
    } catch (error) {
      console.error(error);
      showLoginError('No se pudo enviar el correo. Revisa que el usuario exista en Firebase.');
    }
  });

  qs('#logout-button')?.addEventListener('click', async () => {
    await signOut(auth);
    toast('Sesión cerrada.');
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
  qsa('[data-action="close-quote-form"]').forEach(btn => btn.addEventListener('click', () => resetQuoteForm(true)));
  qs('#open-quote-form')?.addEventListener('click', () => openQuoteForm());
  qs('#open-quote-form-dashboard')?.addEventListener('click', () => openQuoteForm());

  qs('#order-search').addEventListener('input', e => {
    state.orderSearch = e.target.value;
    import('./pedidos.js').then(m => m.renderPedidos());
  });

  qs('#client-search').addEventListener('input', e => {
    state.clientSearch = e.target.value;
    import('./clientes.js').then(m => m.renderClientes());
  });

  qs('#quote-search')?.addEventListener('input', e => {
    state.quoteSearch = e.target.value;
    renderCotizaciones();
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
  qs('#cash-open-form')?.addEventListener('submit', openCashShift);
  qs('#cash-expense-form')?.addEventListener('submit', addCashExpense);
  qs('#cash-income-form')?.addEventListener('submit', addManualIncome);
  qs('#cash-close')?.addEventListener('click', closeCashShift);
  qs('#cash-force-close')?.addEventListener('click', forceCloseActiveShift);
  qs('#cash-exchange-save')?.addEventListener('click', saveExchangeRate);
  qs('#cash-close-form')?.addEventListener('submit', confirmCloseCashShift);
  qs('#cash-close-cancel')?.addEventListener('click', () => closeDialog('#cash-close-dialog'));
  qsa('.denom-input, #close-usd-amount').forEach(input => input.addEventListener('input', renderCloseTotal));
  qs('#product-form')?.addEventListener('submit', saveProduct);
  ['#product-name', '#product-category'].forEach(id => qs(id)?.addEventListener('input', previewNextProductCode));
  previewNextProductCode();
  qs('#quote-form')?.addEventListener('submit', saveQuote);
  qs('#add-quote-item')?.addEventListener('click', () => addQuoteItemRow());
  qs('#quote-add-client')?.addEventListener('click', addClientFromQuote);
  ['#quote-discount', '#quote-discount-type'].forEach(id => qs(id)?.addEventListener('input', recalcQuoteForm));
  qs('#internal-user-form')?.addEventListener('submit', saveInternalUser);
  qs('#admin-reset-data')?.addEventListener('click', resetTestData);
  qs('#internal-login-form')?.addEventListener('submit', internalLogin);
  qs('#cancel-product-edit')?.addEventListener('click', resetProductForm);
  qs('#inventory-search')?.addEventListener('input', e => { state.inventorySearch = e.target.value; import('./inventario.js').then(m => m.renderInventario()); });
  qs('#add-item').addEventListener('click', () => addItemRow());
  ['#order-discount', '#order-discount-type', '#order-initial-payment'].forEach(id => qs(id)?.addEventListener('input', recalcOrderForm));
}

function bindDynamicActions() {
  document.addEventListener('click', e => {
    const target = e.target.closest('button');
    if (!target) return;

    if (target.dataset.view) showView(target.dataset.view);

    if (target.dataset.clientEdit) editClient(target.dataset.clientEdit);
    if (target.dataset.clientHistory) showClientHistory(target.dataset.clientHistory);
    if (target.dataset.clientOrder) openOrderFormForClient(target.dataset.clientOrder);

    if (target.dataset.orderEdit) openOrderForm(target.dataset.orderEdit);
    if (target.dataset.orderDetail) showOrderDetail(target.dataset.orderDetail);
    if (target.dataset.orderPayment) openPaymentForm(target.dataset.orderPayment);
    if (target.dataset.orderWhatsapp) sendWhatsApp(target.dataset.orderWhatsapp);
    if (target.dataset.orderTicket) printOrderTicket(target.dataset.orderTicket);
    if (target.dataset.orderCancel) cancelOrder(target.dataset.orderCancel);

    if (target.dataset.productEdit) editProduct(target.dataset.productEdit);
    if (target.dataset.productMove) addInventoryMovement(target.dataset.productMove);
    if (target.dataset.productKardex) showKardex(target.dataset.productKardex);
    if (target.dataset.quoteEdit) openQuoteForm(target.dataset.quoteEdit);
    if (target.dataset.quoteTicket) printQuoteTicket(target.dataset.quoteTicket);
    if (target.dataset.quoteConvert) convertQuoteToOrder(target.dataset.quoteConvert);
    if (target.dataset.userEdit) editInternalUser(target.dataset.userEdit);
    if (target.dataset.expenseTicket) printExpenseTicket(target.dataset.expenseTicket);
    if (target.dataset.expenseEdit) editCashExpense(target.dataset.expenseEdit);
    if (target.dataset.expenseDelete) deleteCashExpense(target.dataset.expenseDelete);
  });

  document.addEventListener('change', e => {
    const select = e.target.closest('select[data-order-status]');
    if (!select) return;
    updateOrderStatus(select.dataset.orderStatus, select.value);
  });
}

window.addEventListener('error', event => {
  console.error('Error global:', event.error || event.message);
  showLoginError(`Error de carga: ${event.message || 'revisa consola'}`);
});
window.addEventListener('unhandledrejection', event => {
  console.error('Promesa rechazada:', event.reason);
});

boot();
