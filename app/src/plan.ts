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
  /** Mail confirmado/editado en `MercadoPagoEmailSheet` en el último intento de cobro — se usa
   *  para prellenar la hoja la próxima vez. `null` hasta el primer intento. */
  mailMercadoPago: string | null;
  /** Próximo cobro de la suscripción (mensual/anual), guardado desde el webhook de MP.
   *  `null` para plan permanente o sin plan activo. */
  renuevaEl: string | null;
  /** Fecha del pago único aprobado del plan permanente. `null` para mensual/anual. */
  pagadoEl: string | null;
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
      .select(`
        plan, tipo_plan, trial_termina_en, pasarela_suscripcion_id, suscripcion_estado,
        mail_mercado_pago, siguiente_cobro_en, pagado_en
      `)
      .eq('id', userId)
      .single();
    setInfo(data ? {
      plan: data.plan,
      tipoPlan: data.tipo_plan,
      trialTerminaEn: data.trial_termina_en,
      pasarelaSuscripcionId: data.pasarela_suscripcion_id,
      suscripcionEstado: data.suscripcion_estado,
      mailMercadoPago: data.mail_mercado_pago,
      renuevaEl: data.siguiente_cobro_en,
      pagadoEl: data.pagado_en,
    } : null);
    setCargando(false);
  }, [userId]);

  useEffect(() => { recargar(); }, [recargar]);

  return { info, cargando, recargar };
}

export type PlanId = 'mensual' | 'anual' | 'permanente';

export type Plan = { id: PlanId; precio: number; periodo: 'mes' | 'año' | 'unico' };

export type EstadoSuscripcionPlan = {
  planId: PlanId | null;
  renuevaEl: string | null;
  pagadoEl: string | null;
};

/**
 * `tipo_plan` se guarda al CREAR una suscripción/pago en Mercado Pago (`pagos.js`), antes de
 * que el usuario termine de pagar — es así a propósito para trackear qué está intentando pagar
 * (opciones_planes.md, Fase 3). Por eso `tipoPlan` sigue teniendo un valor aunque el usuario
 * cancele el checkout sin pagar nada: solo `plan === 'premium'` confirma que se cobró de verdad
 * (lo pone el webhook). Sin este chequeo, `PlanSelect` mostraba la tarjeta del plan intentado
 * como "tu plan actual" (colapsada, sin precio ni CTA) incluso cuando el usuario canceló en MP.
 */
export function estadoSuscripcionActiva(info: InfoPlan | null): EstadoSuscripcionPlan {
  if (info?.plan !== 'premium') return { planId: null, renuevaEl: null, pagadoEl: null };
  return { planId: info.tipoPlan, renuevaEl: info.renuevaEl, pagadoEl: info.pagadoEl };
}

/** Costo normalizado por mes (design_handoff_allpromos_v2/PANTALLA-12-eleccion-de-plan.md § "Eje
 *  de comparación") — es el único número que se compara de un vistazo entre los tres planes.
 *  `null` para el permanente: no tiene sentido expresarlo como costo mensual. */
export function costoPorMes(plan: Plan): number | null {
  if (plan.periodo === 'unico') return null;
  if (plan.periodo === 'año') return Math.round(plan.precio / 12);
  return plan.precio;
}

/** Lo que el anual ahorra contra pagar mensual doce veces — badge "AHORRÁS $X POR AÑO" en 12b. */
export function ahorroAnual(precioMensual: number, precioAnual: number): number {
  return precioMensual * 12 - precioAnual;
}

/** Días enteros que faltan para `trialTerminaEn` (redondeado para arriba: "vence mañana" en
 *  vez de "vence en 0 días" cuando faltan pocas horas), o `null` si ya venció o no hay fecha. */
export function diasRestantesTrial(trialTerminaEn: string | null): number | null {
  if (!trialTerminaEn) return null;
  const ms = new Date(trialTerminaEn).getTime() - Date.now();
  if (ms <= 0) return null;
  return Math.ceil(ms / (1000 * 60 * 60 * 24));
}
