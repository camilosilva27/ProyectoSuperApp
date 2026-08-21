/**
 * Header negro del rediseño v2: bloque `tinta` a sangre en el tope de cada pantalla principal
 * (Buscar, Carrito, Resultado). Reemplaza el título sobre fondo gris de la versión anterior.
 * Cada pantalla arma su propio contenido adentro (buscador, totales, etc.) — esto solo pone
 * el fondo, el padding y el título en Barlow Condensed mayúscula.
 */

import React from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import type { SuperKey } from '../api';
import { espacio, fuentes, paletaDe, radio, texto, textoPretty } from '../theme';
import { useTema } from '../useTema';
import { NOMBRE_SUPER, ORDEN_SUPERS } from './comunes';
import { PlacaLogoSuper } from './LogoSuper';

export function HeaderNegro({
  children, paddingTop, estilo,
}: { children: React.ReactNode; paddingTop: number; estilo?: StyleProp<ViewStyle> }) {
  const { paleta } = useTema();
  return (
    <View style={[styles.header, { backgroundColor: paleta.tinta, paddingTop }, estilo]}>
      {children}
    </View>
  );
}

export function TituloHeader({ children }: { children: string }) {
  return <Text style={[texto.tituloHeader, { color: '#FFFFFF' }]}>{children}</Text>;
}

const MAX_CELDAS = 4;

/**
 * Selector de supers dentro del header negro (turno "selector + hoja de selección"). Solo
 * muestra celdas de los supers ACTIVOS (hasta `MAX_CELDAS`, los de más uso primero — ver
 * `usoPorSuper` en filtrosSupers.tsx); el resto — desactivados o activos que no entraron en la
 * fila — se resume en la celda "+N otros", que abre `HojaSupers`. El logo reemplaza al nombre
 * en la celda: a 10px el nombre era ilegible, y "Chango Más" se truncaba.
 */
export function SelectorSupers({
  activos, usoPorSuper, onQuitar, onAbrirHoja,
}: {
  activos: SuperKey[];
  usoPorSuper: Partial<Record<SuperKey, number>>;
  onQuitar: (key: SuperKey) => void;
  onAbrirHoja: () => void;
}) {
  const paletaOscura = paletaDe('dark');

  const activosPorUso = [...activos].sort((a, b) => {
    const diferencia = (usoPorSuper[b] ?? 0) - (usoPorSuper[a] ?? 0);
    return diferencia !== 0 ? diferencia : ORDEN_SUPERS.indexOf(a) - ORDEN_SUPERS.indexOf(b);
  });
  const mostrados = activosPorUso.slice(0, MAX_CELDAS);
  const cantidadOtros = ORDEN_SUPERS.length - mostrados.length;
  const inactivos = ORDEN_SUPERS.filter(key => !activos.includes(key));

  return (
    <View style={{ gap: 10 }}>
      <View style={styles.filaEncabezadoSelector}>
        <Text style={styles.tituloComparando}>
          COMPARANDO {activos.length} DE {ORDEN_SUPERS.length} SUPERS
        </Text>
        <View style={styles.divisorEncabezadoSelector} />
        <Text style={styles.ayudaSelector}>tocá para sacar</Text>
      </View>

      <View style={styles.filaCeldas} accessibilityRole="none">
        {mostrados.map(key => (
          <Pressable
            key={key}
            onPress={() => onQuitar(key)}
            hitSlop={{ top: 12, bottom: 12 }}
            accessibilityRole="button"
            accessibilityLabel={`${NOMBRE_SUPER[key]}, comparando. Tocá para sacar de la comparación`}
            style={styles.celdaSuper}
          >
            <View style={[styles.barraColorCelda, { backgroundColor: paletaOscura.supers[key] }]} />
            <PlacaLogoSuper superKey={key} ancho="100%" alto={30} padding={2} radio={4} />
          </Pressable>
        ))}

        {cantidadOtros > 0 ? (
          <Pressable
            onPress={onAbrirHoja}
            hitSlop={{ top: 12, bottom: 12 }}
            accessibilityRole="button"
            accessibilityLabel={`Ver los ${cantidadOtros} supers restantes y elegir cuáles comparar`}
            style={styles.celdaOtros}
          >
            <Text style={styles.numeroOtros}>+{cantidadOtros}</Text>
            <Text style={styles.etiquetaOtros}>otros</Text>
          </Pressable>
        ) : null}
      </View>

      {inactivos.length > 0 ? (
        <View style={styles.cierreSelector}>
          <Text style={[styles.textoCierre, textoPretty]}>
            {listaConY(inactivos.map(k => NOMBRE_SUPER[k]))} {inactivos.length === 1 ? 'está' : 'están'} afuera de la comparación.
          </Text>
        </View>
      ) : null}
    </View>
  );
}

/** "a, b y c" — sin Oxford comma, como se lee en español. */
function listaConY(nombres: string[]): string {
  if (nombres.length <= 1) return nombres.join('');
  return `${nombres.slice(0, -1).join(', ')} y ${nombres[nombres.length - 1]}`;
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: espacio.pantalla, paddingBottom: espacio.pantalla, gap: espacio.md },
  filaEncabezadoSelector: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  tituloComparando: {
    fontFamily: fuentes.semi, fontSize: 11, lineHeight: 14, letterSpacing: 1.2, color: '#FFFFFF',
  },
  divisorEncabezadoSelector: { flex: 1, height: 1, backgroundColor: 'rgba(255,255,255,.18)' },
  ayudaSelector: { fontFamily: fuentes.cuerpo, fontSize: 12, lineHeight: 16, color: '#C6CCD3' },
  filaCeldas: { flexDirection: 'row', gap: 6, alignItems: 'stretch' },
  celdaSuper: {
    flex: 1, minWidth: 0, backgroundColor: 'rgba(255,255,255,.1)', borderRadius: 8,
    paddingVertical: 8, paddingHorizontal: 5, alignItems: 'center', justifyContent: 'center', gap: 7,
  },
  barraColorCelda: { width: '100%', height: 5, borderRadius: radio.pill },
  celdaOtros: {
    flex: 0, width: 54, borderRadius: 8, alignItems: 'center', justifyContent: 'center', gap: 1,
    boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.35)',
  },
  numeroOtros: { fontFamily: fuentes.precio, fontSize: 22, lineHeight: 22, color: '#FFD400' },
  etiquetaOtros: { fontFamily: fuentes.medio, fontSize: 10, lineHeight: 12, color: '#C6CCD3' },
  cierreSelector: {
    borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,.18)', paddingTop: 12,
  },
  textoCierre: { fontFamily: fuentes.cuerpo, fontSize: 13, lineHeight: 18, color: '#C6CCD3' },
});
