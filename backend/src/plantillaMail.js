/**
 * Plantilla visual compartida para los mails que arma el backend (clienteBrevo.js) — replica
 * a mano el diseño de `supabase/email-templates/confirm-signup.html` (banner oscuro + tarjeta
 * blanca + acento amarillo "oferta") para que todos los mails de SuperAhorro se vean como parte
 * de la misma app, no como texto plano. Son dos sistemas separados (ese template lo edita
 * Supabase con sus propios placeholders `{{ .SiteURL }}`, este lo arma JS puro), así que no se
 * puede compartir el archivo — si se retoca el diseño de uno, conviene revisar el otro.
 *
 * Tablas HTML (no flexbox/grid) a propósito: es el layout que sobrevive en clientes de mail
 * viejos (Outlook de escritorio, etc.), mismo criterio que ya usa confirm-signup.html.
 */

const COLOR_BANNER = '#14161A';
const COLOR_TEXTO = '#14161A';
const COLOR_TEXTO_SUAVE = '#3C444D';
const COLOR_TEXTO_FOOTER = '#767E88';
const COLOR_FONDO = '#F6F7F9';
const COLOR_ACENTO = '#FFD400'; // mismo amarillo "oferta" de theme.ts / confirm-signup.html — reservado para el botón CTA
const COLOR_ACENTO_SUAVE = '#FFF6C9'; // "ofertaSuave" de theme.ts — para destacar un monto sin que se confunda con el botón
const LOGO_URL = 'https://mi-superapp.com.ar/apple-touch-icon.png';
const URL_APP = 'https://mi-superapp.com.ar';

// Baja de mails NO transaccionales (auditoría 2026-09-24): resúmenes de ahorro, inactividad y
// Alertas son mails "de marketing/aviso" que el usuario no pidió puntualmente, así que tienen que
// decir cómo darse de baja (pie) y llevar el header `List-Unsubscribe` (Gmail/Outlook muestran el
// botón "Anular suscripción" con él y penalizan menos al remitente). Por ahora la baja es a mano
// por mail al contacto; cuando exista un endpoint de baja con token alcanza con sumar su URL acá
// (header `<https://...>` + `List-Unsubscribe-Post`) y en `PIE_BAJA`, sin tocar cada cron.
// Recibo de pago, bienvenida y fin de trial son transaccionales: no llevan esto.
const MAIL_CONTACTO = 'contacto@mi-superapp.com.ar';
const HEADERS_NO_TRANSACCIONAL = {
  'List-Unsubscribe': `<mailto:${MAIL_CONTACTO}?subject=baja>`,
};
const PIE_BAJA = `Si no querés recibir más estos mails, escribinos a <a href="mailto:${MAIL_CONTACTO}?subject=baja" style="color:${COLOR_TEXTO_FOOTER};">${MAIL_CONTACTO}</a> con el asunto "baja".`;

/**
 * Escapa texto para interpolarlo en HTML (contenido o atributo entre comillas). Usar en TODO
 * dato no confiable que termine en un mail: el `nombre` lo escribe el usuario al registrarse y
 * los nombres de producto vienen scrapeados de los supers — sin esto, un nombre con `<a href>` o
 * `<img>` se renderizaba como HTML dentro de un mail que sale con nuestro remitente (auditoría
 * 2026-09-24). null/undefined → ''.
 */
function escaparHtml(valor) {
  if (valor === null || valor === undefined) return '';
  return String(valor)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * @param {string} preheader - texto oculto que se ve en la bandeja de entrada antes de abrir.
 * @param {string} titulo - headline dentro de la tarjeta (no el asunto del mail).
 * @param {string} cuerpoHtml - HTML ya armado del contenido (párrafos, chip de monto, etc.).
 * @param {{texto: string, url?: string}} [cta] - botón amarillo opcional, como el de confirm-signup.
 * @param {string} [footerTexto] - texto chico al pie, dentro de la misma tarjeta visual.
 * @param {boolean} [noTransaccional] - suma al pie cómo darse de baja (`PIE_BAJA`). Va junto con
 *   `noTransaccional: true` en `enviarMail` (clienteBrevo.js), que agrega el header List-Unsubscribe.
 *
 * `preheader`, `titulo`, `cta.texto`/`cta.url` y `footerTexto` son TEXTO plano y se escapan acá;
 * `cuerpoHtml` es HTML ya armado — quien lo arma tiene que escapar sus datos con `escaparHtml`.
 */
function armarMailBase({ preheader, titulo, cuerpoHtml, cta, footerTexto, noTransaccional }) {
  const pie = escaparHtml(footerTexto || 'Recibís este mail porque tenés una cuenta en SuperAhorro.')
    + (noTransaccional ? `<br />${PIE_BAJA}` : '');
  const botonCta = cta
    ? `
              <table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px auto 8px auto;">
                <tr>
                  <td align="center" style="border-radius:8px; background-color:${COLOR_ACENTO};">
                    <a
                      href="${escaparHtml(cta.url || URL_APP)}"
                      target="_blank"
                      style="display:inline-block; padding:14px 32px; font-family:Helvetica,Arial,sans-serif; font-size:16px; font-weight:700; color:${COLOR_TEXTO}; text-decoration:none; border-radius:8px;"
                    >
                      ${escaparHtml(cta.texto)}
                    </a>
                  </td>
                </tr>
              </table>`
    : '';

  return `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
</head>
<body style="margin:0; padding:0; background-color:${COLOR_FONDO};">
  <div style="display:none; max-height:0; overflow:hidden; opacity:0;">${escaparHtml(preheader)}</div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${COLOR_FONDO};">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px; width:100%; background-color:#FFFFFF; border-radius:12px; overflow:hidden;">

          <tr>
            <td align="center" style="background-color:${COLOR_BANNER}; padding:32px 24px;">
              <img
                src="${LOGO_URL}"
                width="56" height="56" alt="SuperAhorro"
                style="display:block; border-radius:12px; margin-bottom:12px;"
              />
              <div style="font-family:Helvetica,Arial,sans-serif; font-size:20px; font-weight:700; color:#FFFFFF;">
                SuperAhorro
              </div>
            </td>
          </tr>

          <tr>
            <td style="padding:32px 32px 24px 32px; font-family:Helvetica,Arial,sans-serif; color:${COLOR_TEXTO}; text-align:center;">
              <div style="font-size:20px; font-weight:700; margin-bottom:12px;">
                ${escaparHtml(titulo)}
              </div>
              <div style="font-size:15px; line-height:1.5; color:${COLOR_TEXTO_SUAVE}; text-align:left;">
                ${cuerpoHtml}
              </div>
              ${botonCta}
            </td>
          </tr>

          <tr>
            <td style="padding:20px 32px; background-color:${COLOR_FONDO}; font-family:Helvetica,Arial,sans-serif; font-size:12px; color:${COLOR_TEXTO_FOOTER}; text-align:center;">
              ${pie}
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`;
}

module.exports = {
  armarMailBase,
  escaparHtml,
  HEADERS_NO_TRANSACCIONAL,
  PIE_BAJA,
  MAIL_CONTACTO,
  COLOR_ACENTO,
  COLOR_ACENTO_SUAVE,
  COLOR_TEXTO,
  URL_APP,
};
