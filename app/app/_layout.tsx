/**
 * Raíz de la app: carga de fuentes, providers y navegación.
 *
 * Las fuentes se cargan en runtime con useFonts (expo-font). Hasta que estén listas se
 * muestra una pantalla del color de fondo del tema, no un spinner: evita el parpadeo de
 * texto con la fuente del sistema reemplazándose por la definitiva.
 */

import {
  Archivo_400Regular, Archivo_500Medium, Archivo_600SemiBold, Archivo_700Bold,
} from '@expo-google-fonts/archivo';
import {
  BarlowCondensed_600SemiBold, BarlowCondensed_700Bold,
} from '@expo-google-fonts/barlow-condensed';
import { IBMPlexMono_400Regular } from '@expo-google-fonts/ibm-plex-mono';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React from 'react';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ProveedorCarrito } from '../src/carrito';
import { ProveedorFiltrosSupers } from '../src/filtrosSupers';
import { texto } from '../src/theme';
import { useTema } from '../src/useTema';

const cliente = new QueryClient({
  defaultOptions: {
    queries: {
      // Los precios se piden en vivo bajo demanda (no con useQuery), así que el caché acá
      // aplica sobre el catálogo, que cambia una vez por día.
      staleTime: 5 * 60 * 1000,
      retry: 1,
    },
  },
});

export default function LayoutRaiz() {
  const { esquema, paleta } = useTema();
  const [fuentesListas] = useFonts({
    Archivo_400Regular,
    Archivo_500Medium,
    Archivo_600SemiBold,
    Archivo_700Bold,
    BarlowCondensed_600SemiBold,
    BarlowCondensed_700Bold,
    IBMPlexMono_400Regular,
  });

  if (!fuentesListas) {
    return <View style={{ flex: 1, backgroundColor: paleta.fondo }} />;
  }

  return (
    <QueryClientProvider client={cliente}>
      <SafeAreaProvider>
        <ProveedorFiltrosSupers>
          <ProveedorCarrito>
            <StatusBar style={esquema === 'dark' ? 'light' : 'dark'} />
            <Stack
              screenOptions={{
                contentStyle: { backgroundColor: paleta.fondo },
                headerStyle: { backgroundColor: paleta.fondo },
                headerShadowVisible: false,
                headerTintColor: paleta.tinta,
                headerTitleStyle: { ...texto.subtitulo, color: paleta.tinta },
              }}
            >
              <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
              <Stack.Screen
                name="resultado"
                options={{ headerShown: false, presentation: 'card' }}
              />
            </Stack>
          </ProveedorCarrito>
        </ProveedorFiltrosSupers>
      </SafeAreaProvider>
    </QueryClientProvider>
  );
}
