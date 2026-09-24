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
const {
  procesarSuscripcion, verificarYAplicarPago, referenciaPermanente, cancelarSuscripcionesEnMP,
} = require('../procesarPagoMercadoPago');
const {
  mercadopagoAccessToken, precioMensualArs, precioAnualArs, precioPermanenteArs,
  urlVueltaCheckoutMP,
} = require('../config');

const router = express.Router();

// Turnos 12/13 (design_handoff_allpromos_v2/PANTALLA-12-eleccion-de-plan.md): el payer_email de
// una suscripción o un pago único tiene que ser el de la cuenta de Mercado Pago del pagador, no
// necesariamente el de la sesión de SuperAhorro (opciones_planes.md, bug real ya encontrado con un
// pago fallido). MercadoPagoEmailSheet deja confirmar/cambiar ese mail antes de pagar; esta regex
// es solo un chequeo de formato (no se puede verificar si la cuenta existe antes del checkout).
const REGEX_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function resolverEmailPago(req) {
  const emailBody = typeof req.body?.email === 'string' ? req.body.email.trim() : '';
  if (emailBody && REGEX_EMAIL.test(emailBody)) return emailBody;
  return req.usuarioEmail;
}

const COLUMNAS_PAGO = 'plan, tipo_plan, premium_manual, pasarela_suscripcion_id, pasarela_suscripcion_anterior_id, suscripcion_estado';

async function leerPerfilPago(supabaseAdmin, usuarioId) {
  const { data, error } = await supabaseAdmin
    .from('perfil_usuario').select(COLUMNAS_PAGO).eq('id', usuarioId).single();
  if (error) throw error;
  return data;
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
    const perfil = await leerPerfilPago(supabaseAdmin, req.usuarioId);
    if (perfil.plan === 'premium' && perfil.tipo_plan === 'permanente') {
      return res.status(409).json({ error: 'Ya tenés el plan permanente' });
    }
    const tieneEsePlanActivo = perfil.plan === 'premium' && perfil.tipo_plan === tipoPlan
      && perfil.suscripcion_estado === 'authorized' && !perfil.pasarela_suscripcion_anterior_id;
    if (tieneEsePlanActivo) {
      return res.status(409).json({ error: `Ya tenés el plan ${tipoPlan}` });
    }

    // Cambio de plan (auditoría 2026-09-24, decisión del usuario): la suscripción que hoy da
    // acceso NO se cancela acá — se guarda como anterior y recién se cancela cuando MP confirma
    // la nueva (procesarPagoMercadoPago.js). Si el usuario abandona el checkout, no pierde nada.
    // Un intento previo que nunca se autorizó (checkout abandonado) sí se cancela: no da
    // acceso y así no puede autorizarse más tarde por un link viejo sin que nadie lo registre.
    const anterior = perfil.pasarela_suscripcion_anterior_id
      ?? (perfil.suscripcion_estado === 'authorized' ? perfil.pasarela_suscripcion_id : null);
    const intentoAbandonado = perfil.pasarela_suscripcion_id && perfil.pasarela_suscripcion_id !== anterior
      ? perfil.pasarela_suscripcion_id : null;

    const client = new MercadoPagoConfig({ accessToken: mercadopagoAccessToken });
    const preApproval = new PreApproval(client);

    const suscripcion = await preApproval.create({
      body: {
        reason: `SuperAhorro Premium (${tipoPlan})`,
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
        pasarela_suscripcion_anterior_id: anterior,
        // Con un cambio en curso, suscripcion_estado describe la que da acceso (la anterior)
        // hasta que la nueva se confirme; tipo_plan se escribe recién al confirmarse.
        suscripcion_estado: anterior ? 'authorized' : (suscripcion.status ?? 'pending'),
        mail_mercado_pago: emailPago,
        intento_pago_en: new Date().toISOString(),
      })
      .eq('id', req.usuarioId);
    if (error) throw error;

    if (intentoAbandonado) await cancelarSuscripcionesEnMP([intentoAbandonado]);

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
    const perfil = await leerPerfilPago(supabaseAdmin, req.usuarioId);
    if (perfil.plan === 'premium' && perfil.tipo_plan === 'permanente') {
      return res.status(409).json({ error: 'Ya tenés el plan permanente' });
    }

    const client = new MercadoPagoConfig({ accessToken: mercadopagoAccessToken });
    const preference = new Preference(client);

    const pref = await preference.create({
      body: {
        items: [{
          id: 'super-app-premium-permanente',
          title: 'SuperAhorro Premium (permanente)',
          quantity: 1,
          unit_price: precioPermanenteArs,
          currency_id: 'ARS',
        }],
        // Prefijo "perm:" para no confundirlo con los cobros de una suscripción, que llevan el
        // usuarioId pelado (ver referenciaPermanente en procesarPagoMercadoPago.js). Si el
        // usuario tiene una suscripción activa, se cancela cuando este pago se aprueba.
        external_reference: referenciaPermanente(req.usuarioId),
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
      .update({ mail_mercado_pago: emailPago, intento_pago_en: new Date().toISOString() })
      .eq('id', req.usuarioId);
    if (error) throw error;

    res.json({ initPoint: pref.init_point });
  } catch (err) {
    console.error('Error creando pago único de Mercado Pago:', err);
    res.status(502).json({ error: 'No se pudo crear el pago en Mercado Pago' });
  }
});

// POST /api/pagos/cancelar-suscripcion — cancela la suscripción del usuario logueado en
// Mercado Pago. No baja el plan al instante: reusa `procesarSuscripcion` (la misma lógica que
// aplica el webhook) para que, si ya había un período pagado por delante (`siguiente_cobro_en`),
// el usuario mantenga premium hasta esa fecha — política confirmada 2026-09-11 (ver
// .claude/docs/Plan_Usuarios_y_cobros.md § "Cancelación"): no se le cobra el próximo período,
// pero conserva el acceso ya pagado, sin reembolso. `bajar_planes_vencidos()` (migración 0020)
// es quien efectiviza el downgrade real cuando esa fecha pasa.
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
    .select('pasarela_suscripcion_id, pasarela_suscripcion_anterior_id')
    .eq('id', req.usuarioId)
    .single();
  if (errorPerfil || !perfil?.pasarela_suscripcion_id) {
    return res.status(404).json({ error: 'No hay ninguna suscripción para cancelar' });
  }

  try {
    // Con un cambio de plan en curso, la que cobra es la anterior; la nueva todavía no se
    // autorizó. Se cancela la nueva y se deja la anterior como vigente antes de cancelarla
    // (así el 'cancelled' de la nueva ya no encuentra la fila y no la confunde).
    const vigente = perfil.pasarela_suscripcion_anterior_id ?? perfil.pasarela_suscripcion_id;
    if (perfil.pasarela_suscripcion_anterior_id) {
      const { error: errorNormalizar } = await supabaseAdmin
        .from('perfil_usuario')
        .update({ pasarela_suscripcion_id: vigente, pasarela_suscripcion_anterior_id: null, suscripcion_estado: 'authorized' })
        .eq('id', req.usuarioId);
      if (errorNormalizar) throw errorNormalizar;
      await cancelarSuscripcionesEnMP([perfil.pasarela_suscripcion_id]);
    }

    const client = new MercadoPagoConfig({ accessToken: mercadopagoAccessToken });
    const preApproval = new PreApproval(client);
    const suscripcion = await preApproval.update({
      id: vigente,
      body: { status: 'cancelled' },
    });

    await procesarSuscripcion(suscripcion, vigente, supabaseAdmin);

    const { data: perfilActualizado, error: errorLectura } = await supabaseAdmin
      .from('perfil_usuario')
      .select('plan, acceso_premium_hasta')
      .eq('id', req.usuarioId)
      .single();
    if (errorLectura) throw errorLectura;

    res.json({ plan: perfilActualizado.plan, accesoPremiumHasta: perfilActualizado.acceso_premium_hasta });
  } catch (err) {
    console.error('Error cancelando suscripción de Mercado Pago:', err);
    res.status(502).json({ error: 'No se pudo cancelar la suscripción en Mercado Pago' });
  }
});

