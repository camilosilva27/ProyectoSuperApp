-- Cambio de plan y plan permanente (auditoría 2026-09-24, .claude/docs/AUDITORIA_2026-09-24.md).
--
-- 1) pasarela_suscripcion_anterior_id: al pasarse de un plan recurrente a otro (mensual ↔ anual,
--    o a permanente), la suscripción vieja NO se cancela al abrir el checkout nuevo sino recién
--    cuando MP confirma el pago nuevo (decisión del usuario 2026-09-24: si abandona el checkout
--    no pierde nada). Mientras tanto hay que recordar el id de la vieja para poder cancelarla
--    después — antes se pisaba y MP seguía cobrando las dos suscripciones.
--
-- 2) bajar_planes_vencidos():
--    - Nunca baja un plan permanente, aunque haya quedado un acceso_premium_hasta sucio de una
--      suscripción vieja.
--    - El trial vencido se baja aunque haya un pasarela_suscripcion_id: un usuario en trial
--      con ese campo seteado es un checkout abandonado (si se hubiera autorizado, el plan ya
--      sería premium). Antes quedaba con trial eterno en el backend.

alter table public.perfil_usuario
  add column pasarela_suscripcion_anterior_id text;

comment on column public.perfil_usuario.pasarela_suscripcion_anterior_id is 'Suscripción de MP que estaba activa cuando el usuario abrió el checkout de otro plan. Se cancela en MP y se limpia cuando el pago nuevo se confirma (procesarPagoMercadoPago.js). Null si no hay cambio de plan en curso.';

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
    and not premium_manual;

  -- Suscripciones canceladas/pausadas cuyo período ya pagado terminó (ver procesarSuscripcion
  -- en procesarPagoMercadoPago.js, que es quien setea acceso_premium_hasta al cancelar).
  update public.perfil_usuario
  set plan = 'gratis', tipo_plan = null, acceso_premium_hasta = null
  where plan = 'premium'
    and acceso_premium_hasta is not null
    and acceso_premium_hasta < now()
    and tipo_plan is distinct from 'permanente'
    and not premium_manual;
end;
$$;

-- create or replace conserva los permisos, pero se reafirma por las dudas (0005 los revocó).
revoke execute on function public.bajar_planes_vencidos() from public, anon, authenticated;
