# Auditoría general — 24/09/2026

Revisión solo lectura de código (pagos, auth/Supabase, backend, motor AllPromos, app, mails/alertas, seguridad) + producción (VM, Vercel, Supabase, Mercado Pago) sobre el commit `de7337d`. Nada se modificó. Reporte interactivo (con casillas): https://claude.ai/artifact/DXE1t4jDWLGrAC5uq7qLNS

Estado: los 6 críticos resueltos el 24/09; altos/medios/bajos pendientes salvo los marcados. Al arreglar uno, marcarlo acá.

## Crítico
- [x] **Autopromoción a premium** — ✅ RESUELTO 24/09: migración `0024` aplicada en prod + chequeo de `external_reference` en `procesarSuscripcion`; verificado con la cuenta de prueba (403 en plan/premium_manual/trial/nombre, 204 en tour_visto). Detalle original: `authenticated` tenía UPDATE sobre las 25 columnas de `perfil_usuario` (confirmado en prod con `has_column_privilege`). La policy de 0002 solo limita la fila. Fix: revoke update + grant update por columna (carrito_items, carrito_tarjetas, supers_activos, tope_supers, tour_visto, alertas_activas, nombre). También validar en `procesarPagoMercadoPago.js` que la suscripción de MP sea del usuario.
- [x] **Cambio de plan cobra doble** — ✅ RESUELTO 24/09 (0025 + anterior_id, ver Plan_Usuarios_y_cobros.md). — `routes/pagos.js:84-109,125-176` pisa `pasarela_suscripcion_id` sin cancelar la suscripción vieja en MP.
- [x] **Permanente puede perder acceso** — ✅ RESUELTO 24/09. — `procesarPagoAprobado` no limpia `pasarela_suscripcion_id`/`suscripcion_estado`/`acceso_premium_hasta`; `bajar_planes_vencidos` no excluye `tipo_plan='permanente'`.
- [x] **2x1 como 50% por unidad** — ✅ RESUELTO 24/09 (trim en promo-engine + tests). — `AllPromos/promo-engine.js:32` regex `^(\d+)x` falla con nombres que empiezan con espacio (Vea/Jumbo/Disco, ~85 SKUs).
- [x] **Packs "473mlx6" no detectados** — ✅ RESUELTO 24/09 (3 patrones en empaquetado.js + tests). — `AllPromos/core/empaquetado.js` (Brahma, Andes IPA).
- [x] *(probable)* **Cuotas de suscripción tomadas como permanente** — ✅ RESUELTO 24/09 (prefijo perm:). — la suscripción usa el mismo `external_reference`; depende de si MP lo propaga a cada cobro.

## Pendiente de verificación manual
- [ ] **Probar un cambio de plan con pago real** (mensual → anual, idealmente con precios de prueba en la VM): confirmar que la mensual se cancela en MP recién cuando la anual queda autorizada, que llega un solo cobro por período y un solo recibo. Probar también abandonar el checkout de la anual (tiene que seguir la mensual intacta) y pasar de mensual a permanente. Los fixes de 0025/5bddeec solo están verificados con tests simulados (`backend/test/procesarPagoMercadoPago.test.js`).

## Alto
- [x] ✅ RESUELTO 24/09 (0025). Trial eterno en backend si se abandona el checkout (0020 filtra `pasarela_suscripcion_id is null`). Los 22 preapprovals pending de prod son de la etapa de pruebas (confirmado por el usuario), así que baja prioridad; el bug de código sigue para checkouts futuros.
- [x] ✅ RESUELTO 24/09 (tanda 2). Reembolsos/contracargos no bajan el plan (`procesarPagoMercadoPago.js:22`); arrepentimiento solo manual.
- [x] ✅ RESUELTO 24/09. Tras pagar, 403 hasta ~1h: la app no llama `refreshSession()` (`flujoDePago.ts`).
- [x] ✅ RESUELTO 24/09. Promos bancarias por día en UTC (`promos-bancarias.js:193`, VM en UTC).
- [x] ✅ RESUELTO 24/09. Guardrail de catálogo relativo a la corrida anterior, deja bajar escalonado (`guardrailCatalogo.js:28`).
- [x] ✅ RESUELTO 24/09. Caché sin límite de antigüedad + fallos de scrapers GHA no llegan a `/api/health`.
- [x] ✅ RESUELTO 24/09. `schedule` de `scrapers.yml` sigue activo además del disparo de la VM, sin `concurrency` (4 corridas extra/día en prod).
- [x] ✅ RESUELTO 24/09. Cola sin tope y fetch sin timeout en el fallback en vivo de `/api/comparar`.
- [x] ✅ RESUELTO 24/09. Recibo de pago duplicado: guarda compara fechas como string (`procesarPagoMercadoPago.js:102`).
- [x] ✅ RESUELTO 24/09. Huella de Alertas incluye precio y bancarias (`diffCatalogos.js:25-32`) → re-avisos.
- [x] ✅ RESUELTO 24/09. Alertas sin filtro de plan/emailConfirmado (`avisoProductosSeguidos.js`).
- [x] ✅ RESUELTO 24/09. Carrito puede pisarse con vacío si falla la lectura (`sincronizacionPersistente.ts:81-109`).
- [x] ✅ RESUELTO 24/09: reemplazados en el archivo y en TODO el historial con `git filter-repo --replace-text` + force-push (el repo tiene que seguir público). La VM se alineó con `git fetch && git reset --hard origin/master`; cualquier otro clon viejo necesita lo mismo. Mails de 2 usuarios reales en `Plan_Usuarios_y_cobros.md:165` (repo público, commit 000b48d).
- [x] ✅ RESUELTO 24/09. Timeout único de 4s en `app/src/api.ts` + retry puede duplicar POST de pago.

