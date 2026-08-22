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
import type { SuperKey } from '../api';
import { espacio, fuentes, paletaDe, radio, texto, textoPretty } from '../theme';
import { NOMBRE_SUPER, ORDEN_SUPERS } from './comunes';
import { PlacaLogoSuper } from './LogoSuper';

// Debajo de esto no hace falta buscador — se ve toda la lista de un vistazo (con los 7 supers
// de hoy, esto nunca se muestra; queda listo para cuando la lista crezca).
const UMBRAL_BUSQUEDA = 10;

const ALTURA_OFFSCREEN = Dimensions.get('window').height;
const UMBRAL_CIERRE_ARRASTRE = 120;

export function HojaSupers({
  visible, activos, onCerrar, onAplicar,
}: {
  visible: boolean;
  activos: SuperKey[];
  onCerrar: () => void;
  onAplicar: (keys: SuperKey[]) => void;
}) {
  const [borrador, setBorrador] = useState<SuperKey[]>(activos);
  const [busqueda, setBusqueda] = useState('');
  const [arrastrando, setArrastrando] = useState(false);
  const translateY = useRef(new Animated.Value(ALTURA_OFFSCREEN)).current;

  useEffect(() => {
    if (!visible) return;
    setBorrador(activos);
    setBusqueda('');
    translateY.setValue(ALTURA_OFFSCREEN);
    Animated.spring(translateY, { toValue: 0, useNativeDriver: true, bounciness: 4 }).start();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo al abrir, no en cada cambio de `activos`
  }, [visible]);

  const cerrarYConfirmar = () => {
    Animated.timing(translateY, {
      toValue: ALTURA_OFFSCREEN, duration: 220, useNativeDriver: true,
    }).start(() => {
      onAplicar(borrador);
      onCerrar();
      setArrastrando(false);
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

  const toggle = (key: SuperKey) => {
    setBorrador(prev => {
      if (prev.includes(key)) {
        if (prev.length === 1) return prev; // no se puede destildar el último activo
        return prev.filter(k => k !== key);
      }
      return [...prev, key];
    });
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

        <View style={styles.contenedorLista}>
          <ScrollView style={styles.lista} contentContainerStyle={styles.listaContenido}>
            {comparando.length > 0 ? (
              <View style={styles.grupo}>
                <Text style={styles.labelGrupo}>COMPARANDO</Text>
                {comparando.map((key, i) => (
                  <React.Fragment key={key}>
                    {i > 0 ? <View style={styles.separador} /> : null}
                    <FilaSuper superKey={key} activo onPress={() => toggle(key)} />
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
                    <FilaSuper superKey={key} activo={false} onPress={() => toggle(key)} />
                  </React.Fragment>
                ))}
              </View>
            ) : null}
          </ScrollView>
          {arrastrando ? <View style={StyleSheet.absoluteFill} /> : null}
        </View>

        <Pressable onPress={cerrarYConfirmar} accessibilityRole="button" style={styles.botonListo}>
          <Text style={styles.textoBotonListo}>Listo</Text>
        </Pressable>
      </Animated.View>
    </View>
  );
}

function FilaSuper({
  superKey, activo, onPress,
}: { superKey: SuperKey; activo: boolean; onPress: () => void }) {
  return (
    <Pressable
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
  contenedorLista: { position: 'relative' },
  lista: { flexGrow: 0 },
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
