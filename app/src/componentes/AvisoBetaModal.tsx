/**
 * Aviso de fase de pruebas: se muestra una sola vez por dispositivo, la primera vez que hay
 * sesión activa (login o registro recién hechos, o el primer arranque logueado en este
 * dispositivo). Mismo flag "ya lo vi" que `superapp_ya_visito_landing_auth_v1` en
 * `FormularioAuth.tsx`.
 *
 * A diferencia del resto de los `Modal` del repo (todos bottom sheets, `justifyContent:
 * 'flex-end'`), este es un popup centrado en pantalla a propósito — pedido explícito, no el
 * patrón por defecto. Header amarillo (`paleta.oferta`, mismo tono que el hero de
 * `FormularioAuth.tsx`) con el título, cuerpo debajo en la tarjeta blanca.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { useEffect, useState } from 'react';
import { Linking, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { espacio, radio, texto } from '../theme';
import { useTema } from '../useTema';
import { BotonPrincipal } from './comunes';

const CLAVE_YA_VISTO = 'superapp_ya_vio_aviso_beta_v1';
const MAIL_CONTACTO = 'contacto@mi-superapp.com.ar';

export function AvisoBetaModal() {
  const { paleta } = useTema();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(CLAVE_YA_VISTO).then(valor => {
      if (!valor) setVisible(true);
    });
  }, []);

  const cerrar = () => {
    setVisible(false);
    AsyncStorage.setItem(CLAVE_YA_VISTO, '1').catch(() => {});
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={cerrar}>
      <View style={[styles.fondo, { backgroundColor: paleta.overlay }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={cerrar} accessibilityLabel="Cerrar" />
        <View style={[styles.tarjeta, { backgroundColor: paleta.superficie }]}>
          <View style={[styles.header, { backgroundColor: paleta.oferta }]}>
            <Text style={[styles.tituloHeader, { color: paleta.ofertaTinta }]}>
              ESTAMOS EN FASE DE PRUEBAS
            </Text>
          </View>
          <View style={styles.cuerpo}>
            <Text style={[texto.cuerpo, { color: paleta.tintaProsa }]}>
              Todavía estamos ajustando Super App, así que puede haber algún error o algo que no
              termine de andar como esperás. Si te pasa algo raro o se te ocurre algo para
              mejorar, nos ayuda muchísimo que nos escribas a{' '}
              <Text
                style={{ color: paleta.tinta, fontWeight: '600', textDecorationLine: 'underline' }}
                onPress={() => Linking.openURL(`mailto:${MAIL_CONTACTO}`)}
                accessibilityRole="link"
              >
                {MAIL_CONTACTO}
              </Text>.
            </Text>
            <BotonPrincipal onPress={cerrar}>Entendido</BotonPrincipal>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fondo: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: espacio.pantalla },
  tarjeta: {
    width: '100%', maxWidth: 400, borderRadius: radio.lg, overflow: 'hidden',
  },
  header: { paddingHorizontal: espacio.xl, paddingVertical: espacio.lg },
  tituloHeader: {
    fontFamily: 'BarlowCondensed_700Bold', fontSize: 28, lineHeight: 28, letterSpacing: 0.5,
  },
  cuerpo: { padding: espacio.xl, gap: espacio.lg },
});
