-- Referidos: "invitá a 3 y llevate 2 meses gratis" (.claude/docs/PLAN_REFERIDOS.md).
--
-- Tres piezas:
-- 1) perfil_usuario.codigo_referido: el código del link (superahorro.com.ar/?ref=CODIGO). Lo
--    genera el backend la primera vez que el usuario abre su pantalla de referidos — a propósito
--    NO se toca manejar_usuario_nuevo() (el trigger de alta ya se rompió dos veces al redefinirlo,
--    ver 0021/0022/0029).
-- 2) referido / premio_referido: histórico que no se borra. El premio se reconstruye desde acá,
--    no es un efecto suelto sobre trial_termina_en. Solo el backend (service role) lee y escribe:
--    RLS habilitado sin policies, mismo criterio que scraper_errores (0023).
-- 3) otorgar_premio_referido() / revertir_premio_referido(): la lógica del premio vive en SQL,
--    como bajar_planes_vencidos(), para que sea atómica (lock por usuario) e idempotente, y para
--    poder correrla a mano desde el SQL editor.

-- 1) Código de referido --------------------------------------------------------------------

alter table public.perfil_usuario
  add column codigo_referido text unique
    check (codigo_referido ~ '^[A-Z0-9]{4,12}$');

comment on column public.perfil_usuario.codigo_referido is
  'Código del link de referidos (?ref=). Lo genera el backend (routes/referidos.js) la primera vez que se pide; null hasta entonces.';

-- 2) Histórico ---------------------------------------------------------------------------------

create table public.referido (
  id bigint generated always as identity primary key,
  invitador_id uuid not null references auth.users(id) on delete cascade,
  -- Una invitada tiene un solo invitador, para siempre.
  invitada_id uuid not null unique references auth.users(id) on delete cascade,
  -- auth.users.created_at de la invitada: desde acá corren los 30 días para que compare.
  registrada_en timestamptz not null,
  asociada_en timestamptz not null default now(),
  mail_confirmado_en timestamptz,
  primera_comparacion_en timestamptz,
  estado text not null default 'pendiente'
    check (estado in ('pendiente', 'valida', 'expirada', 'descartada')),
  -- Solo para 'descartada': mail_descartable | mismo_mail_que_invitador | mail_repetido.
  motivo_descarte text,
  -- Mail normalizado (Gmail sin puntos, sin +sufijo): detecta la misma casilla con otra cuenta.
  mail_normalizado text,
  check (invitador_id <> invitada_id)
);

comment on table public.referido is
  'Quién invitó a quién (PLAN_REFERIDOS.md). Histórico: no se borra. pendiente → valida (mail confirmado + primera comparación dentro de 30 días) | expirada | descartada.';

create index referido_invitador_idx on public.referido (invitador_id, estado);

alter table public.referido enable row level security;

create table public.premio_referido (
  -- Un premio por cuenta, para siempre (también si se revirtió o no aplicó).
  usuario_id uuid primary key references auth.users(id) on delete cascade,
  otorgado_en timestamptz not null default now(),
  estado text not null check (estado in ('otorgado', 'no_aplica', 'revertido')),
  -- no_aplica: suscripcion_activa | permanente | premium_manual. revertido: texto libre.
  motivo text,
  dias int not null,
  -- Foto del plan antes del premio, para poder reconstruir o revertir qué se tocó.
  plan_antes text not null,
  trial_termina_en_antes timestamptz,
  acceso_premium_hasta_antes timestamptz,
  -- Hasta cuándo quedó el acceso con el premio (null si no_aplica).
  hasta timestamptz,
  revertido_en timestamptz
);

comment on table public.premio_referido is
  'Premio de referidos (60 días). Una fila por cuenta como máximo. otorgado | no_aplica (tenía suscripción paga/permanente/manual) | revertido (fraude, a mano).';

alter table public.premio_referido enable row level security;

-- 3) Lógica del premio -------------------------------------------------------------------------

-- Otorga el premio si el usuario tiene al menos p_necesarias invitadas 'valida' y nunca tuvo
-- premio. Devuelve: 'otorgado' | 'no_aplica' | 'faltan' | 'ya_tenia'. Correrla de más no suma
-- de más (un premio por cuenta + lock por usuario).
--
-- Cómo se suman los días (decisiones del 01/10 y 12/10):
-- - trial: trial_termina_en += días (sobre el trial vigente; si ya venció y el cron todavía no
--   lo bajó, se cuenta desde ahora).
-- - gratis: hay que reactivarlo — plan='premium' + acceso_premium_hasta = ahora + días (solo
--   acceso_premium_hasta no alcanza: solo tiene efecto con plan='premium'). bajar_planes_vencidos()
--   lo vuelve a bajar cuando la fecha pasa.
-- - premium con acceso_premium_hasta (suscripción cancelada en período de gracia, o un premio
--   anterior): se suma a esa fecha.
-- - premium sin acceso_premium_hasta (suscripción paga activa), permanente o premium_manual:
--   no aplica — queda registrado como 'no_aplica' para que no parezca un error.
create or replace function public.otorgar_premio_referido(p_usuario uuid, p_necesarias int, p_dias int)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_validas int;
  v_perfil public.perfil_usuario%rowtype;
  v_motivo text;
  v_hasta timestamptz;
