# Fase 3: múltiples planes de pago (mensual / anual / permanente)

Depende de que fase 2 (`Plan_Usuarios_y_cobros.md`) ya esté implementada y verificada — hoy solo existe un plan pago (mensual, vía `PreApproval` de Mercado Pago). Esta fase agrega opciones de precio distintas sin tocar el mecanismo de trial ni el gate de acceso (`GatePaywallFinTrial`), que siguen siendo los mismos.

## Contexto

Conversado el 2026-08-24: el precio mensual queda en **$8.000 ARS**. Se suman dos planes nuevos:

- **Anual: $80.000 ARS** (equivale a 10 meses, 2 gratis).
- **Permanente: $160.000 ARS** (pago único, "nunca más pagar" — 2x el anual como ancla de precio).

Se decidió armar una pantalla de selección de plan (todavía sin diseñar) en vez de forzar solo la opción mensual que hoy ofrece `ajustes.tsx`.

## Decisiones tomadas (2026-08-24)

- **Anual se cobra igual que mensual**: suscripción recurrente de Mercado Pago (`PreApproval`), pero con `frequency: 12, frequency_type: 'months'` en vez de `frequency: 1`. Se mantiene el mismo modelo mensual: la vigencia la gobierna `suscripcion_estado` vía webhook, **no** una fecha guardada en `perfil_usuario`. Pendiente técnico a validar al implementar: confirmar que MP soporte bien ese intervalo de facturación, y que `webhookMercadoPago.js` no asuma en ningún lado que la suscripción es mensual (por inspección de código no lo asume hoy, pero falta confirmarlo al codear).
- **Permanente es fundamentalmente distinto**: no es una suscripción recurrente, es un **pago único** (Checkout Pro de MP, no `PreApproval`). No genera `pasarela_suscripcion_id` de una suscripción real ni depende de webhooks de suscripción — se marca `plan='premium', tipo_plan='permanente'` directo al confirmarse el pago (webhook de pago único).
- **Nueva columna `tipo_plan`** en `perfil_usuario`: `'mensual' | 'anual' | 'permanente'`, nullable (solo tiene valor cuando `plan='premium'`). Se agrega **separada** de `plan` (que sigue siendo `trial | premium | gratis`) para poder trackear qué plan pagó cada usuario sin sobrecargar una columna que ya tiene otro significado.
- **No se agrega columna de vencimiento para premium**: mensual y anual siguen sin fecha guardada (gobernados por `suscripcion_estado`, igual que hoy). Permanente tampoco necesita fecha — no hay nada que vencer. Es decir, no hace falta un `premium_vence_en` nuevo; alcanza con `tipo_plan`.
- **Permanente NO necesita exclusión en el cron de downgrade** (corregido al revisar el código real): `bajar_planes_vencidos()` (`supabase/migrations/0005_downgrade_trial_vencido.sql`) solo baja usuarios con `plan='trial'` vencido — un usuario que ya está en `plan='premium'` (incluido permanente) nunca entra en ese `where`, sin importar `tipo_plan`. La exclusión con `premium_manual` es un caso distinto (premium otorgado a mano que a veces se deja con `plan='trial'`).
- **Upgrade de plan sin prorrateo**: un usuario premium (mensual o anual) puede pasarse a otro plan desde la misma pantalla de selección. Se cobra el nuevo plan completo (sin descontar lo ya pagado) y se pisa `tipo_plan` (y, si corresponde, se cancela la suscripción vieja en MP y se crea la nueva / se cobra el pago único). La pantalla debería ocultar o marcar como "actual" el plan que el usuario ya tiene, para no dejarlo comprarse el mismo dos veces.

## Investigación de Mercado Pago (2026-08-24, contra documentación oficial)

- **Anual (`PreApproval`, `frequency: 12, frequency_type: 'months'`)**: la doc no fija un tope explícito de "solo 1 mes", y hay reportes de integradores usándolo en producción con `frequency: 12`, pero MP no lo garantiza por escrito en su reference. El riesgo real no es que rechace la config, sino que agende mal el próximo cobro (ej. a 12 días en vez de 12 meses) sin que se note hasta el segundo ciclo — **hay que confirmar en sandbox la fecha del próximo cobro antes de confiar en esto con plata real**.
- **Permanente (pago único)**: confirmado — es la clase `Preference` (Checkout Pro) del SDK oficial, `.create({body})` devuelve `init_point`. Existe una API `Order` más nueva que MP está posicionando como capa unificada; `Preference` sigue siendo válida y documentada para un pago simple.
- **Webhook compartido**: se puede diferenciar en el mismo endpoint por el campo `type` de la query (`payment` para pago único, cualquier otro valor — incluido ausente — para suscripciones), cada uno resolviéndose contra su propio endpoint de la API (`Payment.get()` vs. `PreApproval.get()`).
- **Gotchas de Checkout Pro documentados**: `back_urls` con `localhost`/`127.0.0.1` rompe el checkout ("Something went wrong") — necesita dominio real o IP pública (la VM ya tiene `https://34.24.10.174.nip.io`). `auto_return: 'approved'` exige `back_urls.success` seteado, si falta tira `invalid_auto_return`. No hay confirmación oficial de si el gotcha de "cuenta de prueba mezclada con real" (ya conocido en `PreApproval`) aplica igual a `Preference`, pero es razonable asumir que sí.

