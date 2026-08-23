/**
 * Pantalla Ajustes.
 *
 * El rediseño v2 agrega este tab (antes eran solo Buscar/Carrito) pero su contenido no está
 * diseñado del todo (ver design_handoff_allpromos_v2/SPEC.md § 7.4): tema claro/oscuro y la
 * preferencia de compra online llegan en próximas fases, no como relleno acá. "Cómo funciona",
 * "Mis descuentos" y ahora "Cuenta" (Fase 1, Plan_Usuarios_y_cobros.md) sí tienen su punto de
 * entrada ya.
 *
 * La cuenta ya no es opcional (Fase 2, `GateSesion.tsx`): sin sesión no se llega a este tab
 * (ni a ningún otro) — por eso acá abajo no hace falta un branch para el caso sin sesión.
 */

import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { abrirCheckoutPago } from '../../src/abrirCheckoutPago';
import { cancelarSuscripcion, crearSuscripcion, ErrorApi } from '../../src/api';
import { useAuth } from '../../src/auth';
import { ComoFunciona } from '../../src/componentes/ComoFunciona';
import { ConfirmacionModal } from '../../src/componentes/Confirmacion';
import { HeaderNegro, TituloHeader } from '../../src/componentes/HeaderNegro';
import { diasRestantesTrial, usePlanUsuario } from '../../src/plan';
import { espacio, radio, texto } from '../../src/theme';
import { useTema } from '../../src/useTema';

