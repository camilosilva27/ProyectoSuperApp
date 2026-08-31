/**
 * Hoja "Qué supers comparar" (Parte 2 del turno "selector + hoja de selección"), abierta desde
 * la celda "+N otros" del selector en el header (ver `SelectorSupers` en HeaderNegro.tsx).
 *
 * Sube sobre la pantalla actual, no navega a otra — así no se pierde el carrito ni la búsqueda
 * en curso. Los cambios se acumulan en un borrador local y solo se aplican (recalculando el
 * resultado) al cerrar, sea con "Listo", tocando el scrim o arrastrando hacia abajo — las tres
 * vías cierran Y confirman, no hay "cancelar" separado de "cerrar".
 *
 * El arrastre usa `PanResponder` + `Animated` (ambos del core de RN), no gesture-handler:
 * gesture-handler necesita `GestureHandlerRootView` en la raíz de la app, y dentro de un
 * `Modal` de RN (que monta su propio árbol nativo) es una fuente conocida de gestos que no
 * responden — no vale la pena para un solo gesto de arrastre.
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  Animated, Dimensions, PanResponder, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { comparar, type SuperKey } from '../api';
import { useAuth } from '../auth';
import { useCarrito } from '../carrito';
import { espacio, fuentes, paletaDe, pesosCorto, radio, texto, textoPretty } from '../theme';
import { avanzarTour, useTourPaso } from '../tour/TourContext';
import { NOMBRE_SUPER, ORDEN_SUPERS } from './comunes';
import { PlacaLogoSuper } from './LogoSuper';

/** `0` = sin tope explícito ("Los N") — no se guarda el N literal porque queda obsoleto en
 *  cuanto cambia la selección (ver normalizarTope en filtrosSupers.tsx, misma regla). */
function normalizarTope(tope: number, cantidadElegidos: number): number {
  return tope > 0 && tope < cantidadElegidos ? tope : 0;
}

/** Debounce del preview de costo — no hace falta pedirle al backend en cada tap si el usuario
 *  sigue tocando la fila de opciones. */
const DEMORA_PREVIEW_MS = 400;

/**
 * Cuánto "cuesta" en pesos el tope elegido, calculado en vivo contra el carrito real — la hoja
 * se abre hoy solo desde Buscar, que no tiene un plan de carrito calculado (eso solo existe en
 * Resultado), así que no hay otro dato del que partir: se le pide al backend, con el mismo
 * `borrador` que se está armando en la hoja. `null` = todavía no hay nada que mostrar (carrito
 * vacío, "Los N" seleccionado, o la respuesta no llegó/falló) — el caller decide qué texto
 * corresponde a cada uno de esos casos.
 */
function useCostoTope(
  pedido: { ean: string; cantidad: number }[],
  tarjetas: string[],
  borrador: SuperKey[],
  topeBorrador: number,
  accessToken: string | null,
): number | null {
  const [monto, setMonto] = useState<number | null>(null);
  // Contador de secuencia (mismo patrón que usePreciosProgresivos en la pantalla de Buscar):
  // ignora una respuesta que llega después de que el usuario ya cambió el tope o la selección.
  const turnoRef = useRef(0);

  useEffect(() => {
    if (!pedido.length || !topeBorrador || borrador.length <= 1 || !accessToken) {
      setMonto(null);
      return;
    }
    const miTurno = ++turnoRef.current;
    const id = setTimeout(() => {
      comparar(pedido, tarjetas, accessToken, borrador, topeBorrador)
        .then(({ resumen }) => {
          if (turnoRef.current !== miTurno) return;
          setMonto(
            resumen.totalOptimoSinTope != null
              ? Math.max(0, resumen.totalOptimo - resumen.totalOptimoSinTope)
              : 0
          );
        })
        .catch(() => {
          if (turnoRef.current === miTurno) setMonto(null);
        });
    }, DEMORA_PREVIEW_MS);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `pedido`/`tarjetas` son arrays
    // nuevos en cada render del padre; se comparan por contenido (JSON) para no re-pedir de
    // más cuando lo que cambió fue otra cosa del carrito que no afecta este cálculo.
  }, [JSON.stringify(pedido), JSON.stringify(tarjetas), JSON.stringify(borrador), topeBorrador, accessToken]);

  return monto;
}

