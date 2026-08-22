/**
 * Sistema de diseño de AllPromos.
 *
 * Dos decisiones que explican casi todo lo demás:
 *
 * 1. Los colores de los supermercados son DATOS, no decoración. Vea verde, Carrefour azul,
 *    Chango Más violeta, y Coto y Día compartiendo el mismo rojo (Día era blanco y quedaba
 *    invisible contra el fondo blanco de la app — ver historial de `superBordes` — así que
 *    se optó por repetir un color en vez de mantener uno que no se ve) es la misma
 *    convención que ya se lee en la salida del CLI, así que el color de un precio
 *    siempre dice "de qué super es" y nunca "esto está bien/mal". No son necesariamente los
 *    colores de marca reales de cada cadena — el criterio acá es consistencia de lectura,
 *    no branding. Los logos reales sí se usan para identificar cada cadena en otros puntos
 *    de la UI (ver `assets/logos/`).
 *
 * 2. El ahorro se marca con amarillo de cartel de oferta, no con el verde de "éxito".
 *    El verde ya está ocupado por Vea como dato; si además significara "ahorro", un precio
 *    verde sería ambiguo. El amarillo viene del mundo real del tema (la etiqueta de oferta
 *    en la góndola) y queda libre de conflicto.
 */

import { Platform, type TextStyle } from 'react-native';

export type Esquema = 'light' | 'dark';

// Paleta del selector de supers (turno "selector + hoja de selección"): cada super tiene una
// variante clara (para fondo blanco: hoja, badges, bandas de disponibilidad) y una oscura (para
// el header negro #14161A). Día dejó de compartir el rojo de Coto — antes lo compartía porque
// el blanco original era invisible contra fondo blanco, hoy tiene su propio rojo distinto.
// Jumbo y Disco no son las marcas reales de esas cadenas (naranja/teal en vez de verde/rojo) —
// ya están tomados por Vea y Coto/Día, y el criterio de este archivo es consistencia de
// lectura, no branding (ver punto 1 arriba). Jumbo y Disco no varían entre claro/oscuro porque
// ya rinden bien en los dos fondos.
const superColores = {
  light: { vea: '#12874A', carr: '#1B5FD9', changomas: '#7A3FB8', dia: '#E30613', coto: '#D6293E', jumbo: '#F07C2E', disco: '#35B8C4' },
  dark:  { vea: '#2EA35C', carr: '#4C8DF6', changomas: '#A66FE0', dia: '#FF4438', coto: '#F0576A', jumbo: '#F07C2E', disco: '#35B8C4' },
};

// Bordes SOLO para identidades cuyo relleno no contrasta por sí solo contra el fondo. Vacío
// hoy (Día, el único caso que lo necesitaba, dejó de ser blanco) — se mantiene la estructura
// por si algún super nuevo necesita esto. Los componentes que dibujan el punto de identidad
// (PuntosDisponibilidad, BarraDiferencia, "Todo en X" y la banda de color del plan de compra
// en resultado.tsx) leen esto.
const superBordes = {
  light: {} as Partial<Record<keyof typeof superColores.light, string>>,
  dark: {} as Partial<Record<keyof typeof superColores.dark, string>>,
};

const paletas = {
  light: {
    // Rediseño v2: fondo blanco, no gris — las tarjetas se distinguen por borde, no por
    // contraste de fondo (ver `sombra`, que casi no se usa en claro a propósito).
    fondo: '#FFFFFF',
    superficie: '#FFFFFF',
    superficieAlt: '#F6F7F9',
    // Un escalón más oscuro que `superficieAlt`: banda "no disponible", pistas de progreso.
    // Nunca para tarjetas ni texto — para eso está `superficieAlt`.
    superficie2: '#E4E7EA',
    borde: '#DFE3E7',
    bordeFuerte: '#C6CCD3',
    tinta: '#14161A',
    // Prosa explicativa (onboarding, "Cómo funciona"): más oscura que `tintaSuave` a propósito,
    // ese texto enseña una mecánica de la app y se lee peor que el resto si se lo trata como
    // metadato (ver design_handoff_allpromos_v2/EDICIONES-contraste-y-selector.md § 1.2).
    tintaProsa: '#3C444D',
    tintaSuave: '#565E67',
    // Solo para íconos y elementos gráficos apagados (barras de comparación, spinners). Nunca
    // para texto: a 3.6:1 no llega al 4.5:1 que pide WCAG AA para texto chico (ver EDICIONES-
    // contraste-y-selector.md § 1). `tintaSuave` es el piso para cualquier texto sobre blanco.
    tintaTenue: '#767E88',
    oferta: '#FFD400',
    ofertaTinta: '#14161A',
    ofertaSuave: '#FFF6C9',
    alerta: '#9A5B08',
    alertaFondo: '#FDF3E0',
    sombra: '#000000',
    supers: superColores.light,
    supersBorde: superBordes.light,
  },
  dark: {
    fondo: '#0F1114',
    superficie: '#181B20',
    superficieAlt: '#20242B',
    // Placeholder: el tema oscuro del rediseño todavía no está diseñado (ver SPEC § 7.5).
    // Valor de continuidad con la escala existente, a revisar cuando se encare ese turno.
    superficie2: '#2B3138',
    borde: '#2B3138',
    bordeFuerte: '#3C444D',
    tinta: '#F1F3F5',
    // Placeholder, igual que `superficie2`: el tema oscuro del rediseño todavía no está
    // diseñado, `tintaSuave` sostiene el rol hasta que se encare ese turno.
    tintaProsa: '#A6AEB8',
    tintaSuave: '#A6AEB8',
    tintaTenue: '#727B85',
    oferta: '#FFD400',
    ofertaTinta: '#14161A',
    ofertaSuave: '#3A3410',
    alerta: '#F0B457',
    alertaFondo: '#2E2413',
    sombra: '#000000',
    supers: superColores.dark,
    supersBorde: superBordes.dark,
  },
} as const;

