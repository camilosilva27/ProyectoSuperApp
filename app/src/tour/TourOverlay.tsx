/**
 * Capa visual del tour: 4 bloqueadores (solo bloquean toque, ya no pintan oscuro — ver abajo)
 * alrededor del target actual (arriba/abajo/izquierda/derecha) + el recorte del medio sin
 * overlay (el toque real llega directo al elemento real, no se envuelve en nada) + el cartel
 * de instrucción.
 *
 * El oscurecido en sí lo pinta un único `boxShadow` (spread 9999px) sobre `marcoRecorte`, no
 * los 4 bloqueadores: así el "agujero" de luz sigue el mismo `borderRadius` que el borde
 * amarillo, en vez de quedar un rectángulo recto por debajo de un borde curvo (se veían las
 * esquinas "marcadas" aunque el borde fuera redondeado).
 *
 * "Finalizar" arriba a la derecha del cartel, en todos los pasos: cierra el tour en cualquier
 * momento (antes solo se podía completarlo de punta a punta). El último paso (`ahorro`, ver
 * resultado.tsx) además tiene su propio botón de cierre, más prominente, que hace lo mismo que
 * tocar el recuadro resaltado: terminar.
 *
 * La medición reintenta en cada frame durante una ventana corta después de cada cambio de
 * paso, no solo una vez: esto cubre tanto el caso general (nodo recién montado, 0×0 hasta que
 * el layout corre) como el caso de HojaSupers, que anima su entrada con `Animated.spring` — acá
 * no hace falta escuchar el fin de esa animación, el spotlight simplemente sigue midiendo y
 * "viaja" con el target mientras se termina de mover.
 */

