/**
 * Confirmación genérica para acciones destructivas.
 *
 * OJO — bug real encontrado probando "Vaciar carrito" en el build web: `Alert.alert` de
 * react-native NO está implementado por react-native-web. En web no lanza error ni warning,
 * simplemente no hace nada — el botón parece andar pero no confirma ni cancela nada. Como la
 * app se exporta a web (Vercel), cualquier confirmación tiene que ser un componente propio,
 * no `Alert.alert`.
 */

import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { espacio, radio, texto } from '../theme';
import { useTema } from '../useTema';

export function ConfirmacionModal({
  visible, titulo, mensaje, textoConfirmar, onCancelar, onConfirmar,
}: {
  visible: boolean;
  titulo: string;
  mensaje: string;
  textoConfirmar: string;
  onCancelar: () => void;
  onConfirmar: () => void;
}) {
  const { paleta } = useTema();

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancelar}>
      <View style={styles.fondo}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onCancelar} accessibilityLabel="Cerrar" />
        <View style={[styles.hoja, { backgroundColor: paleta.superficie }]}>
          <View style={{ gap: espacio.xs }}>
            <Text style={[texto.subtitulo, { color: paleta.tinta, fontSize: 20 }]}>{titulo}</Text>
            <Text style={[texto.cuerpo, { color: paleta.tintaSuave }]}>{mensaje}</Text>
          </View>
          <View style={styles.filaBotones}>
            <Pressable
              onPress={onCancelar}
              accessibilityRole="button"
              style={[styles.botonCancelar, { borderColor: paleta.borde }]}
            >
              <Text style={[texto.cuerpoMedio, { color: paleta.tinta }]}>Cancelar</Text>
            </Pressable>
            <Pressable
              onPress={onConfirmar}
              accessibilityRole="button"
              style={[styles.botonConfirmar, { backgroundColor: paleta.alerta }]}
            >
              <Text style={[texto.cuerpoMedio, { color: '#FFFFFF' }]}>{textoConfirmar}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fondo: { flex: 1, backgroundColor: 'rgba(20,22,26,.55)', justifyContent: 'flex-end' },
  hoja: {
    borderTopLeftRadius: radio.pantalla, borderTopRightRadius: radio.pantalla,
    padding: espacio.pantalla, gap: espacio.lg,
  },
  filaBotones: { flexDirection: 'row', gap: espacio.sm },
  botonCancelar: {
    flex: 1, height: 50, borderWidth: 1, borderRadius: radio.sm,
    alignItems: 'center', justifyContent: 'center',
  },
  botonConfirmar: {
    flex: 1, height: 50, borderRadius: radio.sm, alignItems: 'center', justifyContent: 'center',
  },
});
