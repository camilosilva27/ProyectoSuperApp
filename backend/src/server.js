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

const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const { puerto, entorno, rutaImagenes } = require('./config');
const healthRouter = require('./routes/health');
const catalogoRouter = require('./routes/catalogo');
const compararRouter = require('./routes/comparar');
const misDescuentosRouter = require('./routes/misDescuentos');
const pagosRouter = require('./routes/pagos');
const webhookMercadoPagoRouter = require('./routes/webhookMercadoPago');
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
// /api/webhooks/mercadopago es pública pero la llama Mercado Pago, no un usuario — ver la
// verificación de firma dentro de webhookMercadoPago.js. Ninguna de las dos dispara
// consultas a los 5 supers, así que el rate limit global de acá abajo (120/min) alcanza.
app.use('/api', pagosRouter, webhookMercadoPagoRouter);

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
}), catalogoRouter, compararRouter, misDescuentosRouter);

app.use((req, res) => res.status(404).json({ error: 'Ruta no encontrada' }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('Error no manejado:', err);
  res.status(500).json({ error: 'Error interno del servidor' });
});

function arrancar() {
  app.listen(puerto, () => {
    console.log(`🚀 AllPromos backend escuchando en http://localhost:${puerto} (${entorno})`);
    console.log(`   Probá: curl -s http://localhost:${puerto}/api/health`);
  });
  sondaEnVivo.iniciar();
}

if (require.main === module) arrancar();

module.exports = { app, arrancar };
