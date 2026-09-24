/**
 * Servidor HTTP de AllPromos.
 *
 * Existe para que la app mobile no tenga que hablar directo con las APIs de los
 * supermercados: centralizar las consultas acá permite controlar el ritmo de requests en un
 * solo lugar en vez de en cada teléfono (Carrefour tira 429, Chango Más también 502
 * intermitentes). (Motivo histórico que ya no aplica: una cookie `vtex_segment` de Vea que no
 * debía viajar en el binario — se sacó del código por completo el 2026-08-20, ver
 * CONTEXTO_TECNICO.md § "API de Vea".)
 *
 * No duplica lógica de negocio: importa AllPromos/core/* igual que el CLI.
 */

// Antes que cualquier otro require: Sentry necesita inicializarse temprano para poder
// instrumentar los módulos que se cargan después (ver sentry.js).
const { Sentry, inicializar: inicializarSentry } = require('./sentry');
inicializarSentry();

const express = require('express');
const cors = require('cors');

// Express 4 no atrapa promesas rechazadas de handlers `async`: si uno tira después de un
// `await`, el request queda colgado hasta el timeout del cliente y el rechazo sale como
// `unhandledRejection` (auditoría 2026-09-24 — ej. POST /api/comparar, y lo mismo en pagos,
// mis-descuentos, productos seguidos). En vez de envolver cada handler de cada router a mano
// (y depender de que nadie se olvide en el próximo), se hace una sola vez acá, en el punto por
// el que pasa TODO handler de Express 4 (Layer#handle_request): si devuelve una promesa, su
// rechazo se manda a next(err) → Sentry + el handler final de abajo (500 genérico). Es lo mismo
// que hace el paquete `express-async-errors`, sin sumar la dependencia. Express 5 ya hace esto
// de fábrica — al migrar, este bloque se borra.
(function atraparRechazosDeHandlersAsync() {
  const Layer = require('express/lib/router/layer');
  if (Layer.prototype.__rechazosAsyncAtrapados) return;
  Layer.prototype.handle_request = function handle(req, res, next) {
    const fn = this.handle;
    if (fn.length > 3) return next(); // middleware de error: no aplica acá
    try {
      const resultado = fn(req, res, next);
      if (resultado && typeof resultado.then === 'function') resultado.then(null, next);
    } catch (err) {
      next(err);
    }
  };
  Layer.prototype.__rechazosAsyncAtrapados = true;
})();
const rateLimit = require('express-rate-limit');

const { puerto, host, entorno, rutaImagenes } = require('./config');
const healthRouter = require('./routes/health');
const catalogoRouter = require('./routes/catalogo');
const compararRouter = require('./routes/comparar');
const misDescuentosRouter = require('./routes/misDescuentos');
const promosBancariasGrillaRouter = require('./routes/promosBancariasGrilla');
const productosSeguidosRouter = require('./routes/productosSeguidos');
const pagosRouter = require('./routes/pagos');
const webhookMercadoPagoRouter = require('./routes/webhookMercadoPago');
const webhookAuthUsuariosRouter = require('./routes/webhookAuthUsuarios');
const bajaMailsRouter = require('./routes/bajaMails');
const sondaEnVivo = require('./sondaEnVivo');

const app = express();

// Detrás de Caddy (reverse proxy en la misma VM, ver Caddyfile) — sin esto, Express ignora
// X-Forwarded-For y usa la IP del socket (siempre 127.0.0.1, la conexión local de Caddy a
// Node), así que TODOS los usuarios comparten el mismo balde de rate limit en vez de uno cada
// uno. 'loopback' confía en X-Forwarded-For solo cuando quien conecta es un proceso local —
// no un proxy externo arbitrario, que sería spoofeable.
app.set('trust proxy', 'loopback');

app.disable('x-powered-by');
app.use(cors());
app.use(express.json({ limit: '256kb' }));

// Fotos de producto: se sirven desde disco propio (ver src/cron/descargarImagenes.js), no
// se vuelve a pedir nada al super en cada request. Sin token — son fotos de producto que el
// super ya expone públicamente, no hay nada que proteger, y así <Image> no necesita mandar
// headers custom. `immutable` porque una vez descargada una foto nunca se pisa (ver el
// comentario de "para siempre" en descargarImagenes.js).
app.use('/imagenes', rateLimit({
  windowMs: 60 * 1000,
  limit: 300,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
}), express.static(rutaImagenes, { maxAge: '30d', immutable: true }));

