/**
 * Modal de pantalla completa para mostrar Términos de Servicio / Política de Privacidad ANTES
 * de que exista sesión (checkbox de registro en FormularioAuth.tsx). No se puede usar
 * `router.push('/terminos')` ahí: `GateSesion.tsx` reemplaza todo el `<Stack>` de Expo Router
 * por `FormularioAuth` mientras no hay sesión, así que no hay ningún navigator montado para
 * recibir esa navegación. Un `Modal` nativo de React Native no depende del Stack, así que
 * funciona en ese momento — mismo contenido que las rutas `app/terminos.tsx`/`privacidad.tsx`
 * (alcanzables después, con sesión), vía `contenidoLegal.ts`.
 */

import React from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { SeccionLegal } from '../legal/contenidoLegal';
import { espacio, texto } from '../theme';
import { useTema } from '../useTema';

export function ModalLegal({
  visible, titulo, secciones, onCerrar,
}: { visible: boolean; titulo: string; secciones: SeccionLegal[]; onCerrar: () => void }) {
  const { paleta } = useTema();
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onCerrar}>
      <View style={{ flex: 1, backgroundColor: paleta.fondo, paddingTop: insets.top }}>
        <View style={[styles.header, { borderColor: paleta.borde }]}>
          <Text style={[texto.subtitulo, { color: paleta.tinta, flex: 1 }]}>{titulo}</Text>
          <Pressable onPress={onCerrar} accessibilityRole="button" hitSlop={8}>
            <Text style={[texto.cuerpoMedio, { color: paleta.tinta }]}>Cerrar</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={[styles.cuerpo, { paddingBottom: insets.bottom + espacio.pantalla }]}>
          {secciones.map(seccion => (
            <View key={seccion.titulo} style={{ gap: espacio.xs }}>
              <Text style={[texto.subtitulo, { color: paleta.tinta }]}>{seccion.titulo}</Text>
              <Text style={[texto.cuerpo, { color: paleta.tintaProsa }]}>{seccion.cuerpo}</Text>
            </View>
          ))}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row', alignItems: 'center', gap: espacio.md,
    paddingHorizontal: espacio.pantalla, paddingVertical: espacio.md, borderBottomWidth: 1,
  },
  cuerpo: { padding: espacio.pantalla, gap: espacio.lg },
});
