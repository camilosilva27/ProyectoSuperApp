/**
 * Pantalla Ajustes.
 *
 * El rediseño v2 agrega este tab (antes eran solo Buscar/Carrito) pero su contenido no está
 * diseñado del todo (ver design_handoff_allpromos_v2/SPEC.md § 7.4): tema claro/oscuro y la
 * preferencia de compra online llegan en próximas fases, no como relleno acá. "Cómo funciona",
 * "Mis descuentos" y ahora "Cuenta" (Fase 1, Plan_Usuarios_y_cobros.md) sí tienen su punto de
 * entrada ya.
 *
 * La cuenta es siempre opcional acá — a diferencia del prompt post-onboarding (PromptCuenta),
 * esto no tiene "Ahora no" porque ya es el lugar al que alguien vuelve *a propósito* si quiere
 * loguearse más tarde.
 */

import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../src/auth';
import { ComoFunciona } from '../../src/componentes/ComoFunciona';
import { ConfirmacionModal } from '../../src/componentes/Confirmacion';
import { FormularioAuth } from '../../src/componentes/FormularioAuth';
import { HeaderNegro, TituloHeader } from '../../src/componentes/HeaderNegro';
import { espacio, radio, texto } from '../../src/theme';
import { useTema } from '../../src/useTema';

export default function PantallaAjustes() {
  const { paleta } = useTema();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { session, cerrarSesion } = useAuth();
  const [mostrarComoFunciona, setMostrarComoFunciona] = useState(false);
  const [mostrarConfirmarSalir, setMostrarConfirmarSalir] = useState(false);

  return (
    <View style={[styles.pantalla, { backgroundColor: paleta.fondo }]}>
      <HeaderNegro paddingTop={insets.top + espacio.xl}>
        <TituloHeader>Ajustes</TituloHeader>
      </HeaderNegro>
      <View style={styles.cuerpo}>
        <View style={styles.seccion}>
          <Text style={[texto.tituloSeccion, { color: paleta.tintaSuave }]}>CUENTA</Text>
          {session ? (
            <View style={[styles.grupo, { borderColor: paleta.borde }]}>
              <View style={styles.fila}>
                <Text style={[texto.cuerpoMedio, { color: paleta.tinta, flex: 1 }]} numberOfLines={1}>
                  {session.user.email}
                </Text>
              </View>
              <View style={[styles.separador, { backgroundColor: paleta.borde }]} />
              <Pressable
                onPress={() => setMostrarConfirmarSalir(true)}
                accessibilityRole="button"
                style={styles.fila}
              >
                <Text style={[texto.cuerpoMedio, { color: paleta.alerta }]}>Cerrar sesión</Text>
              </Pressable>
            </View>
          ) : (
            <View style={[styles.grupo, styles.grupoFormulario, { borderColor: paleta.borde }]}>
              <FormularioAuth />
            </View>
          )}
        </View>

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
      <ConfirmacionModal
        visible={mostrarConfirmarSalir}
        titulo="Cerrar sesión"
        mensaje="Vas a seguir viendo tu carrito y tarjetas localmente, pero dejan de sincronizarse con tus otros dispositivos hasta que vuelvas a entrar."
        textoConfirmar="Cerrar sesión"
        onCancelar={() => setMostrarConfirmarSalir(false)}
        onConfirmar={() => { setMostrarConfirmarSalir(false); cerrarSesion(); }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  pantalla: { flex: 1 },
  cuerpo: { padding: espacio.pantalla, gap: espacio.pantalla },
  seccion: { gap: espacio.sm },
  grupo: { borderWidth: 1, borderRadius: radio.tarjeta, paddingHorizontal: espacio.md },
  grupoFormulario: { paddingVertical: espacio.md },
  fila: { flexDirection: 'row', alignItems: 'center', minHeight: 52 },
  separador: { height: StyleSheet.hairlineWidth },
});