// Debajo de esto no hace falta buscador — se ve toda la lista de un vistazo (con los 7 supers
// de hoy, esto nunca se muestra; queda listo para cuando la lista crezca).
const UMBRAL_BUSQUEDA = 10;

const ALTURA_OFFSCREEN = Dimensions.get('window').height;
const UMBRAL_CIERRE_ARRASTRE = 120;

export function HojaSupers({
  visible, activos, tope, onCerrar, onAplicar,
}: {
  visible: boolean;
  activos: SuperKey[];
  tope: number;
  onCerrar: () => void;
  onAplicar: (keys: SuperKey[], tope: number) => void;
}) {
  const [borrador, setBorrador] = useState<SuperKey[]>(activos);
  const [topeBorrador, setTopeBorrador] = useState(tope);
  const [busqueda, setBusqueda] = useState('');
  const [arrastrando, setArrastrando] = useState(false);
  const translateY = useRef(new Animated.Value(ALTURA_OFFSCREEN)).current;
  const carrito = useCarrito();
  const { session } = useAuth();
  // Snapshot del tope con el que se abrió la hoja — el paso del tour "elegí un tope" (ver
  // TourContext.tsx) necesita distinguir "el usuario tocó una opción" de "el tope ya venía así".
  const topeInicialRef = useRef(tope);

  useEffect(() => {
    if (!visible) return;
    setBorrador(activos);
    setTopeBorrador(normalizarTope(tope, activos.length));
    topeInicialRef.current = normalizarTope(tope, activos.length);
    setBusqueda('');
    translateY.setValue(ALTURA_OFFSCREEN);
    Animated.spring(translateY, { toValue: 0, useNativeDriver: true, bounciness: 4 }).start();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo al abrir, no en cada cambio de `activos`/`tope`
  }, [visible]);

  const cerrarYConfirmar = () => {
    Animated.timing(translateY, {
      toValue: ALTURA_OFFSCREEN, duration: 220, useNativeDriver: true,
    }).start(() => {
      onAplicar(borrador, topeBorrador);
      onCerrar();
      setArrastrando(false);
      // Imperativo, no vía `useTourPaso`: para cuando esto corre, la hoja ya se está por
      // desmontar (onCerrar) — no hay forma de que un booleano "cumplido" lo detecte a tiempo.
      avanzarTour('listo');
    });
  };
  // El `PanResponder` de más abajo se crea una sola vez (`useRef`) para no perder el gesto en
  // curso si el componente vuelve a renderizar a mitad de un arrastre — pero eso significa que
  // sus callbacks quedan con el closure de ESE primer render para siempre. Sin este ref,
  // `onPanResponderRelease` llamaría a una versión vieja de `cerrarYConfirmar`, que cierra
  // sobre un `borrador` viejo (el de cuando se abrió la hoja por primera vez) — un arrastre
  // deshacía cualquier toggle hecho después de esa primera apertura.
  const cerrarYConfirmarRef = useRef(cerrarYConfirmar);
  cerrarYConfirmarRef.current = cerrarYConfirmar;

  // No usa la forma de updater (prev => ...): tiene que ajustar `topeBorrador` como efecto del
  // mismo toggle ("si destildás y el tope queda >= la cantidad elegida, pasa a Los N"), y
  // anidar un setState dentro del callback de otro es frágil. `borrador` ya está fresco en
  // este closure porque el componente se re-renderiza en cada cambio de estado.
  const toggle = (key: SuperKey) => {
    const siguiente = borrador.includes(key)
      ? (borrador.length === 1 ? borrador : borrador.filter(k => k !== key)) // no se puede destildar el último activo
      : [...borrador, key];
    setBorrador(siguiente);
    setTopeBorrador(t => normalizarTope(t, siguiente.length));
  };

  // `arrastrando` tapa la lista con una capa transparente mientras se arrastra (ver el
  // overlay más abajo, después del ScrollView): sin esto, un arrastre que pasa por encima de
  // una fila puede soltar el touch justo sobre su checkbox y el `Pressable` de esa fila lo
  // toma como un tap suelto — el sistema de responders de RN Web y el de `Pressable` no
  // negocian entre sí de forma confiable. Se apaga recién cuando termina la animación (de
  // cierre o de rebote), no en el release, para seguir tapando la fila en el instante exacto
  // en que se suelta el dedo/mouse.
  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => g.dy > 6 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderGrant: () => setArrastrando(true),
      onPanResponderMove: (_, g) => {
        if (g.dy > 0) translateY.setValue(g.dy);
      },
      onPanResponderRelease: (_, g) => {
        if (g.dy > UMBRAL_CIERRE_ARRASTRE || g.vy > 1.2) {
          cerrarYConfirmarRef.current();
        } else {
          Animated.spring(translateY, { toValue: 0, useNativeDriver: true, bounciness: 4 })
            .start(() => setArrastrando(false));
        }
      },
    })
  ).current;

  const filtro = busqueda.trim().toLowerCase();
  const visiblesPorFiltro = ORDEN_SUPERS.filter(key => NOMBRE_SUPER[key].toLowerCase().includes(filtro));
  const comparando = visiblesPorFiltro.filter(key => borrador.includes(key));
  const afuera = visiblesPorFiltro.filter(key => !borrador.includes(key));

  const pedido = carrito.items.map(i => ({ ean: i.ean, cantidad: i.cantidad }));
  const montoTope = useCostoTope(pedido, carrito.tarjetas, borrador, topeBorrador, session?.access_token ?? null);

  const refCoto = useTourPaso('coto', borrador.includes('coto'));
  const refTope = useTourPaso('tope-elegido', topeBorrador !== topeInicialRef.current);
  // `cumplido` siempre en `false`: este paso se completa con `avanzarTour('listo')` imperativo
  // dentro de `cerrarYConfirmar` (arriba), no con una condición — para cuando se cumple, la
  // hoja ya se está desmontando. El hook igual sirve para registrar el target a medir.
  const refListo = useTourPaso('listo', false);

  if (!visible) return null;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={cerrarYConfirmar}
        accessibilityLabel="Cerrar"
        accessibilityRole="button"
      >
        <Animated.View
          style={[styles.scrim, { opacity: translateY.interpolate({
            inputRange: [0, ALTURA_OFFSCREEN],
            outputRange: [1, 0],
            extrapolate: 'clamp',
          }) }]}
        />
      </Pressable>

      <Animated.View style={[styles.hoja, { transform: [{ translateY }] }]}>
        <View {...panResponder.panHandlers} style={styles.zonaArrastre}>
          <View style={styles.barraArrastre} />
          <View style={styles.encabezado}>
            <Text style={[styles.titulo, styles.sinSeleccionTexto]}>Qué supers comparar</Text>
            <Text style={[styles.bajada, textoPretty, styles.sinSeleccionTexto]}>
              Los que dejes afuera no aparecen en resultados ni en el plan de compra.
            </Text>
          </View>
          {ORDEN_SUPERS.length > UMBRAL_BUSQUEDA ? (
            <TextInput
              value={busqueda}
              onChangeText={setBusqueda}
              placeholder="Buscar supermercado"
              placeholderTextColor="#565E67"
              style={styles.inputBusqueda}
              autoCorrect={false}
              autoCapitalize="none"
              accessibilityLabel="Buscar supermercado"
            />
          ) : null}
        </View>

        {borrador.length > 1 ? (
          <View ref={refTope}>
            <BloqueTope
              n={borrador.length}
              topeBorrador={topeBorrador}
              onCambiarTope={setTopeBorrador}
              monto={montoTope}
              carritoVacio={pedido.length === 0}
            />
          </View>
        ) : null}

        <View style={styles.contenedorLista}>
          <ScrollView style={styles.lista} contentContainerStyle={styles.listaContenido}>
            {comparando.length > 0 ? (
              <View style={styles.grupo}>
                <Text style={styles.labelGrupo}>COMPARANDO</Text>
                {comparando.map((key, i) => (
                  <React.Fragment key={key}>
                    {i > 0 ? <View style={styles.separador} /> : null}
                    <FilaSuper
                      superKey={key}
                      activo
                      onPress={() => toggle(key)}
                      tourRef={key === 'coto' ? refCoto : undefined}
                    />
                  </React.Fragment>
                ))}
              </View>
            ) : null}

            {afuera.length > 0 ? (
              <View style={styles.grupo}>
                <Text style={styles.labelGrupo}>AFUERA</Text>
                {afuera.map((key, i) => (
                  <React.Fragment key={key}>
                    {i > 0 ? <View style={styles.separador} /> : null}
                    <FilaSuper
                      superKey={key}
                      activo={false}
                      onPress={() => toggle(key)}
                      tourRef={key === 'coto' ? refCoto : undefined}
                    />
                  </React.Fragment>
                ))}
              </View>
            ) : null}
          </ScrollView>
          {arrastrando ? <View style={StyleSheet.absoluteFill} /> : null}
        </View>

        <Pressable ref={refListo} onPress={cerrarYConfirmar} accessibilityRole="button" style={styles.botonListo}>
          <Text style={styles.textoBotonListo}>Listo</Text>
        </Pressable>
      </Animated.View>
    </View>
  );
}