// Límite global. La app es para una familia: cualquier volumen por encima de esto es un
// error de la app o alguien usando el backend como proxy hacia los supermercados.
app.use('/api', rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Demasiados requests, esperá un momento' },
}));

// /api/health va sin token: es lo que se usa para saber si el server está vivo.
app.use('/api', healthRouter);

// /api/pagos/suscripcion requiere sesión (ver requiereSesion.js dentro de pagos.js).
// /api/webhooks/mercadopago y /api/webhooks/auth-usuarios son públicas pero las llama
// Mercado Pago y Supabase respectivamente, no un usuario — ver la verificación de firma/secreto
// dentro de cada archivo. Ninguna dispara consultas a los 5 supers, así que el rate limit
// global de acá abajo (120/min) alcanza.
app.use('/api', pagosRouter, webhookMercadoPagoRouter, webhookAuthUsuariosRouter);

// Baja de un clic de mails no transaccionales (GET = página de confirmación, POST = baja; ver
// routes/bajaMails.js). Pública, autenticada por el token HMAC del link. Límite propio más
// estricto que el global: un usuario real la abre una o dos veces, nunca decenas por minuto.
app.use('/api/mails', rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: 'Demasiados intentos, probá de nuevo en unos minutos.',
}), bajaMailsRouter);

// Sin token: en una app web no hay dónde guardar un secreto (queda en el JS que descarga
// cualquiera — ver la discusión en PLAN_FEATURES_APP.md). La única defensa real hoy es este
// límite, más estricto que el global porque comparar y precios disparan consultas reales a
// los 5 supermercados — Carrefour y Chango Más ya devuelven 429/502 con tráfico normal, así
// que un abuso acá arriesga que nos bloqueen a nosotros, no solo "usar de más" el backend propio.
app.use('/api', rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Demasiadas comparaciones seguidas, esperá un momento' },
  skip: req => !req.path.startsWith('/comparar') && !req.path.startsWith('/precios')
    && !req.path.startsWith('/mis-descuentos'),
}), catalogoRouter, compararRouter, misDescuentosRouter, promosBancariasGrillaRouter, productosSeguidosRouter);

app.use((req, res) => res.status(404).json({ error: 'Ruta no encontrada' }));

// Reporta a Sentry (no-op si SENTRY_DSN no está configurado, ver sentry.js) y deja pasar el
// error al handler de abajo, que sigue respondiendo el mismo JSON de siempre — Sentry es
// puramente aditivo acá, no cambia la respuesta que recibe el cliente.
Sentry.setupExpressErrorHandler(app);

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('Error no manejado:', err);
  // Si el handler ya empezó a responder antes de tirar, no se puede mandar otro status: se le
  // deja al handler default de Express, que corta la conexión.
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'Error interno del servidor' });
});

// Red de seguridad a nivel proceso (2026-09-24): un rechazo sin capturar fuera de un request
// (ej. un timer de sondaEnVivo, un fetch disparado sin await) hoy se loguea y se reporta a
// Sentry, pero NO tumba el proceso — desde Node 15 el default de `unhandledRejection` es
// crashear, y un rechazo aislado no justifica cortar /api/comparar para todos hasta que systemd
// lo reinicie. `uncaughtException` es distinto: ahí el estado del proceso puede quedar
// corrupto, así que se reporta y se sale (systemd lo levanta de nuevo).
function instalarHandlersDeProceso() {
  process.on('unhandledRejection', razon => {
    console.error('unhandledRejection (no se tumba el proceso):', razon);
    try { Sentry.captureException(razon); } catch { /* Sentry no inicializado: no-op */ }
  });
  process.on('uncaughtException', err => {
    console.error('uncaughtException — saliendo para que systemd reinicie:', err);
    try { Sentry.captureException(err); } catch { /* idem */ }
    // Darle a Sentry un momento para mandar el evento antes de salir (no-op sin DSN).
    Promise.resolve(Sentry.flush?.(2000)).finally(() => process.exit(1));
  });
}

function arrancar() {
  instalarHandlersDeProceso();
  app.listen(puerto, host, () => {
    console.log(`🚀 AllPromos backend escuchando en http://${host}:${puerto} (${entorno})`);
    console.log(`   Probá: curl -s http://localhost:${puerto}/api/health`);
  });
  sondaEnVivo.iniciar();
}

if (require.main === module) arrancar();

module.exports = { app, arrancar };
