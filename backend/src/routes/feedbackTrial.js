/**
 * GET/POST /api/mails/feedback?u=<usuarioId>&t=<token>&r=<razón> — respuesta al mail
 * "¿Por qué no seguiste?" (mailFeedbackTrial.js, cron/feedbackTrialVencido.js). Ruta pública,
 * autenticada por el token HMAC del link (`tokenFeedbackValido`).
 *
 * - GET: página con las razones (la del botón tocado ya marcada) + campo de texto opcional. NO
 *   guarda nada — ver el porqué en mailFeedbackTrial.js (escáneres de links).
 * - POST: guarda en `feedback_trial` (una fila por usuario; si responde de nuevo, pisa) y muestra
 *   el "¡Gracias!".
 *
 * La página se sirve desde el backend (no la app): quien la abre no tiene acceso a la app (se le
 * venció la prueba) y no hace falta sesión. No muestra datos personales.
 */

const express = require('express');
const config = require('../config');
const { clienteSupabaseAdmin } = require('../clienteSupabaseAdmin');
const { RAZONES, CLAVES_RAZON, tokenFeedbackValido } = require('../mailFeedbackTrial');
const {
  escaparHtml,
  MAIL_CONTACTO,
  COLOR_BANNER,
  COLOR_FONDO,
  COLOR_TEXTO,
  COLOR_TEXTO_SUAVE,
  COLOR_ACENTO,
  URL_APP,
} = require('../plantillaMail');

const router = express.Router();
router.use('/feedback', express.urlencoded({ extended: false, limit: '8kb' }));

const REGEX_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LARGO_MAXIMO_COMENTARIO = 2000; // mismo check que la tabla (migración 0034)

