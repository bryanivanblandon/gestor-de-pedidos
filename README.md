# Gestor de Pedidos V2

Versión reorganizada del gestor de pedidos de **Arca de la Nueva Alianza**.

## Qué incluye

- Clientes con ID automático, WhatsApp e historial.
- Pedidos con productos, cantidades, precios, descuento, total, abono y saldo.
- Estados de producción: Pendiente, En diseño, En producción, Listo, Entregado y Anulado.
- Cobranza con saldos pendientes y días de atraso.
- Registro de abonos.
- Botón de WhatsApp para recordar saldos.
- Reportes PDF de producción, cobranza y ventas.
- Estructura separada por módulos para que sea más fácil de mantener.

## Estructura

```text
index.html
assets/styles.css
src/firebase.js
src/state.js
src/utils.js
src/ui.js
src/clientes.js
src/pedidos.js
src/cobranza.js
src/reportes.js
src/render.js
src/app.js
firestore.rules
```

## Cómo publicarlo en Vercel

1. Sube todos estos archivos al repositorio de GitHub.
2. En Vercel, importa el repositorio.
3. Como es una app estática, no necesitas comando de build.
4. Output directory: dejar vacío o raíz del proyecto.
5. Publicar.

## Firebase

Este proyecto conserva la configuración actual de Firebase del sistema original:

- projectId: `mi-negocio-de-sublimacion`
- colecciones usadas: `clientes` y `pedidos`
- autenticación: anónima

En Firebase Console activa:

1. Authentication → Sign-in method → Anonymous.
2. Firestore Database.
3. Rules: puedes usar el archivo `firestore.rules` incluido.

## Nota importante de seguridad

La autenticación anónima sirve para comenzar rápido, pero para un negocio real conviene pasar luego a login con correo y contraseña. Así evitas que cualquier persona que tenga la URL pueda entrar al sistema.

## Próxima mejora recomendada

Agregar login privado con correo/contraseña y reglas de Firestore limitadas a tu usuario.
