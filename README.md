# Gestor de Pedidos V2 / POS

Sistema POS web para Arca de la Nueva Alianza: clientes, pedidos/facturación, cotizaciones, caja, inventario, cobranza, producción, reportes y tickets 80mm.

## Módulos incluidos

- Login privado con Firebase Email/Password.
- Usuarios internos sin correo, con usuario + PIN y dos niveles: administrador y usuario.
- Clientes con WhatsApp e historial.
- Pedidos/facturas con descuento por monto o porcentaje.
- Pedidos y cotizaciones obligan a seleccionar productos del inventario antes de cobrar, para evitar precios escritos por error.
- Productos por unidad o por área en cm², útil para vinil sobre PVC: ancho × alto × precio por cm².
- Cotizaciones guardadas, imprimibles y convertibles a pedido/factura.
- Inventario con código automático, nombre, categoría, costo, precio, margen, stock mínimo y kardex.
- Caja con apertura de turno, tipo de cambio, ingresos, gastos, cobros y cierre por denominación.
- Tickets de pedido/factura, cotización y gasto en formato 80mm.
- Reportes visibles en navegador para imprimir o descargar: producción, cobranza, ventas, gastos, inventario y cotizaciones.

## Configuración en Firebase

1. En Firebase Authentication activa Email/Password.
2. Crea un usuario principal con correo y contraseña.
3. Publica las reglas de `firestore.rules`.
4. Sube el proyecto a GitHub y despliega en Vercel como sitio estático.

## Colecciones usadas en Firestore

- `clientes`
- `pedidos`
- `cotizaciones`
- `productos`
- `cajaTurnos`
- `usuarios`
- `config/pos`

## Usuarios internos

Los usuarios internos se crean desde Configuración. No usan correo. Sirven para separar permisos dentro del POS:

- Administrador: ve todo, incluyendo configuración, cobranza, reportes y estados de cuenta.
- Usuario: puede trabajar clientes, pedidos, caja, inventario y cotizaciones, pero no entra a configuración, reportes ni cobranza/estados de cuenta.

Nota: el acceso real a Firebase sigue protegido por el login principal. Los usuarios internos son una capa de operación dentro del POS.

## Venta por área cm²

Para productos como vinil sobre PVC:

1. En Inventario crea el producto.
2. En Forma de venta selecciona `Por área, ancho × alto en cm²`.
3. Coloca el precio por cm².
4. En pedido o cotización, selecciona el producto y escribe ancho y alto.
5. El sistema calcula: cantidad × ancho × alto × precio.

## Subida a Vercel

No requiere build. Sube todo el contenido del proyecto y Vercel lo publicará como aplicación estática.


## Cambios de seguridad operativa

- El código de inventario se genera automático usando las primeras 3 letras de la categoría o nombre, por ejemplo `TAZ001`.
- En pedidos y cotizaciones, el precio queda bloqueado hasta seleccionar un producto del inventario.
- Una cotización convertida queda marcada como `Convertida` y no puede convertirse de nuevo.
- Al convertir una cotización a pedido/factura, el sistema pregunta si hay abono inicial.
- Caja incluye recuperación administrativa para turnos trabados, visible solo para administrador.

## Corrección de caja trabada

Esta versión mejora la recuperación de caja: el botón **Cerrar turno abierto administrativamente** ya no depende solo del estado cargado en pantalla. Ahora consulta directamente la colección `cajaTurnos` en Firebase, detecta cualquier turno con estado abierto/abierta/activo/open y lo cierra administrativamente. Si había más de un turno abierto por error, los cierra todos para permitir abrir una caja nueva.


## Novedades de esta actualización

- Recuperación de caja trabada más robusta: si un turno viejo no se puede cerrar, el sistema puede **ignorarlo** desde `config/pos.ignoredShiftIds` para que ya no bloquee la apertura de una caja nueva.
- Menú principal rediseñado con estilo más parecido a software de escritorio: accesos rápidos en barra lateral y mosaicos de colores.

## Actualización de caja y pruebas

- Caja ahora puede abrir un turno nuevo aunque Firebase conserve un turno viejo trabado: al abrir, si detecta turnos antiguos abiertos, pregunta si deseas ignorarlos para que ya no bloqueen el POS.
- La recuperación guarda los turnos ignorados también en el navegador, no solo en Firebase, para evitar que el sistema se vuelva a trabar si el documento viejo no se pudo modificar.
- En Cotizaciones se puede agregar un cliente nuevo desde el mismo formulario.
- En Configuración se agregó una opción peligrosa para borrar datos de prueba. Requiere escribir `BORRAR TODO`.

## Actualización: productos manuales y métodos de pago

- En pedidos y cotizaciones ahora cada línea puede ser **Inventario** o **Manual**.
- Las líneas manuales sirven para servicios, trabajos especiales o productos que no se controlan en stock.
- Las líneas manuales no afectan el kardex ni descuentan inventario.
- Los cobros ahora permiten método de pago: **efectivo**, **tarjeta** o **transferencia**.
- Caja separa tarjeta y transferencia del efectivo esperado: el cierre de billetes solo cuadra el dinero físico.

