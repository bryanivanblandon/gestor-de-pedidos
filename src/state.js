export const state = {
  clientes: [],
  pedidos: [],
  currentView: 'dashboard',
  orderFilter: 'activos',
  orderSearch: '',
  clientSearch: '',
  nextClientId: 1,
};

export const ESTADOS = ['Pendiente', 'En diseño', 'En producción', 'Listo', 'Entregado', 'Anulado'];
export const ESTADOS_ACTIVOS = ['Pendiente', 'En diseño', 'En producción', 'Listo'];