import { useEffect, useRef, useState } from 'react';
import {
  Platform, Pressable, StyleSheet, Text, View, useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../auth';
import { pedirPermisoYSuscribir } from '../push/push';
import { espacio, fuentes, radio } from '../theme';
import { ORDEN_PASOS, PASOS, type PasoId } from './pasos';
import { avanzarTour, refDeTarget, salirTour, tourAltoTabBar, useEstadoTour } from './TourContext';

const ULTIMO_PASO = ORDEN_PASOS[ORDEN_PASOS.length - 1];
const TOTAL_PASOS = ORDEN_PASOS.length;

type Rect = { x: number; y: number; width: number; height: number };

// Índices de pestañas en la barra inferior (ver app/(tabs)/_layout.tsx: Buscar, Carrito,
// Descuentos, Ahorros, Ajustes) y su alto de referencia si todavía no llegó el valor real
// reportado por la pantalla Buscar (ver `tourReportarAltoTabBar` en index.tsx).
const INDICE_TAB_BUSCAR = 0;
const INDICE_TAB_DESCUENTOS = 2;
const CANTIDAD_TABS = 5;
const ALTO_TAB_BAR_FALLBACK = 56;

const PADDING_RECORTE = 8;
const RADIO_RECORTE = 14;
const INTENTOS_RAPIDOS = 90; // ~1.5s a 60fps — sigue al target mientras HojaSupers anima su entrada
const INTERVALO_LENTO_MS = 400; // tras la ventana rápida, sigue reintentando así de por vida

// Pasos cuya finalización implica navegar a otra pantalla (ver mis-descuentos.tsx, index.tsx,
// carrito.tsx: son los únicos 4 con una condición de avance atada a un cambio real de ruta o
// foco). El paso que entra DESPUÉS de completar uno de estos no tiene un target "anterior"
// visible en la misma pantalla — deslizar el recuadro no tendría sentido (el punto de partida
// no existe ahí), así que esos pasos "crecen" desde un punto en el centro del target nuevo en
// vez de deslizar desde el viejo (ver DURACION_CRECIMIENTO_MS).
const PASOS_CAMBIO_PANTALLA = new Set<PasoId>(['tab-descuentos', 'mercado-pago', 'volver-buscar', 'ver-carrito', 'comparar-precios']);
const DURACION_SLIDE_MS = 380;
// A PROPÓSITO no hay ninguna espera fija antes de mostrar el spotlight nuevo tras una
// navegación: hacerlo dejaba una pausa en negro sin nada animándose, que se leía como que la
// app estaba trabada — no como una transición. En vez de eso, apenas se puede medir el target
// nuevo, el recuadro arranca a crecer desde un punto invisible en su centro (mismo mecanismo
// que el slide, con un origen distinto) y el cartel entra en simultáneo — el tiempo que antes
// era "pausa muerta" ahora es tiempo de animación real.
const DURACION_CRECIMIENTO_MS = 650;
const CURVA_CRECIMIENTO = 'cubic-bezier(0.22, 1, 0.36, 1)';
// Cuánto tarda el bloqueo oscuro en aparecer mientras todavía no hay ningún target medido (el
// único momento sin nada animándose de verdad: recién se navegó y la pantalla nueva ni montó) —
// un fade, no un corte seco.
const DURACION_ENTRADA_BLOQUEO_MS = 300;
// El cartel entra junto con el recuadro (no antes ni mucho después): un adelanto chico alcanza
// para que se perciba como "la luz encuentra el lugar, la instrucción lo confirma" sin que el
// cartel se sienta atrasado.
const DEMORA_CARTEL_MS = 60;

function medirNodo(nodo: unknown): Promise<Rect | null> {
  return new Promise(resolve => {
    const medible = nodo as { measureInWindow?: (cb: (x: number, y: number, w: number, h: number) => void) => void } | null;
    if (!medible?.measureInWindow) {
      resolve(null);
      return;
    }
    medible.measureInWindow((x, y, width, height) => {
      resolve(width > 0 && height > 0 ? { x, y, width, height } : null);
    });
  });
}

export function TourOverlay() {
  const { activo, pasoActivo } = useEstadoTour();
  const { width: anchoVentana, height: altoVentana } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [rect, setRect] = useState<Rect | null>(null);
  const { session } = useAuth();

  // Plain state + transición CSS (solo en web — nativo no tiene CSS transitions, cae a un
  // corte instantáneo) para TODO lo que se anima en este archivo, en vez de `Animated` de
  // React Native: se probó con `Animated.Value` + `Animated.timing({useNativeDriver:false})` y
  // en este RN Web quedaba sistemáticamente "congelado" cerca del valor inicial (tanto el fade
  // del cartel como este mismo pulso) — no avanzaba aunque `.start()` se llamara correctamente.
  // No vale la pena perseguir la causa exacta del freeze: un número de estado + `transitionDuration`
  // es más simple, no depende de un consumidor montado en el momento justo en que arranca, y
  // se probó que sí funciona (ver `opacidadCartel`).
  const [posicion, setPosicion] = useState({ left: 0, top: 0, width: 0, height: 0 });
  // 0 = corte instantáneo (usado solo para fijar el punto de partida sin transición, ver más
  // abajo); DURACION_SLIDE_MS = desliza dentro de la misma pantalla; DURACION_CRECIMIENTO_MS =
  // crece desde un punto tras una transición dura.
  const [duracionPosicionMs, setDuracionPosicionMs] = useState(0);
  // Arranca en `false` a propósito (no `true`): el cartel recién existe en el árbol la primera
  // vez que `rect` deja de ser `null`, y React pinta ese primer render CON lo que sea que este
  // estado valga en ese momento — si arrancara en `true`, el paso 1 nacería visible por un
  // instante antes de que el código de abajo lo pusiera en `false`, un parpadeo (aparece,
  // desaparece, reaparece) en vez de un fade-in limpio. Entra con fade + un leve desplazamiento
  // en toda transición dura (incluida la primera); en las blandas queda en `true` y el texto
  // simplemente cambia sin animar.
  const [cartelListo, setCartelListo] = useState(false);
  // Fade de entrada del bloqueo oscuro (ver el JSX de más abajo): arranca en `false` apenas se
  // monta (mientras el target nuevo todavía no se puede medir) y pasa a `true` un frame
  // después, para que el oscurecido también entre con una transición en vez de un corte seco.
  const [bloqueoListo, setBloqueoListo] = useState(false);
  const pasoAnteriorRef = useRef<PasoId | null>(null);
  const pasoClasificadoRef = useRef<PasoId | null>(null);
  const sinContinuidadVisualRef = useRef(false);
  const pasoDelUltimoRectRef = useRef<PasoId | null>(null);
  const huboRectPrevioRef = useRef(false);

  useEffect(() => {
    if (rect !== null) return;
    setBloqueoListo(false);
    const id = requestAnimationFrame(() => setBloqueoListo(true));
    return () => cancelAnimationFrame(id);
  }, [rect]);

  async function activarNotificaciones() {
    try {
      if (session) await pedirPermisoYSuscribir(session.user.id);
    } finally {
      // Avanza haya aceptado o rechazado el permiso: un navegador no deja re-preguntar tras un
      // rechazo, así que bloquear el tour hasta que acepte dejaría afuera a quien rechace.
      avanzarTour('notificaciones');
    }
  }

  useEffect(() => {
    if (!pasoActivo) {
      setRect(null);
      pasoAnteriorRef.current = null;
      pasoClasificadoRef.current = null;
      return;
    }
    // Narrowing explícito: TS no preserva el `!pasoActivo` de arriba dentro de las funciones
    // anidadas de más abajo (son `function`, no arrow, y capturan `pasoActivo` por closure).
    const idPaso: PasoId = pasoActivo;

    // La clasificación (¿el paso ANTERIOR implicó cambiar de pantalla?) se calcula una sola
    // vez por transición real, guardada en `pasoClasificadoRef` — este efecto también depende
    // de `anchoVentana`/`altoVentana`/`insets.bottom`, que pueden cambiar (resize, un inset que
    // termina de resolver) SIN que el paso haya cambiado; sin este guard, ese re-render volvía
    // a leer `pasoAnteriorRef` ya pisado con el propio paso actual (por la corrida anterior de
    // este mismo efecto) y lo tomaba como si fuera "el paso anterior", reclasificando mal.
    if (pasoClasificadoRef.current !== idPaso) {
      const pasoAnterior = pasoAnteriorRef.current;
      // 'notificaciones' no tiene target real (ver más abajo): tratarlo como "sin continuidad
      // visual" también evita que el paso siguiente intente deslizar el recuadro desde el
      // recorte fuera de pantalla que usa ese paso.
      sinContinuidadVisualRef.current = pasoAnterior !== null
        && (pasoAnterior === 'notificaciones' || PASOS_CAMBIO_PANTALLA.has(pasoAnterior));
      pasoAnteriorRef.current = idPaso;
      pasoClasificadoRef.current = idPaso;
      if (sinContinuidadVisualRef.current) {
        // El cartel nuevo va a montar con esto ya en `false` (el efecto de más abajo lo pasa a
        // `true` apenas el rect nuevo llega) — así la entrada arranca realmente desde invisible,
        // en vez de nacer visible y recién después pedirle que retroceda (eso daba un parpadeo).
        setCartelListo(false);
      }
    }
    let cancelado = false;
    let intentos = 0;

    async function calcularCandidato(): Promise<Rect | null> {
      if (idPaso === 'notificaciones') {
        // Sin target real en pantalla (es un permiso del navegador, no un componente): un
        // recorte fuera de pantalla deja el oscurecido completo y el cartel con su botón
        // propio (ver más abajo), sin spotlight sobre nada. NO usar un offset tan grande como
        // -9999: combinado con el spread de 9999px del boxShadow (ver marcoRecorte, más abajo)
        // se cancelaban casi por completo y dejaban la pantalla SIN oscurecer — un offset chico
        // alcanza para esconder el recuadro (tamaño 0) y el spread igual cubre todo el viewport.
        return { x: -100, y: -100, width: 0, height: 0 };
      }
      if (idPaso === 'tab-descuentos' || idPaso === 'volver-buscar') {
        const altoTabBar = tourAltoTabBar() ?? ALTO_TAB_BAR_FALLBACK + insets.bottom;
        const anchoTab = anchoVentana / CANTIDAD_TABS;
        const indice = idPaso === 'tab-descuentos' ? INDICE_TAB_DESCUENTOS : INDICE_TAB_BUSCAR;
        // `y + height` da justo `altoVentana` (la celda llega hasta el borde físico de la
        // pantalla) — el recorte de más abajo le suma PADDING_RECORTE a los cuatro lados, así
        // que el borde inferior terminaba PADDING_RECORTE por FUERA del viewport, invisible.
        // Se descuenta acá (más un margen chico) para que, tras sumarle el padding, el borde
        // completo quede adentro y se vea.
        const alturaVisible = Math.max(0, altoTabBar - PADDING_RECORTE - 4);
        return {
          x: anchoTab * indice,
          y: altoVentana - alturaVisible,
          width: anchoTab,
          height: alturaVisible,
        };
      }
      return medirNodo(refDeTarget(idPaso)?.current);
    }

    async function ciclo() {
      if (cancelado) return;
      const candidato = await calcularCandidato();
      if (cancelado) return;
      if (candidato) {
        // Sin espera artificial: apenas hay un target medible se muestra — la animación de
        // crecimiento (ver el otro efecto) es lo que le da tiempo al usuario a registrar que
        // pasó algo, no una pausa en negro sin nada moviéndose.
        setRect(candidato);
        if (idPaso === 'notificaciones' || idPaso === 'tab-descuentos' || idPaso === 'volver-buscar') return; // calculado, no depende de medir ningún nodo
      }
      intentos++;
      if (intentos < INTENTOS_RAPIDOS) {
        requestAnimationFrame(ciclo);
      } else {
        // El target puede tardar en montarse por algo ajeno a la animación (ej. una pantalla
        // esperando una respuesta de red antes de renderizar su lista) — sin este fallback, un
        // paso cuyo target aparece después de ~1.5s se quedaba sin spotlight para siempre.
        setTimeout(ciclo, INTERVALO_LENTO_MS);
      }
    }

    if (sinContinuidadVisualRef.current) {
      // Transición dura: sin continuidad visual con el target viejo, se sostiene el bloqueo
      // oscuro (con su propio fade de entrada, ver `bloqueoListo`) hasta que el nuevo target
      // se pueda medir — normalmente un puñado de frames, el tiempo real que tarda la pantalla
      // destino en montar.
      setRect(null);
    }
    // Transición blanda: se deja el `rect` del paso anterior tal cual mientras se mide el
    // nuevo — así el recuadro nunca desaparece del árbol y la animación de slide (ver el otro
    // efecto) tiene una posición real de la que partir, en vez de "aparecer de la nada" después
    // de un parpadeo a bloqueo oscuro.
    requestAnimationFrame(ciclo);
    return () => {
      cancelado = true;
    };
  }, [pasoActivo, anchoVentana, altoVentana, insets.bottom]);

  useEffect(() => {
    if (!rect || !pasoActivo) return;
    const recorte = {
      x: rect.x - PADDING_RECORTE,
      y: rect.y - PADDING_RECORTE,
      width: rect.width + PADDING_RECORTE * 2,
      height: rect.height + PADDING_RECORTE * 2,
    };
    const esNuevoPaso = pasoDelUltimoRectRef.current !== pasoActivo;
    if (!esNuevoPaso) {
      // Sigue siendo el mismo target del mismo paso (remedición — el `FlatList`/lista sigue
      // re-midiendo la fila varias veces por segundo, ver INTENTOS_RAPIDOS). NO toca
      // `duracionPosicionMs` acá: si el slide recién arrancó (ver la rama de abajo), esta
      // remedición corre unos ms después, en pleno slide — resetear la duración a 0 en esa
      // rama cortaba la transición CSS casi al instante, dejándola invisible. Cuando de verdad
      // no hay transición en curso (`duracionPosicionMs` ya volvió a 0 solo, ver el
      // `setTimeout` de la rama de slide) esto simplemente sigue al target en vivo sin animar.
      setPosicion({ left: recorte.x, top: recorte.y, width: recorte.width, height: recorte.height });
      return;
    }
    pasoDelUltimoRectRef.current = pasoActivo;

    if (!huboRectPrevioRef.current) {
      // Primer spotlight del tour ('notificaciones'): sin target real en pantalla (recorte
      // fuera de pantalla, ver calcularCandidato), así que el recuadro no tiene nada que
      // animar — pero el cartel sí entra con fade, igual que en cualquier transición dura.
      huboRectPrevioRef.current = true;
      setDuracionPosicionMs(0);
      setPosicion({ left: recorte.x, top: recorte.y, width: recorte.width, height: recorte.height });
      setCartelListo(false);
      requestAnimationFrame(() => setCartelListo(true));
      return;
    }

    if (sinContinuidadVisualRef.current) {
      // El paso anterior implicó navegar a otra pantalla: no hay una posición vieja de la que
      // deslizar, así que el recuadro arranca como un punto invisible en el centro del target
      // nuevo y CRECE hasta su tamaño real — mismo mecanismo que el slide (posición + tamaño
      // animados), con un origen distinto en vez de con un salto instantáneo. El cartel entra
      // en simultáneo (ver DEMORA_CARTEL_MS). El punto de partida se fija sin transición (dura
      // 0) para que el "nace invisible" no se note — recién el crecimiento hacia el tamaño
      // real es lo que se ve.
      const centro = { x: recorte.x + recorte.width / 2, y: recorte.y + recorte.height / 2 };
      setDuracionPosicionMs(0);
      setPosicion({ left: centro.x, top: centro.y, width: 0, height: 0 });
      requestAnimationFrame(() => {
        setDuracionPosicionMs(DURACION_CRECIMIENTO_MS);
        setPosicion({ left: recorte.x, top: recorte.y, width: recorte.width, height: recorte.height });
        setCartelListo(true);
      });
    } else {
      // Mismo screen que el paso anterior: el recuadro se desliza y cambia de tamaño hacia el
      // nuevo target en vez de desaparecer de un lado y aparecer en el otro (a pedido). El
      // `rect` del paso anterior se dejó tal cual en el otro efecto (no se limpió a `null`),
      // así que este nodo nunca se desmontó — la transición CSS tiene una posición real de la
      // que partir. La duración vuelve a 0 recién cuando el slide termina (no antes): así una
      // remedición que llega en pleno slide (rama de arriba) no lo corta a mitad de camino.
      setDuracionPosicionMs(DURACION_SLIDE_MS);
      setPosicion({ left: recorte.x, top: recorte.y, width: recorte.width, height: recorte.height });
      const id = setTimeout(() => setDuracionPosicionMs(0), DURACION_SLIDE_MS);
      return () => clearTimeout(id);
    }
  }, [rect, pasoActivo]);

  if (!activo || !pasoActivo) return null;

  // Todavía no se pudo medir el target (recién se activó el paso, o el elemento recién está
  // montando/animando) — bloquear TODO en vez de no bloquear nada: sin esto, había una ventana
  // real en la que se podía tocar cualquier cosa antes de que el spotlight "enganchara".
  if (!rect) {
    return (
      <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
        <View
          pointerEvents="none"
          style={[
            styles.bloqueadorOpaco,
            { top: 0, left: 0, right: 0, bottom: 0 },
            { opacity: bloqueoListo ? 0.62 : 0 },
            Platform.OS === 'web'
              ? {
                transitionProperty: 'opacity',
                transitionDuration: `${DURACION_ENTRADA_BLOQUEO_MS}ms`,
                transitionTimingFunction: 'ease-out',
              } as object
              : null,
          ]}
        />
        <Pressable
          onPress={() => {}}
          style={[styles.bloqueador, { top: 0, left: 0, right: 0, bottom: 0 }]}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        />
      </View>
    );
  }

  const recorte = {
    x: rect.x - PADDING_RECORTE,
    y: rect.y - PADDING_RECORTE,
    width: rect.width + PADDING_RECORTE * 2,
    height: rect.height + PADDING_RECORTE * 2,
  };

  // El cartel va del lado opuesto a donde cae el target: si el hueco está en la mitad de
  // abajo de la pantalla, el cartel va arriba, y viceversa — nunca lo tapa.
  const targetEnMitadInferior = rect.y + rect.height / 2 > altoVentana / 2;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <Bloqueador estilo={{ top: 0, left: 0, right: 0, height: Math.max(0, recorte.y) }} />
      <Bloqueador
        estilo={{
          top: Math.max(0, recorte.y + recorte.height),
          left: 0,
          right: 0,
          bottom: 0,
        }}
      />
      <Bloqueador
        estilo={{
          top: Math.max(0, recorte.y),
          height: recorte.height,
          left: 0,
          width: Math.max(0, recorte.x),
        }}
      />
      <Bloqueador
        estilo={{
          top: Math.max(0, recorte.y),
          height: recorte.height,
          left: Math.max(0, recorte.x + recorte.width),
          right: 0,
        }}
      />

      <View
        pointerEvents="none"
        style={[
          styles.marcoRecorte,
          {
            left: posicion.left, top: posicion.top, width: posicion.width, height: posicion.height,
          },
          Platform.OS === 'web'
            ? {
              transitionProperty: 'left, top, width, height',
              transitionDuration: `${duracionPosicionMs}ms`,
              transitionTimingFunction: duracionPosicionMs === DURACION_CRECIMIENTO_MS ? CURVA_CRECIMIENTO : 'ease-out',
            } as object
            : null,
        ]}
      />

      <View
        style={[
          styles.cartelContenedor,
          targetEnMitadInferior
            ? { top: insets.top + espacio.lg }
            : { bottom: insets.bottom + espacio.lg },
          { opacity: cartelListo ? 1 : 0 },
          Platform.OS === 'web'
            ? {
              transform: cartelListo ? 'translateY(0) scale(1)' : 'translateY(10px) scale(0.96)',
              transitionProperty: 'opacity, transform',
              transitionDuration: `${DURACION_CRECIMIENTO_MS}ms, ${DURACION_CRECIMIENTO_MS}ms`,
              transitionTimingFunction: `ease-out, ${CURVA_CRECIMIENTO}`,
              // Entra casi junto con el recuadro (ver DEMORA_CARTEL_MS): un adelanto chico para
              // que se perciba orden sin que se sienta atrasado.
              transitionDelay: `${DEMORA_CARTEL_MS}ms, ${DEMORA_CARTEL_MS}ms`,
            } as object
            : null,
        ]}
      >
        <View style={styles.cartel}>
          <View style={styles.filaSuperior}>
            <View style={styles.badgePaso}>
              <Text style={styles.pasoCartel}>Paso {ORDEN_PASOS.indexOf(pasoActivo) + 1} de {TOTAL_PASOS}</Text>
            </View>
            <Pressable onPress={salirTour} accessibilityRole="button" hitSlop={8}>
              <Text style={styles.textoFinalizarLink}>Finalizar</Text>
            </Pressable>
          </View>
          <Text style={styles.tituloCartel}>{PASOS[pasoActivo].titulo}</Text>
          <Text style={styles.textoCartel}>{PASOS[pasoActivo].texto}</Text>
          <View style={styles.puntos} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            {ORDEN_PASOS.map(id => (
              <View key={id} style={[styles.punto, id === pasoActivo ? styles.puntoActivo : null]} />
            ))}
          </View>
          {pasoActivo === 'notificaciones' ? (
            <Pressable onPress={activarNotificaciones} accessibilityRole="button" style={styles.botonFinalizar}>
              <Text style={styles.textoBotonFinalizar}>Activar notificaciones</Text>
            </Pressable>
          ) : null}
          {pasoActivo === ULTIMO_PASO ? (
            <Pressable onPress={salirTour} accessibilityRole="button" style={styles.botonFinalizar}>
              <Text style={styles.textoBotonFinalizar}>Finalizar</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </View>
  );
}

function Bloqueador({ estilo }: { estilo: { top?: number; bottom?: number; left?: number; right?: number; width?: number; height?: number } }) {
  return (
    <Pressable
      onPress={() => {}}
      style={[styles.bloqueador, estilo]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    />
  );
}

const styles = StyleSheet.create({
  // Transparente: solo bloquea el toque afuera del recorte. El oscurecido en sí lo pinta
  // `marcoRecorte` con un boxShadow enorme, que sigue el borderRadius — así el "agujero" de
  // luz queda redondeado igual que el borde amarillo, en vez de tener esquinas rectas por
  // debajo de un borde curvo (ver nota al pie del archivo).
  bloqueador: { position: 'absolute', backgroundColor: 'transparent' },
  bloqueadorOpaco: { position: 'absolute', backgroundColor: 'rgb(11,18,32)' },
  marcoRecorte: {
    position: 'absolute', borderRadius: RADIO_RECORTE, borderWidth: 2, borderColor: '#FFD400',
    boxShadow: '0 0 0 9999px rgba(11,18,32,.62)',
  },
  cartelContenedor: { position: 'absolute', left: espacio.pantalla, right: espacio.pantalla },
  cartel: {
    backgroundColor: '#FFFFFF', borderRadius: radio.tarjeta, padding: espacio.xl, gap: espacio.sm,
    boxShadow: '0 4px 20px rgba(11,18,32,.25)',
  },
  filaSuperior: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  badgePaso: {
    alignSelf: 'flex-start', backgroundColor: '#FFD400', borderRadius: radio.pill,
    paddingHorizontal: espacio.sm, paddingVertical: 2,
  },
  pasoCartel: { fontFamily: fuentes.semi, fontSize: 12, lineHeight: 16, color: '#14161A' },
  // Gris = `tintaSuave` (theme.ts) a mano: este archivo no importa `colores` (el tema oscuro
  // del rediseño no está diseñado todavía, ver ese archivo), pero el valor es el mismo — y es
  // el piso de contraste válido para texto sobre blanco (`tintaTenue` es más claro pero solo
  // vale para íconos, no pasa WCAG AA para texto).
  textoFinalizarLink: {
    fontFamily: fuentes.medio, fontSize: 14, lineHeight: 18, color: '#565E67',
    textDecorationLine: 'underline',
  },
  tituloCartel: { fontFamily: fuentes.semi, fontSize: 17, lineHeight: 22, color: '#14161A' },
  textoCartel: { fontFamily: fuentes.medio, fontSize: 16, lineHeight: 22, color: '#14161A' },
  puntos: { flexDirection: 'row', gap: espacio.xs, marginTop: espacio.xs },
  punto: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#E2E5E9' },
  puntoActivo: { backgroundColor: '#14161A' },
  botonFinalizar: {
    alignSelf: 'flex-start', backgroundColor: '#14161A', borderRadius: radio.sm,
    height: 44, paddingHorizontal: espacio.lg, alignItems: 'center', justifyContent: 'center',
  },
  textoBotonFinalizar: {
    fontFamily: fuentes.semi, fontSize: 14, lineHeight: 18, color: '#FFFFFF',
  },
});
