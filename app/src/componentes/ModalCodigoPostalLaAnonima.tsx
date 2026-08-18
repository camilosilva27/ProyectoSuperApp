/**
 * Modal para pedir el código postal la primera vez que se activa La Anónima en BarraSupers
 * (ver el wrapper de onToggle en app/(tabs)/index.tsx). Mismo patrón visual que
 * GuardarCarritoHoja: hoja sobre backdrop, TextInput + botones.
 *
 * También se reusa cuando el usuario ya había preguntado antes y no tenía cobertura (`cpPrevio`
 * viene poblado): ahí el texto cambia para ofrecer reintentar con otro CP, en vez de repetir la
 * explicación inicial.
 */

import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { espacio, radio, texto } from '../theme';
import { useTema } from '../useTema';

export function ModalCodigoPostalLaAnonima({
  visible, cpPrevio, onConfirmar, onOmitir, onCerrar,
}: {
  visible: boolean;
  /** Si ya se había preguntado antes y no tenía cobertura, se ofrece reintentar con otro CP. */
  cpPrevio: string | null;
  /** Devuelve `coberturaConfirmada` — el caller decide si activar el super o no. */
  onConfirmar: (cp: string) => Promise<boolean>;
  onOmitir: () => void;
  onCerrar: () => void;
}) {
  const { paleta } = useTema();
  const [cp, setCp] = useState('');
  const [verificando, setVerificando] = useState(false);
  const [sinCobertura, setSinCobertura] = useState(false);
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    if (!visible) return;
    setCp('');
    setSinCobertura(false);
    const t = setTimeout(() => inputRef.current?.focus(), 150);
    return () => clearTimeout(t);
  }, [visible]);

  const confirmar = async () => {
    const limpio = cp.trim();
    if (!limpio || verificando) return;
    setVerificando(true);
    setSinCobertura(false);
    try {
      const coberturaConfirmada = await onConfirmar(limpio);
      if (coberturaConfirmada) onCerrar();
      else setSinCobertura(true);
    } catch {
      // No se pudo verificar (sin red, backend caído): mismo trato conservador que
      // "sin cobertura" — no activar el super sin confirmar de verdad.
      setSinCobertura(true);
    } finally {
      setVerificando(false);
    }
  };

  const omitir = () => {
    onOmitir();
    onCerrar();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCerrar}>
      <View style={styles.fondo}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onCerrar} accessibilityLabel="Cerrar" />
        <View style={[styles.hoja, { backgroundColor: paleta.superficie }]}>
          <View style={{ gap: espacio.xs }}>
            <Text style={[texto.subtitulo, { color: paleta.tinta, fontSize: 22 }]}>Tu código postal</Text>
            <Text style={[texto.cuerpo, { color: paleta.tintaSuave }]}>
              {cpPrevio
                ? `Con el código postal ${cpPrevio} no encontramos venta de supermercado online de La Anónima. Probá con otro.`
                : 'La Anónima todavía no vende por internet en todo el país — con tu código postal sabemos si hay cobertura en tu zona antes de incluirla en la comparación.'}
            </Text>
          </View>

          <View style={{ gap: espacio.xs }}>
            <Text style={[texto.tituloSeccion, { color: paleta.tintaSuave }]}>CÓDIGO POSTAL</Text>
            <TextInput
              ref={inputRef}
              value={cp}
              onChangeText={t => { setCp(t); setSinCobertura(false); }}
              placeholder="ej. 1425"
              placeholderTextColor={paleta.tintaTenue}
              keyboardType="number-pad"
              style={[
                texto.subtitulo, styles.input,
                { color: paleta.tinta, borderColor: paleta.tinta, backgroundColor: paleta.superficie },
              ]}
              returnKeyType="done"
              onSubmitEditing={confirmar}
              accessibilityLabel="Código postal"
            />
            {sinCobertura ? (
              <Text style={[texto.dato, { color: paleta.alerta }]}>
                Sin venta de supermercado online en esa zona todavía — no se va a incluir en la comparación.
              </Text>
            ) : null}
          </View>

          <View style={styles.filaBotones}>
            <Pressable
              onPress={omitir}
              accessibilityRole="button"
              style={[styles.botonCancelar, { borderColor: paleta.borde }]}
            >
              <Text style={[texto.cuerpoMedio, { color: paleta.tinta }]}>Omitir</Text>
            </Pressable>
            <Pressable
              onPress={confirmar}
              accessibilityRole="button"
              disabled={!cp.trim() || verificando}
              style={[
                styles.botonGuardar,
                { backgroundColor: paleta.tinta, opacity: cp.trim() && !verificando ? 1 : 0.5 },
              ]}
            >
              {verificando
                ? <ActivityIndicator color={paleta.superficie} />
                : <Text style={[texto.cuerpoMedio, { color: paleta.superficie }]}>Confirmar</Text>}
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
