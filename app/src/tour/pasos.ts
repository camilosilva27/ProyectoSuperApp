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
 * `/resultado`. Avanza tocando el recuadro resaltado (el bloque mismo es un `Pressable`, ver
 * `refAhorro` en resultado.tsx) o el botón "Siguiente" propio del cartel (ver TourOverlay.tsx,
 * caso especial `pasoActivo === 'ahorro'`) — "Finalizar" (visible en todo paso) NO avanza, cierra
 * el tour entero; antes de que `notificaciones` pasara a ser `ULTIMO_PASO` este paso heredaba el
 * botón "Finalizar" de abajo y por eso servía también para avanzar, pero dejó de ser así.
 *
 * `notificaciones` va AL FINAL a propósito (a pedido) — no al principio como en el handoff
 * original: pedir un permiso del navegador antes de que el usuario vio una sola pantalla de la
 * app se sentía invasivo. Al ser el ÚLTIMO paso (`ULTIMO_PASO` en TourOverlay.tsx), hereda
 * gratis el botón "Finalizar" que ya se muestra en el último paso — así "Activar
 * notificaciones" y "Finalizar" quedan uno al lado del otro, dejando el paso explícitamente
 * opcional sin necesitar un botón de "omitir" aparte.
 */

export type PasoId =
  | "notificaciones"
  | "tab-descuentos"
  | "mercado-pago"
  | "volver-buscar"
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
  // Paso propio para volver a Buscar (a pedido): antes `mercado-pago` navegaba solo al
  // completarse (`router.navigate('/')`), lo que "teletransportaba" al usuario sin que tocara
  // nada — acá se le pide el toque real sobre la pestaña, igual que con "Descuentos".
  "volver-buscar",
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
  // Al final (a pedido, ver la nota más arriba): sin spotlight sobre ningún elemento (es un
  // permiso del navegador, no un componente en pantalla) — ver el caso especial en
  // TourOverlay.tsx. Al ser `ULTIMO_PASO`, el botón "Finalizar" aparece junto a "Activar
  // notificaciones", dejándolo opcional.
  "notificaciones",
];

export const PASOS: Record<PasoId, { titulo: string; texto: string }> = {
  notificaciones: {
    titulo: "Por último, ¿te avisamos?",
    texto: "Una vez por semana te contamos si hay mejores precios. Es opcional: activalas o tocá Finalizar.",
  },
  "tab-descuentos": {
    titulo: "Cargá tus descuentos",
    texto: "Presiona Descuentos para cargar tus tarjetas y promos.",
  },
  "mercado-pago": {
    titulo: "Activá Mercado Pago",
    texto: "Así activas tus tarjetas y promociones.",
  },
  "volver-buscar": {
    titulo: "Volvé a Buscar",
    texto: "Presiona Buscar para seguir armando tu carrito.",
  },
  "buscador-input": {
    titulo: "Buscá un producto",
    texto: "Escribí qué querés comprar.",
  },
  "primer-resultado": {
    titulo: "Agregá al carrito",
    texto: "Presiona un producto para agregarlo al carrito.",
  },
  "selector-otros": {
    titulo: "Elegí los supermercados",
    texto: "Presiona acá para elegir qué supermercados comparar.",
  },
  coto: {
    titulo: "Sumá o sacá un super",
    texto: "Presiona para agregar o sacar un supermercado de la comparación.",
  },
  "tope-elegido": {
    titulo: "Poné un máximo de supermercados",
    texto: "Elegí cuántos supermercados como máximo querés visitar.",
  },
  listo: {
    titulo: "Confirmá tu selección",
    texto: "Presiona Listo para confirmar tu selección.",
  },
  "ver-carrito": {
    titulo: "Mirá tu carrito",
    texto: "Presiona para ver tu carrito.",
  },
  "comparar-precios": {
    titulo: "Comparar precios",
    texto: "Presiona para comparar precios y ver dónde conviene comprar.",
  },
  ahorro: {
    titulo: "Así ahorrás",
    texto:
      "Así queda tu compra: cuánto pagás y cuánto ahorrás de verdad, con tus promos ya contadas. Si revisas el resto de la página, verás el detalle de donde comprar cada producto.",
  },
};
