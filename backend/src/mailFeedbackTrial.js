/**
 * Mail "¿Por qué no seguiste?" a quien se le venció la prueba gratis sin pagar (ver
 * .claude/docs/mails_y_notificaciones.md). Lo manda cron/feedbackTrialVencido.js; las respuestas
 * las recibe routes/feedbackTrial.js.
 *
 * Texto decidido con el usuario (2026-11-04): en primera persona de Camilo, sin oferta, sin link
 * de baja (el link de baja va recién en el futuro mail de la oferta), línea de ahorro solo si
 * ahorró > $0, recordatorio de referidos. Las respuestas al mail van a contacto@ (`replyTo`).
 *
 * Cada botón de razón es un link a GET /api/mails/feedback?u=<id>&t=<token>&r=<razón>. El GET
 * NO registra nada: muestra la página con esa razón ya marcada y un campo de texto, y recién el
 * botón "Enviar" (POST) guarda. Mismo motivo que la baja de mails: los escáneres de links
 * (Outlook Safe Links, antivirus) abren TODOS los links del mail con GET, y si el GET guardara,
 * quedaría registrada una razón que la persona nunca eligió.
 *
 * Token: HMAC-SHA256(BAJA_MAILS_SECRET, 'feedback-trial:' + usuarioId). Reusa el secreto de la
 * baja (no hace falta otra variable en la VM) pero con prefijo, así el token de feedback no sirve
 * para dar de baja ni al revés.
 */

const crypto = require('crypto');
const config = require('./config');
const { armarMailBase, escaparHtml, URL_APP, COLOR_ACENTO_SUAVE, COLOR_TEXTO, COLOR_FONDO } = require('./plantillaMail');

// Orden = orden de los botones. `texto` es lo que ve la persona (mail y página).
const RAZONES = [
  { clave: 'caro', texto: 'Me pareció caro' },
  { clave: 'poco_ahorro', texto: 'No ahorré lo suficiente' },
  { clave: 'falta_super', texto: 'No estaba el súper donde compro' },
  { clave: 'no_la_use', texto: 'No la usé / me olvidé' },
  { clave: 'otra', texto: 'Otra razón (contame)' },
];
const CLAVES_RAZON = new Set(RAZONES.map(r => r.clave));

function tokenFeedback(usuarioId) {
  if (!config.bajaMailsSecret || !usuarioId) return null;
  return crypto.createHmac('sha256', config.bajaMailsSecret).update(`feedback-trial:${usuarioId}`).digest('base64url');
}

function tokenFeedbackValido(usuarioId, token) {
  const esperado = tokenFeedback(usuarioId);
  if (!esperado || typeof token !== 'string' || !token) return false;
  const a = Buffer.from(token);
  const b = Buffer.from(esperado);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** URL del botón de una razón, o null si no hay secreto (el cron no manda el mail en ese caso). */
function urlFeedback(usuarioId, razon) {
  const token = tokenFeedback(usuarioId);
  if (!token) return null;
  return `${config.urlPublicaBackend}/api/mails/feedback?u=${encodeURIComponent(usuarioId)}&t=${encodeURIComponent(token)}&r=${encodeURIComponent(razon)}`;
}

function formatearPesos(monto) {
  return monto.toLocaleString('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });
}

function armarHtml({ nombre, usuarioId, ahorroTotal }) {
  const saludo = nombre
    ? `Hola ${escaparHtml(nombre)}, soy Camilo, creador de SuperAhorro.`
    : 'Hola, soy Camilo, creador de SuperAhorro.';
  const lineaAhorro = ahorroTotal > 0
    ? `<p style="margin:0 0 16px 0;">Durante la prueba ahorraste <span style="background:${COLOR_ACENTO_SUAVE}; padding:2px 6px; border-radius:4px; font-weight:700;">${escaparHtml(formatearPesos(ahorroTotal))}</span> comparando precios.</p>`
    : '';
  const botones = RAZONES.map(r => `
      <tr><td style="padding:0 0 8px 0;">
        <a href="${escaparHtml(urlFeedback(usuarioId, r.clave))}" target="_blank" style="display:block; padding:12px 16px; border:1px solid #D5D9DE; border-radius:8px; color:${COLOR_TEXTO}; text-decoration:none; font-weight:600;">${escaparHtml(r.texto)}</a>
      </td></tr>`).join('');
  const cuerpo = `
    <p style="margin:0 0 16px 0;">${saludo}</p>
    <p style="margin:0 0 16px 0;">Vi que no renovaste la suscripción. Me ayudaría mucho saber por qué.</p>
    ${lineaAhorro}
    <p style="margin:0 0 12px 0;"><strong>¿Por qué no seguiste?</strong> Tocá la opción que más se acerque:</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${botones}</table>
    <p style="margin:16px 0 16px 0;">Si preferís contarme con tus palabras, respondé este mail: lo leo yo, no un robot.</p>
    <p style="margin:0; padding:12px 16px; background:${COLOR_FONDO}; border-radius:8px;">🎁 <strong>¿Querés volver sin pagar?</strong> Invitá a 3 amigos y te llevás 2 meses gratis.</p>
  `;
  return armarMailBase({
    preheader: 'Con un clic me ayudás a mejorar SuperAhorro.',
    titulo: '¿Por qué no seguiste?',
    cuerpoHtml: cuerpo,
    cta: { texto: 'Invitar amigos', url: `${URL_APP}/ajustes/invitar` },
  });
}

const ASUNTO = '¿Por qué no seguiste con SuperAhorro?';

module.exports = { RAZONES, CLAVES_RAZON, tokenFeedback, tokenFeedbackValido, urlFeedback, armarHtml, ASUNTO };