function FilaSuper({
  superKey, activo, onPress, tourRef,
}: {
  superKey: SuperKey;
  activo: boolean;
  onPress: () => void;
  /** Solo lo pasa el tour, y solo para la fila de Coto (ver más arriba). */
  tourRef?: React.RefObject<View | null>;
}) {
  return (
    <Pressable
      ref={tourRef}
      onPress={onPress}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: activo }}
      accessibilityLabel={`${NOMBRE_SUPER[superKey]}, ${activo ? 'comparando' : 'afuera'}`}
      style={styles.fila}
    >
      <View style={[styles.checkbox, activo ? styles.checkboxTildado : styles.checkboxVacio]}>
        {activo ? <Text style={styles.check}>✓</Text> : null}
      </View>
      <View style={[styles.barraColorFila, { backgroundColor: paletaDe('light').supers[superKey] }]} />
      <PlacaLogoSuper superKey={superKey} ancho={54} alto={22} padding={2} radio={5} />
      <Text style={[texto.cuerpoMedio, styles.nombreFila]} numberOfLines={1}>{NOMBRE_SUPER[superKey]}</Text>
    </Pressable>
  );
}

/** Segmentado "1 / 2 / ... / Los N" + la línea que dice cuánto cuesta el tope elegido. Vive
 *  entre el título de la hoja y el grupo "COMPARANDO" — cambia el resultado del cálculo, no es
 *  una preferencia de vista, por eso no va mezclado con la lista de supers. */
