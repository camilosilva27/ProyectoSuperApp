/**
 * Prompt de cuenta: prominente pero opcional (Fase 1, Plan_Usuarios_y_cobros.md). Se muestra
 * una sola vez en la vida del dispositivo, al cerrar el onboarding "Cómo funciona" por primera
 * vez — tanto por "Saltar" como por completarlo, ver index.tsx. "Ahora no" no vuelve a
 * aparecer solo; crear cuenta sigue disponible siempre desde Ajustes para quien cambie de idea.
 */

import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { espacio, radio, texto } from '../theme';
import { useTema } from '../useTema';
import { FormularioAuth } from './FormularioAuth';

export function PromptCuenta({ visible, onCerrar }: { visible: boolean; onCerrar: () => void }) {
  const { paleta } = useTema();

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCerrar}>
      <View style={styles.fondo}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onCerrar} accessibilityLabel="Cerrar" />
        <View style={[styles.hoja, { backgroundColor: paleta.superficie }]}>
          <View style={{ gap: espacio.xs }}>
            <Text style={[texto.subtitulo, { color: paleta.tinta, fontSize: 20 }]}>
              Creá una cuenta
            </Text>
            <Text style={[texto.prosa, { color: paleta.tintaSuave }]}>
              Sincronizá tu carrito, tarjetas y listas guardadas entre tus dispositivos. Podés
              seguir usando la app sin cuenta si preferís.
            </Text>
          </View>

          <FormularioAuth onExito={onCerrar} />

          <Pressable onPress={onCerrar} accessibilityRole="button" style={styles.botonAhoraNo}>
            <Text style={[texto.etiqueta, { color: paleta.tintaSuave }]}>Ahora no</Text>
          </Pressable>
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
  botonAhoraNo: { alignSelf: 'center', height: 44, justifyContent: 'center' },
});
