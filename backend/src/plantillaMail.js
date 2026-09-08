/**
 * Plantilla visual compartida para los mails que arma el backend (clienteBrevo.js) — replica
 * a mano el diseño de `supabase/email-templates/confirm-signup.html` (banner oscuro + tarjeta
 * blanca + acento amarillo "oferta") para que todos los mails de Super App se vean como parte
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
const COLOR_ACENTO = '#FFD400'; // mismo amarillo "oferta" de theme.ts / confirm-signup.html
const LOGO_URL = 'https://mi-superapp.vercel.app/apple-touch-icon.png';
const URL_APP = 'https://mi-superapp.vercel.app';

/**
 * @param {string} preheader - texto oculto que se ve en la bandeja de entrada antes de abrir.
 * @param {string} titulo - headline dentro de la tarjeta (no el asunto del mail).
 * @param {string} cuerpoHtml - HTML ya armado del contenido (párrafos, chip de monto, etc.).
 * @param {{texto: string, url?: string}} [cta] - botón amarillo opcional, como el de confirm-signup.
 * @param {string} [footerTexto] - texto chico al pie, dentro de la misma tarjeta visual.
 */
function armarMailBase({ preheader, titulo, cuerpoHtml, cta, footerTexto }) {
  const botonCta = cta
    ? `
              <table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px auto 8px auto;">
                <tr>
                  <td align="center" style="border-radius:8px; background-color:${COLOR_ACENTO};">
                    <a
                      href="${cta.url || URL_APP}"
                      target="_blank"
                      style="display:inline-block; padding:14px 32px; font-family:Helvetica,Arial,sans-serif; font-size:16px; font-weight:700; color:${COLOR_TEXTO}; text-decoration:none; border-radius:8px;"
                    >
                      ${cta.texto}
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
  <div style="display:none; max-height:0; overflow:hidden; opacity:0;">${preheader || ''}</div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${COLOR_FONDO};">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px; width:100%; background-color:#FFFFFF; border-radius:12px; overflow:hidden;">

          <tr>
            <td align="center" style="background-color:${COLOR_BANNER}; padding:32px 24px;">
              <img
                src="${LOGO_URL}"
                width="56" height="56" alt="Super App"
                style="display:block; border-radius:12px; margin-bottom:12px;"
              />
              <div style="font-family:Helvetica,Arial,sans-serif; font-size:20px; font-weight:700; color:#FFFFFF;">
                Super App
              </div>
            </td>
          </tr>

          <tr>
            <td style="padding:32px 32px 24px 32px; font-family:Helvetica,Arial,sans-serif; color:${COLOR_TEXTO}; text-align:center;">
              <div style="font-size:20px; font-weight:700; margin-bottom:12px;">
                ${titulo}
              </div>
              <div style="font-size:15px; line-height:1.5; color:${COLOR_TEXTO_SUAVE}; text-align:left;">
                ${cuerpoHtml}
              </div>
              ${botonCta}
            </td>
          </tr>

          <tr>
            <td style="padding:20px 32px; background-color:${COLOR_FONDO}; font-family:Helvetica,Arial,sans-serif; font-size:12px; color:${COLOR_TEXTO_FOOTER}; text-align:center;">
              ${footerTexto || 'Recibís este mail porque tenés una cuenta en Super App.'}
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

module.exports = { armarMailBase, COLOR_ACENTO, COLOR_TEXTO, URL_APP };
