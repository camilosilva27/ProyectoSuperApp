/**
 * Monitoreo de errores (Sentry). Sin `SENTRY_DSN` configurado, `inicializar()` no hace nada y
 * el server sigue funcionando exactamente igual que antes — mismo criterio de "integración
 * opcional" que Mercado Pago/Brevo en config.js. Tiene que importarse y llamarse ANTES que
 * cualquier otro require de server.js (ver ese archivo) para que Sentry pueda instrumentar los
 * módulos que se cargan después (según su propia documentación de inicialización temprana).
 */

const Sentry = require('@sentry/node');
const { sentryDsn, entorno } = require('./config');

function inicializar() {
  if (!sentryDsn) return;
  Sentry.init({ dsn: sentryDsn, environment: entorno });
}

module.exports = { Sentry, inicializar };
