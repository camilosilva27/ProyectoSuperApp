-- Fase B de "cuánto ahorraste" (Plan_Usuarios_y_cobros.md): sync entre dispositivos del
-- historial de ahorro, que hasta ahora vivía solo en AsyncStorage (fase A).
--
-- Filas reales, no un blob en perfil_usuario: es un log que solo crece (un evento por
-- comparación vista, nunca se edita ni se borra desde el cliente) — mismo motivo que
-- carrito_guardado (0001) usa filas en vez de useSincronizacionPersistente.

create table public.ahorro_registro (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references auth.users(id) on delete cascade,
  fecha timestamptz not null,
  monto double precision not null
);

-- Postgres no indexa las FK solas, y toda lectura (RLS incluida) filtra por esta columna.
create index idx_ahorro_registro_usuario on public.ahorro_registro(usuario_id);

alter table public.ahorro_registro enable row level security;

create policy "ver mi historial de ahorro" on public.ahorro_registro
  for select using ((select auth.uid()) = usuario_id);
create policy "registrar mi historial de ahorro" on public.ahorro_registro
  for insert with check ((select auth.uid()) = usuario_id);