## Medio / bajo
Resueltos el 24/09 (ver sección "Correcciones de la auditoría" en CONTEXTO_TECNICO.md): webhooks/async en Express, deploy con rollback, escrituras atómicas, search-promotions con retry, vigencia de promos, fallback en vivo ($0, Promise.all, timeouts), baja de mails (List-Unsubscribe + pie, sin endpoint con token todavía), HTML escapado, resúmenes paginados e idempotentes, Brevo con timeout, Política de Privacidad y ToS de la app actualizados, `www` con redirect, headers de seguridad, gate/carreras/ErrorBoundary en la app, contraseñas (mín. 8 + mayúscula), tests e2e arreglados.
Tanda 2 (24/09, resueltos): reembolsos/contracargos, webhooks por tópico, bug "Combinable", baja de mails con link (0027), permisos de anon y search_path (0028), huella SSH fija en CI, regla RDP borrada, permisos de .env en la VM.
Pendientes: suscripción con cobros rechazados sigue premium hasta que MP la pause (se acepta), captcha (descartado por ahora), decidir si los teasers "Mi Crf" exigen la tarjeta Mi Carrefour, prueba de cambio de plan con pago real, vulnerabilidades de dependencias de la app (ver abajo).

**Decisiones de bajo impacto (24/09):** `trial_termina_en` con default 30 días + NOT NULL (0029). Default de `VAPID_SUBJECT` pasado a contacto@. **No** se agregó ventana anti-replay (`toleranceSeconds`) a la firma del webhook de MP: repetir un webhook es inofensivo (se re-consulta el estado a MP y todo es idempotente) y una ventana corta podría rechazar reintentos legítimos de MP si conservan el timestamp original.

**npm audit de `app/` (24/09):** 7 high, todas transitivas de tooling de build de Expo (metro, xmldom, image-size, js-yaml), bajo riesgo en runtime. `npm audit fix` (sin --force) las baja a 4 pero **rompe `expo export -p web`** (deja de encontrar `react-native-svg-transformer`, que usan los logos .svg) → se descartó. El resto requiere `--force` (cambios incompatibles con Expo 57). Reintentar al actualizar la versión de Expo.

**Bug "Combinable" — ✅ RESUELTO 24/09 (tanda 2), ver CONTEXTO_TECNICO.md.** Descripción original: los scrapers de Carrefour y Día marcan como bancaria cualquier teaser cuyo nombre contenga `'bin'`, y "Com**bin**able" lo contiene → ~561 SKUs de Carrefour pierden su "2do al 50%"/"2x1" en el camino cacheado (el fallback en vivo sí los aplica). Arreglarlo baja precios en masa y hay teasers "Mi Crf" que exigen Mi Carrefour y habría que tratar aparte.

Detalle original:
Ver el reporte. Los más baratos: `www` sin certificado en Vercel, headers de seguridad en `app/vercel.json`, HIBP/min password en Supabase Auth, tests e2e rotos (401), escapar HTML en mails, List-Unsubscribe, Política de Privacidad sin Sentry/GCP/Vercel/ImprovMX, docs desactualizados (`opciones_planes.md` precios de VM, `ALERTAS-notificaciones-plan.md` "no se pusheó").

