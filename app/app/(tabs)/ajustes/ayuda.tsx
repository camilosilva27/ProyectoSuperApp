/**
 * Pantalla "Ayuda" (diseño 20d, Claude Design turno 20): consolida "Ver el tutorial" y el mail
 * de contacto, que antes vivían sueltos en el cuerpo de Ajustes, en su propia pantalla
 * alcanzada desde el grupo CUENTA.
 */

import { useRouter } from 'expo-router';
import Head from 'expo-router/head';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { IconoChevron } from '../../../src/componentes/comunes';
import { HeaderNegro, TituloHeader } from '../../../src/componentes/HeaderNegro';
import { useTour } from '../../../src/tour/TourContext';
import { espacio, radio, texto } from '../../../src/theme';
import { useTema } from '../../../src/useTema';

export default function PantallaAyuda() {
  const { paleta } = useTema();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const tour = useTour();

  const volver = () => (router.canGoBack() ? router.back() : router.replace('/ajustes'));

  // Ayuda es una pantalla apilada ENCIMA de las tabs (ver Stack.Screen en app/_layout.tsx) —
  // arrancar el tour de acá directo dejaba su primer paso ("tab-descuentos", que resalta una
  // celda de la barra inferior por fórmula, no con un ref) apuntando a un rectángulo fantasma:
  // la barra real está tapada por esta misma pantalla (bug real, encontrado en auditoría). Por
  // eso primero se vuelve a Buscar (revela la barra) y recién ahí se inicia el tour.
  const iniciarTutorial = () => {
    router.replace('/');
    tour.iniciar();
  };

  return (
    <View style={{ flex: 1, backgroundColor: paleta.fondo }}>
      <Head><title>Ayuda - Super App</title></Head>
      <HeaderNegro paddingTop={insets.top + espacio.xl} estilo={{ gap: espacio.md }}>
        <Pressable onPress={volver} accessibilityRole="button" style={styles.filaVolver}>
          <Text style={styles.flechaVolver}>‹</Text>
          <Text style={[texto.micro, styles.labelVolver]}>AJUSTES</Text>
        </Pressable>
        <TituloHeader>Ayuda</TituloHeader>
      </HeaderNegro>

      <View style={styles.cuerpo}>
        <View style={[styles.grupo, { borderColor: paleta.borde }]}>
          <Pressable onPress={iniciarTutorial} accessibilityRole="button" style={styles.fila}>
            <Text style={[texto.cuerpoMedio, { color: paleta.tinta, flex: 1 }]}>Ver el tutorial</Text>
            <IconoChevron color={paleta.tintaTenue} />
          </Pressable>
        </View>

        <Text style={[texto.cuerpo, { color: paleta.tintaSuave }]}>
          Ante cualquier duda, opinión o problema, escribir a contacto@mi-superapp.com.ar
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  filaVolver: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start' },
  flechaVolver: { fontSize: 22, color: '#FFFFFF' },
  labelVolver: { color: '#FFFFFF', opacity: 0.6, letterSpacing: 1.2 },
  cuerpo: { padding: espacio.pantalla, gap: espacio.pantalla },
  grupo: { borderWidth: 1, borderRadius: radio.tarjeta, paddingHorizontal: espacio.md },
  fila: { flexDirection: 'row', alignItems: 'center', minHeight: 52 },
});
