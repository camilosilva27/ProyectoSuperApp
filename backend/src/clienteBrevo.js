/**
 * Envío de mails propios de Super App (recibo de pago, resúmenes de ahorro, avisos de trial,
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

async function enviarMail({ destinatarioEmail, destinatarioNombre, asunto, html }) {
  if (!brevoApiKey) {
    return { ok: false, error: 'Falta BREVO_API_KEY — no se pudo mandar el mail' };
  }

  const respuesta = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': brevoApiKey,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      sender: { email: brevoRemitenteEmail, name: brevoRemitenteNombre },
      to: [{ email: destinatarioEmail, name: destinatarioNombre || undefined }],
      subject: asunto,
      htmlContent: html,
    }),
  });

  if (!respuesta.ok) {
    const cuerpo = await respuesta.text().catch(() => '');
    return { ok: false, error: `Brevo respondió ${respuesta.status}: ${cuerpo}` };
  }

  return { ok: true };
}

module.exports = { enviarMail };
