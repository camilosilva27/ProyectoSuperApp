-- Tabla de monitoreo: cuánto cambió cada corrida de scraper respecto de la anterior, por
-- supermercado. Objetivo: poder responder después "¿qué día/hora suben precios o promos?" y
-- detectar supers que nunca cambian entre corridas (candidatos a bajar la frecuencia del cron
-- de backend/src/cron/refrescarCatalogos.js, hoy cada 2hs). No hay proceso nuevo corriendo:
-- estos números se calculan y guardan dentro del mismo cron existente, comparando el catálogo
-- de la corrida anterior (en memoria, antes de pisarlo) contra el de esta corrida.
--
-- Solo el backend (service role, bypasea RLS) escribe y lee esta tabla — no hay UI de usuario
-- que la consulte, por eso RLS habilitado sin policies (deniega todo a anon/authenticated).
create table public.scraper_diffs (
  id bigint generated always as identity primary key,
  super text not null,
  tipo text not null check (tipo in ('productos', 'promos_bancarias')),
  corrida_en timestamptz not null default now(),

  total_antes int,
  total_despues int,
  agregados int not null default 0,
  eliminados int not null default 0,

  -- Solo tipo='productos': cambios de precioBase vs. cambios del campo promocion (teaser VTEX),
  -- contados por separado para poder responder "¿cuándo suben precio?" y "¿cuándo suben promo?"
  -- como preguntas distintas.
  precio_modificados int,
  promocion_modificados int,

  -- Solo tipo='promos_bancarias': promos que ya existían en ambas corridas pero cambiaron algún
  -- campo (dias, descuentoPct, tope, montoMinimo, vigencia, canales) sin contar el texto legal,
  -- que se reformula seguido sin que cambie la condición real.
  modificados int,

  created_at timestamptz not null default now()
);

comment on table public.scraper_diffs is
  'Diff entre corridas consecutivas de cada scraper (productos y promos bancarias), por super. Ver mails_y_notificaciones.md / CONTEXTO_TECNICO.md § monitoreo de scrapers.';

create index scraper_diffs_super_tipo_corrida_idx
  on public.scraper_diffs (super, tipo, corrida_en desc);

alter table public.scraper_diffs enable row level security;
