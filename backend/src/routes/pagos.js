/**
 * POST /api/pagos/suscripcion — arranca la suscripción premium del usuario logueado en
 * Mercado Pago (Preapproval, cobro recurrente mensual). Requiere sesión (ver
 * requiereSesion.js): la suscripción queda asociada al usuario ACÁ MISMO, guardando el id
 * que devuelve Mercado Pago en `perfil_usuario.pasarela_suscripcion_id` — así, cuando llegue
 * el webhook con un cambio de estado, ya se sabe a qué usuario corresponde ese id sin
 * depender de ningún otro dato (ver idx_perfil_usuario_pasarela_suscripcion en la migración).
 *
 * Importante: esta ruta NO otorga `plan='premium'`. Crear la suscripción en MP no garantiza
 * que el usuario haya terminado de pagar en el checkout — eso lo confirma únicamente el
 * webhook, cuando MP avisa que quedó `authorized` (ver webhookMercadoPago.js).
 */

const express = require('express');
const { MercadoPagoConfig, PreApproval } = require('mercadopago');
const { requiereSesion } = require('../middleware/requiereSesion');
const { clienteSupabaseAdmin } = require('../clienteSupabaseAdmin');
const { planSegunEstado } = require('../planSegunEstadoSuscripcion');
const {
  mercadopagoAccessToken, precioMensualArs, urlVueltaCheckoutMP,
} = require('../config');

const router = express.Router();

router.post('/pagos/suscripcion', requiereSesion, async (req, res) => {
  if (!mercadopagoAccessToken || !precioMensualArs) {
    return res.status(503).json({
      error: 'Mercado Pago todavía no está configurado (falta MERCADOPAGO_ACCESS_TOKEN o MERCADOPAGO_PRECIO_MENSUAL_ARS)',
    });
  }
  const supabaseAdmin = clienteSupabaseAdmin();
  if (!supabaseAdmin) {
    return res.status(503).json({ error: 'Supabase (service role) todavía no está configurado' });
  }

  try {
    const client = new MercadoPagoConfig({ accessToken: mercadopagoAccessToken });
    const preApproval = new PreApproval(client);

    const suscripcion = await preApproval.create({
      body: {
        reason: 'Super App Premium',
        external_reference: req.usuarioId,
        payer_email: req.usuarioEmail,
        back_url: urlVueltaCheckoutMP,
        auto_recurring: {
          frequency: 1,
          frequency_type: 'months',
          transaction_amount: precioMensualArs,
          currency_id: 'ARS',
        },
      },
    });

    const { error } = await supabaseAdmin
      .from('perfil_usuario')
      .update({
        pasarela_pago: 'mercadopago',
        pasarela_suscripcion_id: suscripcion.id,
        suscripcion_estado: suscripcion.status ?? 'pending',
      })
      .eq('id', req.usuarioId);
    if (error) throw error;

    res.json({ initPoint: suscripcion.init_point });
  } catch (err) {
    console.error('Error creando suscripción de Mercado Pago:', err);
    res.status(502).json({ error: 'No se pudo crear la suscripción en Mercado Pago' });
  }
});

// POST /api/pagos/cancelar-suscripcion — cancela la suscripción del usuario logueado. A
// diferencia del webhook (que solo reacciona a lo que MP avisa async), acá se tiene la
// respuesta de `preApproval.update` en la misma llamada, así que el plan se actualiza de
// una sin esperar al webhook — el usuario ve el downgrade reflejado al instante en Ajustes.
router.post('/pagos/cancelar-suscripcion', requiereSesion, async (req, res) => {
  if (!mercadopagoAccessToken) {
    return res.status(503).json({ error: 'Mercado Pago todavía no está configurado' });
  }
  const supabaseAdmin = clienteSupabaseAdmin();
  if (!supabaseAdmin) {
    return res.status(503).json({ error: 'Supabase (service role) todavía no está configurado' });
  }

  const { data: perfil, error: errorPerfil } = await supabaseAdmin
    .from('perfil_usuario')
    .select('pasarela_suscripcion_id')
    .eq('id', req.usuarioId)
    .single();
  if (errorPerfil || !perfil?.pasarela_suscripcion_id) {
    return res.status(404).json({ error: 'No hay ninguna suscripción para cancelar' });
  }

  try {
    const client = new MercadoPagoConfig({ accessToken: mercadopagoAccessToken });
    const preApproval = new PreApproval(client);
    const suscripcion = await preApproval.update({
      id: perfil.pasarela_suscripcion_id,
      body: { status: 'cancelled' },
    });

    const nuevoPlan = planSegunEstado(suscripcion.status) ?? 'gratis';
    // premium_manual nunca se pisa desde acá, mismo criterio que el webhook.
    const { error } = await supabaseAdmin
      .from('perfil_usuario')
      .update({ suscripcion_estado: suscripcion.status ?? 'cancelled', plan: nuevoPlan })
      .eq('id', req.usuarioId)
      .eq('premium_manual', false);
    if (error) throw error;

    res.json({ plan: nuevoPlan });
  } catch (err) {
    console.error('Error cancelando suscripción de Mercado Pago:', err);
    res.status(502).json({ error: 'No se pudo cancelar la suscripción en Mercado Pago' });
  }
});

module.exports = router;