function pagina({ titulo, contenidoHtml }) {
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex" />
  <title>SuperAhorro — ${escaparHtml(titulo)}</title>
</head>
<body style="margin:0; padding:32px 16px; background:${COLOR_FONDO}; font-family:Helvetica,Arial,sans-serif;">
  <div style="max-width:520px; margin:0 auto; background:#FFFFFF; border-radius:12px; overflow:hidden;">
    <div style="background:${COLOR_BANNER}; color:#FFFFFF; padding:24px; text-align:center; font-size:20px; font-weight:700;">SuperAhorro</div>
    <div style="padding:32px; color:${COLOR_TEXTO};">
      <div style="font-size:20px; font-weight:700; margin-bottom:12px; text-align:center;">${escaparHtml(titulo)}</div>
      <div style="font-size:15px; line-height:1.5; color:${COLOR_TEXTO_SUAVE};">${contenidoHtml}</div>
    </div>
  </div>
</body>
</html>`;
}

function responder(res, status, contenido) {
  res
    .status(status)
    .set({
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      'X-Robots-Tag': 'noindex',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'",
    })
    .send(pagina(contenido));
}

const NO_DISPONIBLE = {
  titulo: 'No disponible',
  contenidoHtml: `<p style="text-align:center;">Esto no está disponible en este momento. Si querés, contame por mail a ${escaparHtml(MAIL_CONTACTO)}.</p>`,
};
const LINK_INVALIDO = {
  titulo: 'Link inválido',
  contenidoHtml: `<p style="text-align:center;">Este link no es válido o está incompleto. Probá abrirlo de nuevo desde el mail, o contame directamente a ${escaparHtml(MAIL_CONTACTO)}.</p>`,
};

function valor(req, campo) {
  const v = typeof req.query[campo] === 'string' ? req.query[campo] : req.body?.[campo];
  return typeof v === 'string' ? v : '';
}

function validar(req, res) {
  if (!config.bajaMailsSecret) {
    responder(res, 503, NO_DISPONIBLE);
    return null;
  }
  const u = valor(req, 'u');
  const t = valor(req, 't');
  if (!REGEX_UUID.test(u) || !tokenFeedbackValido(u, t)) {
    responder(res, 400, LINK_INVALIDO);
    return null;
  }
  return { u, t };
}

function formulario({ u, t, razonMarcada, error }) {
  const opciones = RAZONES.map(r => `
      <label style="display:block; padding:12px 16px; margin:0 0 8px 0; border:1px solid #D5D9DE; border-radius:8px; color:${COLOR_TEXTO}; font-weight:600; cursor:pointer;">
        <input type="radio" name="r" value="${r.clave}" ${r.clave === razonMarcada ? 'checked' : ''} required style="margin-right:8px;" />${escaparHtml(r.texto)}
      </label>`).join('');
  const etiquetaTexto = razonMarcada === 'otra' ? 'Contame qué pasó:' : '¿Querés contarme más? (opcional)';
  return `
    ${error ? `<p style="color:#B00020; text-align:center;">${escaparHtml(error)}</p>` : ''}
    <form method="POST" action="feedback?u=${encodeURIComponent(u)}&t=${encodeURIComponent(t)}">
      ${opciones}
      <label for="comentario" style="display:block; margin:16px 0 6px 0; color:${COLOR_TEXTO}; font-weight:600;">${etiquetaTexto}</label>
      <textarea id="comentario" name="comentario" rows="4" maxlength="${LARGO_MAXIMO_COMENTARIO}" ${razonMarcada === 'otra' ? 'autofocus' : ''}
        style="width:100%; box-sizing:border-box; padding:12px; border:1px solid #D5D9DE; border-radius:8px; font-family:inherit; font-size:15px;"></textarea>
      <div style="text-align:center;">
        <button type="submit" style="margin:20px 0 4px 0; border:0; border-radius:8px; background:${COLOR_ACENTO}; color:${COLOR_TEXTO}; font-family:Helvetica,Arial,sans-serif; font-size:16px; font-weight:700; padding:14px 32px; cursor:pointer;">Enviar</button>
      </div>
    </form>`;
}

router.get('/feedback', (req, res) => {
  const cred = validar(req, res);
  if (!cred) return;
  const r = valor(req, 'r');
  responder(res, 200, {
    titulo: '¿Por qué no seguiste?',
    contenidoHtml: formulario({ ...cred, razonMarcada: CLAVES_RAZON.has(r) ? r : null }),
  });
});

router.post('/feedback', async (req, res) => {
  const cred = validar(req, res);
  if (!cred) return;

  const razon = typeof req.body?.r === 'string' ? req.body.r : '';
  const comentario = (typeof req.body?.comentario === 'string' ? req.body.comentario : '').trim().slice(0, LARGO_MAXIMO_COMENTARIO);
  if (!CLAVES_RAZON.has(razon)) {
    return responder(res, 400, {
      titulo: '¿Por qué no seguiste?',
      contenidoHtml: formulario({ ...cred, razonMarcada: null, error: 'Elegí una de las opciones.' }),
    });
  }
  if (razon === 'otra' && !comentario) {
    return responder(res, 400, {
      titulo: '¿Por qué no seguiste?',
      contenidoHtml: formulario({ ...cred, razonMarcada: 'otra', error: 'Contame brevemente qué pasó.' }),
    });
  }

  const cliente = clienteSupabaseAdmin();
  if (!cliente) return responder(res, 503, NO_DISPONIBLE);

  const { error } = await cliente
    .from('feedback_trial')
    .upsert(
      { usuario_id: cred.u, razon, comentario: comentario || null, actualizado_en: new Date().toISOString() },
      { onConflict: 'usuario_id' }
    );
  if (error) {
    console.error(`Feedback trial: no se pudo guardar la respuesta de ${cred.u}: ${error.message}`);
    return responder(res, 500, {
      titulo: 'No se pudo guardar',
      contenidoHtml: `<p style="text-align:center;">Hubo un error de mi lado. Probá de nuevo en un rato, o contame directamente a ${escaparHtml(MAIL_CONTACTO)}.</p>`,
    });
  }

  responder(res, 200, {
    titulo: '¡Gracias!',
    contenidoHtml: `<p style="text-align:center;">Me sirve mucho para mejorar SuperAhorro. Si querés contarme algo más, respondé el mail cuando quieras.</p>
      <p style="text-align:center; margin-top:20px;"><a href="${escaparHtml(URL_APP)}" style="color:${COLOR_TEXTO};">Ir a SuperAhorro</a></p>`,
  });
});

module.exports = router;
