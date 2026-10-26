-- Reporte de usuarios para seguimiento manual (2026-10-26): quién se registró cuándo, cuándo
-- vence su trial, a quién se le venció sin pagar y cuánto usó la app antes de irse. La idea es
-- poder ver en el dashboard de Supabase (Table Editor, schema "admin") a quién contactar para
-- preguntarle por qué no siguió, sin automatizar nada todavía.
--
-- Va en un schema propio ("admin") y no en "public" a propósito: "public" lo expone la API de
-- Supabase (PostgREST) a cualquiera con la anon key, y esta vista lee auth.users (mails). El
-- schema "admin" no está en los "Exposed schemas" de la API, así que solo se ve desde el
-- dashboard (rol postgres). Además se revoca todo a anon/authenticated por si alguien lo expone.

create schema if not exists admin;
revoke all on schema admin from public, anon, authenticated;

create or replace view admin.reporte_usuarios as
with comparaciones as (
  select usuario_id, count(*) as cantidad, max(fecha) as ultima, sum(monto) as ahorro
  from public.ahorro_registro
  group by usuario_id
),
invitaciones as (
  select invitador_id,
         count(*) as registradas,
         count(*) filter (where estado = 'valida') as validas
  from public.referido
  group by invitador_id
)
select
  case
    when p.premium_manual then 'regalado'
    when p.plan = 'premium' and p.acceso_premium_hasta is not null then 'premium temporal'
    when p.plan = 'premium' then 'pago ' || coalesce(p.tipo_plan, '?')
    when p.plan = 'trial' and p.trial_termina_en > now() then 'en trial'
    else 'vencido sin pagar'
  end as estado,
  u.email,
  p.nombre,
  u.created_at::date as alta,
  p.trial_termina_en::date as fin_trial,
  -- Positivo: días que le quedan. Negativo: hace cuántos días se le venció.
  (p.trial_termina_en::date - current_date) as dias_trial,
  u.last_sign_in_at::date as ultimo_login,
  coalesce(c.cantidad, 0) as comparaciones,
  c.ultima::date as ultima_comparacion,
  round(coalesce(c.ahorro, 0)::numeric) as ahorro_total,
  coalesce(i.registradas, 0) as invitados,
  coalesce(i.validas, 0) as invitados_validos,
  u.email_confirmed_at is not null as mail_confirmado,
  p.aviso_fin_trial_enviado,
  p.plan_bajado_a_gratis_en::date as bajado_a_gratis,
  p.suscripcion_estado,
  p.plan,
  u.id
from auth.users u
join public.perfil_usuario p on p.id = u.id
left join comparaciones c on c.usuario_id = u.id
left join invitaciones i on i.invitador_id = u.id
order by
  -- Primero los vencidos sin pagar (los que hay que seguir), después los próximos a vencer.
  case when p.plan in ('trial', 'gratis') and not p.premium_manual then 0 else 1 end,
  p.trial_termina_en;

revoke all on admin.reporte_usuarios from public, anon, authenticated;
