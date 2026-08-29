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

## Validado end-to-end con pago real (2026-08-24)

- **VM temporalmente en Producción**: se cambió `MERCADOPAGO_ACCESS_TOKEN` de la VM de TEST a Producción real para poder probar (con credenciales TEST, Mercado Pago nunca deja pagar a una cuenta real, sin importar el monto — no es un tema de precio). **Se dejó así a propósito** (no se revirtió a TEST), mientras se sigue probando esta fase. Precios bajados temporalmente en la VM para las pruebas: mensual sigue en $1000 (leftover de una prueba anterior, no es el precio real decidido de $8000 — pendiente corregir), anual en $20, permanente en $10.
- **Bug real encontrado: `MERCADOPAGO_PRECIO_ANUAL_ARS=10` rechazado por MP** — `Cannot pay an amount lower than $ 15.00` (mínimo de `PreApproval`). Subido a $20 para destrabar la prueba. Anotar este mínimo si en algún momento se vuelve a bajar un precio para testear.
- **Pago único (permanente) confirmado con plata real**: pago de $10 ARS aprobado y acreditado (`payment.status: 'approved'`, `external_reference` = uuid del usuario correcto), confirmado consultando directo la API de Mercado Pago (`/v1/payments/search` y `/v1/payments/{id}`).
- **Gotcha real encontrado: el checkbox "Pagos" del panel de Webhooks estaba destildado.** La URL de notificaciones para Producción ya estaba bien cargada, pero el panel de MP deja elegir por checkbox QUÉ eventos notificar (Pagos / Suscripciones / etc.) — con solo "Suscripciones" tildado, un pago único real nunca dispara ningún webhook, sin ningún error visible del lado del servidor (la request simplemente nunca llega). Activado el checkbox de "Pagos" — pendiente confirmar con un pago nuevo que ahora sí llegue solo.
- **Rama `payment` del webhook confirmada funcionando**: mientras se esperaba la corrección del checkbox, se reenvió a mano una notificación firmada (HMAC-SHA256, mismo mecanismo ya usado para probar suscripciones) para el pago real ya aprobado — `perfil_usuario` quedó correctamente en `plan='premium', tipo_plan='permanente'`. Confirma que `manejarPago()` en `webhookMercadoPago.js` funciona de punta a punta.
- **Anual**: se confirmó que MP acepta y guarda `frequency: 12, frequency_type: 'months'` (ver sección de arriba), pero el intento de pago real quedó sin completar (se creó la suscripción, `pending`, nunca se pagó) — cancelada manualmente vía API para no dejarla colgada. **Todavía no se confirmó con un pago real completado que la primera cobranza quede agendada a 12 meses**, sigue siendo el punto más débil.
- **Aprendizaje operativo**: probar dos flujos de pago en simultáneo sobre la misma cuenta de prueba genera falsos negativos confusos — `tipo_plan` se pisa al **crear** una suscripción nueva (antes de que se pague), independiente de cualquier webhook. Si se vuelve a probar, hacerlo secuencial (un plan a la vez, confirmar, recién después probar el siguiente).

## Permanente: validado 100% de punta a punta (2026-08-24)

Segundo pago real de $10 aprobado, y esta vez **el webhook llegó solo** (sin reenviar nada a mano) — confirma que el checkbox "Pagos" del panel de Webhooks era la causa raíz completa, ya resuelta. `perfil_usuario` quedó en `plan='premium', tipo_plan='permanente'` automáticamente. El plan permanente queda considerado **completo y funcionando de punta a punta**.

## Pendiente