export type Paleta = typeof paletas.light;

export function paletaDe(esquema: Esquema): Paleta {
  return paletas[esquema] as Paleta;
}

/** Nombres de las familias tal como se registran en useFonts (ver app/_layout.tsx). */
export const fuentes = {
  // Condensada para números: los precios se leen como etiqueta de góndola.
  precio: 'BarlowCondensed_700Bold',
  precioMedio: 'BarlowCondensed_600SemiBold',
  // Grotesca para UI y textos.
  titulo: 'Archivo_700Bold',
  semi: 'Archivo_600SemiBold',
  medio: 'Archivo_500Medium',
  cuerpo: 'Archivo_400Regular',
  // Monoespaciada para datos duros (EAN, precio unitario): registro de ticket.
  dato: 'IBMPlexMono_400Regular',
} as const;

/** Escala tipográfica. Los tamaños de `precio` son mayores porque la fuente es condensada. */
export const texto = {
  // Título del header negro (rediseño v2): siempre mayúscula, ver TituloHeader en
  // componentes/HeaderNegro.tsx — el `textTransform` vive ahí, no acá, porque el label de
  // Resultado ("Dónde comprar") entra por props ya en minúscula normal.
  tituloHeader: {
    fontFamily: fuentes.precio, fontSize: 34, lineHeight: 34, letterSpacing: 1,
    textTransform: 'uppercase' as const,
  },
  precioHero:   { fontFamily: fuentes.precio, fontSize: 40, lineHeight: 42 },
  precioGrande: { fontFamily: fuentes.precio, fontSize: 28, lineHeight: 30 },
  precio:       { fontFamily: fuentes.precio, fontSize: 22, lineHeight: 24 },
  precioChico:  { fontFamily: fuentes.precioMedio, fontSize: 17, lineHeight: 19 },
  titulo:       { fontFamily: fuentes.titulo, fontSize: 24, lineHeight: 28 },
  subtitulo:    { fontFamily: fuentes.semi, fontSize: 17, lineHeight: 22 },
  cuerpo:       { fontFamily: fuentes.cuerpo, fontSize: 15, lineHeight: 21 },
  cuerpoMedio:  { fontFamily: fuentes.medio, fontSize: 15, lineHeight: 21 },
  etiqueta:     { fontFamily: fuentes.medio, fontSize: 13, lineHeight: 18 },
  micro:        { fontFamily: fuentes.medio, fontSize: 11, lineHeight: 14, letterSpacing: 0.7 },
  // Como `micro` pero un escalón más grueso: para los labels de sección en mayúscula
  // (PLAN DE COMPRA, EN ESTA COMPRA, etc.), que necesitan más peso que un dato o un ícono
  // para no perderse en `tintaSuave` (ver EDICIONES-contraste-y-selector.md § 1.1).
  tituloSeccion: { fontFamily: fuentes.semi, fontSize: 11, lineHeight: 14, letterSpacing: 0.7 },
  // Prosa explicativa: párrafos que enseñan una mecánica de la app (onboarding, "Cómo
  // funciona"). Más grande y más alto que `cuerpo` a propósito — es el único rol de texto
  // que se lee como instrucción, no como dato ni como descripción incidental.
  prosa:        { fontFamily: fuentes.cuerpo, fontSize: 14, lineHeight: 20 },
  // Nombre de super bajo la barrita de BarraSupers — letter-spacing más chico que `micro`
  // porque acompaña una barra angosta, no encabeza una sección.
  microSuper:   { fontFamily: fuentes.medio, fontSize: 11, lineHeight: 14, letterSpacing: 0.4 },
  dato:         { fontFamily: fuentes.dato, fontSize: 12, lineHeight: 16 },
} as const;

export const espacio = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, pantalla: 20 } as const;

// `pantalla`/`tarjeta` son los radios explícitos del rediseño v2 (16 y 12 — ver SPEC § 1);
// sm/md/lg quedan para lo que todavía no migró a ese lenguaje visual.
export const radio = { sm: 6, md: 10, lg: 14, pill: 999, pantalla: 16, tarjeta: 12 } as const;

export function sombra(esquema: Esquema) {
  if (esquema === 'dark') return {};
  return Platform.select({
    ios: {
      shadowColor: '#0B1220',
      shadowOpacity: 0.07,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 2 },
    },
    android: { elevation: 2 },
    default: {},
  });
}

/** Formato de moneda argentino. Intl puede no estar disponible según el build: hay fallback. */
export function pesos(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return '—';
  try {
    return '$' + new Intl.NumberFormat('es-AR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(n);
  } catch {
    const [entero, decimales] = Math.abs(n).toFixed(2).split('.');
    const conPuntos = entero.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return `${n < 0 ? '-' : ''}$${conPuntos},${decimales}`;
  }
}

/** Solo el entero, para cuando el contexto ya deja claro que son pesos. */
export function pesosCorto(n: number): string {
  return pesos(n).replace(/,\d{2}$/, '');
}

/**
 * `text-wrap: pretty` (evita que la última línea de un párrafo quede con una sola palabra
 * corta). Los tipos de RN todavía no lo modelan, aunque react-native-web ya lo pasa como CSS
 * — de ahí el cast. En iOS/Android nativo no tiene contraparte: no hace nada, pero tampoco
 * rompe nada.
 */
export const textoPretty = { textWrap: 'pretty' } as unknown as TextStyle;