function BloqueTope({
  n, topeBorrador, onCambiarTope, monto, carritoVacio,
}: {
  n: number;
  topeBorrador: number;
  onCambiarTope: (tope: number) => void;
  monto: number | null;
  carritoVacio: boolean;
}) {
  // 0 = sentinel de "Los N" — ver normalizarTope más arriba en este archivo.
  const opciones = [...Array.from({ length: n - 1 }, (_, i) => i + 1), 0];

  return (
    <View style={styles.bloqueTope}>
      <Text style={styles.labelGrupo}>CUÁNTOS QUERÉS VISITAR COMO MÁXIMO?</Text>
      <View style={styles.filaTope}>
        {opciones.map(valor => {
          const seleccionado = valor === topeBorrador;
          return (
            <Pressable
              key={valor}
              onPress={() => onCambiarTope(valor)}
              accessibilityRole="button"
              accessibilityState={{ selected: seleccionado }}
              accessibilityLabel={
                valor === 0
                  ? `Los ${n} supers elegidos`
                  : `Como mucho ${valor} super${valor === 1 ? '' : 's'}`
              }
              style={[
                styles.opcionTope,
                valor === 0 ? styles.opcionTopeLosN : null,
                seleccionado ? styles.opcionTopeSeleccionada : styles.opcionTopeNoSeleccionada,
              ]}
            >
              <Text style={seleccionado ? styles.textoOpcionTopeSeleccionada : styles.textoOpcionTope}>
                {valor === 0 ? `Los ${n}` : valor}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <LineaCostoTope n={n} tope={topeBorrador} monto={monto} carritoVacio={carritoVacio} />
    </View>
  );
}

function LineaCostoTope({
  n, tope, monto, carritoVacio,
}: { n: number; tope: number; monto: number | null; carritoVacio: boolean }) {
  if (tope === 0) {
    return (
      <Text style={[styles.lineaCosto, textoPretty]}>Estás comparando los {n} supers elegidos.</Text>
    );
  }
  // Sin carrito no hay nada que comparar (la hoja se abre hoy desde Buscar, donde puede no
  // haber nada agregado todavía) — y `monto === null` también cubre "todavía no llegó la
  // respuesta"/"falló": en ningún caso hay un spinner, la línea directamente "aparece".
  if (carritoVacio || monto === null) return null;
  if (monto === 0) {
    return (
      <Text style={[styles.lineaCosto, textoPretty]}>
        Con {tope} supers ahorrás lo mismo que visitando los {n}.
      </Text>
    );
  }
  return (
    <Text style={[styles.lineaCosto, textoPretty]}>
      Con {tope} supers pagás <Text style={styles.montoLineaCosto}>{pesosCorto(monto)}</Text>
      {' '}mas que visitando los {n}, pero hacés {tope} de {n} viajes.
    </Text>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: 'rgba(0,0,0,.55)' },
  hoja: {
    position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: '85%',
    backgroundColor: '#FFFFFF', borderTopLeftRadius: radio.pantalla, borderTopRightRadius: radio.pantalla,
    paddingTop: 18, paddingHorizontal: espacio.pantalla, paddingBottom: 24, gap: espacio.lg,
  },
  // `userSelect: 'none'` (web): sin esto, arrastrar desde el título dispara selección de
  // texto del navegador en vez del gesto de cierre — en iOS/Android nativo no hace nada.
  zonaArrastre: { userSelect: 'none' },
  sinSeleccionTexto: { userSelect: 'none' },
  barraArrastre: {
    width: 38, height: 4, borderRadius: radio.pill, backgroundColor: '#C6CCD3', alignSelf: 'center',
    marginBottom: espacio.md,
  },
  encabezado: { gap: 4 },
  titulo: { fontFamily: fuentes.titulo, fontSize: 20, lineHeight: 24, color: '#14161A' },
  bajada: { fontFamily: fuentes.cuerpo, fontSize: 14, lineHeight: 20, color: '#3C444D' },
  inputBusqueda: {
    height: 44, borderRadius: radio.md, paddingHorizontal: espacio.md, marginTop: espacio.md,
    fontFamily: fuentes.cuerpo, fontSize: 15, lineHeight: 21, color: '#14161A',
    boxShadow: 'inset 0 0 0 1px #C6CCD3', outlineWidth: 0, outlineStyle: 'none',
  },
  bloqueTope: { gap: 10, borderBottomWidth: 1, borderBottomColor: '#DFE3E7', paddingBottom: 18 },
  filaTope: { flexDirection: 'row', gap: 6 },
  opcionTope: { flex: 1, height: 44, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  opcionTopeLosN: { flex: 1.6 },
  opcionTopeNoSeleccionada: { boxShadow: 'inset 0 0 0 1px #C6CCD3' },
  opcionTopeSeleccionada: { backgroundColor: '#14161A' },
  textoOpcionTope: { fontFamily: fuentes.medio, fontSize: 15, color: '#14161A' },
  textoOpcionTopeSeleccionada: { fontFamily: fuentes.semi, fontSize: 15, color: '#FFFFFF' },
  lineaCosto: { fontFamily: fuentes.cuerpo, fontSize: 14, lineHeight: 20, color: '#3C444D' },
  montoLineaCosto: { fontFamily: fuentes.semi, fontSize: 14, lineHeight: 20, color: '#14161A' },
  contenedorLista: { position: 'relative', flex: 1, minHeight: 0 },
  lista: { flex: 1 },
  listaContenido: { gap: espacio.lg },
  grupo: { gap: espacio.sm },
  labelGrupo: {
    fontFamily: fuentes.semi, fontSize: 11, lineHeight: 14, letterSpacing: 1.2, color: '#565E67',
  },
  separador: { height: 1, backgroundColor: '#DFE3E7' },
  fila: {
    flexDirection: 'row', alignItems: 'center', gap: espacio.md, paddingVertical: 9,
  },
  checkbox: {
    width: 22, height: 22, borderRadius: 5, alignItems: 'center', justifyContent: 'center',
  },
  checkboxTildado: { backgroundColor: '#14161A' },
  checkboxVacio: { backgroundColor: 'transparent', boxShadow: 'inset 0 0 0 1.5px #14161A' },
  check: { color: '#FFFFFF', fontSize: 13, fontWeight: '700' },
  barraColorFila: { width: 24, height: 8, borderRadius: radio.pill },
  nombreFila: { flex: 1, color: '#14161A' },
  botonListo: {
    backgroundColor: '#14161A', borderRadius: radio.md, minHeight: 52,
    alignItems: 'center', justifyContent: 'center',
  },
  textoBotonListo: { fontFamily: fuentes.semi, fontSize: 16, color: '#FFFFFF' },
});
