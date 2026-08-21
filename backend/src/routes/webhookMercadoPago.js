/**
 * POST /api/webhooks/mercadopago — ruta pública (sin sesión, no la llama la app): la llama
 * Mercado Pago directamente cuando cambia el estado de una suscripción (autorizada,
 * pausada, cancelada). La URL de notificación se configura en el panel de Developers de la
 * app de MP ("Tus integraciones" > la app > Webhooks), no en este código.
 *
 * Nunca se confía en el contenido del body/query para el estado real: solo se usan para
 * saber QUÉ id consultar (`data.id`), y se le pregunta a la API de Mercado Pago el estado
 * autoritativo con `preApproval.get()`. Así, si alguien lograra falsificar la firma, no
 * alcanzaría con eso solo — también tendría que lograr que MP devuelva ese estado al
 * consultarlo.
 */

const express = require('express');
const {
  MercadoPagoConfig, PreApproval, WebhookSignatureValidator, InvalidWebhookSignatureError,
} = require('mercadopago');
const { clienteSupabaseAdmin } = require('../clienteSupabaseAdmin');
const { mercadopagoAccessToken, mercadopagoWebhookSecret } = require('../config');

const router = express.Router();

// El downgrade automático de trial vencido ya lo cubre pg_cron (bajar_planes_vencidos, ver
// migración 0005) — acá solo se reacciona a cambios de estado de una suscripción ya creada.
// Estados de tránsito (ej. 'pending') no tocan el plan todavía.
function planSegunEstado(estado) {
  if (estado === 'authorized') return 'premium';
  if (estado === 'cancelled' || estado === 'paused') return 'gratis';
  return null;
}

router.post('/webhooks/mercadopago', async (req, res) => {
  if (!mercadopagoWebhookSecret || !mercadopagoAccessToken) {
    console.error('Webhook de Mercado Pago recibido pero MERCADOPAGO_WEBHOOK_SECRET / MERCADOPAGO_ACCESS_TOKEN no están configurados');
    return res.status(503).end();
  }

  const dataId = req.query['data.id'];
  if (!dataId) return res.status(400).end();

  try {
    WebhookSignatureValidator.validate({
      xSignature: req.get('x-signature'),
      xRequestId: req.get('x-request-id'),
      dataId,
      secret: mercadopagoWebhookSecret,
    });
  } catch (err) {
    if (err instanceof InvalidWebhookSignatureError) {
      console.error('Firma inválida en webhook de Mercado Pago');
      return res.status(401).end();
    }
    throw err;
  }

  try {
    const client = new MercadoPagoConfig({ accessToken: mercadopagoAccessToken });
    const preApproval = new PreApproval(client);
    const suscripcion = await preApproval.get({ id: dataId });

    const supabaseAdmin = clienteSupabaseAdmin();
    if (!supabaseAdmin) throw new Error('Supabase (service role) no configurado');

    const nuevoPlan = planSegunEstado(suscripcion.status);
    const cambios = { suscripcion_estado: suscripcion.status };
    if (nuevoPlan) cambios.plan = nuevoPlan;

    // premium_manual nunca se pisa desde acá: un cambio de estado en MP no debe sacarle el
    // premium otorgado a mano a un usuario, sea cual sea el id de suscripción involucrado.
    const { error } = await supabaseAdmin
      .from('perfil_usuario')
      .update(cambios)
      .eq('pasarela_suscripcion_id', dataId)
      .eq('premium_manual', false);
    if (error) throw error;

    res.status(200).end();
  } catch (err) {
    console.error('Error procesando webhook de Mercado Pago:', err);
    res.status(500).end();
  }
});

module.exports = router;