## Corrección de login

Esta versión carga primero el formulario de acceso y luego los módulos del POS. Si Firebase no responde, el botón se libera después de 12 segundos y muestra un mensaje claro en pantalla.


## Actualización Caja reconstruida

El módulo Caja fue reconstruido para no depender de lógica anterior: abre turno localmente de inmediato, sincroniza con Firebase si puede, muestra gastos/ingresos al abrir, calcula efectivo esperado y permite cierre por denominación. Si Firebase falla, la caja sigue funcionando localmente en el navegador y avisa el problema.


## Actualización caja - gastos editables

- Después de guardar un gasto, la vista de Caja se actualiza inmediatamente.
- Los gastos del turno ahora muestran acciones: Ticket, Editar y Eliminar.
- Editar y eliminar gasto quedan disponibles para el usuario administrador.
- La edición y eliminación recalculan de inmediato el efectivo esperado del turno.


## Corrección de caja - ventas y cobros

- Los cobros ahora se registran directamente dentro del turno de caja en `cobros`.
- Además se conservan dentro del pedido en `pagos`, pero Caja evita duplicarlos usando `cashId`.
- El resumen de Caja suma efectivo, tarjeta y transferencia según método de pago; solo el efectivo entra al efectivo esperado.


## Actualización caja estable

Se reconstruyó `src/caja.js` para que los gastos, ingresos, cobros, cierre normal y cierre administrativo usen una sola estructura de turno. Cada movimiento se guarda primero localmente y luego se sincroniza con Firebase usando `setDoc(..., {merge:true})`, evitando que los gastos desaparezcan por snapshots viejos o fallos de arrayUnion.


## Caja y Kardex - actualización

- El botón **Confirmar cierre** ahora tiene manejador directo por clic, además del submit del formulario.
- El cierre administrativo marca el turno como ignorado localmente para que no vuelva a bloquear la caja aunque Firebase tarde o devuelva un turno viejo.
- Inventario incluye **Kardex general** con tabla filtrable por búsqueda, producto y tipo de movimiento.

## Actualización kardex y cierre
- Kardex general ahora calcula saldo anterior y saldo después de cada movimiento.
- Kardex filtrado se puede imprimir según los filtros visibles.
- Hoja de inventario imprimible con stock actual, costos y valor de venta.
- Cierre normal y administrativo tienen manejadores directos dentro del módulo de Caja para evitar que el botón quede desconectado.


## Caja - corrección final directa

El módulo de Caja fue reemplazado por una versión directa y auto-contenida. Los botones de abrir turno, guardar gasto, ingreso extra, cerrar caja y cierre administrativo se conectan dentro de `src/caja.js`, además de las conexiones generales del sistema. La caja activa se guarda primero en `localStorage` para responder inmediatamente y luego se sincroniza con Firebase sin bloquear la pantalla.


## Corrección caja-noincludes2

Se eliminó el uso de `.includes()` dentro del módulo de Caja para evitar el error de navegador `Cannot read properties of null (reading includes)`. También se subió la versión del script para romper caché en Vercel.

## Reportes de ventas y gastos

Se agregó una vista mejorada de reportes:

- Ventas general por factura/pedido.
- Productos vendidos agrupados por producto, código, moneda y precio.
- Filtros por fecha, cliente, moneda, estado, método de pago, producto y búsqueda.
- Detalle de gastos por rango de fechas.
- Vista previa en pantalla y PDF visible en el navegador antes de imprimir o descargar.


## Actualización: descuentos y tickets

- Descuento por línea en pedidos y cotizaciones: cada producto puede tener descuento por monto o por porcentaje.
- El subtotal ahora se calcula ya descontando las líneas; el descuento general sigue funcionando aparte.
- El mensaje de WhatsApp muestra descuento general y descuentos de línea cuando existan.
- Los tickets 80mm ahora usan letra más oscura, más grande y en negrita para mejorar la impresión térmica.


## Ajuste de descuento por producto

El descuento por línea en monto ahora funciona como **descuento unitario**.
Ejemplo: 20 tazas a C$150 con descuento C$50 descuenta automáticamente 20 × C$50 = C$1,000.
El descuento en porcentaje se aplica sobre el total bruto de la línea.


## Ajuste de descuentos por línea

- El descuento por línea en monto se calcula como descuento unitario: cantidad × descuento unitario.
- El total de descuentos del ticket ahora suma descuentos por línea + descuento general.
- El subtotal del ticket muestra el bruto antes de descuentos.

## Actualización: caja global, vuelto y usuarios POS

- Caja global: los dispositivos usan el turno abierto en Firebase; si una caja está abierta en otro dispositivo, los cobros caen al mismo turno.
- Cobros en efectivo: al abonar o cobrar, se registra monto recibido y vuelto.
- Abono inicial: también permite recibido/vuelto si el método es efectivo.
- Usuarios POS: se agregó botón para cambiar usuario interno desde el encabezado y se recuerda el usuario local en el navegador.