export default function PantallaAjustes() {
  const { paleta } = useTema();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { session, cerrarSesion } = useAuth();
  const { info: infoPlan, recargar: recargarPlan } = usePlanUsuario();
  const [mostrarComoFunciona, setMostrarComoFunciona] = useState(false);
  const [mostrarConfirmarSalir, setMostrarConfirmarSalir] = useState(false);
  const [mostrarConfirmarCancelar, setMostrarConfirmarCancelar] = useState(false);
  const [accionEnCurso, setAccionEnCurso] = useState<'suscribir' | 'cancelar' | null>(null);
  const [errorAccion, setErrorAccion] = useState<string | null>(null);

  // Al volver a esta pantalla (ej. después de ir y volver del checkout de Mercado Pago) se
  // refresca el plan — el webhook de MP ya pudo haber actualizado `perfil_usuario` mientras
  // el usuario estaba afuera.
  useFocusEffect(useCallback(() => { recargarPlan(); }, [recargarPlan]));

  const suscribirse = async () => {
    if (!session) return;
    setErrorAccion(null);
    setAccionEnCurso('suscribir');
    try {
      await abrirCheckoutPago(() => crearSuscripcion(session.access_token));
    } catch (err) {
      setErrorAccion(err instanceof ErrorApi ? err.message : 'No se pudo iniciar la suscripción');
    } finally {
      setAccionEnCurso(null);
    }
  };

  const confirmarCancelarSuscripcion = async () => {
    setMostrarConfirmarCancelar(false);
    if (!session) return;
    setErrorAccion(null);
    setAccionEnCurso('cancelar');
    try {
      await cancelarSuscripcion(session.access_token);
      await recargarPlan();
    } catch (err) {
      setErrorAccion(err instanceof ErrorApi ? err.message : 'No se pudo cancelar la suscripción');
    } finally {
      setAccionEnCurso(null);
    }
  };

  const diasTrial = diasRestantesTrial(infoPlan?.trialTerminaEn ?? null);
  const textoPlan = infoPlan?.plan === 'premium'
    ? 'Plan Premium activo'
    : infoPlan?.plan === 'trial'
      ? (diasTrial !== null
        ? `Prueba gratis · vence en ${diasTrial} día${diasTrial === 1 ? '' : 's'}`
        : 'Prueba gratis')
      : infoPlan?.plan === 'gratis'
        ? 'Plan gratis'
        : null;

  // GateSesion (_layout.tsx) ya garantiza que no se llega acá sin sesión.
  if (!session) return null;

  return (
    <View style={[styles.pantalla, { backgroundColor: paleta.fondo }]}>
      <HeaderNegro paddingTop={insets.top + espacio.xl}>
        <TituloHeader>Ajustes</TituloHeader>
      </HeaderNegro>
      <View style={styles.cuerpo}>
        <View style={styles.seccion}>
          <Text style={[texto.tituloSeccion, { color: paleta.tintaSuave }]}>CUENTA</Text>
          <View style={[styles.grupo, { borderColor: paleta.borde }]}>
            <View style={styles.fila}>
              <Text style={[texto.cuerpoMedio, { color: paleta.tinta, flex: 1 }]} numberOfLines={1}>
                {session.user.email}
              </Text>
            </View>
            {textoPlan && (
              <>
                <View style={[styles.separador, { backgroundColor: paleta.borde }]} />
                <View style={styles.fila}>
                  <Text style={[texto.cuerpoMedio, { color: paleta.tintaSuave, flex: 1 }]}>
                    {textoPlan}
                  </Text>
                </View>
              </>
            )}
            {(infoPlan?.plan === 'trial' || infoPlan?.plan === 'gratis') && (
              <>
                <View style={[styles.separador, { backgroundColor: paleta.borde }]} />
                <Pressable
                  onPress={suscribirse}
                  disabled={accionEnCurso !== null}
                  accessibilityRole="button"
                  style={styles.fila}
                >
                  <Text style={[texto.cuerpoMedio, { color: paleta.tinta, flex: 1 }]}>
                    Actualizar a premium
                  </Text>
                  {accionEnCurso === 'suscribir' && <ActivityIndicator color={paleta.tintaSuave} />}
                </Pressable>
              </>
            )}
            {infoPlan?.plan === 'premium' && infoPlan.pasarelaSuscripcionId && (
              <>
                <View style={[styles.separador, { backgroundColor: paleta.borde }]} />
                <Pressable
                  onPress={() => setMostrarConfirmarCancelar(true)}
                  disabled={accionEnCurso !== null}
                  accessibilityRole="button"
                  style={styles.fila}
                >
                  <Text style={[texto.cuerpoMedio, { color: paleta.alerta, flex: 1 }]}>
                    Cancelar suscripción
                  </Text>
                  {accionEnCurso === 'cancelar' && <ActivityIndicator color={paleta.alerta} />}
                </Pressable>
              </>
            )}
            {errorAccion && (
              <>
                <View style={[styles.separador, { backgroundColor: paleta.borde }]} />
                <View style={styles.fila}>
                  <Text style={[texto.cuerpo, { color: paleta.alerta, flex: 1 }]}>{errorAccion}</Text>
                </View>
              </>
            )}
            <View style={[styles.separador, { backgroundColor: paleta.borde }]} />
            <Pressable
              onPress={() => setMostrarConfirmarSalir(true)}
              accessibilityRole="button"
              style={styles.fila}
            >
              <Text style={[texto.cuerpoMedio, { color: paleta.alerta }]}>Cerrar sesión</Text>
            </Pressable>
          </View>
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
        mensaje="Vas a tener que volver a iniciar sesión para seguir usando la app — la cuenta es obligatoria."
        textoConfirmar="Cerrar sesión"
        onCancelar={() => setMostrarConfirmarSalir(false)}
        onConfirmar={() => { setMostrarConfirmarSalir(false); cerrarSesion(); }}
      />
      <ConfirmacionModal
        visible={mostrarConfirmarCancelar}
        titulo="Cancelar suscripción"
        mensaje="Vas a perder el acceso a la app hasta que vuelvas a suscribirte."
        textoConfirmar="Cancelar suscripción"
        onCancelar={() => setMostrarConfirmarCancelar(false)}
        onConfirmar={confirmarCancelarSuscripcion}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  pantalla: { flex: 1 },
  cuerpo: { padding: espacio.pantalla, gap: espacio.pantalla },
  seccion: { gap: espacio.sm },
  grupo: { borderWidth: 1, borderRadius: radio.tarjeta, paddingHorizontal: espacio.md },
  fila: { flexDirection: 'row', alignItems: 'center', minHeight: 52 },
  separador: { height: StyleSheet.hairlineWidth },
});
