/**
 * Hoja de confirmación al destildar un producto seguido (diseño 20f/20g, Claude Design turno
 * 20): el check se apaga en el momento en la lista de atrás, la hoja explica qué se pierde, y
 * "Seguir siguiéndolo" lo devuelve tildado sin tocar el servidor. Mismo patrón de Modal +
 * overlay + hoja que `GuardarCarritoHoja.tsx` — sin toast de deshacer después de confirmar
 * (volver a seguir un producto se hace desde el buscador, no hay "deshacer" temporal).
 */

import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { espacio, radio, texto } from '../theme';
import { useTema } from '../useTema';
import { BotonPrincipal } from './comunes';

export function DejarDeSeguirHoja({
  producto, onCancelar, onConfirmar,
}: {
  producto: { ean: string; nombre: string } | null;
  onCancelar: () => void;
  onConfirmar: () => void;
}) {
  const { paleta } = useTema();

  return (
    <Modal visible={!!producto} transparent animationType="fade" onRequestClose={onCancelar}>
      <View style={[styles.fondo, { backgroundColor: paleta.overlay }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onCancelar} accessibilityLabel="Cerrar" />
        <View style={[styles.hoja, { backgroundColor: paleta.superficie }]}>
          <View style={{ gap: espacio.xs }}>
            <Text style={[texto.subtitulo, { color: paleta.tinta, fontSize: 22 }]}>
              ¿Dejar de seguir {producto?.nombre}?
            </Text>
            <Text style={[texto.cuerpo, { color: paleta.tintaSuave }]}>
              Sale de tus alertas y no te vamos a avisar cuando tenga promo. Podés volver a seguirlo cuando quieras.
            </Text>
          </View>

          <View style={{ gap: espacio.sm }}>
            <BotonPrincipal variante="primario" onPress={onConfirmar}>
              Dejar de seguir
            </BotonPrincipal>
            <BotonPrincipal variante="secundario" onPress={onCancelar}>
              Seguir siguiéndolo
            </BotonPrincipal>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fondo: { flex: 1, justifyContent: 'flex-end' },
  hoja: {
    borderTopLeftRadius: radio.pantalla, borderTopRightRadius: radio.pantalla,
    padding: espacio.pantalla, gap: espacio.lg,
  },
});
