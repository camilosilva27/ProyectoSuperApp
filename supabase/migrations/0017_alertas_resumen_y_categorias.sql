-- Ajustes al diseño final de Alertas (Claude Design, turno 20, 2026-09-10):
-- 1) Mail y push van juntos, en cada corrida del cron de 2hs (refrescarCatalogos.js) — un solo
--    mail agrupado por usuario con todo lo que se prendió en esa corrida, no un resumen diario
--    aparte. Por eso acá NO hay tabla de cola para mail: avisoProductosSeguidos.js manda ambos
--    canales en el momento, igual que ya hacía para push.
-- 2) Modo categorías (pantalla 20c): elegible y guardable ya mismo, pero sin lógica de aviso
--    todavía ("EN CAMINO" en el diseño) — por eso `categoria_seguida` no tiene ninguna
--    contraparte en avisoProductosSeguidos.js.
-- 3) Preferencia única "Recibir notificaciones" (push + email juntos, sin split por canal) vive
--    en perfil_usuario, no en su propia tabla — es 1 bit por usuario, incorporarla ahí evita un
--    join más en cada cron.
-- 4) Tope de 20 productos seguidos (visible como "N de 20" en el diseño): se refuerza con un
--    trigger, no solo en la UI — la escritura es directa desde la app vía RLS (sin backend en
--    el medio que valide), así que un client bugueado o alguien pegándole directo a la REST API
--    de PostgREST no puede pasarlo de largo.

alter table public.perfil_usuario
  add column alertas_activas boolean not null default true;

create table public.categoria_seguida (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references auth.users(id) on delete cascade,
  categoria text not null,
  creado_en timestamptz not null default now(),
  unique (usuario_id, categoria)
);

create index idx_categoria_seguida_usuario on public.categoria_seguida(usuario_id);

alter table public.categoria_seguida enable row level security;

-- Mismo patrón que producto_seguido: la app escribe/borra/lee su propia fila directo vía RLS.
create policy "ver mis categorias seguidas" on public.categoria_seguida
  for select using ((select auth.uid()) = usuario_id);
create policy "seguir una categoria" on public.categoria_seguida
  for insert with check ((select auth.uid()) = usuario_id);
create policy "dejar de seguir una categoria" on public.categoria_seguida
  for delete using ((select auth.uid()) = usuario_id);

-- Tope de 20 productos seguidos por usuario (ver diseño 20a/20f/20g, contador "N de 20").
create function public.verificar_tope_producto_seguido()
returns trigger as $$
begin
  if (select count(*) from public.producto_seguido where usuario_id = new.usuario_id) >= 20 then
    raise exception 'Ya seguís 20 productos, el máximo permitido' using errcode = 'P0001';
  end if;
  return new;
end;
$$ language plpgsql security definer;

create trigger tope_producto_seguido
  before insert on public.producto_seguido
  for each row execute function public.verificar_tope_producto_seguido();
