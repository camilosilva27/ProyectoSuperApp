/**
 * Página 404: cualquier ruta que no exista (typo en la URL, link viejo, etc.) cae acá en vez
 * de la pantalla en blanco default de Expo Router. Mismo lenguaje visual que el resto de la
 * app — header negro + `Vacio` (ver comunes.tsx: "una invitación a actuar, no un cartel de
 * error") — para que no se lea como una página de error genérica de otro sitio.
 */

import { useRouter } from 'expo-router';
import Head from 'expo-router/head';
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BotonPrincipal, Vacio } from '../src/componentes/comunes';
import { HeaderNegro, TituloHeader } from '../src/componentes/HeaderNegro';
import { espacio } from '../src/theme';
import { useTema } from '../src/useTema';

export default function PantallaNoEncontrada() {
  const { paleta } = useTema();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  return (
    <View style={[styles.pantalla, { backgroundColor: paleta.fondo }]}>
      <Head><title>Página no encontrada - Super App</title></Head>
      <HeaderNegro paddingTop={insets.top + espacio.xl}>
        <TituloHeader>Esta página no existe</TituloHeader>
      </HeaderNegro>
      <View style={styles.cuerpo}>
        <Vacio
          titulo="No encontramos esto"
          detalle="El link puede estar roto o la página ya no existe. Volvé a Buscar para seguir comparando precios."
        />
        <BotonPrincipal onPress={() => router.replace('/')}>Volver a Buscar</BotonPrincipal>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  pantalla: { flex: 1 },
  cuerpo: { flex: 1, justifyContent: 'center', padding: espacio.pantalla, gap: espacio.lg },
});
