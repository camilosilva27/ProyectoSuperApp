-- Idempotencia del mail de bienvenida (backend/src/mailBienvenida.js, disparado por
-- backend/src/routes/webhookAuthUsuarios.js cuando confirma el mail por primera vez). Flag
-- simple: a diferencia del de inactividad, este evento pasa una sola vez en la vida de la
-- cuenta (auth.users.email_confirmed_at nunca vuelve a null), así que no hace falta guardar
-- una fecha, mismo criterio que aviso_fin_trial_enviado (migración 0013).
alter table public.perfil_usuario
  add column mail_bienvenida_enviado boolean not null default false;

comment on column public.perfil_usuario.mail_bienvenida_enviado is
  'Si ya se mandó el mail de bienvenida al confirmar el mail de registro.';
