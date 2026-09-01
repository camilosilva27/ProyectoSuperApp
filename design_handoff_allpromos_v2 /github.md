repo: camilosilva27/ProyectoSuperApp
branch: master
path: app

## Last sync
date: 2026-08-12T23:46:37Z

### Updated in this project
- Chosen direction built as `AllPromos v2.dc.html`: Bloques (1c) + super-bar filters (2c) + savings-first promo block (2f)
- Added onboarding ("Cómo funciona", 3 steps), colour legend, two-total header, per-super export, save-cart sheet + toast
- Renamed "Mis tarjetas" to "Mis descuentos" (Mi Carrefour / MODO / MasClub are not cards); promo CTA now names the benefit
- Designed the next-7-days promos view; needs a vigencia field on `Promo` (`dias: number[]` or `desde/hasta`) — today it only has `activa`

## Screen map
| Screen | Repo files |
| --- | --- |
| AllPromos Actual — Buscar | app/app/(tabs)/index.tsx, app/app/(tabs)/_layout.tsx, app/src/componentes/comunes.tsx, app/src/componentes/FotoProducto.tsx, app/src/theme.ts |
| AllPromos Actual — Carrito | app/app/(tabs)/carrito.tsx, app/src/carrito.tsx, app/src/componentes/comunes.tsx, app/src/theme.ts |
| AllPromos Actual — Resultado | app/app/resultado.tsx, app/src/componentes/BarraDiferencia.tsx, app/src/api.ts, app/src/theme.ts |
| v2 — Buscar (filtros 2c, estado inicial, onboarding) | app/app/(tabs)/index.tsx, app/src/theme.ts |
| v2 — Carrito (carritos guardados, Mis descuentos) | app/app/(tabs)/carrito.tsx, app/src/carrito.tsx |
| v2 — Resultado (dos totales, plan, promos, exportar) | app/app/resultado.tsx, app/src/componentes/BarraDiferencia.tsx, app/src/api.ts |
| v2 — Día de compra / próximos 7 días | app/src/api.ts (Promo needs vigencia), app/app/resultado.tsx |

## Sync history
- 2026-08-12T22:39:54Z — read the new filter bar and both apply-promo affordances; proposed replacements
- 2026-08-12T13:45:00Z — first import: recreated Buscar / Carrito / Resultado from source
