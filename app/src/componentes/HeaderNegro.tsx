/**
 * Header negro del rediseño v2: bloque `tinta` a sangre en el tope de cada pantalla principal
 * (Buscar, Carrito, Resultado). Reemplaza el título sobre fondo gris de la versión anterior.
 * Cada pantalla arma su propio contenido adentro (buscador, totales, etc.) — esto solo pone
 * el fondo, el padding y el título en Barlow Condensed mayúscula.
 */

import React from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import type { SuperKey } from '../api';
import { espacio, fuentes, texto } from '../theme';
import { useTema } from '../useTema';
import { NOMBRE_SUPER, ORDEN_SUPERS } from './comunes';

/**
 * Colores de super sobre el header negro, siempre oscuro lleve el sistema el tema que lleve
 * (ver comentario de `HeaderNegro` y el de `textoMutedOscuro` en resultado.tsx). Son variantes
 * claras fijas, no `paleta.supers`: esas son para fondo blanco y no contrastan lo suficiente
 * sobre `tinta` (ver EDICIONES-contraste-y-selector.md § 2.2).
 */
const SUPERS_SOBRE_OSCURO: Record<SuperKey, string> = {
  vea: '#2EA35C', carr: '#4C8DF6', changomas: '#A66FE0', dia: '#FFFFFF', coto: '#F0576A',
  // Jumbo/Disco no comparten hue con nadie más (a diferencia de Día/Coto), así que reusan
  // directamente la variante oscura de theme.ts en vez de necesitar una tercera tonalidad.
  jumbo: '#F2894D', disco: '#4DD0DA',
};

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

/**
 * Selector de supers, legible como control (turno 7, ver EDICIONES-contraste-y-selector.md
 * § 2): línea de encabezado que dice qué hace el toque, y cinco celdas tocables — activa con
 * fondo y barra llena, apagada con borde punteado y nombre tachado. Antes eran cinco barritas
 * sueltas con el nombre debajo, que se leían como leyenda y no como control.
 *
 * `sobreOscuro`: variante para dentro del header negro (la única en uso hoy, ver Buscar) vs.
 * variante sobre fondo claro. La línea de encabezado es específica del header oscuro — no
 * tiene equivalente diseñado sobre claro — así que solo se muestra en esa variante.
 */
export function BarraSupers({
  activos, onToggle, sobreOscuro = true,
}: { activos: SuperKey[]; onToggle: (key: SuperKey) => void; sobreOscuro?: boolean }) {
  const { paleta } = useTema();

  return (
    <View style={{ gap: 10 }}>
      {sobreOscuro ? (
        <View style={styles.filaEncabezadoSelector}>
          <Text style={styles.tituloComparando}>
            COMPARANDO {activos.length} DE {ORDEN_SUPERS.length} SUPERS
          </Text>
          <View style={styles.divisorEncabezadoSelector} />
          <Text style={styles.ayudaSelector}>tocá para sacar uno</Text>
        </View>
      ) : null}

      <View style={styles.barraSupers} accessibilityRole="none">
        {ORDEN_SUPERS.map(key => {
          const activo = activos.includes(key);
          const bordeIdentidad = (paleta.supersBorde as Partial<Record<SuperKey, string>>)[key];
          const colorSuper = sobreOscuro ? SUPERS_SOBRE_OSCURO[key] : paleta.supers[key];

          return (
            <Pressable
              key={key}
              onPress={() => onToggle(key)}
              hitSlop={{ top: 8, bottom: 8 }}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: activo, selected: activo }}
              accessibilityLabel={`${NOMBRE_SUPER[key]}, ${activo ? 'comparando' : 'sin comparar'}`}
              style={[
                styles.celdaSuper,
                sobreOscuro
                  ? (activo
                      ? { backgroundColor: 'rgba(255,255,255,.1)' }
                      : { borderWidth: 1, borderStyle: 'dashed', borderColor: 'rgba(255,255,255,.35)' })
                  : (activo
                      ? { backgroundColor: paleta.superficieAlt }
                      : { borderWidth: 1, borderStyle: 'dashed', borderColor: paleta.borde }),
              ]}
            >
              <View
                style={[
                  styles.barritaSuper,
                  activo
                    ? {
                        backgroundColor: colorSuper,
                        ...(bordeIdentidad ? { borderWidth: 1, borderColor: bordeIdentidad } : null),
                      }
                    : {
                        backgroundColor: 'transparent',
                        borderWidth: 1,
                        borderColor: sobreOscuro ? 'rgba(255,255,255,.4)' : paleta.bordeFuerte,
                      },
                ]}
              />
              <Text
                style={[
                  texto.microSuper,
                  activo
                    ? { fontFamily: fuentes.semi, color: sobreOscuro ? '#FFFFFF' : paleta.tinta }
                    : {
                        color: sobreOscuro ? '#C6CCD3' : paleta.tintaSuave,
                        textDecorationLine: 'line-through',
                      },
                ]}
                numberOfLines={1}
              >
                {NOMBRE_SUPER[key]}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: espacio.pantalla, paddingBottom: espacio.pantalla, gap: espacio.md },
  filaEncabezadoSelector: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  tituloComparando: {
    fontFamily: fuentes.semi, fontSize: 11, lineHeight: 14, letterSpacing: 1.2, color: '#FFFFFF',
  },
  divisorEncabezadoSelector: { flex: 1, height: 1, backgroundColor: 'rgba(255,255,255,.18)' },
  ayudaSelector: { fontFamily: fuentes.cuerpo, fontSize: 12, lineHeight: 16, color: '#C6CCD3' },
  barraSupers: { flexDirection: 'row', gap: 6 },
  celdaSuper: {
    flex: 1, alignItems: 'center', gap: 7, borderRadius: 8,
    paddingTop: 8, paddingHorizontal: 4, paddingBottom: 7,
  },
  barritaSuper: { width: '100%', height: 6, borderRadius: 999 },
});
