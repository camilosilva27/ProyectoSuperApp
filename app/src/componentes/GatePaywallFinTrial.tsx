/**
 * Gate de acceso pago (Fase 2, Plan_Usuarios_y_cobros.md § "Feature candidata: 'cuánto
 * ahorraste'"). Va adentro de `GateSesion` en `_layout.tsx`: para cuando esto se evalúa ya hay
 * sesión, así que solo falta decidir si el usuario logueado puede ver el resto de la
 * navegación o el bloqueo (`PaywallFinTrial`).
 *
 * Regla decidida (2026-08-21, corrige el alcance original de "solo fin de trial"): sin pagar
 * no se usa la app, salvo estar dentro del trial vigente. No hay "plan gratis" navegable ni
 * salida sin pagar — por eso `PaywallFinTrial` ya no tiene un botón de "continuar gratis", y
 * este gate no persiste ningún "ya lo vi": se re-evalúa en cada carga y bloquea siempre que
 * corresponda, sin excepción de una sola vez.
 *
 * `bloqueado` es true salvo `plan==='premium'` o estar en un trial todavía no vencido. El
 * chequeo de vencimiento se hace contra `trialTerminaEn` en el cliente, no contra `plan`
 * directamente: `bajar_planes_vencidos()` (cron diario, `supabase/migrations/0005_...sql`)
 * puede tardar hasta 24hs en pasar `plan` de `'trial'` a `'gratis'`, y ese hueco ya no es
 * aceptable ahora que este gate es la única barrera real de acceso, no una pantalla informativa.
 *
 * Dos motivos posibles de bloqueo, con textos distintos en `PaywallFinTrial`:
 * - Nunca hubo una suscripción confirmada (fin de trial sin pagar nunca): se muestra el ahorro
 *   acumulado durante la ventana del trial ("este mes de prueba").
 * - Hubo un premium que se canceló o pausó (`suscripcionEstado`): se muestra el ahorro
 *   acumulado de siempre, porque hablar de "mes de prueba" no tendría sentido para alguien que
 *   ya fue premium después de esa prueba.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AppState, Linking, View } from 'react-native';
import { crearSuscripcion, ErrorApi, precioSuscripcion } from '../api';
import { useAuth } from '../auth';
import { calcularResumenAhorro, type EventoAhorro, useHistorialAhorro } from '../historialAhorro';
import { usePlanUsuario } from '../plan';
import { useTema } from '../useTema';
import { PaywallFinTrial } from './PaywallFinTrial';

/** Ahorro acumulado dentro de la ventana del trial (sus 30 días), no el total histórico. */
function ahorroDuranteTrial(eventos: EventoAhorro[], trialTerminaEn: string | null) {
  if (!trialTerminaEn) return { monto: 0, conteo: 0 };
  const fin = new Date(trialTerminaEn).getTime();
  const inicio = fin - 30 * 24 * 60 * 60 * 1000;
  const enTrial = eventos.filter(({ fecha }) => {
    const t = new Date(fecha).getTime();
    return !Number.isNaN(t) && t >= inicio && t <= fin;
  });
  return {
    monto: enTrial.reduce((acc, e) => acc + e.monto, 0),
    conteo: enTrial.length,
  };
}

export function GatePaywallFinTrial({ children }: { children: React.ReactNode }) {
  const { paleta } = useTema();
  const { session } = useAuth();
  const { info: infoPlan, cargando: cargandoPlan, recargar: recargarPlan } = usePlanUsuario();
  const { eventos } = useHistorialAhorro();

  const [precioMensual, setPrecioMensual] = useState<number | null>(null);
  const [cargandoPrecio, setCargandoPrecio] = useState(true);
  const [suscribiendo, setSuscribiendo] = useState(false);
  const [errorSuscripcion, setErrorSuscripcion] = useState<string | null>(null);

  useEffect(() => {
    precioSuscripcion()
      .then(({ precioMensualArs }) => setPrecioMensual(precioMensualArs))
      .catch(() => setPrecioMensual(null))
      .finally(() => setCargandoPrecio(false));
  }, []);

  // Vuelve a pedir el plan al volver a la app (ej. después de ir y volver del checkout de
  // Mercado Pago) — si el pago se acreditó, el próximo render ya no bloquea.
  useEffect(() => {
    const sub = AppState.addEventListener('change', estado => {
      if (estado === 'active') recargarPlan();
    });
    return () => sub.remove();
  }, [recargarPlan]);

  const trialVencido = infoPlan?.trialTerminaEn
    ? new Date(infoPlan.trialTerminaEn).getTime() <= Date.now()
    : false;
  const enTrialVigente = infoPlan?.plan === 'trial' && !trialVencido;
  const premium = infoPlan?.plan === 'premium';
  const bloqueado = !!infoPlan && !premium && !enTrialVigente;

  const huboSuscripcionPrevia = infoPlan?.suscripcionEstado === 'cancelled'
    || infoPlan?.suscripcionEstado === 'paused';

  const resumenTrial = useMemo(
    () => ahorroDuranteTrial(eventos, infoPlan?.trialTerminaEn ?? null),
    [eventos, infoPlan?.trialTerminaEn],
  );
  const resumenTotal = useMemo(() => calcularResumenAhorro(eventos), [eventos]);
  const resumen = huboSuscripcionPrevia
    ? { monto: resumenTotal.totalMonto, conteo: resumenTotal.totalConteo }
    : resumenTrial;

  const cargando = cargandoPlan || cargandoPrecio;
  const mostrarPaywall = !cargando && bloqueado && precioMensual !== null;

  const onSuscribirse = useCallback(async () => {
    if (!session || suscribiendo) return;
    setSuscribiendo(true);
    setErrorSuscripcion(null);
    try {
      const { initPoint } = await crearSuscripcion(session.access_token);
      await Linking.openURL(initPoint);
    } catch (err) {
      setErrorSuscripcion(err instanceof ErrorApi ? err.message : 'No se pudo iniciar la suscripción');
    } finally {
      setSuscribiendo(false);
    }
  }, [session, suscribiendo]);

  // Mismo criterio que GateSesion/_layout.tsx: pantalla lisa mientras se resuelve si hay que
  // bloquear, no un parpadeo mostrando primero la navegación y después el paywall encima.
  if (cargando) {
    return <View style={{ flex: 1, backgroundColor: paleta.fondo }} />;
  }

  if (mostrarPaywall) {
    return (
      <PaywallFinTrial
        montoAhorradoTrial={resumen.monto}
        conteoComparaciones={resumen.conteo}
        precioMensual={precioMensual as number}
        onSuscribirse={onSuscribirse}
        enviando={suscribiendo}
        error={errorSuscripcion}
        titulo={huboSuscripcionPrevia ? 'SIN SUSCRIPCIÓN ACTIVA' : 'TERMINÓ TU MES DE PRUEBA'}
        etiquetaPeriodo={huboSuscripcionPrevia ? 'desde que usás la app' : 'este mes de prueba'}
      />
    );
  }

  return <>{children}</>;
}