## Implementado (2026-08-24)

- `supabase/migrations/0009_tipo_plan.sql` — columna `tipo_plan` en `perfil_usuario`. **Falta correr en el proyecto Supabase real** (mismo pendiente que las migraciones anteriores).
- `backend/src/config.js` / `.env.example` — `MERCADOPAGO_PRECIO_ANUAL_ARS` y `MERCADOPAGO_PRECIO_PERMANENTE_ARS` nuevos, cada uno independiente (si falta uno, ese plan responde 503 sin afectar a los otros). **Falta cargar los valores reales en `backend/.env` de la VM.**
- `backend/src/routes/pagos.js`:
  - `POST /api/pagos/suscripcion` ahora acepta `{ tipoPlan: 'mensual' | 'anual' }` en el body (default `'mensual'`, retrocompatible), ajustando `frequency` (1 o 12) y el precio; guarda `tipo_plan` en `perfil_usuario` al crear.
  - `POST /api/pagos/pago-unico` (nuevo) — crea una `Preference` de Checkout Pro para el permanente. No otorga premium por sí sola (igual que la suscripción): eso lo hace el webhook al confirmar `status: 'approved'`.
  - `POST /api/pagos/cancelar-suscripcion` ahora también limpia `tipo_plan` a `null` al bajar de plan.
  - `GET /api/pagos/precio` devuelve los 3 precios (cada uno `null` si no está configurado).
- `backend/src/routes/webhookMercadoPago.js` — ramifica por `req.query.type`: `'payment'` va a la rama nueva (`Payment.get()`, resuelve el usuario por `external_reference`, otorga `plan='premium', tipo_plan='permanente'`); cualquier otro valor (incluido el caso legado sin `type`) sigue el camino existente de suscripciones, que ahora también limpia `tipo_plan` cuando el nuevo estado es `'gratis'`.
- `app/src/plan.ts` — `usePlanUsuario()` lee `tipo_plan`.
- `app/src/api.ts` — `crearSuscripcion(token, tipoPlan)`, `crearPagoUnico(token)`, `precioSuscripcion()` devuelve los 3 precios.
- `app/app/(tabs)/ajustes.tsx` — **UI provisoria** (no es la pantalla final diseñada, solo para poder probar los 3 flujos de punta a punta ya): tres botones "Actualizar a premium (mensual/anual/permanente)" cuando no es premium, y "Cambiar a plan X" para upgrade cuando ya es premium (oculta el plan actual; permanente no puede upgradear a nada, ya no se le ofrece cambiar). Texto de plan actual ahora muestra el `tipo_plan` entre paréntesis.
- Verificado: `tsc --noEmit` limpio en `app/`, los módulos de `backend/src/routes/` cargan sin errores de sintaxis, el SDK instalado (`mercadopago`) expone `Preference` y `Payment`.

## Pendiente para probar de punta a punta (no es código)

- ✅ **Migración `0009_tipo_plan.sql` corrida contra el proyecto Supabase real** (2026-08-24, vía `supabase db push --linked` con el CLI, usando `SUPABASE_ACCESS_TOKEN` ya presente en el entorno — confirmado con `supabase migration list --linked`, columna `tipo_plan` ya existe en `perfil_usuario` en producción).
- Cargar `MERCADOPAGO_PRECIO_ANUAL_ARS=80000` y `MERCADOPAGO_PRECIO_PERMANENTE_ARS=160000` en `.env` (local y VM) — en proceso por el usuario.
- Probar en sandbox: alta de suscripción anual (confirmar fecha del próximo cobro), y el pago único completo con `back_urls`/`auto_return` bien configuradas (gotcha más probable del fallo anterior).
- La pantalla de fin de trial (`PaywallFinTrial`/`GatePaywallFinTrial`) sigue ofreciendo **solo mensual** — no se tocó todavía; el prompt para Claude Design (ver conversación) cubre la pantalla de selección completa, pendiente de diseño e integración ahí.

## Estado

Lógica y código backend/frontend implementados (2026-08-24), sin probar todavía contra Mercado Pago real. UI de `ajustes.tsx` es funcional pero provisoria — la pantalla final la resuelve el diseño pedido a Claude Design.
