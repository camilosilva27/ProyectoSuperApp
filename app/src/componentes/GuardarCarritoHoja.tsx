/**
 * Hoja "Guardar carrito" (SPEC.md § 4.4, 4a). El nombre viene pre-llenado con "Compra de
 * {mes}" y seleccionado: guardar es un toque, y escribir encima también. Nombre duplicado se
 * permite — no bloquea el guardado, eso queda para quien lo mire después.
 */

import React, { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { espacio, radio, texto } from '../theme';
import { useTema } from '../useTema';

const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

function nombrePorDefecto(): string {
  const mes = MESES[new Date().getMonth()];
  return `Compra de ${mes.charAt(0).toUpperCase()}${mes.slice(1)}`;
}

export function GuardarCarritoHoja({
  visible, productos, unidades, onCancelar, onGuardar,
}: {
  visible: boolean;
  productos: number;
  unidades: number;
  onCancelar: () => void;
  onGuardar: (nombre: string) => void;
}) {
  const { paleta } = useTema();
  const [nombre, setNombre] = useState(nombrePorDefecto);
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    if (!visible) return;
    setNombre(nombrePorDefecto());
    const t = setTimeout(() => inputRef.current?.focus(), 150);
    return () => clearTimeout(t);
  }, [visible]);

  const confirmar = () => {
    const limpio = nombre.trim();
    if (!limpio) return;
    onGuardar(limpio);
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancelar}>
      <View style={styles.fondo}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onCancelar} accessibilityLabel="Cerrar" />
        <View style={[styles.hoja, { backgroundColor: paleta.superficie }]}>
          <View style={{ gap: espacio.xs }}>
            <Text style={[texto.subtitulo, { color: paleta.tinta, fontSize: 22 }]}>Guardar carrito</Text>
            <Text style={[texto.cuerpo, { color: paleta.tintaSuave }]}>
              Lo vas a poder volver a cargar entero desde Carrito, cuando quieras.
            </Text>
          </View>

          <View style={{ gap: espacio.xs }}>
            <Text style={[texto.tituloSeccion, { color: paleta.tintaSuave }]}>NOMBRE</Text>
            <TextInput
              ref={inputRef}
              value={nombre}
              onChangeText={setNombre}
              selectTextOnFocus
              style={[
                texto.subtitulo,
                styles.input,
                { color: paleta.tinta, borderColor: paleta.tinta, backgroundColor: paleta.superficie },
              ]}
              returnKeyType="done"
              onSubmitEditing={confirmar}
              accessibilityLabel="Nombre del carrito"
            />
            <Text style={[texto.dato, { color: paleta.tintaSuave }]}>
             {productos} producto{productos === 1 ? '' : 's'} · {unidades} unidad{unidades === 1 ? '' : 'es'}
            </Text>
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
              onPress={confirmar}
              accessibilityRole="button"
              disabled={!nombre.trim()}
              style={[styles.botonGuardar, { backgroundColor: paleta.tinta, opacity: nombre.trim() ? 1 : 0.5 }]}
            >
              <Text style={[texto.cuerpoMedio, { color: paleta.superficie }]}>Guardar</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

/**
 * Toast de confirmación (4b): sobre el CTA, no tapándolo — confirma el nombre, que es lo
 * único que el usuario acaba de decidir. Se cierra solo a los ~3s.
 */
export function ToastGuardado({ nombre, onFin }: { nombre: string | null; onFin: () => void }) {
  const { paleta } = useTema();

  useEffect(() => {
    if (!nombre) return;
    const t = setTimeout(onFin, 3000);
    return () => clearTimeout(t);
  }, [nombre, onFin]);

  if (!nombre) return null;

  return (
    <View style={styles.toast} pointerEvents="none">
      <View style={[styles.checkToast, { backgroundColor: paleta.oferta }]}>
        <Text style={{ color: paleta.ofertaTinta, fontSize: 11, fontWeight: '600' }}>✓</Text>
      </View>
      <Text style={[texto.etiqueta, styles.textoToast]} numberOfLines={1}>Guardado como {nombre}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fondo: { flex: 1, backgroundColor: 'rgba(20,22,26,.55)', justifyContent: 'flex-end' },
  toast: {
    position: 'absolute', left: espacio.pantalla, right: espacio.pantalla, bottom: '100%',
    marginBottom: espacio.sm, backgroundColor: '#14161A', borderRadius: radio.sm,
    paddingHorizontal: espacio.md, paddingVertical: espacio.sm,
    flexDirection: 'row', alignItems: 'center', gap: espacio.sm,
  },
  checkToast: { width: 18, height: 18, borderRadius: radio.pill, alignItems: 'center', justifyContent: 'center' },
  textoToast: { color: '#FFFFFF', flex: 1 },
  hoja: {
    borderTopLeftRadius: radio.pantalla, borderTopRightRadius: radio.pantalla,
    padding: espacio.pantalla, gap: espacio.lg,
  },
  input: {
    height: 52, borderWidth: 1, borderRadius: radio.sm, paddingHorizontal: espacio.md,
    outlineWidth: 0, outlineStyle: 'none',
  },
  filaBotones: { flexDirection: 'row', gap: espacio.sm },
  botonCancelar: {
    width: 110, height: 50, borderWidth: 1, borderRadius: radio.sm,
    alignItems: 'center', justifyContent: 'center',
  },
  botonGuardar: {
    flex: 1, height: 50, borderRadius: radio.sm, alignItems: 'center', justifyContent: 'center',
  },
});
