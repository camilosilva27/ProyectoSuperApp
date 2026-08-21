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
  // Cuántos días puede tener un catálogo antes de considerarse vencido (mismo umbral que el CLI).
  diasMaximoCatalogo: 30,
  // El cache de promos bancarias se refresca cada 2hs (cron); a diferencia de los catálogos
  // (que cambian poco), estas promos son día-específicas (ej. "solo miércoles y jueves"), así
  // que un cache viejo por unas pocas horas ya puede estar mostrando el día equivocado.
  horasMaximoPromosBancarias: 6,
  // Límite de resultados que devuelve la búsqueda de catálogo por request.
  limiteBusquedaDefault: 50,
  limiteBusquedaMaximo: 200,
  RAIZ_BACKEND,

  // --- Fase 2 (Plan_Usuarios_y_cobros.md): sesión + Mercado Pago ---
  // JWT Secret del proyecto Supabase (Dashboard > Project Settings > API > JWT Settings).
  // Con esto el Express valida la sesión localmente (jsonwebtoken), sin pegarle a la red de
  // Supabase en cada request.
  supabaseJwtSecret: process.env.SUPABASE_JWT_SECRET,
  // Para el cliente de Supabase con service role key (bypasea RLS, lo usa el webhook para
  // escribir en perfil_usuario en nombre del sistema, no de un usuario).
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  // Access token de la app de Mercado Pago (Test o Producción, panel de Developers).
  mercadopagoAccessToken: process.env.MERCADOPAGO_ACCESS_TOKEN,
  // Firma secreta configurada en el panel de esa misma app (Tus integraciones > Webhooks) —
  // se usa para validar que una notificación de webhook realmente viene de Mercado Pago.
  mercadopagoWebhookSecret: process.env.MERCADOPAGO_WEBHOOK_SECRET,
  // Precio mensual de la suscripción en ARS — todavía no decidido, sin default: sin esta
  // variable, la ruta de alta de suscripción responde 503 en vez de inventar un número.
  precioMensualArs: process.env.MERCADOPAGO_PRECIO_MENSUAL_ARS
    ? Number(process.env.MERCADOPAGO_PRECIO_MENSUAL_ARS)
    : null,
  // A dónde vuelve el navegador/webview de MP una vez que el usuario termina el checkout.
  urlVueltaCheckoutMP: process.env.URL_VUELTA_CHECKOUT_MP || 'https://mi-superapp.vercel.app',
};
