/**
 * Orquesta `PlanSelect` + `MercadoPagoEmailSheet` + `abrirCheckoutPago` (turnos 12/13) — un solo
 * lugar para no duplicar esta lógica entre `GatePaywallFinTrial` (bloqueante) y la pantalla
 * `plan-y-pago` (desde Ajustes).
 *
 * El mail no se resetea entre reintentos: si `POST /checkout` falla, `MercadoPagoEmailSheet`
 * guarda lo que el usuario escribió y "Probar de nuevo" llama de nuevo a `confirmarEmail` con
 * ese mismo mail — por eso `confirmarEmail` es la única función que el 13c necesita.
 */

import { useCallback, useState } from 'react';
import { abrirCheckoutPago } from './abrirCheckoutPago';
import { crearPagoUnico, crearSuscripcion, ErrorApi } from './api';
import type { PlanId } from './plan';

export function useFlujoDePago(accessToken: string | null, onCambioDePlan: () => void) {
  const [planElegido, setPlanElegido] = useState<PlanId | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const elegirPlan = useCallback((planId: PlanId) => {
    setError(null);
    setPlanElegido(planId);
  }, []);

  const cerrarHoja = useCallback(() => {
    setPlanElegido(null);
    setError(null);
    setEnviando(false);
  }, []);

  const confirmarEmail = useCallback(async (email: string) => {
    if (!accessToken || !planElegido || enviando) return;
    setEnviando(true);
    setError(null);
    try {
      await abrirCheckoutPago(() => (
        planElegido === 'permanente'
          ? crearPagoUnico(accessToken, email)
          : crearSuscripcion(accessToken, planElegido, email)
      ));
      onCambioDePlan();
      setPlanElegido(null);
    } catch (err) {
      setError(err instanceof ErrorApi ? err.message : 'No se pudo abrir el checkout de Mercado Pago');
    } finally {
      setEnviando(false);
    }
  }, [accessToken, planElegido, enviando, onCambioDePlan]);

  return { planElegido, enviando, error, elegirPlan, cerrarHoja, confirmarEmail };
}
