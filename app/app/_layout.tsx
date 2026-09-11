/**
 * Raíz de la app: carga de fuentes, providers y navegación.
 *
 * Las fuentes se cargan en runtime con useFonts (expo-font). El splash nativo (logo + "Super
 * App" sobre fondo blanco, configurado en app.json vía expo-splash-screen) se queda en
 * pantalla hasta que las fuentes están listas, así se evita tanto la pantalla en blanco del
 * arranque nativo como el parpadeo de texto con la fuente del sistema reemplazándose por la
 * definitiva.
 */

import {
  Archivo_400Regular, Archivo_500Medium, Archivo_600SemiBold, Archivo_700Bold,
} from '@expo-google-fonts/archivo';
import {
  BarlowCondensed_600SemiBold, BarlowCondensed_700Bold,
} from '@expo-google-fonts/barlow-condensed';
import { IBMPlexMono_400Regular } from '@expo-google-fonts/ibm-plex-mono';
import { Analytics } from '@vercel/analytics/react';
import { SpeedInsights } from '@vercel/speed-insights/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useFonts } from 'expo-font';
import { Image } from 'expo-image';
import { Stack } from 'expo-router';
import Head from 'expo-router/head';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import React from 'react';
import { Platform, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider } from '../src/auth';
import { ProveedorCarrito } from '../src/carrito';
import { ProveedorCarritosGuardados } from '../src/carritosGuardados';
import { GatePaywallFinTrial } from '../src/componentes/GatePaywallFinTrial';
import { GateSesion } from '../src/componentes/GateSesion';
import { ProveedorFiltrosSupers } from '../src/filtrosSupers';
import { ProveedorHistorialAhorro } from '../src/historialAhorro';
import { texto } from '../src/theme';
import { TourOverlay } from '../src/tour/TourOverlay';
import { useTema } from '../src/useTema';

SplashScreen.preventAutoHideAsync();

// "Cannot find single active touch." es un console.error interno de react-native-web (bookkeeping
// de touches al soltar un gesto de pinch en la grilla de promos, ResponderTouchHistoryStore.js),
// envuelto en `if (__DEV__)` en la librería misma — no existe en producción, no rompe nada, es
// solo un log de diagnóstico. En dev, Metro intercepta cualquier console.error y lo muestra como
// pantalla roja de error, así que sin este filtro un pinch inofensivo se ve como un crash. Filtra
// SOLO este mensaje puntual, cualquier otro error sigue mostrándose normal.
if (Platform.OS === 'web') {
  const consoleErrorOriginal = console.error;
  console.error = (...args) => {
    if (typeof args[0] === 'string' && args[0].includes('Cannot find single active touch')) return;
    consoleErrorOriginal(...args);
  };
}

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

  React.useEffect(() => {
    if (fuentesListas) {
      SplashScreen.hideAsync();
    }
  }, [fuentesListas]);

  // <Head> va afuera del guard de fuentes: si solo estuviera en la rama ya cargada, el
  // export estático (que renderiza antes de que useFonts resuelva) horneaba un <title> vacío.
  // Mismo logo e imageWidth que el splash nativo (app.json § expo-splash-screen): en una
  // pestaña de navegador normal (sin agregar la app a la pantalla de inicio) el sistema
  // operativo no dibuja ningún splash — antes esta rama se quedaba en blanco liso mientras
  // cargaban las fuentes, ahora los tres casos (nativo, acceso directo iOS, pestaña normal)
  // muestran lo mismo.
  if (!fuentesListas) {
    return (
      <>
        <Head><title>Super App</title></Head>
        <View style={{ flex: 1, backgroundColor: paleta.fondo, alignItems: 'center', justifyContent: 'center' }}>
          <Image
            source={require('../assets/splash-icon.png')}
            style={{ width: 220, aspectRatio: 990 / 834 }}
            contentFit="contain"
          />
        </View>
      </>
    );
  }

  return (
    <QueryClientProvider client={cliente}>
      <SafeAreaProvider>
        <AuthProvider>
          <ProveedorFiltrosSupers>
            <ProveedorCarrito>
              <ProveedorCarritosGuardados>
                <ProveedorHistorialAhorro>
                  <Head><title>Super App</title></Head>
                  <StatusBar style={esquema === 'dark' ? 'light' : 'dark'} />
                  {/* GateSesion envuelve solo la navegación, no los providers de arriba: así,
                      si alguien ya tenía carrito/tarjetas locales de antes de este gate, la
                      transición anónimo→logueado la sigue viendo `useSincronizacionPersistente`
                      (que necesita que el provider no se remonte al loguearse) y migra los
                      datos igual que en Fase 1 — moverlos adentro del gate rompería eso. */}
                  <GateSesion>
                    {/* Adentro de GateSesion: para cuando esto se evalúa ya hay sesión, así
                        que solo decide si el usuario logueado tiene que ver el paywall de fin
                        de trial en vez de la navegación (ver GatePaywallFinTrial.tsx). */}
                    <GatePaywallFinTrial>
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
                        {/* Estas 4 pantallas dibujan su propio header negro (HeaderNegro o
                            equivalente a mano) con flecha de volver incluida — sin
                            headerShown:false quedaba también el header nativo (barra blanca)
                            superpuesto, y su botón de volver invisible se comía los toques del
                            header negro (en seguir-producto, tocar el medio del header cerraba
                            el buscador por navegar atrás sin querer). */}
                        <Stack.Screen name="mis-ahorros" options={{ headerShown: false, presentation: 'card' }} />
                        <Stack.Screen name="datos-personales" options={{ headerShown: false, presentation: 'card' }} />
                        <Stack.Screen name="ayuda" options={{ headerShown: false, presentation: 'card' }} />
                        <Stack.Screen name="seguir-producto" options={{ headerShown: false, presentation: 'card' }} />
                        {/* El header nativo (flecha + título) queda visible a propósito acá,
                            a diferencia de resultado: sin "title" mostraba el nombre del
                            archivo tal cual ("plan-y-pago"). Dice "Ajustes" porque es adonde
                            vuelve la flecha, no el nombre de esta pantalla. */}
                        <Stack.Screen
                          name="plan-y-pago"
                          options={{ title: 'Ajustes', presentation: 'card' }}
                        />
                      </Stack>
                      {/* Hermano del Stack, no dentro de una screen: así sobrevive la
                          navegación entre tabs y hacia /resultado sin remontarse. */}
                      <TourOverlay />
                    </GatePaywallFinTrial>
                  </GateSesion>
                  {/* @vercel/analytics y speed-insights manipulan document.head — no existen en iOS/Android */}
                  {Platform.OS === 'web' ? <Analytics /> : null}
                  {Platform.OS === 'web' ? <SpeedInsights /> : null}
                </ProveedorHistorialAhorro>
              </ProveedorCarritosGuardados>
            </ProveedorCarrito>
          </ProveedorFiltrosSupers>
        </AuthProvider>
      </SafeAreaProvider>
    </QueryClientProvider>
  );
}
