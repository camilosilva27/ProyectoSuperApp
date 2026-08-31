/**
 * Metadata pura de los pasos del tour (TOUR-interactivo-handoff.md): id, orden y el texto del
 * cartel. Sin lógica de condición acá — la condición de avance de cada paso vive colocada en
 * el componente real que tiene el dato (ver `useTourPaso` en TourContext.tsx), no en esta
 * tabla, para no duplicar estado.
 *
 * El paso 4 del handoff ("elegir tope → cierra la hoja") se partió en dos (`tope-elegido` /
 * `listo`): tal como estaba escrito, el botón "Listo" —lo único que de verdad cierra y
 * confirma la hoja— quedaba fuera del recorte del spotlight y por lo tanto bloqueado por el
 * propio overlay. Sin este split el usuario no podía salir de la hoja de supers.
 *
 * `ahorro` (a pedido, no estaba en el handoff original) resalta el bloque de precio/ahorro de
 * `/resultado`. Es el único paso con un botón en el cartel ("Finalizar", ver TourOverlay.tsx) —
 * los demás no tienen forma de salir a mitad de camino, a pedido. Termina tocando el recuadro
 * resaltado (el bloque mismo es un `Pressable`, ver `refAhorro` en resultado.tsx) o tocando
 * "Finalizar"; ninguno de los dos avanza solo.
 */

export type PasoId =
  | 'tab-descuentos'
  | 'mercado-pago'
  | 'buscador-input'
  | 'primer-resultado'
  | 'selector-otros'
  | 'coto'
  | 'tope-elegido'
  | 'listo'
  | 'ver-carrito'
  | 'comparar-precios'
  | 'ahorro';

export const ORDEN_PASOS: PasoId[] = [
  'tab-descuentos',
  'mercado-pago',
  'buscador-input',
  // Agregar el producto va antes de elegir supers (a pedido) — al revés del orden del handoff
  // original, que abría la hoja de supers apenas se escribía, sin esperar a que el usuario
  // llegara a tocar un resultado.
  'primer-resultado',
  'selector-otros',
  'coto',
  'tope-elegido',
  'listo',
  'ver-carrito',
  'comparar-precios',
  'ahorro',
];

export const PASOS: Record<PasoId, { texto: string }> = {
  'tab-descuentos': { texto: 'Tocá Descuentos para cargar tus tarjetas y promos.' },
  'mercado-pago': { texto: 'Activá Mercado Pago: el comparador ya la va a tener en cuenta.' },
  'buscador-input': { texto: 'Escribí qué querés comprar.' },
  'selector-otros': { texto: 'Tocá acá para elegir qué supermercados comparar.' },
  coto: { texto: 'Tocá Coto: así activás o sacás un super de la comparación.' },
  'tope-elegido': { texto: 'Elegí cuántos supermercados como máximo querés visitar.' },
  listo: { texto: 'Tocá Listo para confirmar tu selección.' },
  'primer-resultado': { texto: 'Tocá un producto para agregarlo al carrito.' },
  'ver-carrito': { texto: 'Tocá para ver tu carrito.' },
  'comparar-precios': { texto: 'Tocá para comparar precios y ver dónde conviene comprar.' },
  ahorro: { texto: 'Así queda tu compra: cuánto pagás y cuánto ahorrás de verdad, con tus promos ya contadas.' },
};
