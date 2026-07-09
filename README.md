# Gestor de Pedidos V2 / POS

Sistema POS web para Arca de la Nueva Alianza: clientes, pedidos/facturación, cotizaciones, caja, inventario, cobranza, producción, reportes y tickets 80mm.

## Módulos incluidos

- Login privado con Firebase Email/Password.
- Usuarios internos sin correo, con usuario + PIN y niveles: administrador, ventas, caja y producción.
- Clientes con WhatsApp e historial.
- Pedidos/facturas con descuento por monto o porcentaje.
- Productos manuales o seleccionados desde inventario.
- Productos por unidad o por área en cm², útil para vinil sobre PVC: ancho × alto × precio por cm².
- Cotizaciones guardadas, imprimibles y convertibles a pedido/factura.
- Inventario con código, nombre, categoría, costo, precio, margen, stock mínimo y kardex.
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

- Administrador: ve todo.
- Ventas: clientes, pedidos, caja, cobranza, inventario, cotizaciones y reportes.
- Caja: caja, cobros, clientes, pedidos, cobranza, cotizaciones y reportes.
- Producción: pedidos, inventario y cotizaciones.

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
