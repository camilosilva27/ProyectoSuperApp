/**
 * Configuración del backend. Todo lo sensible o dependiente del entorno vive en .env
 * (ver .env.example) — nada de secretos hardcodeados acá.
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const RAIZ_BACKEND = path.join(__dirname, '..');

module.exports = {
  puerto: Number(process.env.PORT) || 3000,
  entorno: process.env.NODE_ENV || 'development',
  rutaCatalogoUnificado: path.join(RAIZ_BACKEND, 'catalogo-unificado.json'),
  rutaLogs: path.join(RAIZ_BACKEND, 'logs'),
  // Fotos de producto descargadas una sola vez desde el CDN de cada super (ver
  // src/cron/descargarImagenes.js) y servidas desde acá — no se hotlinkea al super en cada
  // request de la app, ni se vuelve a descargar una imagen que ya está en disco.
  rutaImagenes: path.join(RAIZ_BACKEND, 'imagenes'),
  // Cuántas horas puede tener un catálogo antes de que /api/health lo marque como problema.
  // Antes era `diasMaximoCatalogo: 30` (mismo umbral que el CLI), pero desde que precioCache.js
  // sirve el precio de la app desde estos catalogo-*.json (y los scrapers corren cada 2hs), un
  // catálogo de 3 días ya es un precio viejo servido como vigente, y health seguía en ok:true
  // (auditoría 2026-09-24). 12hs = ~6 corridas seguidas sin actualizar ese super: tolera un par
  // de fallos puntuales (429 de Carrefour, runner lento) sin despertar a UptimeRobot, pero no
  // medio día de precios congelados.
  horasMaximoCatalogo: 12,
  // Ventana en la que /api/health mira `scraper_errores` (Supabase, la escriben los scrapers en
  // GitHub Actions vía registrarError — nunca llegan a logs/ultimo-refresco.json, que lo pisa
  // el post-proceso de la VM solo con SUS errores). 6hs = las últimas ~3 corridas.
  horasVentanaErroresScrapers: 6,
  // Cuántas corridas fallidas seguidas de un mismo scraper/extra (sin una exitosa en el medio)
  // hacen falta para que health pase a ok:false. Un fallo aislado (un 429 de Carrefour) se
  // muestra en `avisos` pero no despierta a UptimeRobot; dos seguidos ya son ~4hs sin precio
  // nuevo de ese super.
  corridasFallidasParaAlerta: 2,
  // Token opcional para ver el detalle interno completo de /api/health (?token=... o header
  // x-health-token). Sin él, la respuesta pública no expone mensajes de error crudos.
  healthToken: process.env.HEALTH_TOKEN || null,
  // Tope de búsquedas en vivo (fallback de /api/comparar y /api/precios) esperando turno detrás
  // del semáforo global — sin tope, un pico de EANs no cacheados encolaba sin límite.
  maxColaFallbackEnVivo: 20,
  // Host en el que escucha Express (2026-09-24). En producción, Caddy corre en la misma VM y
  // proxya por loopback (la IP del socket que ve Express es siempre 127.0.0.1, ver `trust proxy`
  // en server.js), así que no hace falta exponer el puerto 3000 hacia afuera — antes escuchaba
  // en todas las interfaces. En desarrollo se sigue escuchando en todas: la app en el teléfono
  // real le pega a la IP de la LAN de la Mac (EXPO_PUBLIC_API_URL), no a localhost.
  host: process.env.HOST || ((process.env.NODE_ENV || 'development') === 'production' ? '127.0.0.1' : '0.0.0.0'),
  // El cache de promos bancarias se refresca cada 2hs (cron); a diferencia de los catálogos
  // (que cambian poco), estas promos son día-específicas (ej. "solo miércoles y jueves"), así
  // que un cache viejo por unas pocas horas ya puede estar mostrando el día equivocado.
  horasMaximoPromosBancarias: 6,
  // Límite de resultados que devuelve la búsqueda de catálogo por request.
  limiteBusquedaDefault: 50,
  limiteBusquedaMaximo: 200,
  RAIZ_BACKEND,

  // --- Fase 2 (Plan_Usuarios_y_cobros.md): sesión + Mercado Pago ---
  // Este proyecto Supabase firma sus JWT con clave asimétrica (ES256, confirmado
  // 2026-08-21) — la sesión se valida contra el JWKS público en SUPABASE_URL
  // (ver requiereSesion.js), no contra un secreto compartido. También la usa el cliente con
  // service role key (bypasea RLS, lo usa el webhook para escribir en perfil_usuario en
  // nombre del sistema, no de un usuario).
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  // Access token de la app de Mercado Pago (Test o Producción, panel de Developers).
  mercadopagoAccessToken: process.env.MERCADOPAGO_ACCESS_TOKEN,
  // Firma secreta configurada en el panel de esa misma app (Tus integraciones > Webhooks) —
  // se usa para validar que una notificación de webhook realmente viene de Mercado Pago.
  mercadopagoWebhookSecret: process.env.MERCADOPAGO_WEBHOOK_SECRET,
  // Secreto compartido para /api/webhooks/auth-usuarios (mail de bienvenida) — se configura
  // como header custom en el Database Webhook de Supabase (Database > Webhooks), no hay
  // firma HMAC de por medio como en Mercado Pago.
  authWebhookSecret: process.env.AUTH_WEBHOOK_SECRET,
  // Precios en ARS de cada plan (Fase 3, opciones_planes.md) — sin default: si falta la
  // variable de un plan puntual, ese plan responde 503 en vez de inventar un número, pero no
  // bloquea a los otros dos.
  precioMensualArs: process.env.MERCADOPAGO_PRECIO_MENSUAL_ARS
    ? Number(process.env.MERCADOPAGO_PRECIO_MENSUAL_ARS)
    : null,
  precioAnualArs: process.env.MERCADOPAGO_PRECIO_ANUAL_ARS
    ? Number(process.env.MERCADOPAGO_PRECIO_ANUAL_ARS)
    : null,
  precioPermanenteArs: process.env.MERCADOPAGO_PRECIO_PERMANENTE_ARS
    ? Number(process.env.MERCADOPAGO_PRECIO_PERMANENTE_ARS)
    : null,
  // A dónde vuelve el navegador/webview de MP una vez que el usuario termina el checkout.
  urlVueltaCheckoutMP: process.env.URL_VUELTA_CHECKOUT_MP || 'https://mi-superapp.com.ar',

  // Notificaciones push web (recordatorio semanal, ver src/cron/recordatorioSemanal.js). La
  // pública viaja también en app/.env (EXPO_PUBLIC_VAPID_PUBLIC_KEY) — no es secreta, es la
  // misma clave que ya usa el navegador para suscribirse.
  vapidPublicKey: process.env.VAPID_PUBLIC_KEY,
  vapidPrivateKey: process.env.VAPID_PRIVATE_KEY,
  vapidSubject: process.env.VAPID_SUBJECT || 'mailto:camilosilva28@gmail.com',

  // Mails propios (recibo de pago, resúmenes de ahorro, avisos de trial, re-engagement — ver
  // clienteBrevo.js y .claude/docs/mails_y_notificaciones.md). Misma cuenta de Brevo que el SMTP
  // de Supabase Auth, pero vía su API HTTP con una API key propia (Brevo > Settings > SMTP & API
  // > API Keys), no el SMTP key que ya tiene Supabase.
  brevoApiKey: process.env.BREVO_API_KEY,
  brevoRemitenteEmail: process.env.BREVO_REMITENTE_EMAIL || 'no-reply@mi-superapp.com.ar',
  brevoRemitenteNombre: process.env.BREVO_REMITENTE_NOMBRE || 'SuperAhorro',

  // Monitoreo de errores (Sentry) — sin esta variable, sentry.js no inicializa nada y el
  // server sigue funcionando exactamente igual que antes (mismo criterio "gracioso" que el
  // resto de las integraciones opcionales de este archivo).
  sentryDsn: process.env.SENTRY_DSN,
};
