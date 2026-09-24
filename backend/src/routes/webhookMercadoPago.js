/**
 * POST /api/webhooks/mercadopago — ruta pública (sin sesión, no la llama la app): la llama
 * Mercado Pago directamente cuando cambia el estado de una suscripción (autorizada, pausada,
 * cancelada), se cobra una cuota, o cambia un pago único (permanente aprobado, reembolsado o
 * contracargado — ver resolverEventoWebhook abajo para el enrutamiento por tópico). La URL de
 * notificación se configura en el panel de Developers de la app de MP ("Tus integraciones" > la app >
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
  MercadoPagoConfig, PreApproval, Payment, Invoice, Chargeback,
  WebhookSignatureValidator, InvalidWebhookSignatureError,
} = require('mercadopago');
const { clienteSupabaseAdmin } = require('../clienteSupabaseAdmin');
const { mercadopagoAccessToken, mercadopagoWebhookSecret } = require('../config');
const { procesarPagoUnico, procesarSuscripcion } = require('../procesarPagoMercadoPago');

const router = express.Router();

// El downgrade automático de trial vencido ya lo cubre pg_cron (bajar_planes_vencidos, ver
// migración 0005) — acá solo se reacciona a cambios de estado de una suscripción/pago ya creado.
// Estados de tránsito (ej. 'pending') no tocan el plan todavía.

// Tópico de MP → qué hacer (auditoría 2026-09-24). Antes todo lo que no era type=payment iba a
// preApproval.get(): `subscription_authorized_payment`, `merchant_order`, contracargos, etc.
// traen otro tipo de id → 404 → 500 → MP reintentaba sin fin. MP manda el tópico de dos formas:
// Webhooks (`?data.id=…&type=…` + body `{ type, action, data: { id } }`) e IPN legado
// (`?id=…&topic=…`); se aceptan las dos. Los nombres de contracargo/merchant_order en Webhooks
// (`topic_*_wh`) salen de la doc de MP, no se vieron llegar en vivo.
const ACCION_POR_TOPICO = {
  payment: 'pago',
  subscription_preapproval: 'suscripcion',
  preapproval: 'suscripcion',
  subscription_authorized_payment: 'cobro_suscripcion',
  authorized_payment: 'cobro_suscripcion',
  chargebacks: 'contracargo',
  chargeback: 'contracargo',
  topic_chargebacks_wh: 'contracargo',
};

/**
 * Decisión de enrutamiento, pura (sin red) para poder testearla. Devuelve
 * `{ accion, topico, dataId }`, con accion ∈ 'pago' | 'suscripcion' | 'cobro_suscripcion' |
 * 'contracargo' | 'ignorar'. Sin ningún tópico se mantiene el comportamiento legado (se trata como
 * suscripción, igual que antes de sumar el permanente).
 */
function resolverEventoWebhook(query = {}, body = {}) {
  const b = body && typeof body === 'object' ? body : {};
  const accionBody = typeof b.action === 'string' ? b.action.split('.')[0] : undefined;
  const topico = query.type ?? query.topic ?? b.type ?? b.topic ?? accionBody;
  const idCrudo = query['data.id'] ?? query.id ?? b.data?.id;
  const dataId = idCrudo === undefined || idCrudo === null || idCrudo === '' ? null : String(idCrudo);

  let accion;
  if (!topico) accion = 'suscripcion';
  else accion = ACCION_POR_TOPICO[String(topico).toLowerCase()] ?? 'ignorar';
  return { accion, topico: topico ?? null, dataId };
}

// MP responde 404 cuando el recurso no existe (o no es de esta cuenta): reintentar no lo arregla.
function esNoEncontradoMP(err) {
  return err?.status === 404 || err?.constructor?.name === 'MPNotFoundError';
}

async function aplicarEvento({ accion, topico, dataId }, client, supabaseAdmin) {
  switch (accion) {
    case 'pago': {
      // Pago único del permanente (aprobado o revertido: reembolso/contracargo). Un cobro
      // recurrente de suscripción también llega como type=payment — procesarPagoUnico solo actúa
      // sobre external_reference con prefijo "perm:", la suscripción se reconcilia por su lado.
      const pago = await new Payment(client).get({ id: dataId });
      await procesarPagoUnico(pago, supabaseAdmin);
      return;
    }
    case 'suscripcion': {
      const suscripcion = await new PreApproval(client).get({ id: dataId });
      await procesarSuscripcion(suscripcion, dataId, supabaseAdmin);
      return;
    }
    case 'cobro_suscripcion': {
      // dataId es un authorized_payment (cuota); se reconcilia la suscripción que lo generó.
      const cuota = await new Invoice(client).get({ id: dataId });
      const preapprovalId = cuota?.preapproval_id;
      if (!preapprovalId) {
        console.warn(`Webhook MP ${topico} ${dataId} sin preapproval_id; se ignora`);
        return;
      }
      const suscripcion = await new PreApproval(client).get({ id: preapprovalId });
      await procesarSuscripcion(suscripcion, String(preapprovalId), supabaseAdmin);
      return;
    }
    case 'contracargo': {
      // Se usa el estado del PAGO como autoridad, no el del contracargo: mientras la disputa
      // está abierta el pago queda 'in_mediation' (no se toca); si se pierde, 'charged_back'.
      const contracargo = await new Chargeback(client).get({ id: dataId });
      const paymentId = contracargo?.payment_id;
      if (!paymentId) {
        console.warn(`Webhook MP contracargo ${dataId} sin payment_id; se ignora`);
        return;
      }
      const pago = await new Payment(client).get({ id: String(paymentId) });
      await procesarPagoUnico(pago, supabaseAdmin);
      return;
    }
    default:
      console.log(`Webhook MP con tópico no manejado (${topico}, id ${dataId}); se responde 200 sin hacer nada`);
  }
}

router.post('/webhooks/mercadopago', async (req, res) => {
  if (!mercadopagoWebhookSecret || !mercadopagoAccessToken) {
    console.error('Webhook de Mercado Pago recibido pero MERCADOPAGO_WEBHOOK_SECRET / MERCADOPAGO_ACCESS_TOKEN no están configurados');
    return res.status(503).end();
  }

  const evento = resolverEventoWebhook(req.query, req.body);
  const { dataId } = evento;
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

  if (evento.accion === 'ignorar') {
    console.log(`Webhook MP con tópico no manejado (${evento.topico}, id ${dataId}); se responde 200 sin hacer nada`);
    return res.status(200).end();
  }

  try {
    const client = new MercadoPagoConfig({ accessToken: mercadopagoAccessToken });
    const supabaseAdmin = clienteSupabaseAdmin();
    if (!supabaseAdmin) throw new Error('Supabase (service role) no configurado');

    await aplicarEvento(evento, client, supabaseAdmin);
    res.status(200).end();
  } catch (err) {
    if (esNoEncontradoMP(err)) {
      // 200 a propósito: si MP no encuentra el recurso, reintentar no lo va a cambiar.
      console.warn(`Webhook MP ${evento.topico ?? '(sin tópico)'} ${dataId}: recurso no encontrado en MP; se responde 200`);
      return res.status(200).end();
    }
    // Errores reales (red, Supabase, 5xx de MP): 500 para que MP reintente.
    console.error('Error procesando webhook de Mercado Pago:', err);
    res.status(500).end();
  }
});

module.exports = router;
module.exports.resolverEventoWebhook = resolverEventoWebhook;
module.exports.esNoEncontradoMP = esNoEncontradoMP;
