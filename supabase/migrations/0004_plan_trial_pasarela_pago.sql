-- Fase 2 (Plan_Usuarios_y_cobros.md): mecanismo de trial + plan pago, sin atarlo
-- todavía a ninguna feature gateada ni al gate de sesión obligatoria (eso llega después).
--
-- Columnas de pasarela nombradas genéricas (pasarela_pago / pasarela_suscripcion_id) en vez
-- de mercadopago_suscripcion_id: la decisión tomada es arrancar solo con Mercado Pago, pero
-- dejar el esquema listo para sumar otra pasarela (ej. Stripe) sin una migración de rename.

alter table public.perfil_usuario
  add column plan text not null default 'trial',
  add column trial_termina_en timestamptz,
  add column pasarela_pago text,
  add column pasarela_suscripcion_id text,
  add column suscripcion_estado text;

alter table public.perfil_usuario
  add constraint perfil_usuario_plan_check check (plan in ('trial', 'premium', 'gratis'));

alter table public.perfil_usuario
  add constraint perfil_usuario_pasarela_pago_check
  check (pasarela_pago is null or pasarela_pago in ('mercadopago', 'stripe'));

-- Usuarios ya registrados en fase 1 no tenían trial: arranca recién ahora, desde hoy.
update public.perfil_usuario
set trial_termina_en = now() + interval '30 days'
where trial_termina_en is null;

-- El webhook de la pasarela llega con el id de suscripción, no con el id de usuario
-- (salvo que se mande como metadata/external_reference, que no siempre es confiable) —
-- este índice es para resolver "qué perfil_usuario corresponde a esta suscripción".
create index idx_perfil_usuario_pasarela_suscripcion
  on public.perfil_usuario (pasarela_suscripcion_id)
  where pasarela_suscripcion_id is not null;

-- Registros nuevos arrancan con el trial ya seteado, no en null.
create or replace function public.manejar_usuario_nuevo()
returns trigger as $$
begin
  insert into public.perfil_usuario (id, nombre, trial_termina_en)
  values (new.id, new.raw_user_meta_data->>'nombre', now() + interval '30 days');
  return new;
end;
$$ language plpgsql security definer;