// POST /api/pagos/verificar — chequeo activo del estado real en Mercado Pago, para el usuario
// logueado. No depende de que llegue el webhook: lo llama el frontend al volver del checkout
// (`ajustes.tsx`, en vez de solo releer `perfil_usuario`). Existe porque se detectó en vivo
// (2026-09-11, ver .claude/docs/Plan_Usuarios_y_cobros.md) que MP puede demorar días en avisar
// un pago ya aprobado — sin esto, el usuario quedaba sin premium (y sin el mail de recibo)
// aunque ya había pagado. Comparte la lógica de aplicar el estado con el webhook
// (`procesarPagoMercadoPago.js`), así que llamarlo de más no genera recibos duplicados.
router.post('/pagos/verificar', requiereSesion, async (req, res) => {
  if (!mercadopagoAccessToken) {
    return res.status(503).json({ error: 'Mercado Pago todavía no está configurado' });
  }
  const supabaseAdmin = clienteSupabaseAdmin();
  if (!supabaseAdmin) {
    return res.status(503).json({ error: 'Supabase (service role) todavía no está configurado' });
  }

  try {
    const plan = await verificarYAplicarPago(req.usuarioId, supabaseAdmin);
    res.json({ plan });
  } catch (err) {
    console.error('Error verificando pago de Mercado Pago:', err);
    res.status(502).json({ error: 'No se pudo verificar el pago en Mercado Pago' });
  }
});

module.exports = router;
