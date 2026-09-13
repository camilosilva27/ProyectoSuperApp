/**
 * Stack anidado dentro del tab "Ajustes": a diferencia de antes (estas 4 pantallas vivían como
 * hermanas de "(tabs)" en el Stack raíz), estar anidadas bajo la propia Tabs navigator hace que
 * la tab bar siga visible al entrar a cualquiera de ellas — con el Stack raíz, navegar a una
 * screen hermana de "(tabs)" reemplazaba toda la navegación (tab bar incluida) por la card.
 *
 * Los screenOptions de estilo de header (headerStyle/headerTintColor/etc, usados solo por
 * "plan-y-pago", la única con header nativo) se repiten acá: este Stack no hereda los del Stack
 * raíz (`app/_layout.tsx`), son navegadores distintos.
 */

import { Stack } from 'expo-router';
import React from 'react';
import { texto } from '../../../src/theme';
import { useTema } from '../../../src/useTema';

export default function LayoutAjustes() {
  const { paleta } = useTema();

  return (
    <Stack
      screenOptions={{
        contentStyle: { backgroundColor: paleta.fondo },
        headerStyle: { backgroundColor: paleta.fondo },
        headerShadowVisible: false,
        headerTintColor: paleta.tinta,
        headerTitleStyle: { ...texto.subtitulo, color: paleta.tinta },
      }}
    >
      <Stack.Screen name="index" options={{ headerShown: false }} />
      {/* Las 4 pantallas de acá abajo comparten el header nativo (flecha + "Ajustes", adonde
          vuelve la flecha, no el nombre de la pantalla) — cada una dibuja su propio título
          adentro del cuerpo, como ya hacía "plan-y-pago". Sin "title" mostraba el nombre del
          archivo tal cual (ej. "mis-ahorros"). */}
      <Stack.Screen name="mis-ahorros" options={{ title: 'Ajustes', presentation: 'card' }} />
      <Stack.Screen name="datos-personales" options={{ title: 'Ajustes', presentation: 'card' }} />
      <Stack.Screen name="ayuda" options={{ title: 'Ajustes', presentation: 'card' }} />
      <Stack.Screen name="plan-y-pago" options={{ title: 'Ajustes', presentation: 'card' }} />
    </Stack>
  );
}
