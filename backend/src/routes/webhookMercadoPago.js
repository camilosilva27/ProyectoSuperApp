/**
 * POST /api/webhooks/mercadopago — ruta pública (sin sesión, no la llama la app): la llama
 * Mercado Pago directamente cuando cambia el estado de una suscripción (autorizada, pausada,
 * cancelada) o se confirma un pago único (plan permanente, Fase 3). La URL de notificación se
 * configura en el panel de Developers de la app de MP ("Tus integraciones" > la app >
 * Webhooks), no en este código — el mismo endpoint recibe ambos tipos de evento.
 *
 * Nunca se confía en el contenido del body/query para el estado real: solo se usan para saber
 * QUÉ id consultar (`data.id`), y se le pregunta a la API de Mercado Pago el estado
 * autoritativo (`preApproval.get()` o `payment.get()` según el caso). Así, si alguien lograra
 * falsificar la firma, no alcanzaría con eso solo — también tendría que lograr que MP devuelva
 * ese estado al consultarlo.
 */

const express = require('express');
const {
  MercadoPagoConfig, PreApproval, Payment, WebhookSignatureValidator, InvalidWebhookSignatureError,
} = require('mercadopago');
const { clienteSupabaseAdmin } = require('../clienteSupabaseAdmin');
const { mercadopagoAccessToken, mercadopagoWebhookSecret } = require('../config');
const { planSegunEstado } = require('../planSegunEstadoSuscripcion');

const router = express.Router();

// El downgrade automático de trial vencido ya lo cubre pg_cron (bajar_planes_vencidos, ver
// migración 0005) — acá solo se reacciona a cambios de estado de una suscripción/pago ya creado.
// Estados de tránsito (ej. 'pending') no tocan el plan todavía.

// Pago único del plan permanente: `data.id` acá es un id de pago (Payment), no de suscripción,
// y el usuario se resuelve por `external_reference` (seteado al crear la Preference en
// pagos.js), no por `pasarela_suscripcion_id` — el permanente nunca crea una fila de suscripción.
async function manejarPago(dataId, client, supabaseAdmin) {
  const payment = new Payment(client);
  const pago = await payment.get({ id: dataId });

  if (pago.status !== 'approved' || !pago.external_reference) return;

  // premium_manual nunca se pisa desde acá, mismo criterio que la rama de suscripciones.
  const { error } = await supabaseAdmin
    .from('perfil_usuario')
    .update({ plan: 'premium', tipo_plan: 'permanente' })
    .eq('id', pago.external_reference)
    .eq('premium_manual', false);
  if (error) throw error;
}

async function manejarSuscripcion(dataId, client, supabaseAdmin) {
  const preApproval = new PreApproval(client);
  const suscripcion = await preApproval.get({ id: dataId });

  const nuevoPlan = planSegunEstado(suscripcion.status);
  const cambios = { suscripcion_estado: suscripcion.status };
  if (nuevoPlan) {
    cambios.plan = nuevoPlan;
    // Si el nuevo estado baja al usuario (cancelled/paused → gratis), tipo_plan ya no aplica.
    if (nuevoPlan === 'gratis') cambios.tipo_plan = null;
  }

  // premium_manual nunca se pisa desde acá: un cambio de estado en MP no debe sacarle el
  // premium otorgado a mano a un usuario, sea cual sea el id de suscripción involucrado.
  const { error } = await supabaseAdmin
    .from('perfil_usuario')
    .update(cambios)
    .eq('pasarela_suscripcion_id', dataId)
    .eq('premium_manual', false);
  if (error) throw error;
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
    const supabaseAdmin = clienteSupabaseAdmin();
    if (!supabaseAdmin) throw new Error('Supabase (service role) no configurado');

    // `type=payment` es el único caso de pago único (permanente); cualquier otro valor
    // (incluido el legado, sin `type`) se trata como evento de suscripción — mismo
    // comportamiento que tenía este endpoint antes de sumar el plan permanente.
    if (req.query.type === 'payment') {
      await manejarPago(dataId, client, supabaseAdmin);
    } else {
      await manejarSuscripcion(dataId, client, supabaseAdmin);
    }

    res.status(200).end();
  } catch (err) {
    console.error('Error procesando webhook de Mercado Pago:', err);
    res.status(500).end();
  }
});

module.exports = router;
