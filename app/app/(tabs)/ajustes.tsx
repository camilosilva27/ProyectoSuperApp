/**
 * Pantalla Ajustes: placeholder.
 *
 * El rediseño v2 agrega este tab (antes eran solo Buscar/Carrito) pero su contenido no está
 * diseñado todavía (ver design_handoff_allpromos_v2/SPEC.md § 7.4): va a tener que sumar tema
 * claro/oscuro, Mis descuentos, Cómo funciona y la preferencia de compra online — cada una
 * llega en su propia fase, no como relleno acá.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { HeaderNegro, TituloHeader } from '../../src/componentes/HeaderNegro';
import { espacio, texto } from '../../src/theme';
import { useTema } from '../../src/useTema';

export default function PantallaAjustes() {
  const { paleta } = useTema();
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.pantalla, { backgroundColor: paleta.fondo }]}>
      <HeaderNegro paddingTop={insets.top + espacio.xl}>
        <TituloHeader>Ajustes</TituloHeader>
      </HeaderNegro>
      <View style={styles.cuerpo}>
        <Text style={[texto.cuerpo, { color: paleta.tintaSuave }]}>
          Todavía no hay nada acá. Mis descuentos, Cómo funciona, tema oscuro y la preferencia
          de compra online se suman en próximas fases del rediseño.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  pantalla: { flex: 1 },
  cuerpo: { padding: espacio.pantalla },
});
