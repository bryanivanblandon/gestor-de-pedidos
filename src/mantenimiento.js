import { clientesRef, pedidosRef, cajaTurnosRef, productosRef, cotizacionesRef, usuariosRef, deleteDoc, getDocs, doc, db, setDoc, configRef, serverTimestamp } from './firebase.js';
import { toast } from './ui.js';

async function deleteCollection(ref) {
  const snap = await getDocs(ref);
  for (const item of snap.docs) {
    await deleteDoc(doc(db, item.ref.parent.id, item.id));
  }
  return snap.size;
}

export async function resetTestData() {
  const first = confirm('Esto borrará datos de prueba: clientes, pedidos, caja, inventario, cotizaciones y usuarios internos. ¿Continuar?');
  if (!first) return;
  const phrase = prompt('Para confirmar escribe exactamente: BORRAR TODO');
  if (phrase !== 'BORRAR TODO') return toast('Limpieza cancelada.');

  try {
    const results = [];
    results.push(['clientes', await deleteCollection(clientesRef)]);
    results.push(['pedidos', await deleteCollection(pedidosRef)]);
    results.push(['cajaTurnos', await deleteCollection(cajaTurnosRef)]);
    results.push(['productos', await deleteCollection(productosRef)]);
    results.push(['cotizaciones', await deleteCollection(cotizacionesRef)]);
    results.push(['usuarios', await deleteCollection(usuariosRef)]);
    try { localStorage.removeItem('posIgnoredShiftIds'); } catch {}
    await setDoc(configRef, { tipoCambio: 36.5, ignoredShiftIds: [], updatedAt: serverTimestamp() }, { merge: true });
    const total = results.reduce((s, [, n]) => s + n, 0);
    toast(`Base limpiada: ${total} registros borrados. Ya puedes usar el sistema en real.`);
  } catch (error) {
    console.error('No se pudo limpiar la base:', error);
    toast(`No pude borrar todos los datos. Revisa permisos de Firebase (${error?.code || 'error'}).`);
  }
}
