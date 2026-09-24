/**
 * GET/POST /api/mails/baja?u=<usuarioId>&t=<token> — baja de un clic de los mails NO
 * transaccionales (resúmenes de ahorro, inactividad, Alertas). Ruta pública: la abre el usuario
 * desde el link del pie del mail, o la llama el propio cliente de mail (Gmail/Yahoo) desde el
 * header `List-Unsubscribe` + `List-Unsubscribe-Post` (RFC 8058).
 *
 * - GET: solo muestra una página de confirmación con un botón (form POST). NO da de baja: los
 *   escáneres de links de los clientes de mail (Outlook Safe Links, antivirus corporativos) abren
 *   todos los links con GET, y si el GET diera de baja, cualquier mail escaneado quedaría dado de
 *   baja sin que el usuario haga nada.
 * - POST: da de baja. Lo manda el botón de la página, o el cliente de mail con el body
 *   `List-Unsubscribe=One-Click` (application/x-www-form-urlencoded) al mismo URL del header.
 *
 * Autenticación: el token es HMAC-SHA256(BAJA_MAILS_SECRET, usuarioId) (`tokenBajaValido` en
 * plantillaMail.js), sin expiración y comparado en tiempo constante. Sin el secreto configurado,
 * responde 503 (y los mails no incluyen el link, solo el mailto a contacto@).
 *
 * La baja pone `perfil_usuario.mails_no_transaccionales = false` (migración 0027) con service
 * role: el usuario NO puede cambiar esa columna por la API (no está en el GRANT de 0024), así que
 * volver a suscribirse hoy es a mano (escribiendo a contacto@). Transaccionales (bienvenida,
 * recibo, fin de trial) y los push no se ven afectados.
 *
 * Las páginas no muestran datos personales (ni mail ni nombre): solo confirman la acción.
 */

const express = require('express');
const config = require('../config');
const { clienteSupabaseAdmin } = require('../clienteSupabaseAdmin');
const {
  tokenBajaValido,
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

// El body del POST (botón de la página o RFC 8058) viene como form urlencoded, no JSON — el
// express.json() global de server.js no lo parsea.
router.use('/baja', express.urlencoded({ extended: false, limit: '2kb' }));

const REGEX_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function pagina({ titulo, mensajeHtml, formAction }) {
  const boton = formAction
    ? `
      <form method="POST" action="${escaparHtml(formAction)}" style="margin:24px 0 8px 0;">
        <button type="submit" style="border:0; border-radius:8px; background:${COLOR_ACENTO}; color:${COLOR_TEXTO}; font-family:Helvetica,Arial,sans-serif; font-size:16px; font-weight:700; padding:14px 32px; cursor:pointer;">Darme de baja</button>
      </form>`
    : '';
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
    <div style="padding:32px; text-align:center; color:${COLOR_TEXTO};">
      <div style="font-size:20px; font-weight:700; margin-bottom:12px;">${escaparHtml(titulo)}</div>
      <div style="font-size:15px; line-height:1.5; color:${COLOR_TEXTO_SUAVE};">${mensajeHtml}</div>
      ${boton}
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
      // El URL lleva el token: que no viaje como Referer a ningún lado.
      'Referrer-Policy': 'no-referrer',
      'X-Robots-Tag': 'noindex',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'",
    })
    .send(pagina(contenido));
}

const NO_CONFIGURADO = {
  titulo: 'No disponible',
  mensajeHtml: `La baja automática no está disponible en este momento. Escribinos a ${escaparHtml(MAIL_CONTACTO)} con el asunto "baja" y te damos de baja a mano.`,
};
const LINK_INVALIDO = {
  titulo: 'Link inválido',
  mensajeHtml: `Este link de baja no es válido o está incompleto. Probá abrirlo de nuevo desde el mail, o escribinos a ${escaparHtml(MAIL_CONTACTO)} con el asunto "baja".`,
};

// Lee u/t de la query (así viene el URL del mail y del header) o, de respaldo, del body.
function credenciales(req) {
  const u = typeof req.query.u === 'string' ? req.query.u : req.body?.u;
  const t = typeof req.query.t === 'string' ? req.query.t : req.body?.t;
  return { u: typeof u === 'string' ? u : '', t: typeof t === 'string' ? t : '' };
}

function validar(req, res) {
  if (!config.bajaMailsSecret) {
    responder(res, 503, NO_CONFIGURADO);
    return null;
  }
  const { u, t } = credenciales(req);
  if (!REGEX_UUID.test(u) || !tokenBajaValido(u, t)) {
    responder(res, 400, LINK_INVALIDO);
    return null;
  }
  return { u, t };
}

router.get('/baja', (req, res) => {
  const cred = validar(req, res);
  if (!cred) return;
  responder(res, 200, {
    titulo: '¿Dejar de recibir estos mails?',
    mensajeHtml: 'Vas a dejar de recibir los resúmenes de ahorro, los avisos de Alertas y los recordatorios por mail. Los mails sobre tu cuenta y tus pagos (recibos, fin de la prueba) te van a seguir llegando.',
    // Relativo al path actual (/api/mails/baja) — mismo endpoint, por POST.
    formAction: `baja?u=${encodeURIComponent(cred.u)}&t=${encodeURIComponent(cred.t)}`,
  });
});

// Cubre tanto el botón de la página como el POST RFC 8058 (`List-Unsubscribe=One-Click`): en
// ambos casos lo que autoriza es el token, así que no hace falta distinguirlos.
router.post('/baja', async (req, res) => {
  const cred = validar(req, res);
  if (!cred) return;

  const cliente = clienteSupabaseAdmin();
  if (!cliente) return responder(res, 503, NO_CONFIGURADO);

  const { error } = await cliente
    .from('perfil_usuario')
    .update({ mails_no_transaccionales: false })
    .eq('id', cred.u);
  if (error) {
    console.error(`Baja de mails: no se pudo actualizar al usuario ${cred.u}: ${error.message}`);
    return responder(res, 500, {
      titulo: 'No pudimos darte de baja',
      mensajeHtml: `Hubo un error de nuestro lado. Probá de nuevo en un rato, o escribinos a ${escaparHtml(MAIL_CONTACTO)} con el asunto "baja".`,
    });
  }

  responder(res, 200, {
    titulo: 'Listo, te diste de baja',
    mensajeHtml: `No vas a recibir más resúmenes ni avisos por mail. Los mails sobre tu cuenta y tus pagos te van a seguir llegando. Si te arrepentís, escribinos a ${escaparHtml(MAIL_CONTACTO)}.<br /><br /><a href="${escaparHtml(URL_APP)}" style="color:${COLOR_TEXTO};">Volver a SuperAhorro</a>`,
  });
});

module.exports = router;
