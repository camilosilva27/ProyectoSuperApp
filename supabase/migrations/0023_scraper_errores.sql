-- Historial de fallos de scrapers/extras, persistente más allá de la retención de logs de
-- GitHub Actions (~90 días). Complementa a scraper_diffs (que solo registra corridas
-- EXITOSAS): acá va cada vez que un scraper o un refrescador de extras termina con error, para
-- poder responder después "¿cuántas veces falló Carrefour por conexión este mes?" sin depender
-- de que el log de esa corrida puntual todavía exista. Se escribe desde
-- backend/src/cron/refrescarCatalogosGHA.js.
--
-- Solo el backend (service role, bypasea RLS) escribe y lee esta tabla — mismo criterio que
-- scraper_diffs (RLS habilitado sin policies, deniega todo a anon/authenticated).
create table public.scraper_errores (
  id bigint generated always as identity primary key,
  super text not null,
  etapa text not null check (etapa in ('scraper', 'extra')),
  script text not null,
  corrida_en timestamptz not null default now(),
  mensaje text not null,
  created_at timestamptz not null default now()
);

comment on table public.scraper_errores is
  'Historial de fallos de scrapers/extras (mensaje de error), por super. Complementa scraper_diffs, que solo registra corridas exitosas. Ver CONTEXTO_TECNICO.md § monitoreo de scrapers.';

create index scraper_errores_super_corrida_idx
  on public.scraper_errores (super, corrida_en desc);

alter table public.scraper_errores enable row level security;
