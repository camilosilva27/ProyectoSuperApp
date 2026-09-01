/**
 * Precarga del carrito del tour: en vez de que el usuario busque un producto a mano, arranca
 * con 2-3 productos ya elegidos (con diferencia de precio real y descuento fuerte entre
 * Vea/Carrefour/Coto, ver elegirProductosTour en backend/src/precioCache.js) y con Vea+Carrefour
 * preseleccionados como únicos supers activos — Coto queda afuera a propósito, para que sumarlo
 * en el paso "coto" del tour tenga un efecto visible.
 *
 * Fire-and-forget: no bloquea el inicio del tour. Si falla (sin red, sin token) el tour sigue
 * andando igual que siempre, con el carrito vacío y el usuario buscando a mano.
 */

import { productosTour, type ProductoCatalogo, type SuperKey } from '../api';

export async function precargarTour(
  accessToken: string | null,
  agregar: (producto: ProductoCatalogo) => void,
  setSupersYTope: (keys: SuperKey[], tope: number) => void,
) {
  if (!accessToken) return;
  try {
    const { productos } = await productosTour(accessToken);
    productos.forEach(agregar);
    setSupersYTope(['vea', 'carr'], 0);
  } catch {
    // Sin precarga, no rompe el tour (ver cabecera del archivo).
  }
}
