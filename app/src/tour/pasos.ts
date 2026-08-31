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
 */

export type PasoId =
  | 'tab-descuentos'
  | 'mercado-pago'
  | 'buscador-input'
  | 'selector-otros'
  | 'coto'
  | 'tope-elegido'
  | 'listo'
  | 'primer-resultado'
  | 'ver-carrito'
  | 'comparar-precios';

export const ORDEN_PASOS: PasoId[] = [
  'tab-descuentos',
  'mercado-pago',
  'buscador-input',
  'selector-otros',
  'coto',
  'tope-elegido',
  'listo',
  'primer-resultado',
  'ver-carrito',
  'comparar-precios',
];

export const PASOS: Record<PasoId, { texto: string }> = {
  'tab-descuentos': { texto: 'Tocá Descuentos para cargar tus tarjetas y promos.' },
  'mercado-pago': { texto: 'Activá Mercado Pago: el comparador ya la va a tener en cuenta.' },
  'buscador-input': { texto: 'Escribí qué querés comprar.' },
  'selector-otros': { texto: 'Tocá acá para elegir qué supermercados comparar.' },
  coto: { texto: 'Marcá Coto para sumarlo a la comparación.' },
  'tope-elegido': { texto: 'Elegí cuántos supermercados como máximo querés visitar.' },
  listo: { texto: 'Tocá Listo para confirmar tu selección.' },
  'primer-resultado': { texto: 'Tocá un producto para agregarlo al carrito.' },
  'ver-carrito': { texto: 'Tocá para ver tu carrito.' },
  'comparar-precios': { texto: 'Tocá para comparar precios y ver dónde conviene comprar.' },
};
