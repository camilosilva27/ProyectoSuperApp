/**
 * Tres pestañas (rediseño v2 — antes eran dos): buscar productos, ver la lista, y Ajustes.
 * El resultado no es una pestaña — es la consecuencia de una acción ("Comparar precios"),
 * así que se abre apilado encima.
 *
 * El contador de la pestaña "Carrito" muestra unidades, no productos distintos: es lo que
 * el usuario está por comparar.
 */

import { Tabs } from 'expo-router';
import React from 'react';
import { StyleSheet, Text, View, type ColorValue } from 'react-native';
import { useCarrito } from '../../src/carrito';
import { radio, texto } from '../../src/theme';
import { useTema } from '../../src/useTema';

export default function LayoutPestanas() {
  const { paleta } = useTema();
  const { totalUnidades } = useCarrito();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: paleta.tinta,
        tabBarInactiveTintColor: paleta.tintaTenue,
        tabBarStyle: {
          backgroundColor: paleta.superficie,
          borderTopColor: paleta.borde,
        },
        tabBarLabelStyle: texto.micro,
        sceneStyle: { backgroundColor: paleta.fondo },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Buscar',
          tabBarIcon: ({ color }) => <IconoLupa color={color} />,
        }}
      />
      <Tabs.Screen
        name="carrito"
        options={{
          title: 'Carrito',
          tabBarIcon: ({ color }) => <IconoLista color={color} cantidad={totalUnidades} />,
        }}
      />
      <Tabs.Screen
        name="ajustes"
        options={{
          title: 'Ajustes',
          tabBarIcon: ({ color }) => <IconoAjustes color={color} />,
        }}
      />
    </Tabs>
  );
}

// Iconos dibujados con Views en vez de una librería de iconos: son dos formas simples y
// evita sumar una dependencia (y su peso) para esto.
function IconoLupa({ color }: { color: ColorValue }) {
  return (
    <View style={styles.icono}>
      <View style={[styles.lupaAro, { borderColor: color }]} />
      <View style={[styles.lupaMango, { backgroundColor: color }]} />
    </View>
  );
}

function IconoLista({ color, cantidad }: { color: ColorValue; cantidad: number }) {
  const { paleta } = useTema();
  return (
    <View style={styles.icono}>
      <View style={styles.lineas}>
        {[0, 1, 2].map(i => (
          <View key={i} style={[styles.linea, { backgroundColor: color, width: i === 2 ? 10 : 16 }]} />
        ))}
      </View>
      {cantidad > 0 ? (
        <View style={[styles.globo, { backgroundColor: paleta.oferta }]}>
          <Text style={[texto.micro, { color: paleta.ofertaTinta, fontSize: 9, letterSpacing: 0 }]}>
            {cantidad > 99 ? '99+' : cantidad}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function IconoAjustes({ color }: { color: ColorValue }) {
  return (
    <View style={styles.icono}>
      <View style={styles.lineasAjustes}>
        {[0, 1, 2].map(i => (
          <View key={i} style={[styles.linea, { backgroundColor: color, width: 18 }]} />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  icono: { width: 24, height: 24, alignItems: 'center', justifyContent: 'center' },
  lupaAro: { width: 14, height: 14, borderRadius: radio.pill, borderWidth: 2 },
  lupaMango: {
    position: 'absolute', width: 2, height: 7, borderRadius: 2,
    right: 4, bottom: 3, transform: [{ rotate: '-45deg' }],
  },
  lineas: { gap: 3 },
  lineasAjustes: { gap: 4, alignItems: 'center' },
  linea: { height: 2, borderRadius: 1 },
  globo: {
    position: 'absolute', top: -4, right: -6, minWidth: 16, height: 16,
    borderRadius: radio.pill, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 3,
  },
});
