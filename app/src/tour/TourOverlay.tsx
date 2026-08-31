/**
 * Capa visual del tour: 4 bloqueadores opacos alrededor del target actual (arriba/abajo/
 * izquierda/derecha) + el recorte del medio sin overlay (el toque real llega directo al
 * elemento real, no se envuelve en nada) + el cartel de instrucción + "Salir", siempre visible.
 *
 * La medición reintenta en cada frame durante una ventana corta después de cada cambio de
 * paso, no solo una vez: esto cubre tanto el caso general (nodo recién montado, 0×0 hasta que
 * el layout corre) como el caso de HojaSupers, que anima su entrada con `Animated.spring` — acá
 * no hace falta escuchar el fin de esa animación, el spotlight simplemente sigue midiendo y
 * "viaja" con el target mientras se termina de mover.
 */

import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { espacio, fuentes, radio } from '../theme';
import { PASOS } from './pasos';
import { refDeTarget, salirTour, tourAltoTabBar, useEstadoTour } from './TourContext';

type Rect = { x: number; y: number; width: number; height: number };

// Índice de la pestaña "Descuentos" en la barra inferior (ver app/(tabs)/_layout.tsx: Buscar,
// Carrito, Descuentos, Ahorros, Ajustes) y su alto de referencia si todavía no llegó el valor
// real reportado por la pantalla Buscar (ver `tourReportarAltoTabBar` en index.tsx).
const INDICE_TAB_DESCUENTOS = 2;
const CANTIDAD_TABS = 5;
const ALTO_TAB_BAR_FALLBACK = 56;

const PADDING_RECORTE = 8;
const RADIO_RECORTE = 14;
const MAX_INTENTOS_MEDICION = 90; // ~1.5s a 60fps

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

  useEffect(() => {
    if (!pasoActivo) {
      setRect(null);
      return;
    }
    const idPaso = pasoActivo;
    let cancelado = false;
    let intentos = 0;

    async function ciclo() {
      if (cancelado) return;
      if (idPaso === 'tab-descuentos') {
        const altoTabBar = tourAltoTabBar() ?? ALTO_TAB_BAR_FALLBACK + insets.bottom;
        const anchoTab = anchoVentana / CANTIDAD_TABS;
        if (!cancelado) {
          setRect({
            x: anchoTab * INDICE_TAB_DESCUENTOS,
            y: altoVentana - altoTabBar,
            width: anchoTab,
            height: altoTabBar,
          });
        }
        return; // calculado, no depende de medir ningún nodo
      }
      const medido = await medirNodo(refDeTarget(idPaso)?.current);
      if (cancelado) return;
      if (medido) setRect(medido);
      intentos++;
      if (intentos < MAX_INTENTOS_MEDICION) requestAnimationFrame(ciclo);
    }

    setRect(null);
    requestAnimationFrame(ciclo);
    return () => {
      cancelado = true;
    };
  }, [pasoActivo, anchoVentana, altoVentana, insets.bottom]);

  if (!activo || !pasoActivo || !rect) return null;

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
            left: recorte.x, top: recorte.y, width: recorte.width, height: recorte.height,
          },
        ]}
      />

      <View
        style={[
          styles.cartelContenedor,
          targetEnMitadInferior
            ? { top: insets.top + espacio.lg }
            : { bottom: insets.bottom + espacio.lg },
        ]}
      >
        <View style={styles.cartel}>
          <Text style={styles.textoCartel}>{PASOS[pasoActivo].texto}</Text>
          <Pressable onPress={salirTour} accessibilityRole="button" style={styles.botonSalir}>
            <Text style={styles.textoSalir}>Salir del tutorial</Text>
          </Pressable>
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
  bloqueador: { position: 'absolute', backgroundColor: 'rgba(11,18,32,.62)' },
  marcoRecorte: {
    position: 'absolute', borderRadius: RADIO_RECORTE, borderWidth: 2, borderColor: '#FFD400',
  },
  cartelContenedor: { position: 'absolute', left: espacio.pantalla, right: espacio.pantalla },
  cartel: {
    backgroundColor: '#FFFFFF', borderRadius: radio.tarjeta, padding: espacio.lg, gap: espacio.md,
    boxShadow: '0 4px 20px rgba(11,18,32,.25)',
  },
  textoCartel: { fontFamily: fuentes.medio, fontSize: 16, lineHeight: 22, color: '#14161A' },
  botonSalir: { alignSelf: 'flex-start' },
  textoSalir: {
    fontFamily: fuentes.medio, fontSize: 13, lineHeight: 18, color: '#565E67',
    textDecorationLine: 'underline',
  },
});
