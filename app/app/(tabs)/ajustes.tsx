/**
 * Pantalla Ajustes: placeholder.
 *
 * El rediseño v2 agrega este tab (antes eran solo Buscar/Carrito) pero su contenido no está
 * diseñado todavía (ver design_handoff_allpromos_v2/SPEC.md § 7.4): va a tener que sumar tema
 * claro/oscuro y la preferencia de compra online — cada una llega en su propia fase, no como
 * relleno acá. "Cómo funciona" y "Mis descuentos" sí tienen su punto de entrada ya (se
 * reabren siempre desde acá, SPEC § 4.5 y § 4.7).
 */

import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ComoFunciona } from '../../src/componentes/ComoFunciona';
import { HeaderNegro, TituloHeader } from '../../src/componentes/HeaderNegro';
import { espacio, radio, texto } from '../../src/theme';
import { useTema } from '../../src/useTema';

export default function PantallaAjustes() {
  const { paleta } = useTema();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [mostrarComoFunciona, setMostrarComoFunciona] = useState(false);

  return (
    <View style={[styles.pantalla, { backgroundColor: paleta.fondo }]}>
      <HeaderNegro paddingTop={insets.top + espacio.xl}>
        <TituloHeader>Ajustes</TituloHeader>
      </HeaderNegro>
      <View style={styles.cuerpo}>
        <View style={[styles.grupo, { borderColor: paleta.borde }]}>
          <Pressable
            onPress={() => router.push('/mis-descuentos')}
            accessibilityRole="button"
            style={styles.fila}
          >
            <Text style={[texto.cuerpoMedio, { color: paleta.tinta, flex: 1 }]}>Mis descuentos</Text>
            <Text style={[texto.subtitulo, { color: paleta.tintaTenue }]}>›</Text>
          </Pressable>
          <View style={[styles.separador, { backgroundColor: paleta.borde }]} />
          <Pressable
            onPress={() => setMostrarComoFunciona(true)}
            accessibilityRole="button"
            style={styles.fila}
          >
            <Text style={[texto.cuerpoMedio, { color: paleta.tinta, flex: 1 }]}>Cómo funciona</Text>
            <Text style={[texto.subtitulo, { color: paleta.tintaTenue }]}>›</Text>
          </Pressable>
        </View>

        <Text style={[texto.cuerpo, { color: paleta.tintaSuave }]}>
          Tema oscuro y la preferencia de compra online se suman en próximas fases del rediseño.
        </Text>
      </View>
      <ComoFunciona visible={mostrarComoFunciona} onClose={() => setMostrarComoFunciona(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  pantalla: { flex: 1 },
  cuerpo: { padding: espacio.pantalla, gap: espacio.pantalla },
  grupo: { borderWidth: 1, borderRadius: radio.tarjeta, paddingHorizontal: espacio.md },
  fila: { flexDirection: 'row', alignItems: 'center', minHeight: 52 },
  separador: { height: StyleSheet.hairlineWidth },
});
