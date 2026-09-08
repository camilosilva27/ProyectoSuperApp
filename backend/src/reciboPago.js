/**
 * Recibo de pago propio de Super App (ver .claude/docs/mails_y_notificaciones.md, tipo #2).
 * Mercado Pago ya le manda su propio comprobante genérico al pagador — este es adicional, con
 * la marca de la app y contexto (qué plan, cuándo es el próximo cobro).
 *
 * No es un cron: lo dispara directo `webhookMercadoPago.js` cuando confirma un pago real (no
 * hay agenda, es evento-a-evento). Por eso vive en `src/`, no en `src/cron/`.
 */

const { clienteSupabaseAdmin } = require('./clienteSupabaseAdmin');
const { enviarMail } = require('./clienteBrevo');
const { armarMailBase, COLOR_ACENTO, COLOR_ACENTO_SUAVE, COLOR_TEXTO, URL_APP } = require('./plantillaMail');

function formatoArs(monto) {
  return Number(monto).toLocaleString('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });
}

function formatoFecha(iso) {
  return new Date(iso).toLocaleDateString('es-AR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Argentina/Buenos_Aires' });
}

const NOMBRE_PLAN = { mensual: 'mensual', anual: 'anual', permanente: 'permanente' };

function armarHtml({ nombre, tipoPlan, monto, siguienteCobroEn }) {
  const saludo = nombre ? `Hola ${nombre},` : 'Hola,';
  const nombrePlan = NOMBRE_PLAN[tipoPlan] || tipoPlan;
  const lineaProximoCobro = siguienteCobroEn
    ? `<p style="margin:0;">Tu próximo cobro es el <strong>${formatoFecha(siguienteCobroEn)}</strong>.</p>`
    : `<p style="margin:0;">Tu acceso a Super App ya es permanente — no vas a recibir más cobros por este plan.</p>`;

  const cuerpo = `
    <p style="margin:0 0 16px 0;">${saludo}</p>
    <p style="margin:0 0 16px 0;">Tu pago del plan <strong>${nombrePlan}</strong> de Super App se acreditó correctamente:</p>
    <p style="margin:0 0 16px 0; text-align:center;">
      <span style="display:inline-block; background:${COLOR_ACENTO_SUAVE}; border:2px solid ${COLOR_ACENTO}; color:${COLOR_TEXTO}; padding:6px 16px; border-radius:8px; font-size:1.5em; font-weight:700;">${formatoArs(monto)}</span>
    </p>
    ${lineaProximoCobro}
  `;

  return armarMailBase({
    preheader: `Tu pago del plan ${nombrePlan} de Super App se acreditó.`,
    titulo: 'Recibo de pago',
    cuerpoHtml: cuerpo,
    cta: { texto: 'Ver mi plan', url: `${URL_APP}/ajustes` },
  });
}

/**
 * @param {string} usuarioId
 * @param {{tipoPlan: string, monto: number, siguienteCobroEn?: string|null, nombre?: string|null}} detalles
 */
async function enviarRecibo(usuarioId, detalles) {
  const cliente = clienteSupabaseAdmin();
  if (!cliente) return { ok: false, error: 'Falta SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY' };

  const { data, error } = await cliente.auth.admin.getUserById(usuarioId);
  if (error || !data?.user?.email) {
    return { ok: false, error: `No se pudo resolver el mail del usuario ${usuarioId}: ${error?.message || 'sin mail'}` };
  }

  return enviarMail({
    destinatarioEmail: data.user.email,
    destinatarioNombre: detalles.nombre,
    asunto: 'Tu pago en Super App se acreditó',
    html: armarHtml(detalles),
  });
}

module.exports = { armarHtml, enviarRecibo };
