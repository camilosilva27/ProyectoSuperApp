-- Notificaciones push web (recordatorio semanal genérico, primer caso de uso). Una fila por
-- suscripción de navegador/dispositivo — el mismo usuario puede tener varias (celular + PC).

create table public.push_suscripcion (
  endpoint text primary key,
  usuario_id uuid not null references auth.users(id) on delete cascade,
  p256dh text not null,
  auth text not null,
  creado_en timestamptz not null default now()
);

-- Postgres no indexa las FK solas, y el cron del backend filtra/agrupa por esta columna.
create index idx_push_suscripcion_usuario on public.push_suscripcion(usuario_id);

alter table public.push_suscripcion enable row level security;

-- auth.uid() envuelto en (select ...) para que el planner lo evalúe una vez, no por fila
-- (ver supabase-postgres-best-practices, security-rls-performance).
create policy "crear mi suscripcion push" on public.push_suscripcion
  for insert with check ((select auth.uid()) = usuario_id);
create policy "borrar mi suscripcion push" on public.push_suscripcion
  for delete using ((select auth.uid()) = usuario_id);
-- Sin policy de select/update para el cliente: la app solo necesita crear/borrar su propia
-- suscripción; el envío del cron lee todo con la service role (bypassa RLS).
