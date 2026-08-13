/**
 * Header negro del rediseño v2: bloque `tinta` a sangre en el tope de cada pantalla principal
 * (Buscar, Carrito, Resultado). Reemplaza el título sobre fondo gris de la versión anterior.
 * Cada pantalla arma su propio contenido adentro (buscador, totales, etc.) — esto solo pone
 * el fondo, el padding y el título en Barlow Condensed mayúscula.
 */

import React from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import type { SuperKey } from '../api';
import { espacio, texto } from '../theme';
import { useTema } from '../useTema';
import { NOMBRE_SUPER, ORDEN_SUPERS } from './comunes';

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
 * Cinco columnas iguales: una barra de 6px con el color del super, el nombre debajo. Filtra
 * (toca para prender/apagar) y enseña el código de color al mismo tiempo — por eso va antes
 * de los resultados, no en un menú (ver SPEC § 3.2).
 *
 * `sobreOscuro`: variante para dentro del header negro (texto blanco/gris claro, barra
 * inactiva `#3C444D`) vs. variante sobre fondo claro (texto tinta/gris, barra inactiva
 * `superficie2`). Día activo necesita su borde de contraste en las dos variantes.
 */
export function BarraSupers({
  activos, onToggle, sobreOscuro = true,
}: { activos: SuperKey[]; onToggle: (key: SuperKey) => void; sobreOscuro?: boolean }) {
  const { paleta } = useTema();

  return (
    <View style={styles.barraSupers} accessibilityRole="none">
      {ORDEN_SUPERS.map(key => {
        const activo = activos.includes(key);
        const bordeIdentidad = (paleta.supersBorde as Partial<Record<SuperKey, string>>)[key];
        const colorBarra = activo
          ? paleta.supers[key]
          : (sobreOscuro ? '#3C444D' : paleta.superficie2);
        const colorTexto = activo
          ? (sobreOscuro ? '#FFFFFF' : paleta.tinta)
          : (sobreOscuro ? '#727B85' : paleta.tintaTenue);

        return (
          <Pressable
            key={key}
            onPress={() => onToggle(key)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: activo }}
            accessibilityLabel={`${NOMBRE_SUPER[key]}, ${activo ? 'incluido' : 'excluido'} del filtro`}
            style={styles.columnaSuper}
          >
            <View
              style={[
                styles.barritaSuper,
                {
                  backgroundColor: colorBarra,
                  ...(activo && bordeIdentidad ? { borderWidth: 1, borderColor: bordeIdentidad } : null),
                },
              ]}
            />
            <Text style={[texto.microSuper, { color: colorTexto }]} numberOfLines={1}>
              {NOMBRE_SUPER[key]}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: espacio.pantalla, paddingBottom: espacio.pantalla, gap: espacio.md },
  barraSupers: { flexDirection: 'row', gap: 6 },
  columnaSuper: { flex: 1, alignItems: 'center', gap: 7 },
  barritaSuper: { width: '100%', height: 6, borderRadius: 999 },
});
