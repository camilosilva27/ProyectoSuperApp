-- Fase 1 (Plan_Usuarios_y_cobros.md): sync de carrito/tarjetas/supers activos y listas
-- guardadas entre dispositivos. Ver también el diagrama en el artifact "Esquema de Cuentas".

-- perfil_usuario: 1 fila por usuario, id comparte PK con auth.users
create table public.perfil_usuario (
  id uuid primary key references auth.users(id) on delete cascade,
  carrito_items jsonb not null default '[]'::jsonb,
  carrito_tarjetas text[] not null default '{}',
  supers_activos text[] not null default '{}',
  actualizado_en timestamptz not null default now()
);

alter table public.perfil_usuario enable row level security;

-- auth.uid() envuelto en (select ...) para que el planner lo evalúe una vez, no por fila
-- (ver supabase-postgres-best-practices, security-rls-performance).
create policy "leer perfil propio" on public.perfil_usuario
  for select using ((select auth.uid()) = id);
create policy "actualizar perfil propio" on public.perfil_usuario
  for update using ((select auth.uid()) = id);
-- sin policy de insert/delete para el cliente: los crea el trigger de abajo

-- Crea el perfil vacío automáticamente al registrarse
create function public.manejar_usuario_nuevo()
returns trigger as $$
begin
  insert into public.perfil_usuario (id) values (new.id);
  return new;
end;
$$ language plpgsql security definer;

create trigger al_crear_usuario
  after insert on auth.users
  for each row execute function public.manejar_usuario_nuevo();

-- carrito_guardado: 1 fila por lista guardada
create table public.carrito_guardado (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references auth.users(id) on delete cascade,
  nombre text not null,
  items jsonb not null default '[]'::jsonb,
  guardado_en timestamptz not null default now()
);

-- Postgres no indexa las FK solas, y toda lectura (RLS incluida) filtra por esta columna.
create index idx_carrito_guardado_usuario on public.carrito_guardado(usuario_id);

alter table public.carrito_guardado enable row level security;

create policy "ver mis listas guardadas" on public.carrito_guardado
  for select using ((select auth.uid()) = usuario_id);
create policy "crear mis listas guardadas" on public.carrito_guardado
  for insert with check ((select auth.uid()) = usuario_id);
create policy "borrar mis listas guardadas" on public.carrito_guardado
  for delete using ((select auth.uid()) = usuario_id);
