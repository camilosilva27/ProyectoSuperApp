/**
 * Pantalla "Datos personales" (diseño 20d, Claude Design turno 20): antes el mail y "Cerrar
 * sesión" vivían inline en el tope de Ajustes; con la reestructuración pasan a su propia
 * pantalla, alcanzada desde el grupo CUENTA.
 */

import { useRouter } from 'expo-router';
import Head from 'expo-router/head';
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../../src/auth';
import { ConfirmacionModal, IconoSalir } from '../../../src/componentes/Confirmacion';
import { HeaderNegro, TituloHeader } from '../../../src/componentes/HeaderNegro';
import { espacio, radio, texto } from '../../../src/theme';
import { useTema } from '../../../src/useTema';

export default function PantallaDatosPersonales() {
  const { paleta } = useTema();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { session, cerrarSesion } = useAuth();
  const [mostrarConfirmarSalir, setMostrarConfirmarSalir] = useState(false);

  const volver = () => (router.canGoBack() ? router.back() : router.replace('/ajustes'));

  if (!session) return null;

  return (
    <View style={{ flex: 1, backgroundColor: paleta.fondo }}>
      <Head><title>Datos personales - Super App</title></Head>
      <HeaderNegro paddingTop={insets.top + espacio.xl} estilo={{ gap: espacio.md }}>
        <Pressable onPress={volver} accessibilityRole="button" style={styles.filaVolver}>
          <Text style={styles.flechaVolver}>‹</Text>
          <Text style={[texto.micro, styles.labelVolver]}>AJUSTES</Text>
        </Pressable>
        <TituloHeader>Datos personales</TituloHeader>
      </HeaderNegro>

      <View style={styles.cuerpo}>
        <View style={[styles.grupo, { borderColor: paleta.borde }]}>
          <View style={styles.fila}>
            <Text style={[texto.cuerpoMedio, { color: paleta.tinta, flex: 1 }]} numberOfLines={1}>
              {session.user.email}
            </Text>
          </View>
          <View style={[styles.separador, { backgroundColor: paleta.borde }]} />
          <Pressable
            onPress={() => setMostrarConfirmarSalir(true)}
            accessibilityRole="button"
            style={styles.fila}
          >
            <Text style={[texto.cuerpoMedio, { color: paleta.peligro }]}>Cerrar sesión</Text>
          </Pressable>
        </View>
      </View>

      <ConfirmacionModal
        visible={mostrarConfirmarSalir}
        titulo="Cerrar sesión"
        mensaje="¿Estás seguro de que querés cerrar sesión?"
        textoConfirmar="Cerrar sesión"
        icono={IconoSalir}
        onCancelar={() => setMostrarConfirmarSalir(false)}
        onConfirmar={() => { setMostrarConfirmarSalir(false); cerrarSesion(); }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  filaVolver: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start' },
  flechaVolver: { fontSize: 22, color: '#FFFFFF' },
  labelVolver: { color: '#FFFFFF', opacity: 0.6, letterSpacing: 1.2 },
  cuerpo: { padding: espacio.pantalla },
  grupo: { borderWidth: 1, borderRadius: radio.tarjeta, paddingHorizontal: espacio.md },
  fila: { flexDirection: 'row', alignItems: 'center', minHeight: 52 },
  separador: { height: StyleSheet.hairlineWidth },
});
