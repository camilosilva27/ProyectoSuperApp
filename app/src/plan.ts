/**
 * Lee el plan del usuario logueado (Plan_Usuarios_y_cobros.md, Fase 2) directo de
 * `perfil_usuario` en Supabase — mismo patrón de "frontend habla directo con Supabase para
 * datos personales" que `sincronizacionPersistente.ts`, pero de solo lectura: no hay estado
 * local que sincronizar acá, `ajustes.tsx` solo necesita mostrarlo y disparar `recargar()`
 * después de crear/cancelar una suscripción.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from './auth';
import { planDelToken, refrescarSesionCompartida, supabase } from './supabase';
import { verificarPago } from './api';

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
  /** Si la suscripción se canceló/pausó con un período ya pagado por delante, hasta cuándo
   *  sigue el acceso premium (ver migración 0020_gracia_cancelacion_suscripcion.sql). `null`
   *  si no hay ninguna cancelación pendiente de efectivizar. */
  accesoPremiumHasta: string | null;
};

type ResultadoCarga = { info: InfoPlan | null; error: string | null };

/** Si `verificarPago` corrió hace menos que esto para el mismo usuario, no se repite: evita que
 *  las 3 instancias del hook (gate, ajustes, plan-y-pago) consulten a Mercado Pago cada una, y
 *  que cada vuelta a la pestaña dispare otra consulta. Corto a propósito: al volver del checkout
 *  de MP (varios segundos después de abrirlo) tiene que volver a correr. */
const INTERVALO_MIN_VERIFICAR_MS = 10_000;
let ultimaVerificacion: { userId: string; en: number } | null = null;
/** Carga en curso compartida entre instancias del hook (mismo usuario → mismo pedido). */
let cargaEnCurso: { userId: string; promesa: Promise<ResultadoCarga> } | null = null;

async function cargarInfoPlan(userId: string, accessToken: string | null): Promise<ResultadoCarga> {
  // Chequeo activo contra Mercado Pago antes de leer: el webhook puede demorar días en avisar
  // un pago ya aprobado (ver Plan_Usuarios_y_cobros.md), así que no alcanza con esperarlo.
  // Falla en silencio (sin bloquear la lectura de abajo) si el backend no responde — el
  // webhook sigue siendo la vía de fondo, esto solo adelanta el caso feliz.
  const verificacionReciente = ultimaVerificacion?.userId === userId
    && Date.now() - ultimaVerificacion.en < INTERVALO_MIN_VERIFICAR_MS;
  if (accessToken && !verificacionReciente) {
    ultimaVerificacion = { userId, en: Date.now() };
    await verificarPago(accessToken).catch(() => null);
  }
  const { data, error } = await supabase
    .from('perfil_usuario')
    .select(`
      plan, tipo_plan, trial_termina_en, pasarela_suscripcion_id, suscripcion_estado,
      mail_mercado_pago, siguiente_cobro_en, pagado_en, acceso_premium_hasta
    `)
    .eq('id', userId)
    .single();
  // Antes (hasta la auditoría 2026-09-24) el error se ignoraba y quedaba `info: null`, que el
  // gate interpretaba como "no hay nada que bloquear": el usuario pasaba y veía errores
  // genéricos en todas las pantallas. Ahora se reporta para que el gate muestre "Reintentar".
  if (error || !data) {
    return { info: null, error: error?.message ?? 'No se encontró el perfil del usuario' };
  }
  const info: InfoPlan = {
    plan: data.plan,
    tipoPlan: data.tipo_plan,
    trialTerminaEn: data.trial_termina_en,
    pasarelaSuscripcionId: data.pasarela_suscripcion_id,
    suscripcionEstado: data.suscripcion_estado,
    mailMercadoPago: data.mail_mercado_pago,
    renuevaEl: data.siguiente_cobro_en,
    pagadoEl: data.pagado_en,
    accesoPremiumHasta: data.acceso_premium_hasta,
  };
  // Bug "bloqueado después de pagar" (auditoría 2026-09-24): el backend decide acceso con el
  // claim `plan` del JWT (Auth Hook, migración 0006), no con esta fila. Si la fila ya cambió
  // (ej. pasó a premium tras verificar el pago) y el token todavía trae el plan viejo, se
  // renueva la sesión ya — si no, `/api/*` sigue respondiendo 403 hasta el auto-refresh (~1h).
  const planToken = planDelToken(accessToken);
  if (planToken !== null && planToken !== info.plan) {
    await refrescarSesionCompartida();
  }
  return { info, error: null };
}

function cargarInfoPlanCompartida(userId: string, accessToken: string | null) {
  if (cargaEnCurso?.userId === userId) return cargaEnCurso.promesa;
  const promesa = cargarInfoPlan(userId, accessToken).finally(() => {
    if (cargaEnCurso?.promesa === promesa) cargaEnCurso = null;
  });
  cargaEnCurso = { userId, promesa };
  return promesa;
}

export function usePlanUsuario() {
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  // El token se lee por ref: `recargar` depende solo del user id. Antes dependía de `session`
  // entero, y cada auto-refresh del token (o el refresh que dispara este mismo hook) recreaba
  // `recargar` → el efecto de abajo volvía a correr → otra consulta a Mercado Pago.
  const tokenRef = useRef<string | null>(session?.access_token ?? null);
  tokenRef.current = session?.access_token ?? null;
  const [info, setInfo] = useState<InfoPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);

  const recargar = useCallback(async () => {
    if (!userId) {
      setInfo(null);
      setError(null);
      setCargando(false);
      return;
    }
    setCargando(true);
    const resultado = await cargarInfoPlanCompartida(userId, tokenRef.current);
    // En una revalidación fallida se conserva el último `info` bueno: tirarlo a null haría que el
    // gate deje de bloquear (o que desbloquee) por un error de red momentáneo.
    if (resultado.info) setInfo(resultado.info);
    setError(resultado.error);
    setCargando(false);
  }, [userId]);

  // Cambio de usuario: no arrastrar el plan del anterior si la primera lectura del nuevo falla.
  useEffect(() => { setInfo(null); setError(null); }, [userId]);
  useEffect(() => { recargar(); }, [recargar]);

  return { info, cargando, error, recargar };
}

export type PlanId = 'mensual' | 'anual' | 'permanente';

export type Plan = { id: PlanId; precio: number; periodo: 'mes' | 'año' | 'unico' };

export type EstadoSuscripcionPlan = {
  planId: PlanId | null;
  renuevaEl: string | null;
  pagadoEl: string | null;
};

/**
 * Desde la auditoría 2026-09-24, `tipo_plan` se escribe recién cuando MP confirma el pago
 * (procesarPagoMercadoPago.js), no al abrir el checkout — así un cambio de plan abandonado no
 * muestra el plan intentado como si fuera el actual. Igual se exige `plan === 'premium'`: una
 * fila vieja o un plan en período de gracia pueden tener `tipo_plan` sin estar cobrando.
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
