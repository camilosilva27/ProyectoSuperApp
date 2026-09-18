/**
 * Pantalla "Datos personales" (diseño 20d, Claude Design turno 20): antes el mail y "Cerrar
 * sesión" vivían inline en el tope de Ajustes; con la reestructuración pasan a su propia
 * pantalla, alcanzada desde el grupo CUENTA.
 *
 * El volver usa el header nativo del Stack (ver _layout.tsx), no uno propio — mismo patrón que
 * "plan-y-pago": el título de la pantalla se dibuja acá adentro, el header nativo solo dice
 * "Ajustes" (adonde vuelve la flecha).
 */

import Head from 'expo-router/head';
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../../src/auth';
import { ConfirmacionModal, IconoSalir } from '../../../src/componentes/Confirmacion';
import { espacio, radio, texto } from '../../../src/theme';
import { useTema } from '../../../src/useTema';

export default function PantallaDatosPersonales() {
  const { paleta } = useTema();
  const insets = useSafeAreaInsets();
  const { session, cerrarSesion } = useAuth();
  const [mostrarConfirmarSalir, setMostrarConfirmarSalir] = useState(false);

  if (!session) return null;

  return (
    <View style={{ flex: 1, backgroundColor: paleta.fondo, paddingTop: insets.top }}>
      <Head><title>Datos personales - SuperAhorro</title></Head>
      <Text style={[texto.titulo, styles.titulo, { color: paleta.tinta }]}>Datos personales</Text>

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
  titulo: { paddingHorizontal: espacio.pantalla, paddingTop: espacio.xl },
  cuerpo: { padding: espacio.pantalla },
  grupo: { borderWidth: 1, borderRadius: radio.tarjeta, paddingHorizontal: espacio.md },
  fila: { flexDirection: 'row', alignItems: 'center', minHeight: 52 },
  separador: { height: StyleSheet.hairlineWidth },
});
