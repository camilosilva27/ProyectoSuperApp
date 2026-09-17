/**
 * Monitoreo de errores (Sentry). Sin `SENTRY_DSN` configurado, `inicializar()` no hace nada y
 * el server sigue funcionando exactamente igual que antes — mismo criterio de "integración
 * opcional" que Mercado Pago/Brevo en config.js. Tiene que importarse y llamarse ANTES que
 * cualquier otro require de server.js (ver ese archivo) para que Sentry pueda instrumentar los
 * módulos que se cargan después (según su propia documentación de inicialización temprana).
 *
 * Tampoco se inicializa en desarrollo local (`NODE_ENV=development`, el default de `backend/.env`)
 * — mismo criterio que `app/src/sentry.ts` con `__DEV__`: solo interesa monitorear errores del
 * server real (VM), no cosas como el puerto 3000 ya ocupado en la máquina del dev.
 */

const Sentry = require('@sentry/node');
const { sentryDsn, entorno } = require('./config');

function inicializar() {
  if (!sentryDsn || entorno === 'development') return;
  Sentry.init({ dsn: sentryDsn, environment: entorno });
}

module.exports = { Sentry, inicializar };
