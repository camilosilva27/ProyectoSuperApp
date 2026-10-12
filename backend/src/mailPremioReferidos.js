/**
 * Aviso "¡Ganaste 2 meses gratis!" del programa de referidos (ver .claude/docs/PLAN_REFERIDOS.md
 * y mails_y_notificaciones.md, tipo #9). Es el único aviso del programa (decisión del usuario
 * 12/10: no hace falta avisar cada invitada que se suma).
 *
 * No es un cron: lo dispara `referidos.js § validarInvitada` en el mismo momento en que
 * `otorgar_premio_referido()` devuelve 'otorgado' — que pasa una sola vez por cuenta. Mail
 * operativo (un aviso del plan, como el recibo): sin pie de baja. Como el resto de los avisos,
 * va con su push equivalente si la persona activó las notificaciones.
 */

const { enviarMail } = require('./clienteBrevo');
const { armarMailBase, escaparHtml, COLOR_ACENTO, COLOR_ACENTO_SUAVE, COLOR_TEXTO, URL_APP } = require('./plantillaMail');
const { obtenerSuscripcionesDeUsuario, enviarPush } = require('./clientePush');

const URL_INVITAR = `${URL_APP}/ajustes/invitar`;

/** 60 → "2 meses"; cualquier otro número de días, tal cual (mismo criterio que la app). */
function textoPremio(dias) {
  return dias % 30 === 0 ? `${dias / 30} meses` : `${dias} días`;
}

function formatoFecha(iso) {
  return new Date(iso).toLocaleDateString('es-AR', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Argentina/Buenos_Aires',
  });
}

/**
 * @param {{nombre?: string|null, dias: number, hasta: string, planAntes: string, invitadas: number}} datos
 */
function armarHtml({ nombre, dias, hasta, planAntes, invitadas }) {
  // `nombre` lo escribe el usuario al registrarse: escapado (auditoría 2026-09-24).
  const saludo = nombre ? `Hola ${escaparHtml(nombre)},` : 'Hola,';
  const premio = textoPremio(dias);
  const fecha = escaparHtml(formatoFecha(hasta));
  const lineaFecha = planAntes === 'trial'
    ? `Los sumamos a tu prueba: ahora vence el <strong>${fecha}</strong>.`
    : `Ya tenés acceso completo a SuperAhorro hasta el <strong>${fecha}</strong>.`;

  const cuerpo = `
    <p style="margin:0 0 16px 0;">${saludo}</p>
    <p style="margin:0 0 16px 0;">Tus ${invitadas} amigos ya se sumaron a SuperAhorro con tu link. ¡Gracias por recomendarnos!</p>
    <p style="margin:0 0 16px 0; text-align:center;">
      <span style="display:inline-block; background:${COLOR_ACENTO_SUAVE}; border:2px solid ${COLOR_ACENTO}; color:${COLOR_TEXTO}; padding:6px 16px; border-radius:8px; font-size:1.5em; font-weight:700;">${escaparHtml(premio.toUpperCase())} GRATIS</span>
    </p>
    <p style="margin:0;">${lineaFecha}</p>
  `;

  return armarMailBase({
    preheader: `Tus ${invitadas} amigos ya se sumaron: tenés ${premio} gratis en SuperAhorro.`,
    titulo: `¡Ganaste ${premio} gratis!`,
    cuerpoHtml: cuerpo,
    cta: { texto: 'Abrir SuperAhorro', url: URL_INVITAR },
  });
}

/** "María José Pérez" → "María". */
function nombreDePila(nombre) {
  if (typeof nombre !== 'string') return null;
  return nombre.trim().split(/\s+/)[0] || null;
}

/**
 * Manda el aviso del premio a `usuarioId` y deja constancia en `premio_referido.mail_enviado_en`.
 * No hace nada si el premio no está 'otorgado' o si el aviso ya salió. Nunca lanza: devuelve
 * `{ ok, error? }` para que quien lo llama solo lo registre.
 * @param {object} cliente - Supabase con service role.
 * @param {string} usuarioId
 * @param {number} invitadasNecesarias
 */
async function enviarAvisoPremio(cliente, usuarioId, invitadasNecesarias) {
  try {
    const { data: premio, error: errorPremio } = await cliente
      .from('premio_referido')
      .select('estado, dias, hasta, plan_antes, mail_enviado_en')
      .eq('usuario_id', usuarioId)
      .maybeSingle();
    if (errorPremio) return { ok: false, error: errorPremio.message };
    if (!premio || premio.estado !== 'otorgado' || !premio.hasta) return { ok: false, error: 'Sin premio otorgado' };
    if (premio.mail_enviado_en) return { ok: true, yaEnviado: true };

    const { data: datosUsuario, error: errorUsuario } = await cliente.auth.admin.getUserById(usuarioId);
    const usuario = datosUsuario?.user;
    if (errorUsuario || !usuario?.email) {
      return { ok: false, error: `No se pudo resolver el mail de ${usuarioId}: ${errorUsuario?.message || 'sin mail'}` };
    }
    // Mismo criterio que los crons de mail (bug 2026-09-14): nunca a una cuenta sin confirmar.
    if (!usuario.email_confirmed_at) return { ok: false, error: 'Mail sin confirmar' };

    const { data: perfil } = await cliente.from('perfil_usuario').select('nombre').eq('id', usuarioId).maybeSingle();
    const nombre = nombreDePila(perfil?.nombre);
    const datos = {
      nombre, dias: premio.dias, hasta: premio.hasta, planAntes: premio.plan_antes, invitadas: invitadasNecesarias,
    };

    const resultadoMail = await enviarMail({
      destinatarioEmail: usuario.email,
      destinatarioNombre: perfil?.nombre,
      asunto: `¡Ganaste ${textoPremio(premio.dias)} gratis en SuperAhorro!`,
      html: armarHtml(datos),
    });
    if (resultadoMail.ok) {
      await cliente.from('premio_referido')
        .update({ mail_enviado_en: new Date().toISOString() })
        .eq('usuario_id', usuarioId)
        .is('mail_enviado_en', null);
    }

    const suscripciones = await obtenerSuscripcionesDeUsuario(cliente, usuarioId).catch(() => []);
    await enviarPush(cliente, suscripciones, {
      title: 'SuperAhorro',
      body: `¡Ganaste ${textoPremio(premio.dias)} gratis! Tus ${invitadasNecesarias} amigos ya se sumaron.`,
      url: URL_INVITAR,
    }).catch(() => undefined);

    return resultadoMail;
  } catch (err) {
    return { ok: false, error: err?.message ?? String(err) };
  }
}

module.exports = { armarHtml, enviarAvisoPremio, textoPremio };
