/**
 * Pantalla "Política de Privacidad" — alcanzable con sesión activa (ver comentario equivalente
 * en terminos.tsx sobre por qué el registro sin sesión usa `ModalLegal` en cambio). Contenido en
 * `src/legal/contenidoLegal.ts`, espejo de .claude/docs/POLITICA_DE_PRIVACIDAD.md.
 */

import { useRouter } from 'expo-router';
import Head from 'expo-router/head';
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { HeaderNegro, TituloHeader } from '../src/componentes/HeaderNegro';
import { SECCIONES_PRIVACIDAD } from '../src/legal/contenidoLegal';
import { espacio, texto } from '../src/theme';
import { useTema } from '../src/useTema';

export default function PantallaPrivacidad() {
  const { paleta } = useTema();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const volver = () => (router.canGoBack() ? router.back() : router.replace('/ajustes'));

  return (
    <View style={{ flex: 1, backgroundColor: paleta.fondo }}>
      <Head><title>Política de Privacidad - Super App</title></Head>
      <HeaderNegro paddingTop={insets.top + espacio.xl} estilo={{ gap: espacio.md }}>
        <Pressable onPress={volver} accessibilityRole="button" style={styles.filaVolver}>
          <Text style={styles.flechaVolver}>‹</Text>
          <Text style={[texto.micro, styles.labelVolver]}>VOLVER</Text>
        </Pressable>
        <TituloHeader>Política de Privacidad</TituloHeader>
      </HeaderNegro>

      <ScrollView contentContainerStyle={styles.cuerpo}>
        {SECCIONES_PRIVACIDAD.map(seccion => (
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
