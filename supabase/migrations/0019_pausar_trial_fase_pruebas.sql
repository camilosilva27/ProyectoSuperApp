-- Pausa temporal del vencimiento de trial mientras dura la fase de pruebas de la app
-- (decisión 2026-09-11, ver Plan_Usuarios_y_cobros.md § "Pausa del trial durante fase de
-- pruebas — pendiente de revertir"). El gate de pantalla (GatePaywallFinTrial.tsx) compara
-- `trial_termina_en` directo contra la hora actual en el cliente, así que alcanza con empujar
-- esa fecha bien lejos: no hace falta tocar el cron `bajar_planes_vencidos` ni el gate.

-- Usuarios existentes en trial: extender su vencimiento un año.
update public.perfil_usuario
set trial_termina_en = now() + interval '365 days'
where plan = 'trial';

-- Nuevos registros durante la pausa: mismo criterio (365 días en vez de 30).
-- REVERTIR cuando termine la fase de pruebas: volver esto a interval '30 days'.
create or replace function public.manejar_usuario_nuevo()
returns trigger as $$
begin
  insert into public.perfil_usuario (id, nombre, trial_termina_en)
  values (new.id, new.raw_user_meta_data->>'nombre', now() + interval '365 days');
  return new;
end;
$$ language plpgsql security definer;

-- Bug aparte, sin relación con la pausa del trial (ver Plan_Usuarios_y_cobros.md, 2026-09-11):
-- los UPDATE manuales de premium permanente para la familia del usuario seteaban `plan` y
-- `premium_manual` pero no `tipo_plan`, que quedaba en null. `ajustes.tsx` interpretaba ese
-- caso como suscripción mensual/anual y mostraba literalmente la palabra "null" en el
-- subtítulo de plan. El código ya tiene un fallback, pero corrige también los datos ya
-- escritos para esas cuentas.
update public.perfil_usuario
set tipo_plan = 'permanente'
where premium_manual = true and tipo_plan is null;
