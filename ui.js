export const state = {
  clientes: [],
  pedidos: [],
  cajaTurnos: [],
  currentCashShiftId: localStorage.getItem('posCurrentCashShiftId') || '',
  productos: [],
  cotizaciones: [],
  usuarios: [],
  usuarioInterno: null,
  config: {
    tipoCambio: 36.5,
    ignoredShiftIds: [],
  },
  currentView: 'dashboard',
  orderFilter: 'activos',
  orderSearch: '',
  clientSearch: '',
  inventorySearch: '',
  quoteSearch: '',
  userSearch: '',
  nextClientId: 1,
};

export const ESTADOS = ['Activo', 'Pendiente', 'Entregado', 'Anulado'];
export const ESTADOS_ACTIVOS = ['Activo', 'Pendiente'];
export const ESTADOS_LEGACY_MAP = {
  'En diseño': 'Activo',
  'En producción': 'Activo',
  'Listo': 'Activo',
};
