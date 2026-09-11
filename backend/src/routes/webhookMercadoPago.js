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
const { enviarRecibo } = require('../reciboPago');

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

  // TEMPORAL (investigación 2026-09-11): un cargo recurrente de suscripción también llega acá
  // como type=payment (topic "Pagos (legacy)"), pero sin external_reference (eso solo lo setea
  // pagos.js para el plan permanente) — hoy se ignora en el `return` de abajo. Este log es para
  // ver el payload real de un cargo de suscripción y encontrar el campo que lo liga al
  // preapproval/usuario, antes de escribir la lógica que manda el recibo en el momento de
  // aprobación real (no de acreditación). Sacar este log una vez confirmado el campo.
  if (pago.status === 'approved' && !pago.external_reference) {
    console.log('[investigación recibo] payment de posible cargo de suscripción:', JSON.stringify(pago));
  }

  if (pago.status !== 'approved' || !pago.external_reference) return;

  // Se lee el estado ANTES de actualizar para poder distinguir "primera vez que se aprueba
  // este pago" de "MP reintentó/reenvió el mismo webhook" — sin esto, un reenvío mandaría el
  // recibo de nuevo (el pago único solo se aprueba una vez en la vida del usuario).
  const { data: filaAnterior } = await supabaseAdmin
    .from('perfil_usuario')
    .select('nombre, pagado_en')
    .eq('id', pago.external_reference)
    .eq('premium_manual', false)
    .maybeSingle();

  // premium_manual nunca se pisa desde acá, mismo criterio que la rama de suscripciones.
  const { error } = await supabaseAdmin
    .from('perfil_usuario')
    .update({ plan: 'premium', tipo_plan: 'permanente', pagado_en: pago.date_approved ?? null })
    .eq('id', pago.external_reference)
    .eq('premium_manual', false);
  if (error) throw error;

  if (filaAnterior && !filaAnterior.pagado_en) {
    const resultado = await enviarRecibo(pago.external_reference, {
      tipoPlan: 'permanente',
      monto: pago.transaction_amount,
      siguienteCobroEn: null,
      nombre: filaAnterior.nombre,
    });
    if (!resultado.ok) console.error('No se pudo mandar el recibo de pago (permanente):', resultado.error);
  }
}

async function manejarSuscripcion(dataId, client, supabaseAdmin) {
  const preApproval = new PreApproval(client);
  const suscripcion = await preApproval.get({ id: dataId });

  const nuevoPlan = planSegunEstado(suscripcion.status);
  const cambios = {
    suscripcion_estado: suscripcion.status,
    siguiente_cobro_en: suscripcion.next_payment_date ?? null,
  };
  if (nuevoPlan) {
    cambios.plan = nuevoPlan;
    // Si el nuevo estado baja al usuario (cancelled/paused → gratis), tipo_plan y la fecha de
    // próximo cobro ya no aplican.
    if (nuevoPlan === 'gratis') {
      cambios.tipo_plan = null;
      cambios.siguiente_cobro_en = null;
    }
  }

  // Se lee ANTES de actualizar para poder comparar `siguiente_cobro_en` viejo vs. nuevo: MP
  // llama este mismo webhook en cada renovación (no solo al autorizar por primera vez), y la
  // única señal de "hubo un cobro nuevo de verdad" es que esa fecha avanzó — sin esto, un
  // reenvío del mismo evento (o cualquier otro cambio de estado que no sea un cobro) mandaría
  // el recibo de nuevo.
  const { data: filaAnterior } = await supabaseAdmin
    .from('perfil_usuario')
    .select('id, nombre, tipo_plan, siguiente_cobro_en')
    .eq('pasarela_suscripcion_id', dataId)
    .eq('premium_manual', false)
    .maybeSingle();

  // premium_manual nunca se pisa desde acá: un cambio de estado en MP no debe sacarle el
  // premium otorgado a mano a un usuario, sea cual sea el id de suscripción involucrado.
  const { error } = await supabaseAdmin
    .from('perfil_usuario')
    .update(cambios)
    .eq('pasarela_suscripcion_id', dataId)
    .eq('premium_manual', false);
  if (error) throw error;

  const huboCobroNuevo = nuevoPlan === 'premium' && cambios.siguiente_cobro_en !== (filaAnterior?.siguiente_cobro_en ?? null);
  if (filaAnterior && huboCobroNuevo) {
    const resultado = await enviarRecibo(filaAnterior.id, {
      tipoPlan: filaAnterior.tipo_plan || 'mensual',
      monto: suscripcion.auto_recurring?.transaction_amount,
      siguienteCobroEn: cambios.siguiente_cobro_en,
      nombre: filaAnterior.nombre,
    });
    if (!resultado.ok) console.error('No se pudo mandar el recibo de pago (suscripción):', resultado.error);
  }
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
