/**
 * POST /api/webhooks/auth-usuarios — ruta pública (sin sesión, no la llama la app): la llama
 * Supabase directamente vía un Database Webhook configurado a mano en el dashboard (Database >
 * Webhooks > New webhook, schema `auth`, tabla `users`, evento `Update`, apuntando a esta URL;
 * ver .claude/docs/mails_y_notificaciones.md § tipo #7 para el paso a paso completo). No hay
 * Edge Functions en este proyecto (el backend es Express en una VM) — por eso el webhook pega
 * directo acá en vez de a una función de Supabase.
 *
 * Supabase manda este webhook en CUALQUIER UPDATE de auth.users (cambio de mail, de password,
 * último login, etc.), no solo al confirmar el registro — por eso el filtro real está acá
 * adentro (email_confirmed_at pasa de null a una fecha), no en la config del dashboard.
 *
 * Verificación: un secreto compartido en un header custom (configurado como "Additional HTTP
 * Headers" en el mismo webhook del dashboard), no HMAC — Supabase Database Webhooks no firman
 * el body como sí lo hace Mercado Pago.
 */

const express = require('express');
const { clienteSupabaseAdmin } = require('../clienteSupabaseAdmin');
const { authWebhookSecret } = require('../config');
const { enviarBienvenida } = require('../mailBienvenida');

const router = express.Router();

router.post('/webhooks/auth-usuarios', async (req, res) => {
  if (!authWebhookSecret) {
    console.error('Webhook de auth.users recibido pero AUTH_WEBHOOK_SECRET no está configurado');
    return res.status(503).end();
  }

  if (req.get('x-webhook-secret') !== authWebhookSecret) {
    console.error('Secreto inválido en webhook de auth.users');
    return res.status(401).end();
  }

  const { record, old_record: registroAnterior } = req.body || {};
  const seAcabaDeConfirmar = record?.email_confirmed_at && !registroAnterior?.email_confirmed_at;
  if (!seAcabaDeConfirmar) return res.status(200).end();

  try {
    const supabaseAdmin = clienteSupabaseAdmin();
    if (!supabaseAdmin) throw new Error('Supabase (service role) no configurado');

    // Se lee y actualiza con la guarda `.eq('mail_bienvenida_enviado', false)` para no mandarlo
    // dos veces si Supabase reintenta la entrega del mismo webhook.
    const { data: fila, error: errorLectura } = await supabaseAdmin
      .from('perfil_usuario')
      .select('nombre, mail_bienvenida_enviado')
      .eq('id', record.id)
      .maybeSingle();
    if (errorLectura) throw errorLectura;
    if (!fila || fila.mail_bienvenida_enviado) return res.status(200).end();

    const { error: errorUpdate } = await supabaseAdmin
      .from('perfil_usuario')
      .update({ mail_bienvenida_enviado: true })
      .eq('id', record.id)
      .eq('mail_bienvenida_enviado', false);
    if (errorUpdate) throw errorUpdate;

    const resultado = await enviarBienvenida(record.id, { nombre: fila.nombre });
    if (!resultado.ok) console.error('No se pudo mandar el mail de bienvenida:', resultado.error);

    res.status(200).end();
  } catch (err) {
    console.error('Error procesando webhook de auth.users:', err);
    res.status(500).end();
  }
});

module.exports = router;
