# Super App — índice de contexto

Este repo es la app "Super App" (motor interno de comparación de precios: AllPromos). Todo el estado del proyecto, decisiones tomadas y planes vive en `.claude/docs/` — no está auto-cargado en cada sesión (serían miles de líneas), así que **antes de investigar "cómo está armado X" en el código o de mandar un agente a averiguarlo, leer primero el doc correspondiente de esta tabla con la herramienta de lectura de archivos.**

| Doc (`.claude/docs/`) | Cuándo abrirlo |
|---|---|
| `CONTEXTO_TECNICO.md` | Referencia técnica principal: scrapers, APIs de cada super, formato de promos, catálogos, crons, quirks de VTEX/Constructor.io. Si la pregunta es "cómo funciona X en el código", empezar acá. |
| `COMO_FUNCIONA.md` | Explicación en lenguaje simple del flujo de comparación de precios, de cara a producto/usuario (no implementación). |
| `Plan_Usuarios_y_cobros.md` | Login (Supabase Auth), SMTP/Brevo del mail de confirmación, gate de sesión/plan, MercadoPago (fase 2). |
| `opciones_planes.md` | Planes mensual/anual/permanente, precios, `PlanSelect`, `MercadoPagoEmailSheet`. |
| `email-confirmacion-embellecer.md` | Setup específico del mail de confirmación (Brevo, remitente, por qué no hay foto de remitente sin dominio). |
| `PLAN_FEATURES_APP.md` | Backlog de features de producto (modo claro, límite de supers por geolocalización) — login ya no está acá, ver el doc de planes/cobros. |
| `PANTALLAS-ahorros-y-paywall.md` | Diseño de las pantallas de historial de ahorro y paywall. |
| `PLAN_SACAR_LAANONIMA.md` | Histórico: por qué y cómo se sacó La Anónima de la app (ya ejecutado). |
| `completador_catalogos.md` | Completadores de catálogo por EAN (los 6 supers VTEX completando datos de Coto y viceversa), crons asociados. |
| `ComoCorrerlo.md` | Cómo levantar el proyecto localmente. |

## Contexto por subcarpeta (mismo criterio: abrir solo si se trabaja ahí)

- `AllPromos/CLAUDE.md` — motor de scraping/comparación de precios (el "AllPromos" interno).
- `backend/README.md` — API, cron jobs, caché de precios.
- `app/CLAUDE.md` / `app/AGENTS.md` — app Expo/React Native, incluye nota de versión de Expo.
- `design_handoff_allpromos_v2 /` — entregable de diseño (mockups .html + specs .md) del rediseño v2. No se movió a `.claude/docs/` porque es un paquete autocontenido (HTML + JS + docs juntos), no docs sueltos.

## Nota sobre referencias viejas en comentarios de código

Varios comentarios en `app/src/*.ts(x)` y `backend/src/**` citan estos documentos por su nombre de archivo suelto (ej. "ver Plan_Usuarios_y_cobros.md") de cuando vivían en la raíz del repo. Ahora están en `.claude/docs/`. No se reescribieron esos comentarios (son cientos y es solo una cita informal), pero si se edita un archivo que tiene una de estas referencias, vale la pena actualizarla de paso.
