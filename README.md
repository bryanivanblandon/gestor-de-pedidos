# Gestor de Pedidos V2 POS

Sistema web estático para **Arca de la Nueva Alianza**: clientes, pedidos, producción, cobranza, caja, reportes PDF y mensajes por WhatsApp.

## Módulos incluidos

- **Panel principal:** resumen de clientes, pedidos activos, entregados y saldos por cobrar.
- **Clientes:** registro, edición, WhatsApp e historial.
- **Pedidos / Producción:** creación de pedidos con productos, cantidades, precios, descuento por monto o porcentaje, abono inicial y estados simples.
- **Estados de producción:** Activo, Pendiente, Entregado y Anulado.
- **Cobranza:** facturas con saldo, registro de abonos y mensaje de WhatsApp.
- **Caja POS:** abrir turno, ver ventas/abonos del día, registrar gastos, registrar ingresos extra, cobrar facturas pendientes y cerrar caja.
- **Reportes:** filtros, vista previa y descarga PDF.

## Mejoras de esta versión

1. Se eliminó la descripción general del pedido. El resumen del pedido ahora se genera automáticamente desde los productos agregados.
2. El descuento puede ser por **monto fijo** o por **porcentaje**.
3. El mensaje de WhatsApp fue mejorado y ahora toma primero el teléfono actual del cliente, evitando contactos incorrectos por datos viejos guardados en pedidos.
4. Se agregó módulo de **Caja POS**.
5. Se simplificó producción a: **Activo, Pendiente, Entregado**. Se conserva **Anulado** para cancelar pedidos sin eliminarlos.
6. Los abonos quedan guardados en el pedido y alimentan el resumen de ventas/abonos del día en caja.
7. Se agregó navegación de vuelta al menú principal en los módulos.

## Estructura

```text
gestor-pedidos-v2/
├── index.html
├── assets/styles.css
├── src/
│   ├── app.js
│   ├── firebase.js
│   ├── state.js
│   ├── utils.js
│   ├── ui.js
│   ├── clientes.js
│   ├── pedidos.js
│   ├── cobranza.js
│   ├── caja.js
│   ├── reportes.js
│   └── render.js
├── firestore.rules
└── README.md
```

## Publicar en Vercel

No requiere build. Solo sube los archivos al repositorio y redeploy en Vercel.

## Firebase

El sistema usa las colecciones:

- `clientes`
- `pedidos`
- `cajaTurnos`

Recuerda publicar las reglas de `firestore.rules` en Firebase Console.

## Recomendación importante

Para producción real, lo siguiente debería ser agregar **login con correo y contraseña** y reglas por usuario. Actualmente la versión mantiene autenticación anónima para conservar compatibilidad con tu proyecto original.


## Login privado con Firebase

Esta versión ya no usa acceso anónimo. Para entrar al POS debes crear un usuario con correo y contraseña en Firebase.

Pasos recomendados:

1. Entra a Firebase Console.
2. Abre el proyecto `mi-negocio-de-sublimacion`.
3. Ve a **Authentication > Sign-in method**.
4. Activa **Email/Password**.
5. Ve a **Users** y crea el usuario que usarás para entrar al sistema.
6. Desactiva **Anonymous** si estaba activo.
7. Publica las reglas de `firestore.rules`.

Con esto, la página mostrará primero una pantalla de acceso y no cargará clientes, pedidos, caja ni reportes hasta que exista una sesión válida.

### Importante sobre seguridad

Las reglas actuales permiten leer y escribir solo a usuarios autenticados. Para un negocio pequeño con uno o pocos usuarios está bien. Más adelante se puede mejorar con roles, por ejemplo: administrador, cajero y producción.