## Confirmado OK en prod (24/09)
VM sana (RAM 251/958MB, sin OOM, NRestarts=0), catálogos del día, crontab = docs, pg_cron 14/14, RLS en las 8 tablas, migraciones 0001–0023 aplicadas, MP con token de producción y precios 8000/80000/160000, sin secretos en repo ni historial, Vercel apunta a la API de prod por HTTPS, snapshots diarios.

## Auditoría de PROMOS por súper (24/09, segunda parte)
5 subagentes (Vea/Jumbo/Disco, Carrefour, Chango Más, Día, Coto) compararon lo que publica cada súper hoy (y su simulación de checkout) contra catálogo de prod + `/api/comparar`. Detalle técnico de cada regla en CONTEXTO_TECNICO.md ("Motor de promos" y "Promos bancarias por ticket").

Resueltos:
- [x] Chango Más: promos por cantidad (2x1, 2da al X%, 2x$) solo existen en la simulación de checkout → nueva pasada `core/simulacionChangoMas.js` (~15% de SKUs con promo, antes 0).
- [x] Vea/Jumbo/Disco: precio fijo "OFERTA X" usaba un % promedio → usa `value` (Jumbo 193 y Disco 166 SKUs con error >2% → 0). Extras de Disco con seller equivocado (0 promos) → corregido.
- [x] Carrefour/Día: descuento directo + teaser se acumulaban → base ListPrice si el directo es promo VTEX. Teaser "Tarjeta Carrefour o Cuenta digital" habilitado para Cuenta Digital. "Exclusivo online" marcado.
- [x] Coto: "Llevando N" + X%Dto aplicado desde la 1ra unidad (38 SKUs); "15%" de Comunidad aplicado a todos.
- [x] Día: "Llevando N a $X c/u" no se interpretaba; fallback en vivo hacía desaparecer el súper con teaser desconocido.
- [x] Bancarias: mínimos de compra no leídos (MODO, MP, Cuenta DNI), topes múltiples/sin $/de jubilados, MODO+banco exigía solo una tarjeta, NaranjaX/Hipotecario sin alias, Club La Nación como Banco Nación, canal express (Chango) y Maxi (Carrefour), promo bancaria solo online sin aviso, domingo perdido en Cencosud, local puntual (Jumbo Comodoro), cuotas leídas como %, Coto "solo productos sin oferta", Coto fechas puntuales.

Decisiones de negocio pendientes (no se tocaron):
- [ ] Niveles de una misma tarjeta (Naranja X Épico/Turbo/Inicial, Patagonia Clásica/Plus/Singular — Patagonia sin alias en Carrefour por esto —, Galicia Eminent): hoy cualquiera con la tarjeta recibe el nivel máximo.
- [x] Promos de segmento (jubilados/ANSES/+60, plan sueldo, empleados públicos, Supervielle Identité, Mi Carrefour 10% ANSES/+60) → requisitos propios en Mis descuentos (tarjeta Y segmento, o solo segmento). Y MODO + banco → canónico propio "<Banco> Modo" (reemplaza `requiereTodas`). Ver "Modelo de tarjetas y requisitos" en CONTEXTO_TECNICO.md.
- [ ] Teasers/descuentos "Mi Crf": la simulación anónima los aplica (online valen para todos; en el local piden DNI de Mi Carrefour Clásico). Si se condicionan, condicionar también los descuentos directos "Mi Crf".
- [ ] Promos bancarias "no acumulables" con la de producto, y limitadas a categorías (Cencopay 25%/40%).
- [x] Promos sin banco (bancarias por ticket): "Billeteras Virtuales" = Mercado Pago, "10% todos los medios online" (Carrefour) para todos y solo online, Comunidad Coto (15% miércoles) y MasGO exclusivas como requisitos propios. Las promos de PRODUCTO de Comunidad Coto las trabaja aparte promo-engine.js.
- [ ] Coto: 15% con cualquier tarjeta de crédito los viernes y Visa débito NFC — siguen sin modelar (el % no viene como "N% DE DESCUENTO" y no hay opción "cualquier crédito").
- [ ] Topes semanales/mensuales tratados como por ticket.
Dudosos sin confirmar: "Max N unidades" de Carrefour (online aplica a todas), Coca-Cola 6x4 vs 6x5 en Coto, promos por sucursal de Coto, "Ofertas Trafico" de Vea como solo online, seller que usan Jumbo/Disco en su tienda, carne picada de Chango Más (checkout más barato que catálogo), vigencia de las bancarias de Día (legales vencidos pero promos renovadas).
