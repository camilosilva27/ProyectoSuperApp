/**
 * Envío de mails propios de SuperAhorro (recibo de pago, resúmenes de ahorro, avisos de trial,
 * re-engagement — ver .claude/docs/mails_y_notificaciones.md) vía la API HTTP de Brevo.
 *
 * Deliberadamente separado del SMTP de Brevo que ya usa Supabase Auth para sus mails
 * transaccionales (confirmación de registro, etc., ver Plan_Usuarios_y_cobros.md) — ese circuito
 * no se toca. Este es un segundo uso de la misma cuenta de Brevo, pero disparado por código
 * propio en vez de por Supabase, así que necesita su propia API key (distinta del SMTP).
 *
 * Se usa la API HTTP en vez del SMTP porque permite mandar HTML con asunto/destinatario
 * dinámicos por request sin manejar una conexión SMTP a mano; no hace falta sumar el SDK oficial
 * de Brevo como dependencia, la API es un solo POST con fetch (nativo en Node 20+).
 */

const { brevoApiKey, brevoRemitenteEmail, brevoRemitenteNombre } = require('./config');
const { HEADERS_NO_TRANSACCIONAL } = require('./plantillaMail');

// Robustez (auditoría 2026-09-24): antes el fetch no tenía timeout ni try/catch — un error de
// red (DNS, reset, Brevo colgado) LANZABA y cortaba el loop entero del cron que lo llamaba (y en
// Alertas las huellas ya estaban guardadas, así que esos avisos se perdían sin haber salido).
// Ahora NUNCA lanza: todo error vuelve como `{ ok: false, error }`, el mismo contrato que ya
// chequeaban todos los que lo llaman (`if (!resultado.ok) ... resultado.error`).
const TIMEOUT_MS = 15000;
// 429 = rate limit de Brevo. Un solo reintento, esperando lo que diga `Retry-After` (acotado para
// no colgar un cron que recorre N usuarios en serie); si vuelve a dar 429, se reporta como error.
const ESPERA_429_DEFAULT_MS = 2000;
const ESPERA_429_MAX_MS = 10000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function esperaDeRetryAfter(valor) {
  const segundos = Number(valor);
  if (Number.isFinite(segundos) && segundos >= 0) return Math.min(segundos * 1000, ESPERA_429_MAX_MS);
  return ESPERA_429_DEFAULT_MS;
}

async function postBrevo(body) {
  try {
    const respuesta = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'api-key': brevoApiKey,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (respuesta.ok) return { ok: true };
    const cuerpo = await respuesta.text().catch(() => '');
    return {
      ok: false,
      status: respuesta.status,
      retryAfter: respuesta.headers.get('retry-after'),
      error: `Brevo respondió ${respuesta.status}: ${cuerpo}`,
    };
  } catch (err) {
    const motivo = err?.name === 'TimeoutError' ? `timeout de ${TIMEOUT_MS / 1000}s` : err?.message || String(err);
    return { ok: false, error: `Error de red hablando con Brevo: ${motivo}` };
  }
}

/**
 * @param {object} opciones
 * @param {boolean} [opciones.noTransaccional] - resúmenes/inactividad/Alertas: agrega el header
 *   `List-Unsubscribe` (ver `HEADERS_NO_TRANSACCIONAL` en plantillaMail.js). Usar junto con
 *   `armarMailBase({ noTransaccional: true })`, que suma el pie de baja.
 * @returns {Promise<{ok: true} | {ok: false, error: string}>} nunca lanza.
 */
async function enviarMail({ destinatarioEmail, destinatarioNombre, asunto, html, noTransaccional = false }) {
  if (!brevoApiKey) {
    return { ok: false, error: 'Falta BREVO_API_KEY — no se pudo mandar el mail' };
  }

  const body = {
    sender: { email: brevoRemitenteEmail, name: brevoRemitenteNombre },
    to: [{ email: destinatarioEmail, name: destinatarioNombre || undefined }],
    subject: asunto,
    htmlContent: html,
    ...(noTransaccional ? { headers: { ...HEADERS_NO_TRANSACCIONAL } } : {}),
  };

  let resultado = await postBrevo(body);
  if (!resultado.ok && resultado.status === 429) {
    await sleep(esperaDeRetryAfter(resultado.retryAfter));
    resultado = await postBrevo(body);
  }
  return resultado.ok ? { ok: true } : { ok: false, error: resultado.error };
}

module.exports = { enviarMail };
