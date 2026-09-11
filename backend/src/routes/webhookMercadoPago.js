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
 *
 * IMPORTANTE (investigado 2026-09-11, ver .claude/docs/Plan_Usuarios_y_cobros.md): MP puede
 * demorar días en mandar este webhook para un pago ya aprobado (se observó en vivo atado a
 * `money_release_date`, no a `date_approved`) — por eso este webhook ya NO es la única vía: la
 * lógica de aplicar el estado se comparte con `POST /api/pagos/verificar`
 * (`procesarPagoMercadoPago.js`), que la app dispara activamente al volver del checkout.
 */

const express = require('express');
const {
  MercadoPagoConfig, PreApproval, Payment, WebhookSignatureValidator, InvalidWebhookSignatureError,
} = require('mercadopago');
const { clienteSupabaseAdmin } = require('../clienteSupabaseAdmin');
const { mercadopagoAccessToken, mercadopagoWebhookSecret } = require('../config');
const { procesarPagoAprobado, procesarSuscripcion } = require('../procesarPagoMercadoPago');

const router = express.Router();

// El downgrade automático de trial vencido ya lo cubre pg_cron (bajar_planes_vencidos, ver
// migración 0005) — acá solo se reacciona a cambios de estado de una suscripción/pago ya creado.
// Estados de tránsito (ej. 'pending') no tocan el plan todavía.

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
    // comportamiento que tenía este endpoint antes de sumar el plan permanente. Un cargo
    // recurrente de suscripción también llega acá como type=payment, pero sin
    // external_reference (eso solo lo setea pagos.js para el plan permanente) —
    // `procesarPagoAprobado` lo ignora en ese caso, la suscripción ya se reconcilia sola por
    // `next_payment_date` en la otra rama.
    if (req.query.type === 'payment') {
      const payment = new Payment(client);
      const pago = await payment.get({ id: dataId });
      await procesarPagoAprobado(pago, supabaseAdmin);
    } else {
      const preApproval = new PreApproval(client);
      const suscripcion = await preApproval.get({ id: dataId });
      await procesarSuscripcion(suscripcion, dataId, supabaseAdmin);
    }

    res.status(200).end();
  } catch (err) {
    console.error('Error procesando webhook de Mercado Pago:', err);
    res.status(500).end();
  }
});

module.exports = router;
