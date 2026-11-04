-- Mail "¿Por qué no seguiste?" a quien se le venció la prueba gratis sin pagar
-- (backend/src/cron/feedbackTrialVencido.js, routes/feedbackTrial.js; ver
-- .claude/docs/mails_y_notificaciones.md). Tres piezas:
--
-- 1. `plan_anterior_a_gratis`: de qué plan cayó a 'gratis' (lo setea el mismo trigger que ya
--    mantiene `plan_bajado_a_gratis_en`, migración 0013). El mail va SOLO a quien venía de
--    'trial' (decisión 2026-11-04), no a quien pagó y canceló — y `plan_bajado_a_gratis_en`
--    solo no permite distinguirlos.
-- 2. `mail_feedback_trial_enviado_en`: idempotencia del mail (se manda una sola vez).
-- 3. Tabla `feedback_trial`: la razón elegida (botón del mail) + comentario libre opcional.

alter table public.perfil_usuario
  add column plan_anterior_a_gratis text,
  add column mail_feedback_trial_enviado_en timestamptz;

comment on column public.perfil_usuario.plan_anterior_a_gratis is
  'Plan del que cayó a gratis la última vez (trigger marcar_cuando_cae_a_gratis). Null si no está en gratis.';
comment on column public.perfil_usuario.mail_feedback_trial_enviado_en is
  'Cuándo se mandó el mail "¿Por qué no seguiste?" (cron feedbackTrialVencido.js). Una sola vez por usuario.';

create or replace function public.marcar_cuando_cae_a_gratis()
returns trigger
language plpgsql
as $$
begin
  if new.plan = 'gratis' and old.plan is distinct from 'gratis' then
    new.plan_bajado_a_gratis_en := now();
    new.plan_anterior_a_gratis := old.plan;
  elsif new.plan is distinct from 'gratis' and old.plan = 'gratis' then
    new.plan_bajado_a_gratis_en := null;
    new.plan_anterior_a_gratis := null;
  end if;
  return new;
end;
$$;

-- Relleno de quienes YA están en gratis (aproximado: sin rastro de pago = venía de trial). Solo
-- importa para los vencidos en los últimos días: el cron no mira a quien cayó hace más de
-- DIAS_MAXIMO días, así que nadie viejo recibe el mail por este relleno.
update public.perfil_usuario
set plan_anterior_a_gratis = case
  when pagado_en is null and pasarela_suscripcion_id is null and tipo_plan is null then 'trial'
  else 'premium'
end
where plan = 'gratis';

create table public.feedback_trial (
  usuario_id uuid primary key references auth.users(id) on delete cascade,
  razon text not null check (razon in ('caro', 'poco_ahorro', 'falta_super', 'no_la_use', 'otra')),
  comentario text check (char_length(comentario) <= 2000),
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

comment on table public.feedback_trial is
  'Respuesta al mail "¿Por qué no seguiste?" (una por usuario, la última pisa). Solo service role.';

-- Sin policies a propósito: la escribe el backend con service role (routes/feedbackTrial.js,
-- autenticado por el token HMAC del link) y se lee desde el dashboard. Nadie desde el cliente.
alter table public.feedback_trial enable row level security;
