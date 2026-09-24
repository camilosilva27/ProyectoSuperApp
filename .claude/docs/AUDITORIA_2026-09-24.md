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

## Alto
- [x] ✅ RESUELTO 24/09 (0025). Trial eterno en backend si se abandona el checkout (0020 filtra `pasarela_suscripcion_id is null`). Los 22 preapprovals pending de prod son de la etapa de pruebas (confirmado por el usuario), así que baja prioridad; el bug de código sigue para checkouts futuros.
- [ ] Reembolsos/contracargos no bajan el plan (`procesarPagoMercadoPago.js:22`); arrepentimiento solo manual.
- [ ] Tras pagar, 403 hasta ~1h: la app no llama `refreshSession()` (`flujoDePago.ts`).
- [ ] Promos bancarias por día en UTC (`promos-bancarias.js:193`, VM en UTC).
- [ ] Guardrail de catálogo relativo a la corrida anterior, deja bajar escalonado (`guardrailCatalogo.js:28`).
- [ ] Caché sin límite de antigüedad + fallos de scrapers GHA no llegan a `/api/health`.
- [ ] `schedule` de `scrapers.yml` sigue activo además del disparo de la VM, sin `concurrency` (4 corridas extra/día en prod).
- [ ] Cola sin tope y fetch sin timeout en el fallback en vivo de `/api/comparar`.
- [x] ✅ RESUELTO 24/09. Recibo de pago duplicado: guarda compara fechas como string (`procesarPagoMercadoPago.js:102`).
- [ ] Huella de Alertas incluye precio y bancarias (`diffCatalogos.js:25-32`) → re-avisos.
- [ ] Alertas sin filtro de plan/emailConfirmado (`avisoProductosSeguidos.js`).
- [ ] Carrito puede pisarse con vacío si falla la lectura (`sincronizacionPersistente.ts:81-109`).
- [ ] Mails de 2 usuarios reales en `Plan_Usuarios_y_cobros.md:165` (repo público, commit 000b48d).
- [ ] Timeout único de 4s en `app/src/api.ts` + retry puede duplicar POST de pago.

## Medio / bajo
Ver el reporte. Los más baratos: `www` sin certificado en Vercel, headers de seguridad en `app/vercel.json`, HIBP/min password en Supabase Auth, tests e2e rotos (401), escapar HTML en mails, List-Unsubscribe, Política de Privacidad sin Sentry/GCP/Vercel/ImprovMX, docs desactualizados (`opciones_planes.md` precios de VM, `ALERTAS-notificaciones-plan.md` "no se pusheó").

## Confirmado OK en prod (24/09)
VM sana (RAM 251/958MB, sin OOM, NRestarts=0), catálogos del día, crontab = docs, pg_cron 14/14, RLS en las 8 tablas, migraciones 0001–0023 aplicadas, MP con token de producción y precios 8000/80000/160000, sin secretos en repo ni historial, Vercel apunta a la API de prod por HTTPS, snapshots diarios.
