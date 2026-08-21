-- Fase 2 (Plan_Usuarios_y_cobros.md): Auth Hook de Supabase ("Customize Access Token") que
-- inyecta el campo `plan` directo en el JWT cuando se emite/refresca. Evita que el Express
-- tenga que consultar perfil_usuario en cada request de una ruta caliente (ej. /api/comparar)
-- para saber si un usuario es premium — una vez decodificado el JWT (ya se hace en
-- requiereSesion.js), `plan` viene ahí adentro, gratis.
--
-- OJO: esta migración deja la función lista, pero activarla como el hook real de "Customize
-- Access Token (JWT) Claims" es un paso manual en el dashboard de Supabase (Authentication >
-- Hooks), no algo que se pueda hacer por SQL — ver nota al final del archivo.

create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
as $$
declare
  claims jsonb;
  plan_usuario text;
begin
  select plan into plan_usuario
  from public.perfil_usuario
  where id = (event->>'user_id')::uuid;

  claims := event->'claims';
  -- 'gratis' si por lo que sea no hay fila en perfil_usuario todavía (no debería pasar, el
  -- trigger de fase 1 la crea al registrarse) — nunca dejar el claim ausente.
  claims := jsonb_set(claims, '{plan}', to_jsonb(coalesce(plan_usuario, 'gratis')));

  event := jsonb_set(event, '{claims}', claims);
  return event;
end;
$$;

-- Solo supabase_auth_admin (el rol interno que corre los Auth Hooks) puede ejecutar esta
-- función y leer perfil_usuario para este fin — ni un usuario logueado ni anon deberían poder
-- invocarla directo (revocar el EXECUTE que Postgres otorga a PUBLIC por default al crear
-- cualquier función).
grant usage on schema public to supabase_auth_admin;

grant execute
  on function public.custom_access_token_hook
  to supabase_auth_admin;

revoke execute
  on function public.custom_access_token_hook
  from authenticated, anon, public;

-- El hook corre como supabase_auth_admin, no como el usuario dueño de la fila — sin esto, las
-- policies de "leer perfil propio" (auth.uid() = id) no le dejarían ver nada.
grant select on public.perfil_usuario to supabase_auth_admin;

create policy "Auth hook puede leer el plan de cualquier perfil" on public.perfil_usuario
  as permissive for select
  to supabase_auth_admin
  using (true);

-- PASO MANUAL PENDIENTE (no se puede hacer por SQL): en el dashboard de Supabase, ir a
-- Authentication > Hooks (o "Auth Hooks"), sección "Customize Access Token (JWT) Claims
-- Hook", y seleccionar esta función (public.custom_access_token_hook) como el hook activo.
-- Sin ese paso, la función existe pero Supabase no la llama todavía — el JWT sigue sin el
-- claim `plan` hasta activarlo ahí.
