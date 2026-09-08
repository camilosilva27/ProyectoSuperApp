/**
 * Envío de push web dirigido a un usuario puntual — generaliza el circuito que ya probó
 * `recordatorioSemanal.js` (mensaje genérico a TODAS las suscripciones) para los mails nuevos
 * (resumen mensual/semanal, aviso de trial, inactividad, recibo de pago), que sí necesitan
 * mandarle a cada usuario su propio contenido.
 *
 * Mismo criterio de limpieza que recordatorioSemanal.js: un 404/410 de una suscripción significa
 * que el navegador la dio de baja de su lado (desinstaló, borró datos) — se borra de la tabla
 * en el momento, no se deja acumular filas muertas.
 */

const webpush = require('web-push');
const { vapidPublicKey, vapidPrivateKey, vapidSubject } = require('./config');

let vapidConfigurado = false;
function asegurarVapidConfigurado() {
  if (vapidConfigurado) return true;
  if (!vapidPublicKey || !vapidPrivateKey) return false;
  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
  vapidConfigurado = true;
  return true;
}

/**
 * Trae TODAS las suscripciones de una sola vez, agrupadas por usuario — para que un cron que ya
 * recorre N usuarios no haga N queries separadas (mismo motivo por el que los crons de mail ya
 * traen perfiles/eventos en un solo select antes del loop).
 */
async function obtenerSuscripcionesPorUsuario(clienteAdmin) {
  const { data, error } = await clienteAdmin.from('push_suscripcion').select('usuario_id, endpoint, p256dh, auth');
  if (error) throw new Error(`No se pudo leer push_suscripcion: ${error.message}`);

  const mapa = new Map();
  for (const fila of data ?? []) {
    const lista = mapa.get(fila.usuario_id) ?? [];
    lista.push(fila);
    mapa.set(fila.usuario_id, lista);
  }
  return mapa;
}

/**
 * Para el caso evento-a-evento (ej. reciboPago.js): un solo usuario, no vale la pena traer la
 * tabla entera como hacen los crons (que ya recorren N usuarios en el mismo proceso).
 */
async function obtenerSuscripcionesDeUsuario(clienteAdmin, usuarioId) {
  const { data, error } = await clienteAdmin.from('push_suscripcion').select('endpoint, p256dh, auth').eq('usuario_id', usuarioId);
  if (error) throw new Error(`No se pudo leer push_suscripcion: ${error.message}`);
  return data ?? [];
}

/**
 * @param {object} clienteAdmin - cliente de Supabase con service role (para borrar suscripciones vencidas).
 * @param {Array} lista - suscripciones de un usuario (de obtenerSuscripcionesPorUsuario.get(id) ?? [], o de obtenerSuscripcionesDeUsuario).
 * @param {{title: string, body: string, url?: string}} payload - `url` es adónde navega el
 *   click de la notificación (ver sw.js) — default '/' si no se especifica.
 */
async function enviarPush(clienteAdmin, lista, payload) {
  if (lista.length === 0) return { enviados: 0, vencidas: 0, errores: [] };
  if (!asegurarVapidConfigurado()) return { enviados: 0, vencidas: 0, errores: ['Faltan VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY'] };

  let enviados = 0;
  let vencidas = 0;
  const errores = [];

  for (const s of lista) {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify(payload)
      );
      enviados++;
    } catch (err) {
      if (err.statusCode === 404 || err.statusCode === 410) {
        vencidas++;
        await clienteAdmin.from('push_suscripcion').delete().eq('endpoint', s.endpoint);
      } else {
        errores.push(`Push a ${s.endpoint.slice(0, 40)}...: ${err.message}`);
      }
    }
  }

  return { enviados, vencidas, errores };
}

module.exports = { obtenerSuscripcionesPorUsuario, obtenerSuscripcionesDeUsuario, enviarPush };
