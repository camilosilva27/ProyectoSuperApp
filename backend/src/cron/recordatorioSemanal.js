/**
 * Recordatorio semanal por notificación push web (primer caso de uso del circuito de push, ver
 * app/src/push/push.ts). Manda un mensaje genérico a todas las suscripciones guardadas en
 * `push_suscripcion` — sin personalización, solo para tener el circuito end-to-end andando.
 *
 * Uso: node src/cron/recordatorioSemanal.js   (o npm run recordatorio-semanal)
 * Crontab sugerido en la VM (lunes 10:00 hora Argentina — ajustar si la VM no está en ese huso,
 * confirmar con `timedatectl` antes de cargarlo):
 *   0 10 * * 1 cd /ruta/ProyectoSuperApp/backend && /usr/bin/node src/cron/recordatorioSemanal.js >> logs/cron-recordatorio-semanal.log 2>&1
 * Este archivo de crontab vive en la VM, no en el repo — mismo criterio que pingSupabase.js.
 */

const fs = require('fs');
const path = require('path');
const webpush = require('web-push');
const { rutaLogs, vapidPublicKey, vapidPrivateKey, vapidSubject } = require('../config');
const { clienteSupabaseAdmin } = require('../clienteSupabaseAdmin');

const MENSAJE = {
  title: 'Super App',
  body: '¿Ya revisaste los precios de esta semana? Puede que hayas ahorrado.',
};

async function recordatorioSemanal() {
  const inicio = new Date();
  console.log(`\n🔔 Recordatorio semanal — ${inicio.toLocaleString('es-AR')}`);

  const errores = [];
  let enviadas = 0;
  let vencidas = 0;

  if (!vapidPublicKey || !vapidPrivateKey) {
    errores.push('Faltan VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY — no se pudo mandar nada');
    console.error(`   ❌ ${errores[0]}`);
  } else {
    webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);

    const cliente = clienteSupabaseAdmin();
    if (!cliente) {
      errores.push('Falta SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY — no se pudo leer push_suscripcion');
      console.error(`   ❌ ${errores[0]}`);
    } else {
      const { data: suscripciones, error } = await cliente.from('push_suscripcion').select('endpoint, p256dh, auth');
      if (error) {
        errores.push(`No se pudo leer push_suscripcion: ${error.message}`);
        console.error(`   ❌ ${errores[0]}`);
      } else {
        for (const s of suscripciones ?? []) {
          try {
            await webpush.sendNotification(
              { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
              JSON.stringify(MENSAJE)
            );
            enviadas++;
          } catch (err) {
            // 404/410 = el navegador dio de baja la suscripción de su lado (desinstaló, borró
            // datos, etc.) — se limpia acá para que la tabla no acumule filas muertas.
            if (err.statusCode === 404 || err.statusCode === 410) {
              vencidas++;
              await cliente.from('push_suscripcion').delete().eq('endpoint', s.endpoint);
            } else {
              errores.push(`Falló el envío a ${s.endpoint}: ${err.message}`);
            }
          }
        }
        console.log(`   ✅ ${enviadas} enviadas, ${vencidas} vencidas (borradas), ${errores.length} con error`);
      }
    }
  }

  const reporte = {
    inicio: inicio.toISOString(),
    fin: new Date().toISOString(),
    enviadas,
    vencidas,
    errores,
  };

  fs.mkdirSync(rutaLogs, { recursive: true });
  fs.writeFileSync(path.join(rutaLogs, 'ultimo-recordatorio-semanal.json'), JSON.stringify(reporte, null, 2));

  console.log(errores.length ? '\n⚠️  Recordatorio terminado con problemas' : '\n✅ Recordatorio OK');

  return reporte;
}

if (require.main === module) {
  recordatorioSemanal()
    .then(r => process.exit(r.errores.length ? 1 : 0))
    .catch(err => {
      console.error('❌ Error fatal en el recordatorio semanal:', err);
      process.exit(1);
    });
}

module.exports = { recordatorioSemanal };