- **Anual sigue bloqueado por `payer_email`** (ver debajo) — no se pudo completar un pago real todavía, sigue siendo el único plan sin confirmar de punta a punta.
- **Problema real de producto confirmado (2026-08-24): `payer_email` debe coincidir exactamente con el mail de la cuenta de Mercado Pago del pagador, para mensual/anual (`PreApproval`).** Confirmado de nuevo probando el anual (ya se había visto una vez con el mensual, `Plan_Usuarios_y_cobros.md`) — no es un artefacto de TEST, es una restricción real de Suscripciones: al ser una autorización de débito recurrente, MP la ata a una cuenta específica desde el momento en que se crea. **El error es en seco, sin "cambiar de cuenta" dentro del mismo checkout** — si el mail no coincide, esa suscripción puntual queda muerta (hay que crear una nueva con el mail correcto). **No afecta al permanente** (`Preference`/Checkout Pro no hace este chequeo — confirmado, el hermano del usuario pagó el permanente con un mail totalmente distinto sin problema).
  - **Investigado a fondo (2026-08-24)**: probé crear un `PreApproval` sin `payer_email` directo contra la API — MP responde `"payer_email is required"`. **No se puede omitir**, es obligatorio en la creación. La única opción real es dejar de asumir "el mail de Mercado Pago es el mismo que el de la cuenta de Super App" y en su lugar preguntarle al usuario, justo antes de crear la suscripción (no antes, no en el registro — nada que ver con la cuenta de Super App), con qué mail va a pagar en MP (precargado con el mail de su cuenta, editable). Confirmado con el historial real de intentos de esta cuenta de prueba: la única suscripción que llegó a cobrarse de verdad fue la que por casualidad tenía el `payer_email` correcto.
  - **Decisión (2026-08-24): por ahora no se implementa, queda anotado.** Al usuario no le cierra sumar fricción (un input más) para un caso que probablemente coincide para la mayoría (mismo mail en todos lados). Revisar esto cuando el diseño de la pantalla de selección de planes (pedido a Claude Design) esté listo — puede ser un buen lugar natural para meter ese campo sin que se sienta como un paso extra, si hace falta.
- Confirmar con un pago único nuevo (sin reenviar el webhook a mano) que ahora, con el checkbox de "Pagos" activado, MP notifica solo.
- Completar un pago real del anual para confirmar que la primera cobranza efectivamente se agenda a 12 meses (`next_payment_date`), no antes.
- Decidir cuándo volver la VM a TEST (o directamente dejarla en Producción de forma permanente y ajustar los precios a los reales: mensual $8000, anual $80000, permanente $160000 — hoy están en valores de prueba).
- Corregir `MERCADOPAGO_PRECIO_MENSUAL_ARS` en la VM: sigue en $1000 (de una prueba de fase 2 anterior), no en el $8000 ya decidido.

## Estado

Lógica y código backend/frontend implementados y parcialmente validados con pagos reales (2026-08-24): permanente confirmado de punta a punta (pago + webhook), anual confirmado solo a nivel de configuración de MP (falta un pago completo). UI de `ajustes.tsx` es funcional pero provisoria — la pantalla final la resuelve el diseño pedido a Claude Design.

## Turnos 12/13 implementados (2026-08-24): PlanSelect + MercadoPagoEmailSheet

Resuelve el pendiente de arriba ("payer_email debe coincidir con la cuenta de MP") y reemplaza
la UI provisoria de `ajustes.tsx`. Los comps de diseño de estos turnos nunca llegaron a
`design_handoff_allpromos_v2 /AllPromos v2.dc.html` (ese archivo solo llega hasta el turno 5) —
se construyó a partir del copy y los tokens de `PANTALLA-12-eleccion-de-plan.md`, sin comp HTML
para comparar pixel a pixel.

- **Nueva migración `supabase/migrations/0010_mercadopago_email_y_fechas.sql`** — `perfil_usuario`
  suma `mail_mercado_pago`, `siguiente_cobro_en`, `pagado_en`. ✅ Corrida contra el proyecto
  Supabase real (2026-08-24, `supabase db push --linked`, confirmada con `migration list`) —
  esto destrabó un bug real: sin la columna, `crearSuscripcion`/`crearPagoUnico` fallaban en seco
  (`PGRST204`, "Could not find the 'mail_mercado_pago' column"), lo que hacía que la pestaña de
  Mercado Pago se abriera y se cerrara sola sin llegar al checkout.
- `backend/src/routes/pagos.js` — `/pagos/suscripcion` y `/pagos/pago-unico` aceptan `email`
  opcional en el body (valida formato, cae a `req.usuarioEmail` si no viene o es inválido) y lo
  persisten en `mail_mercado_pago`. Esto es lo que cierra el bug de `payer_email` documentado
  arriba — antes de esto se mandaba siempre el mail de la sesión.
