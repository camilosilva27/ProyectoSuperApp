/**
 * Confirmación genérica para acciones destructivas.
 *
 * OJO — bug real encontrado probando "Vaciar carrito" en el build web: `Alert.alert` de
 * react-native NO está implementado por react-native-web. En web no lanza error ni warning,
 * simplemente no hace nada — el botón parece andar pero no confirma ni cancela nada. Como la
 * app se exporta a web (Vercel), cualquier confirmación tiene que ser un componente propio,
 * no `Alert.alert`.
 *
 * El ícono es opcional y sigue el mismo mecanismo inline con `react-native-svg` que
 * FormularioAuth.tsx (estilo Feather, `{ tamano, color }`), sin sumar una librería de íconos.
 */

import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Line, Path, Polyline, Rect } from 'react-native-svg';
import { espacio, radio, texto } from '../theme';
import { useTema } from '../useTema';

/** Íconos para los 3 usos de ConfirmacionModal — mismo mecanismo (react-native-svg, estilo
 *  Feather) que IconoPersona/IconoMail/IconoCandado en FormularioAuth.tsx. */
export function IconoSalir({ tamano, color }: { tamano: number; color: string }) {
  return (
    <Svg width={tamano} height={tamano} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <Polyline points="16 17 21 12 16 7" />
      <Line x1={21} y1={12} x2={9} y2={12} />
    </Svg>
  );
}

export function IconoTacho({ tamano, color }: { tamano: number; color: string }) {
  return (
    <Svg width={tamano} height={tamano} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Polyline points="3 6 5 6 21 6" />
      <Path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <Line x1={10} y1={11} x2={10} y2={17} />
      <Line x1={14} y1={11} x2={14} y2={17} />
    </Svg>
  );
}

export function IconoTarjetaCancelar({ tamano, color }: { tamano: number; color: string }) {
  return (
    <Svg width={tamano} height={tamano} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Rect x={2} y={5} width={20} height={14} rx={2} />
      <Line x1={2} y1={10} x2={22} y2={10} />
      <Line x1={15} y1={15} x2={19} y2={19} />
      <Line x1={19} y1={15} x2={15} y2={19} />
    </Svg>
  );
}

export function ConfirmacionModal({
  visible, titulo, mensaje, textoConfirmar, icono: Icono, onCancelar, onConfirmar,
}: {
  visible: boolean;
  titulo: string;
  mensaje: string;
  textoConfirmar: string;
  icono?: (props: { tamano: number; color: string }) => React.ReactElement;
  onCancelar: () => void;
  onConfirmar: () => void;
}) {
  const { paleta } = useTema();

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancelar}>
      <View style={styles.fondo}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onCancelar} accessibilityLabel="Cerrar" />
        <View style={[styles.hoja, { backgroundColor: paleta.superficie }]}>
          {Icono ? (
            <View style={[styles.iconoFondo, { backgroundColor: paleta.errorFondo, borderColor: paleta.errorBorde }]}>
              <Icono tamano={26} color={paleta.peligro} />
            </View>
          ) : null}
          <View style={{ gap: espacio.xs }}>
            <Text style={[texto.titulo, { color: paleta.tinta, fontSize: 21 }]}>{titulo}</Text>
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
              style={[styles.botonConfirmar, { backgroundColor: paleta.peligro }]}
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
  fondo: { flex: 1, backgroundColor: 'rgba(15,17,20,.65)', justifyContent: 'flex-end' },
  hoja: {
    borderTopLeftRadius: radio.pantalla, borderTopRightRadius: radio.pantalla,
    padding: espacio.pantalla, gap: espacio.lg,
  },
  iconoFondo: {
    width: 52, height: 52, borderRadius: radio.pill, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center',
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
