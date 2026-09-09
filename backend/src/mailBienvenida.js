/**
 * Mail de bienvenida propio de Super App (ver .claude/docs/mails_y_notificaciones.md, tipo #7).
 * Supabase Auth ya manda el mail de confirmación de registro (plantilla en
 * supabase/email-templates/confirm-signup.html) — este es adicional, y se manda recién cuando
 * la persona confirma ese link (no al hacer signUp), para que sea lo primero que ve una vez
 * que ya puede usar la app de verdad.
 *
 * No es un cron: lo dispara directo `webhookAuthUsuarios.js` cuando Supabase notifica el
 * UPDATE de `auth.users` en el que `email_confirmed_at` pasa de null a una fecha. Por eso vive
 * en `src/`, no en `src/cron/`.
 */

const { clienteSupabaseAdmin } = require('./clienteSupabaseAdmin');
const { enviarMail } = require('./clienteBrevo');
const { armarMailBase, URL_APP } = require('./plantillaMail');
const { obtenerSuscripcionesDeUsuario, enviarPush } = require('./clientePush');

// Sin CTA a propósito: el remitente es no-reply@mi-superapp.com.ar (ver clienteBrevo.js), una
// respuesta directa al mail no llegaría a ningún lado — por eso se deriva al mail de contacto
// real, el mismo que ya figura en Ajustes (app/app/(tabs)/ajustes.tsx).
function armarHtml({ nombre }) {
  const saludo = nombre ? `Hola ${nombre},` : 'Hola,';

  const cuerpo = `
    <p style="margin:0 0 16px 0;">${saludo}</p>
    <p style="margin:0 0 16px 0;">¡Confirmaste tu cuenta! Ya podés usar Super App para comparar precios entre supermercados y armar tu carrito con el más barato de cada producto.</p>
    <p style="margin:0;">Ante cualquier duda, consulta o sugerencia, por favor escribinos a contacto@mi-superapp.com.ar</p>
  `;

  return armarMailBase({
    preheader: 'Ya podés usar Super App para comparar precios entre supermercados.',
    titulo: '¡Bienvenido a Super App!',
    cuerpoHtml: cuerpo,
  });
}

/**
 * @param {string} usuarioId
 * @param {{nombre?: string|null}} [detalles]
 */
async function enviarBienvenida(usuarioId, detalles = {}) {
  const cliente = clienteSupabaseAdmin();
  if (!cliente) return { ok: false, error: 'Falta SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY' };

  const { data, error } = await cliente.auth.admin.getUserById(usuarioId);
  if (error || !data?.user?.email) {
    return { ok: false, error: `No se pudo resolver el mail del usuario ${usuarioId}: ${error?.message || 'sin mail'}` };
  }

  const resultadoMail = await enviarMail({
    destinatarioEmail: data.user.email,
    destinatarioNombre: detalles.nombre,
    asunto: '¡Bienvenido a Super App!',
    html: armarHtml(detalles),
  });

  const suscripciones = await obtenerSuscripcionesDeUsuario(cliente, usuarioId).catch(() => []);
  await enviarPush(cliente, suscripciones, {
    title: 'Super App',
    body: '¡Bienvenido a Super App! Ya podés comparar precios entre supermercados.',
    url: URL_APP,
  });

  return resultadoMail;
}

module.exports = { armarHtml, enviarBienvenida };