begin
  perform pg_advisory_xact_lock(hashtext('premio_referido:' || p_usuario::text));

  if exists (select 1 from public.premio_referido where usuario_id = p_usuario) then
    return 'ya_tenia';
  end if;

  select count(*) into v_validas
  from public.referido
  where invitador_id = p_usuario and estado = 'valida';
  if v_validas < p_necesarias then
    return 'faltan';
  end if;

  select * into v_perfil from public.perfil_usuario where id = p_usuario for update;
  if not found then
    return 'faltan';
  end if;

  if v_perfil.premium_manual then
    v_motivo := 'premium_manual';
  elsif v_perfil.tipo_plan = 'permanente' then
    v_motivo := 'permanente';
  elsif v_perfil.plan = 'premium' and v_perfil.acceso_premium_hasta is null then
    v_motivo := 'suscripcion_activa';
  end if;

  if v_motivo is not null then
    insert into public.premio_referido
      (usuario_id, estado, motivo, dias, plan_antes, trial_termina_en_antes, acceso_premium_hasta_antes)
    values
      (p_usuario, 'no_aplica', v_motivo, p_dias, v_perfil.plan, v_perfil.trial_termina_en, v_perfil.acceso_premium_hasta);
    return 'no_aplica';
  end if;

  if v_perfil.plan = 'trial' then
    v_hasta := greatest(v_perfil.trial_termina_en, now()) + make_interval(days => p_dias);
    update public.perfil_usuario set trial_termina_en = v_hasta where id = p_usuario;
  elsif v_perfil.plan = 'gratis' then
    v_hasta := now() + make_interval(days => p_dias);
    update public.perfil_usuario
    set plan = 'premium', tipo_plan = null, acceso_premium_hasta = v_hasta
    where id = p_usuario;
  else
    -- premium con acceso_premium_hasta (gracia de una suscripción cancelada).
    v_hasta := greatest(v_perfil.acceso_premium_hasta, now()) + make_interval(days => p_dias);
    update public.perfil_usuario set acceso_premium_hasta = v_hasta where id = p_usuario;
  end if;

  insert into public.premio_referido
    (usuario_id, estado, dias, plan_antes, trial_termina_en_antes, acceso_premium_hasta_antes, hasta)
  values
    (p_usuario, 'otorgado', p_dias, v_perfil.plan, v_perfil.trial_termina_en, v_perfil.acceso_premium_hasta, v_hasta);
  return 'otorgado';
end;
$$;

-- Revierte un premio otorgado (fraude descubierto después). Solo a mano desde el SQL editor:
--   select public.revertir_premio_referido('<uuid>', 'motivo');
-- Resta los días de la misma columna a la que se sumaron. No borra nada: la fila queda
-- 'revertido' con el motivo. Si el plan cambió desde entonces (ej. se suscribió), no toca
-- perfil_usuario y lo avisa en el resultado.
create or replace function public.revertir_premio_referido(p_usuario uuid, p_motivo text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_premio public.premio_referido%rowtype;
  v_perfil public.perfil_usuario%rowtype;
  v_resta interval;
  v_tocado boolean := false;
begin
  perform pg_advisory_xact_lock(hashtext('premio_referido:' || p_usuario::text));

  select * into v_premio from public.premio_referido where usuario_id = p_usuario for update;
  if not found or v_premio.estado <> 'otorgado' then
    return 'sin_premio_otorgado';
  end if;

  select * into v_perfil from public.perfil_usuario where id = p_usuario for update;
  v_resta := make_interval(days => v_premio.dias);

  if v_premio.plan_antes = 'trial' and v_perfil.plan = 'trial' then
    update public.perfil_usuario set trial_termina_en = trial_termina_en - v_resta where id = p_usuario;
    v_tocado := true;
  elsif v_perfil.plan = 'premium' and v_perfil.acceso_premium_hasta is not null
        and not v_perfil.premium_manual and v_perfil.tipo_plan is distinct from 'permanente' then
    update public.perfil_usuario set acceso_premium_hasta = acceso_premium_hasta - v_resta where id = p_usuario;
    v_tocado := true;
  end if;

  update public.premio_referido
  set estado = 'revertido', motivo = p_motivo, revertido_en = now()
  where usuario_id = p_usuario;

  -- El cron diario (bajar_planes_vencidos) lo baja a 'gratis' si con la resta ya venció.
  return case when v_tocado then 'revertido' else 'revertido_sin_tocar_plan' end;
end;
$$;

revoke execute on function public.otorgar_premio_referido(uuid, int, int) from public, anon, authenticated;
revoke execute on function public.revertir_premio_referido(uuid, text) from public, anon, authenticated;
grant execute on function public.otorgar_premio_referido(uuid, int, int) to service_role;
