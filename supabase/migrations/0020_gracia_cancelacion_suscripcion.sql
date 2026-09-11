-- Fix: cancelar una suscripción (mensual/anual) bajaba el plan a 'gratis' al instante, en vez de
-- mantener el acceso hasta el final del período ya pagado (política confirmada 2026-09-11 con el
-- usuario, ver .claude/docs/Plan_Usuarios_y_cobros.md § "Cancelación": "no se cobra el próximo
-- período, pero se mantiene el acceso hasta que termine el ya pagado, sin reembolso"). Esta
-- migración agrega la columna que guarda hasta cuándo sigue vigente ese acceso ya pagado, y
-- extiende el downgrade automático diario para recién bajar el plan cuando esa fecha pasa.

alter table public.perfil_usuario
  add column acceso_premium_hasta timestamptz;

comment on column public.perfil_usuario.acceso_premium_hasta is 'Cuando una suscripción se cancela o pausa, el plan queda en premium hasta esta fecha (el período ya pagado, tomado de siguiente_cobro_en al momento de cancelar) en vez de bajar al instante. Null si no hay ninguna cancelación pendiente de efectivizar.';

create or replace function public.bajar_planes_vencidos()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.perfil_usuario
  set plan = 'gratis'
  where plan = 'trial'
    and trial_termina_en < now()
    and pasarela_suscripcion_id is null
    and not premium_manual;

  -- Suscripciones canceladas/pausadas cuyo período ya pagado terminó (ver procesarSuscripcion
  -- en procesarPagoMercadoPago.js, que es quien setea acceso_premium_hasta al cancelar).
  update public.perfil_usuario
  set plan = 'gratis', tipo_plan = null, acceso_premium_hasta = null
  where plan = 'premium'
    and acceso_premium_hasta is not null
    and acceso_premium_hasta < now()
    and not premium_manual;
end;
$$;
