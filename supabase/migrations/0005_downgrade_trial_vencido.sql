-- Fase 2 (Plan_Usuarios_y_cobros.md): downgrade automático del trial vencido a plan 'gratis'.
--
-- La lógica vive en una función (no un UPDATE suelto solo dentro del cron) para poder
-- volver a correrla a mano en cualquier momento desde el SQL editor, sin esperar al
-- horario del cron: `select public.bajar_planes_vencidos();`. Es idempotente — si no hay
-- ningún trial vencido sin pagar, no toca ninguna fila, así que correrla de más no rompe nada.

-- Premium otorgado a mano para casos puntuales (nunca se le cobra a este usuario). El
-- downgrade automático nunca toca a estos usuarios, sin importar hace cuánto venció su trial.
alter table public.perfil_usuario
  add column premium_manual boolean not null default false;

comment on column public.perfil_usuario.premium_manual is
  'Premium otorgado a mano (nunca se le cobra). El downgrade automático de trial vencido excluye a estos usuarios.';

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
    and pasarela_suscripcion_id is null
    and not premium_manual;
end;
$$;

-- Ya viene precargada en todos los proyectos Supabase; esto solo la habilita. Si esta
-- línea falla, habilitarla a mano desde Database > Extensions en el dashboard y volver
-- a correr el resto del archivo.
create extension if not exists pg_cron;

-- cron.schedule con un nombre de job existente actualiza ese job en vez de duplicarlo,
-- así que este bloque también es seguro de volver a correr.
select cron.schedule(
  'bajar_planes_vencidos_diario',
  '0 3 * * *',
  $$select public.bajar_planes_vencidos()$$
);
