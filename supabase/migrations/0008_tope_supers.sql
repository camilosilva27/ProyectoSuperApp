-- Tope de supers (hoja "Qué supers comparar"): cantidad máxima de supers a visitar, preferencia
-- persistente que viaja junto con supers_activos (ver ProveedorFiltrosSupers en filtrosSupers.tsx).
-- 0 = sin tope explícito ("Los N"): no se guarda el N literal porque queda obsoleto en cuanto
-- supers_activos cambia (ver normalizarTope en filtrosSupers.tsx).

alter table public.perfil_usuario
  add column tope_supers integer not null default 0;
