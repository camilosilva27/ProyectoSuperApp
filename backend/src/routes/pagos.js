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
const {
  MercadoPagoConfig, PreApproval, Preference,
} = require('mercadopago');
const { requiereSesion } = require('../middleware/requiereSesion');
const { clienteSupabaseAdmin } = require('../clienteSupabaseAdmin');
const { planSegunEstado } = require('../planSegunEstadoSuscripcion');
const {
  mercadopagoAccessToken, precioMensualArs, precioAnualArs, precioPermanenteArs,
  urlVueltaCheckoutMP,
} = require('../config');

const router = express.Router();

// Turnos 12/13 (design_handoff_allpromos_v2/PANTALLA-12-eleccion-de-plan.md): el payer_email de
// una suscripción o un pago único tiene que ser el de la cuenta de Mercado Pago del pagador, no
// necesariamente el de la sesión de Super App (opciones_planes.md, bug real ya encontrado con un
// pago fallido). MercadoPagoEmailSheet deja confirmar/cambiar ese mail antes de pagar; esta regex
// es solo un chequeo de formato (no se puede verificar si la cuenta existe antes del checkout).
const REGEX_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function resolverEmailPago(req) {
  const emailBody = typeof req.body?.email === 'string' ? req.body.email.trim() : '';
  if (emailBody && REGEX_EMAIL.test(emailBody)) return emailBody;
  return req.usuarioEmail;
}

// Fase 3 (opciones_planes.md): mensual y anual son ambos PreApproval (suscripción recurrente
// de MP), solo cambia el intervalo de cobro y el precio — este mapa evita duplicar la ruta.
const CONFIG_PLAN_RECURRENTE = {
  mensual: { frequency: 1, precio: () => precioMensualArs },
  anual: { frequency: 12, precio: () => precioAnualArs },
};

// GET /api/pagos/precio — pública (la usa el paywall de fin de trial antes de que el usuario
// haga nada, y `ajustes.tsx`): solo expone los precios configurados, sin tocar ningún dato de
// usuario, así que no hace falta sesión. Cada precio es independiente: si falta la variable de
// uno, ese campo queda en null en vez de romper a los otros dos.
router.get('/pagos/precio', (req, res) => {
  if (!precioMensualArs && !precioAnualArs && !precioPermanenteArs) {
    return res.status(503).json({ error: 'Ningún precio de plan está configurado todavía' });
  }
  res.json({
    precioMensualArs: precioMensualArs ?? null,
    precioAnualArs: precioAnualArs ?? null,
    precioPermanenteArs: precioPermanenteArs ?? null,
  });
});

router.post('/pagos/suscripcion', requiereSesion, async (req, res) => {
  const tipoPlan = req.body?.tipoPlan === 'anual' ? 'anual' : 'mensual';
  const { frequency, precio } = CONFIG_PLAN_RECURRENTE[tipoPlan];
  const precioArs = precio();

  if (!mercadopagoAccessToken || !precioArs) {
    return res.status(503).json({
      error: `Mercado Pago todavía no está configurado para el plan ${tipoPlan} (falta MERCADOPAGO_ACCESS_TOKEN o el precio correspondiente)`,
    });
  }
  const supabaseAdmin = clienteSupabaseAdmin();
  if (!supabaseAdmin) {
    return res.status(503).json({ error: 'Supabase (service role) todavía no está configurado' });
  }

  const emailPago = resolverEmailPago(req);

  try {
    const client = new MercadoPagoConfig({ accessToken: mercadopagoAccessToken });
    const preApproval = new PreApproval(client);

    const suscripcion = await preApproval.create({
      body: {
        reason: `Super App Premium (${tipoPlan})`,
        external_reference: req.usuarioId,
        payer_email: emailPago,
        back_url: urlVueltaCheckoutMP,
        auto_recurring: {
          frequency,
          frequency_type: 'months',
          transaction_amount: precioArs,
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
        tipo_plan: tipoPlan,
        mail_mercado_pago: emailPago,
      })
      .eq('id', req.usuarioId);
    if (error) throw error;

    res.json({ initPoint: suscripcion.init_point });
  } catch (err) {
    console.error('Error creando suscripción de Mercado Pago:', err);
    res.status(502).json({ error: 'No se pudo crear la suscripción en Mercado Pago' });
  }
});

// POST /api/pagos/pago-unico — arranca el pago único del plan permanente (Checkout Pro /
// Preference, no PreApproval: no hay recurrencia que crear). A diferencia de la suscripción,
// acá no se guarda ningún id de "suscripción" en `perfil_usuario` — el pago se asocia al
// usuario vía `external_reference`, y es el webhook (`type=payment`) el que, al confirmar
// `status: 'approved'`, otorga `plan='premium', tipo_plan='permanente'`. Igual que la
// suscripción, esta ruta NO otorga premium por sí sola.
router.post('/pagos/pago-unico', requiereSesion, async (req, res) => {
  if (!mercadopagoAccessToken || !precioPermanenteArs) {
    return res.status(503).json({
      error: 'Mercado Pago todavía no está configurado para el plan permanente (falta MERCADOPAGO_ACCESS_TOKEN o MERCADOPAGO_PRECIO_PERMANENTE_ARS)',
    });
  }

  const supabaseAdmin = clienteSupabaseAdmin();
  if (!supabaseAdmin) {
    return res.status(503).json({ error: 'Supabase (service role) todavía no está configurado' });
  }

  const emailPago = resolverEmailPago(req);

  try {
    const client = new MercadoPagoConfig({ accessToken: mercadopagoAccessToken });
    const preference = new Preference(client);

    const pref = await preference.create({
      body: {
        items: [{
          id: 'super-app-premium-permanente',
          title: 'Super App Premium (permanente)',
          quantity: 1,
          unit_price: precioPermanenteArs,
          currency_id: 'ARS',
        }],
        external_reference: req.usuarioId,
        payer: { email: emailPago },
        back_urls: {
          success: urlVueltaCheckoutMP,
          failure: urlVueltaCheckoutMP,
          pending: urlVueltaCheckoutMP,
        },
        auto_return: 'approved',
      },
    });

    // El pago único no otorga premium acá (eso lo hace el webhook cuando el pago se confirma),
    // pero el mail sí se puede guardar ya: es el mismo dato que se usó para crear la Preference.
    const { error } = await supabaseAdmin
      .from('perfil_usuario')
      .update({ mail_mercado_pago: emailPago })
      .eq('id', req.usuarioId);
    if (error) throw error;

    res.json({ initPoint: pref.init_point });
  } catch (err) {
    console.error('Error creando pago único de Mercado Pago:', err);
    res.status(502).json({ error: 'No se pudo crear el pago en Mercado Pago' });
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
    // premium_manual nunca se pisa desde acá, mismo criterio que el webhook. tipo_plan se
    // limpia porque ya no tiene sentido una vez que el usuario deja de ser premium.
    const { error } = await supabaseAdmin
      .from('perfil_usuario')
      .update({ suscripcion_estado: suscripcion.status ?? 'cancelled', plan: nuevoPlan, tipo_plan: null })
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
