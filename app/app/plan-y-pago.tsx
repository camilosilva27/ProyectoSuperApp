/**
 * Pantalla "Plan y pago" (turnos 12/13), alcanzada desde la fila de Ajustes. A diferencia de
 * cuando se llega desde `GatePaywallFinTrial` (bloqueante, sin X), acá `PlanSelect` se abre
 * con X que vuelve a Ajustes — el usuario ya es premium o está en trial vigente, esto es un
 * cambio de plan, no un bloqueo.
 *
 * Pantalla blanca a propósito (design_handoff_allpromos_v2/PANTALLA-12-eleccion-de-plan.md):
 * no lleva el header negro que usan el resto de las pantallas (`HeaderNegro`), la tarjeta
 * oscura del plan Anual es el único elemento invertido de esta pantalla.
 */

import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { cancelarSuscripcion, ErrorApi, precioSuscripcion } from '../src/api';
import { useAuth } from '../src/auth';
import { ConfirmacionModal } from '../src/componentes/Confirmacion';
import { MercadoPagoEmailSheet } from '../src/componentes/MercadoPagoEmailSheet';
import { PlanSelect, type PreciosPlanes } from '../src/componentes/PlanSelect';
import { Problema } from '../src/componentes/comunes';
import { useFlujoDePago } from '../src/flujoDePago';
import { estadoSuscripcionActiva, usePlanUsuario } from '../src/plan';
import { espacio, texto } from '../src/theme';
import { useTema } from '../src/useTema';

export default function PantallaPlanYPago() {
  const { paleta } = useTema();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { session } = useAuth();
  const { info: infoPlan, cargando: cargandoPlan, recargar: recargarPlan } = usePlanUsuario();
  const [precios, setPrecios] = useState<PreciosPlanes | null>(null);
  const [cargandoPrecio, setCargandoPrecio] = useState(true);
  const [mostrarConfirmarCancelar, setMostrarConfirmarCancelar] = useState(false);
  const [cancelando, setCancelando] = useState(false);
  const [errorCancelar, setErrorCancelar] = useState<string | null>(null);
  const flujoDePago = useFlujoDePago(session?.access_token ?? null, recargarPlan);

  useEffect(() => {
    precioSuscripcion()
      .then(({ precioMensualArs, precioAnualArs, precioPermanenteArs }) => {
        setPrecios(precioMensualArs && precioAnualArs && precioPermanenteArs
          ? { mensual: precioMensualArs, anual: precioAnualArs, permanente: precioPermanenteArs }
          : null);
      })
      .catch(() => setPrecios(null))
      .finally(() => setCargandoPrecio(false));
  }, []);

  const volver = () => (router.canGoBack() ? router.back() : router.replace('/ajustes'));

  const confirmarCancelarSuscripcion = async () => {
    setMostrarConfirmarCancelar(false);
    if (!session) return;
    setErrorCancelar(null);
    setCancelando(true);
    try {
      await cancelarSuscripcion(session.access_token);
      await recargarPlan();
    } catch (err) {
      setErrorCancelar(err instanceof ErrorApi ? err.message : 'No se pudo cancelar la suscripción');
    } finally {
      setCancelando(false);
    }
  };

  // Solo mensual/anual generan una suscripción (`pasarela_suscripcion_id`) que cancelar — el
  // permanente es un pago único, no hay nada que dar de baja.
  const puedeCancelar = infoPlan?.plan === 'premium' && !!infoPlan.pasarelaSuscripcionId;

  if (cargandoPlan || cargandoPrecio) {
    return (
      <View style={{ flex: 1, backgroundColor: paleta.fondo, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={paleta.tintaSuave} />
      </View>
    );
  }

  if (!precios || !session) {
    return (
      <View style={{ flex: 1, backgroundColor: paleta.fondo, padding: 20, paddingTop: insets.top + 20 }}>
        <Problema mensaje="No se pudieron consultar los precios de los planes." onReintentar={volver} />
      </View>
    );
  }

  const planElegidoInfo = flujoDePago.planElegido
    ? { id: flujoDePago.planElegido, precio: precios[flujoDePago.planElegido] }
    : null;

  return (
    <View style={{ flex: 1, backgroundColor: paleta.fondo, paddingTop: insets.top }}>
      <PlanSelect
        precios={precios}
        suscripcion={estadoSuscripcionActiva(infoPlan)}
        bloqueante={false}
        cargando={flujoDePago.enviando}
        planEnCurso={flujoDePago.planElegido}
        onElegirPlan={flujoDePago.elegirPlan}
        onCerrar={volver}
      />
      <MercadoPagoEmailSheet
        visible={flujoDePago.planElegido !== null}
        plan={planElegidoInfo ? {
          id: planElegidoInfo.id,
          precio: planElegidoInfo.precio,
          periodo: planElegidoInfo.id === 'anual' ? 'año' : planElegidoInfo.id === 'permanente' ? 'unico' : 'mes',
        } : null}
        mailApp={session.user.email ?? ''}
        mailInicial={infoPlan?.mailMercadoPago ?? session.user.email ?? ''}
        enviando={flujoDePago.enviando}
        error={flujoDePago.error}
        onConfirmar={flujoDePago.confirmarEmail}
        onCancelar={flujoDePago.cerrarHoja}
        onElegirOtroPlan={flujoDePago.cerrarHoja}
      />
      {puedeCancelar ? (
        <View style={[styles.pieCancelar, { paddingBottom: insets.bottom + espacio.md }]}>
          {errorCancelar ? (
            <Text style={[texto.cuerpo, { color: paleta.errorTexto, textAlign: 'center' }]}>{errorCancelar}</Text>
          ) : null}
          <Pressable
            onPress={() => setMostrarConfirmarCancelar(true)}
            disabled={cancelando}
            accessibilityRole="button"
            style={styles.botonCancelar}
          >
            {cancelando ? (
              <ActivityIndicator color={paleta.alerta} />
            ) : (
              <Text style={[texto.cuerpoMedio, { color: paleta.alerta }]}>Cancelar suscripción</Text>
            )}
          </Pressable>
        </View>
      ) : null}
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
  pieCancelar: { alignItems: 'center', gap: espacio.sm, paddingHorizontal: espacio.pantalla },
  botonCancelar: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
});
