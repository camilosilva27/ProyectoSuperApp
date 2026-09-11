-- Productos que un usuario sigue para recibir aviso (mail + push) cuando les aparece una
-- promoción nueva. Primera versión de la feature de notificaciones (ver
-- .claude/docs/mails_y_notificaciones.md, tipo #8): solo producto puntual por EAN, no
-- categoría — categoría queda para una fase futura porque requiere desambiguar el árbol de
-- categorías entre los 7 supers (no es el mismo árbol, ver CONTEXTO_TECNICO.md).
--
-- `nombre` queda desnormalizado (copiado del catálogo al momento de seguir el producto) para
-- que la pantalla de "mis notificaciones" no dependa de una consulta extra al catálogo — mismo
-- criterio que ya usa `carrito_guardado` para sus ítems.
--
-- Mismo patrón que `push_suscripcion` (0012_push_suscripciones.sql): el usuario escribe/borra
-- su propia fila directo desde la app vía RLS (sin endpoint Express de por medio); el cron que
-- cruza "promo nueva" contra esta tabla lee con service role. A diferencia de push_suscripcion,
-- acá SÍ hay policy de select: el usuario necesita ver/editar la lista de lo que sigue en la
-- pantalla de notificaciones (push_suscripcion es invisible para el usuario, esto no).

create table public.producto_seguido (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references auth.users(id) on delete cascade,
  ean text not null,
  nombre text not null,
  -- Huella (ver huellaPromoSku en diffCatalogos.js) de la última promo de la que ya se avisó a
  -- este usuario por este producto. null = todavía no se avisó nada (recién seguido, o la
  -- promo se apagó y se reseteó). Existe para no perderse la promo que YA estaba activa cuando
  -- el usuario empezó a seguir el producto: sin esto, el cron solo detecta transiciones
  -- GLOBALES de sin-promo a con-promo, y un producto que ya tenía promo antes de seguirlo nunca
  -- generaría esa transición de nuevo — el usuario se quedaría sin avisar indefinidamente.
  huella_promo_avisada text,
  creado_en timestamptz not null default now(),
  unique (usuario_id, ean)
);

-- Postgres no indexa las FK solas; el cron de avisos filtra por ean (IN de varios) al cruzar
-- contra los productos con promo nueva de esta corrida.
create index idx_producto_seguido_usuario on public.producto_seguido(usuario_id);
create index idx_producto_seguido_ean on public.producto_seguido(ean);

alter table public.producto_seguido enable row level security;

-- auth.uid() envuelto en (select ...) para que el planner lo evalúe una vez, no por fila
-- (ver supabase-postgres-best-practices, security-rls-performance).
create policy "ver mis productos seguidos" on public.producto_seguido
  for select using ((select auth.uid()) = usuario_id);
create policy "seguir un producto" on public.producto_seguido
  for insert with check ((select auth.uid()) = usuario_id);
create policy "dejar de seguir un producto" on public.producto_seguido
  for delete using ((select auth.uid()) = usuario_id);
