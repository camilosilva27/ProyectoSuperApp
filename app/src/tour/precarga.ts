/**
 * Precarga del carrito del tour: en vez de que el usuario busque un producto a mano, arranca
 * con 2-3 productos ya elegidos (con diferencia de precio real y descuento fuerte entre
 * Vea/Carrefour/Coto, ver elegirProductosTour en backend/src/precioCache.js). El forzado de
 * supers (Vea+Carrefour únicos activos) va aparte, en TourContext.tsx — es síncrono y no
 * depende de que este fetch responda.
 *
 * A propósito pisa cualquier carrito real que hubiera antes (a pedido: iniciar el tour, aunque
 * sea reabriéndolo manualmente con una compra en curso, tiene que mostrar siempre la misma demo
 * consistente) — solo si el fetch responde bien: si falla (sin red, sin token) no se vacía nada,
 * mejor dejar el carrito real intacto que vaciarlo sin tener nada para poner en su lugar.
 */

import { productosTour, type ProductoCatalogo } from '../api';

export async function precargarTour(
  accessToken: string | null,
  vaciar: () => void,
  agregar: (producto: ProductoCatalogo) => void,
) {
  if (!accessToken) return;
  try {
    const { productos } = await productosTour(accessToken);
    vaciar();
    productos.forEach(agregar);
  } catch {
    // Sin precarga, no rompe el tour (ver cabecera del archivo).
  }
}
