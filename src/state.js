export const state = {
  clientes: [],
  pedidos: [],
  cajaTurnos: [],
  currentView: 'dashboard',
  orderFilter: 'activos',
  orderSearch: '',
  clientSearch: '',
  nextClientId: 1,
};

export const ESTADOS = ['Activo', 'Pendiente', 'Entregado', 'Anulado'];
export const ESTADOS_ACTIVOS = ['Activo', 'Pendiente'];
export const ESTADOS_LEGACY_MAP = {
  'En diseño': 'Activo',
  'En producción': 'Activo',
  'Listo': 'Activo',
};
