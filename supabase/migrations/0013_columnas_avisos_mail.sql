-- Columnas de soporte para los mails de resumen mensual / aviso de fin de trial / inactividad
-- (mails_y_notificaciones.md). Ninguna dispara el envío por sí sola — eso lo hacen los crons
-- nuevos en backend/src/cron/ — pero necesitan saber "desde cuándo" pasó algo, y eso no vive
-- en ningún lado hoy.

-- Desde cuándo el usuario está en plan 'gratis' (bloqueado). Sin esto no hay forma de
-- distinguir a alguien que acaba de caer del trial (todavía queremos mandarle el resumen
-- mensual con lo que ahorró mientras tuvo acceso) de alguien bloqueado hace meses (no tiene
-- sentido mandarle un resumen de un mes en el que no pudo usar la app). Se mantiene con un
-- trigger en vez de calcularlo en cada cron porque plan puede pasar a 'gratis' desde tres
-- lugares distintos (bajar_planes_vencidos, el webhook de MP, y cancelar-suscripcion) — un
-- solo trigger a nivel de tabla es más confiable que repetir la lógica en los tres.
alter table public.perfil_usuario
  add column plan_bajado_a_gratis_en timestamptz;

comment on column public.perfil_usuario.plan_bajado_a_gratis_en is
  'Cuándo pasó plan a gratis por última vez (trigger). Null si nunca estuvo en gratis o si volvió a trial/premium después.';

create or replace function public.marcar_cuando_cae_a_gratis()
returns trigger
language plpgsql
as $$
begin
  if new.plan = 'gratis' and old.plan is distinct from 'gratis' then
    new.plan_bajado_a_gratis_en := now();
  elsif new.plan is distinct from 'gratis' and old.plan = 'gratis' then
    new.plan_bajado_a_gratis_en := null;
  end if;
  return new;
end;
$$;

create trigger antes_de_actualizar_plan
  before update on public.perfil_usuario
  for each row
  when (new.plan is distinct from old.plan)
  execute function public.marcar_cuando_cae_a_gratis();

-- Idempotencia del aviso de fin de trial (backend/src/cron/avisoFinTrial.js): el trial se
-- fija una sola vez por usuario (trial_termina_en no cambia en la vida normal de la cuenta),
-- así que un flag simple alcanza — no hace falta guardar cuándo se mandó.
alter table public.perfil_usuario
  add column aviso_fin_trial_enviado boolean not null default false;

comment on column public.perfil_usuario.aviso_fin_trial_enviado is
  'Si ya se mandó el mail de "tu prueba termina en 3 días" para el trial actual.';

-- Idempotencia del mail de inactividad (backend/src/cron/avisoInactividad.js): a diferencia
-- del de arriba, acá si hace falta la fecha (no un boolean) — un usuario puede volver a
-- loguearse y caer en inactividad de nuevo más adelante, y en ese caso sí corresponde
-- mandarle el aviso otra vez. El cron compara este timestamp contra el último login
-- (auth.users.last_sign_in_at, no está en esta tabla) para decidir si ya está cubierto.
alter table public.perfil_usuario
  add column aviso_inactividad_enviado_en timestamptz;

comment on column public.perfil_usuario.aviso_inactividad_enviado_en is
  'Cuándo se mandó el último mail de inactividad. Si es anterior al último login del usuario, se lo puede volver a mandar.';
