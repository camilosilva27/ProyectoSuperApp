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
  | "tab-descuentos"
  | "mercado-pago"
  | "buscador-input"
  | "primer-resultado"
  | "selector-otros"
  | "coto"
  | "tope-elegido"
  | "listo"
  | "ver-carrito"
  | "comparar-precios"
  | "ahorro";

export const ORDEN_PASOS: PasoId[] = [
  "tab-descuentos",
  "mercado-pago",
  "buscador-input",
  // Agregar el producto va antes de elegir supers (a pedido) — al revés del orden del handoff
  // original, que abría la hoja de supers apenas se escribía, sin esperar a que el usuario
  // llegara a tocar un resultado.
  "primer-resultado",
  "selector-otros",
  "coto",
  "tope-elegido",
  "listo",
  "ver-carrito",
  "comparar-precios",
  "ahorro",
];

export const PASOS: Record<PasoId, { titulo: string; texto: string }> = {
  "tab-descuentos": {
    titulo: "Cargá tus descuentos",
    texto: "Tocá Descuentos para cargar tus tarjetas y promos.",
  },
  "mercado-pago": {
    titulo: "Activá Mercado Pago",
    texto:
      "Activá Mercado Pago: De esta forma te mostraremos las promociones que lo necesiten.",
  },
  "buscador-input": {
    titulo: "Buscá un producto",
    texto: "Escribí qué querés comprar.",
  },
  "primer-resultado": {
    titulo: "Agregá al carrito",
    texto: "Tocá un producto para agregarlo al carrito.",
  },
  "selector-otros": {
    titulo: "Elegí los supermercados",
    texto: "Tocá acá para elegir qué supermercados comparar.",
  },
  coto: {
    titulo: "Sumá o sacá un super",
    texto: "Tocá Coto: así agregás o sacás a un super de la comparación.",
  },
  "tope-elegido": {
    titulo: "Poné un máximo de supermercados",
    texto: "Elegí cuántos supermercados como máximo querés visitar.",
  },
  listo: {
    titulo: "Confirmá tu selección",
    texto: "Tocá Listo para confirmar tu selección.",
  },
  "ver-carrito": {
    titulo: "Mirá tu carrito",
    texto: "Tocá para ver tu carrito.",
  },
  "comparar-precios": {
    titulo: "Comparar precios",
    texto: "Tocá para comparar precios y ver dónde conviene comprar.",
  },
  ahorro: {
    titulo: "Así ahorrás",
    texto:
      "Así queda tu compra: cuánto pagás y cuánto ahorrás de verdad, con tus promos ya contadas. Si revisas el resto de la página, verás el detalle de donde comprar cada producto.",
  },
};
