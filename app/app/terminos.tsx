/**
 * Pantalla "Términos de Servicio" — alcanzable con sesión activa (ej. desde Ajustes en el
 * futuro). Durante el registro (sin sesión todavía) se usa `ModalLegal` en cambio, ver su
 * comentario: acá no aplica porque esta pantalla vive en el `Stack` que `GateSesion.tsx` no
 * monta hasta que hay sesión. Contenido en `src/legal/contenidoLegal.ts`, compartido con
 * `ModalLegal` y espejo de .claude/docs/TERMINOS_DE_SERVICIO.md.
 */

import { useRouter } from 'expo-router';
import Head from 'expo-router/head';
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { HeaderNegro, TituloHeader } from '../src/componentes/HeaderNegro';
import { SECCIONES_TERMINOS } from '../src/legal/contenidoLegal';
import { espacio, texto } from '../src/theme';
import { useTema } from '../src/useTema';

export default function PantallaTerminos() {
  const { paleta } = useTema();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const volver = () => (router.canGoBack() ? router.back() : router.replace('/ajustes'));

  return (
    <View style={{ flex: 1, backgroundColor: paleta.fondo }}>
      <Head><title>Términos de Servicio - Super App</title></Head>
      <HeaderNegro paddingTop={insets.top + espacio.xl} estilo={{ gap: espacio.md }}>
        <Pressable onPress={volver} accessibilityRole="button" style={styles.filaVolver}>
          <Text style={styles.flechaVolver}>‹</Text>
          <Text style={[texto.micro, styles.labelVolver]}>VOLVER</Text>
        </Pressable>
        <TituloHeader>Términos de Servicio</TituloHeader>
      </HeaderNegro>

      <ScrollView contentContainerStyle={styles.cuerpo}>
        {SECCIONES_TERMINOS.map(seccion => (
          <View key={seccion.titulo} style={{ gap: espacio.xs }}>
            <Text style={[texto.subtitulo, { color: paleta.tinta }]}>{seccion.titulo}</Text>
            <Text style={[texto.cuerpo, { color: paleta.tintaProsa }]}>{seccion.cuerpo}</Text>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  filaVolver: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start' },
  flechaVolver: { fontSize: 22, color: '#FFFFFF' },
  labelVolver: { color: '#FFFFFF', opacity: 0.6, letterSpacing: 1.2 },
  cuerpo: { padding: espacio.pantalla, gap: espacio.lg },
});
