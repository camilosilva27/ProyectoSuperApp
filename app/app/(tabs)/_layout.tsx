/**
 * Cinco pestañas: buscar productos, ver la lista, Mis descuentos, Alertas, y Ajustes. El
 * resultado no es una pestaña — es la consecuencia de una acción ("Comparar precios"), así que
 * se abre apilado encima.
 *
 * "Mis descuentos" vivía como una fila dentro de Ajustes (una pantalla apilada, abierta con
 * router.push) y pasó a ser su propia pestaña: es algo que se consulta y toca seguido (activar/
 * desactivar tarjetas antes de comparar), no una preferencia de una sola vez como el resto de
 * Ajustes.
 *
 * El contador de la pestaña "Carrito" muestra unidades, no productos distintos: es lo que
 * el usuario está por comparar.
 *
 * "Alertas" (diseño 20a-20g, Claude Design turno 20, 2026-09-10) reemplaza a "Ahorros" en este
 * lugar de la barra: seguir productos/categorías puntuales para recibir aviso cuando les
 * aparece una promo. "Ahorros" no desapareció, se mudó a ser una fila dentro de Ajustes (ver
 * ajustes.tsx) — es una consulta ocasional, no algo que se toque tan seguido como para merecer
 * su propia pestaña, a diferencia de Alertas.
 */

import { Tabs } from 'expo-router';
import React from 'react';
import { Platform, StyleSheet, Text, View, type ColorValue } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
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
          // Sin esto, las barras CTA "flotantes" de Buscar/Carrito (position:absolute
          // dentro de cada pantalla) podían pintarse por encima de las pestañas: nada
          // fijaba el orden de stacking entre ellas.
          zIndex: 10,
          elevation: 10,
          // En nativo, React Navigation ya suma insets.bottom (home indicator/curvatura)
          // a la altura y el padding de la tab bar. En web (react-native-web) ese cálculo
          // no corre — ahí depende de env(safe-area-inset-bottom), que solo existe si el
          // viewport tiene viewport-fit=cover (ver app/+html.tsx). Sin esto la tab bar
          // queda pegada al borde curvo de los iPhone nuevos en Safari/PWA.
          ...(Platform.OS === 'web'
            ? {
                height: 'calc(49px + env(safe-area-inset-bottom, 0px))' as unknown as number,
                paddingBottom: 'env(safe-area-inset-bottom, 0px)' as unknown as number,
              }
            : null),
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
        name="mis-descuentos"
        options={{
          title: 'Descuentos',
          tabBarIcon: ({ color }) => <IconoDescuentos color={color} />,
        }}
      />
      <Tabs.Screen
        name="alertas"
        options={{
          title: 'Alertas',
          tabBarIcon: ({ color }) => <IconoAlertas color={color} />,
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

// Etiqueta de precio (a pedido del usuario, parecida al ícono "tag" de Lucide): a diferencia
// del resto de los íconos de esta pantalla (Views con bordes/transforms), esta forma con una
// punta real no se puede armar con esos trucos — SVG con un path, ya es dependencia del proyecto
// (ver LogoBanco.tsx/LogoSuper.tsx).
function IconoDescuentos({ color }: { color: ColorValue }) {
  return (
    <View style={styles.icono}>
      <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
        <Path
          d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"
          stroke={color}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <Circle cx={7.5} cy={7.5} r={1.25} fill={color} />
      </Svg>
    </View>
  );
}

// Campana, mismo trazo 2px que el resto de los íconos de esta barra (diseño 20, sección t20).
function IconoAlertas({ color }: { color: ColorValue }) {
  return (
    <View style={styles.icono}>
      <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
        <Path
          d="M18.5 16.5V10.5a6.5 6.5 0 00-13 0v6L4 19h16l-1.5-2.5z"
          stroke={color}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <Path d="M9.8 19a2.2 2.2 0 004.4 0" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      </Svg>
    </View>
  );
}

// Engranaje clásico: 8 dientes en el mismo truco de rotate+translateY que ya usa lupaMango
// (cada diente nace centrado en el ícono y el translateY lo empuja hacia afuera sobre su
// propio eje ya rotado), más un aro con hueco en vez de un círculo relleno.
const DIENTES_ANGULOS = [0, 45, 90, 135, 180, 225, 270, 315];

function IconoAjustes({ color }: { color: ColorValue }) {
  return (
    <View style={styles.icono}>
      {DIENTES_ANGULOS.map(angulo => (
        <View
          key={angulo}
          style={[
            styles.diente,
            { backgroundColor: color, transform: [{ rotate: `${angulo}deg` }, { translateY: -8 }] },
          ]}
        />
      ))}
      <View style={[styles.aroEngranaje, { borderColor: color }]} />
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
  linea: { height: 2, borderRadius: 1 },
  diente: {
    position: 'absolute', width: 3, height: 7, borderRadius: 1,
    top: 8.5, left: 10.5,
  },
  aroEngranaje: {
    position: 'absolute', width: 13, height: 13, borderRadius: radio.pill,
    borderWidth: 2.5, top: 5.5, left: 5.5,
  },
  globo: {
    position: 'absolute', top: -4, right: -6, minWidth: 16, height: 16,
    borderRadius: radio.pill, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 3,
  },
});