- `backend/src/routes/webhookMercadoPago.js` — guarda `siguiente_cobro_en` (de
  `suscripcion.next_payment_date`) en cada webhook de suscripción, y `pagado_en` (de
  `pago.date_approved`) al confirmar el pago único. Decisión tomada con el usuario: la fecha de
  renovación se guarda al llegar el webhook, no se pide en vivo a la API de MP en cada carga de
  pantalla.
- `app/src/componentes/PlanSelect.tsx` (nuevo) y `app/src/componentes/MercadoPagoEmailSheet.tsx`
  (nuevo) — pantalla de elección de plan y hoja de confirmación de mail, con sus estados
  (sin plan, con plan activo, permanente comprado, loading, mobile/web, mail inválido/distinto,
  error de checkout).
- `app/src/flujoDePago.ts` (nuevo) — hook `useFlujoDePago` que orquesta ambos componentes +
  `abrirCheckoutPago`, compartido entre `GatePaywallFinTrial` (bloqueante, sin salida) y la nueva
  pantalla `app/app/plan-y-pago.tsx` (desde Ajustes, con X).
- `app/app/(tabs)/ajustes.tsx` — se sacaron los 3 botones provisorios de "Actualizar a premium
  (x)"; queda una sola fila "Plan y pago" que navega a `/plan-y-pago`. Cancelar suscripción se
  movió de Ajustes a esa pantalla nueva (no estaba en el diseño original de los turnos 12/13,
  pero sin eso se perdía una función real de Fase 2 — el permanente no la necesita, no genera
  `pasarela_suscripcion_id`).
- **"Comprobante de pago" (mencionado en el .md para el plan permanente) no se implementó a
  propósito** — decisión tomada con el usuario: no hay backend/destino definido para eso todavía,
  queda pendiente sin fecha.
- Verificado: `tsc --noEmit` limpio en `app/`, ambas rutas de `backend/src/routes/` cargan sin
  error de sintaxis. Probado en un teléfono real contra el backend/Expo local (misma red Wi-Fi):
  se encontraron y corrigieron dos bugs reales — `PlanSelect` sin `ScrollView` (el CTA quedaba
  fuera de la pantalla en un teléfono real, sin ningún error visible) y la migración 0010 sin
  correr contra Supabase (ver arriba). El mail de Mercado Pago en `MercadoPagoEmailSheet` es
  ahora un campo editable directo (sin el paso intermedio de tocar "Cambiar").

### Pendiente de UX (2026-08-24, decisión del usuario, no implementado todavía)

Hoy `MercadoPagoEmailSheet` se muestra siempre, incluso cuando ya hay un `mail_mercado_pago`
guardado de un pago anterior — solo evita que el usuario tenga que *escribirlo* (viene
prellenado), pero igual tiene que confirmar con un toque cada vez.

Cambio pedido: una vez que el mail quedó guardado la primera vez, no volver a mostrar la hoja en
compras siguientes — ir directo al checkout con ese mail. Deja como salvavidas una opción de
"Cambiar" en algún lugar siempre alcanzable (no necesariamente atada a estar comprando en ese
momento), para el caso en que el usuario haya cambiado de cuenta de Mercado Pago. Si el checkout
directo falla, ahí sí conviene caer a la hoja (con el error 13c) en vez de fallar en seco, para
no perder la posibilidad de reintentar o cambiar el mail.

No implementado aún — anotado para no perderlo, a implementar en `useFlujoDePago`/`PlanSelect`/
`MercadoPagoEmailSheet` cuando se retome.

### ✅ Hecho: pasada de diseño visual (era "Pendiente 2026-08-24", resuelto 2026-08-25)

El commit `46a02c4` (2026-08-25) alineó `PlanSelect.tsx`, `MercadoPagoEmailSheet.tsx` y
`ajustes.tsx` contra el `.dc.html` real de los turnos 12/13 que el usuario compartió. Queda
como registro histórico: el `.dc.html` no había llegado al handoff original (`design_handoff_allpromos_v2 /AllPromos v2.dc.html` solo llega hasta el turno 5), así que hasta ese
commit `PlanSelect`/`MercadoPagoEmailSheet` funcionaban de punta a punta pero sin comparar
pixel a pixel contra un comp real.
