-- Fechas de admin.reporte_usuarios en formato argentino (DD/MM/YYYY, hora de Buenos Aires),
-- pedido del usuario 26/10. Son texto, así que ordenar por esas columnas desde el Table Editor
-- ordena alfabéticamente (por día); el orden por defecto de la vista sigue siendo el correcto.
-- Se dropea y recrea porque `create or replace` no deja cambiar el tipo de una columna.

drop view admin.reporte_usuarios;

create view admin.reporte_usuarios as
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
  to_char(u.created_at at time zone 'America/Argentina/Buenos_Aires', 'DD/MM/YYYY') as alta,
  to_char(p.trial_termina_en at time zone 'America/Argentina/Buenos_Aires', 'DD/MM/YYYY') as fin_trial,
  -- Positivo: días que le quedan. Negativo: hace cuántos días se le venció.
  ((p.trial_termina_en at time zone 'America/Argentina/Buenos_Aires')::date
   - (now() at time zone 'America/Argentina/Buenos_Aires')::date) as dias_trial,
  to_char(u.last_sign_in_at at time zone 'America/Argentina/Buenos_Aires', 'DD/MM/YYYY') as ultimo_login,
  coalesce(c.cantidad, 0) as comparaciones,
  to_char(c.ultima at time zone 'America/Argentina/Buenos_Aires', 'DD/MM/YYYY') as ultima_comparacion,
  round(coalesce(c.ahorro, 0)::numeric) as ahorro_total,
  coalesce(i.registradas, 0) as invitados,
  coalesce(i.validas, 0) as invitados_validos,
  u.email_confirmed_at is not null as mail_confirmado,
  p.aviso_fin_trial_enviado,
  to_char(p.plan_bajado_a_gratis_en at time zone 'America/Argentina/Buenos_Aires', 'DD/MM/YYYY') as bajado_a_gratis,
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
