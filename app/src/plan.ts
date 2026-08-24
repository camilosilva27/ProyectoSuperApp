/**
 * Lee el plan del usuario logueado (Plan_Usuarios_y_cobros.md, Fase 2) directo de
 * `perfil_usuario` en Supabase — mismo patrón de "frontend habla directo con Supabase para
 * datos personales" que `sincronizacionPersistente.ts`, pero de solo lectura: no hay estado
 * local que sincronizar acá, `ajustes.tsx` solo necesita mostrarlo y disparar `recargar()`
 * después de crear/cancelar una suscripción.
 */

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from './auth';
import { supabase } from './supabase';

export type InfoPlan = {
  plan: 'trial' | 'premium' | 'gratis';
  tipoPlan: 'mensual' | 'anual' | 'permanente' | null;
  trialTerminaEn: string | null;
  pasarelaSuscripcionId: string | null;
  suscripcionEstado: string | null;
};

export function usePlanUsuario() {
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  const [info, setInfo] = useState<InfoPlan | null>(null);
  const [cargando, setCargando] = useState(true);

  const recargar = useCallback(async () => {
    if (!userId) {
      setInfo(null);
      setCargando(false);
      return;
    }
    setCargando(true);
    const { data } = await supabase
      .from('perfil_usuario')
      .select('plan, tipo_plan, trial_termina_en, pasarela_suscripcion_id, suscripcion_estado')
      .eq('id', userId)
      .single();
    setInfo(data ? {
      plan: data.plan,
      tipoPlan: data.tipo_plan,
      trialTerminaEn: data.trial_termina_en,
      pasarelaSuscripcionId: data.pasarela_suscripcion_id,
      suscripcionEstado: data.suscripcion_estado,
    } : null);
    setCargando(false);
  }, [userId]);

  useEffect(() => { recargar(); }, [recargar]);

  return { info, cargando, recargar };
}

/** Días enteros que faltan para `trialTerminaEn` (redondeado para arriba: "vence mañana" en
 *  vez de "vence en 0 días" cuando faltan pocas horas), o `null` si ya venció o no hay fecha. */
export function diasRestantesTrial(trialTerminaEn: string | null): number | null {
  if (!trialTerminaEn) return null;
  const ms = new Date(trialTerminaEn).getTime() - Date.now();
  if (ms <= 0) return null;
  return Math.ceil(ms / (1000 * 60 * 60 * 24));
}
