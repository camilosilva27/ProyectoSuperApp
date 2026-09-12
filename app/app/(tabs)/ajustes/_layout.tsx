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
      {/* Estas 3 pantallas dibujan su propio header negro (HeaderNegro) con flecha de volver
          incluida — sin headerShown:false quedaba también el header nativo superpuesto (ver
          mismo comentario en el Stack raíz). */}
      <Stack.Screen name="mis-ahorros" options={{ headerShown: false, presentation: 'card' }} />
      <Stack.Screen name="datos-personales" options={{ headerShown: false, presentation: 'card' }} />
      <Stack.Screen name="ayuda" options={{ headerShown: false, presentation: 'card' }} />
      {/* El header nativo (flecha + título) queda visible a propósito acá, a diferencia de las
          otras 3: sin "title" mostraba el nombre del archivo tal cual ("plan-y-pago"). Dice
          "Ajustes" porque es adonde vuelve la flecha, no el nombre de esta pantalla. */}
      <Stack.Screen name="plan-y-pago" options={{ title: 'Ajustes', presentation: 'card' }} />
    </Stack>
  );
}
