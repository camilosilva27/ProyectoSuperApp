/**
 * Lógica de "aplicar el estado real de MP a perfil_usuario", compartida entre dos disparadores:
 * el webhook (`webhookMercadoPago.js`, reactivo a lo que MP decide avisar) y la verificación
 * activa (`POST /api/pagos/verificar`, que la app dispara al volver del checkout en vez de
 * esperar pasivamente). Ver .claude/docs/Plan_Usuarios_y_cobros.md — se detectó (2026-09-11)
 * que MP puede demorar días en mandar el webhook de un pago ya aprobado (parece atado a la
 * liberación de fondos, no a la aprobación), así que no alcanza con el webhook solo.
 *
 * Ambas funciones son idempotentes por diseño (comparan el estado ANTES de escribir), así que
 * da lo mismo si el webhook y la verificación activa procesan el mismo pago dos veces.
 */

const { MercadoPagoConfig, PreApproval, Payment } = require('mercadopago');
const { planSegunEstado } = require('./planSegunEstadoSuscripcion');
const { enviarRecibo } = require('./reciboPago');
const { mercadopagoAccessToken } = require('./config');

// Pago único del plan permanente: `pago.external_reference` es el usuarioId (seteado al crear
// la Preference en pagos.js). Devuelve el plan resultante, o null si no había nada que aplicar
// (pago no aprobado, o ya estaba aplicado antes).
async function procesarPagoAprobado(pago, supabaseAdmin) {
  if (pago.status !== 'approved' || !pago.external_reference) return null;

  const { data: filaAnterior } = await supabaseAdmin
    .from('perfil_usuario')
    .select('nombre, pagado_en')
    .eq('id', pago.external_reference)
    .eq('premium_manual', false)
    .maybeSingle();
  if (!filaAnterior) return null;

  const { error } = await supabaseAdmin
    .from('perfil_usuario')
    .update({ plan: 'premium', tipo_plan: 'permanente', pagado_en: pago.date_approved ?? null })
    .eq('id', pago.external_reference)
    .eq('premium_manual', false);
  if (error) throw error;

  if (!filaAnterior.pagado_en) {
    const resultado = await enviarRecibo(pago.external_reference, {
      tipoPlan: 'permanente',
      monto: pago.transaction_amount,
      siguienteCobroEn: null,
      nombre: filaAnterior.nombre,
    });
    if (!resultado.ok) console.error('No se pudo mandar el recibo de pago (permanente):', resultado.error);
  }

  return 'premium';
}

// Suscripción (mensual/anual): `dataId` es el id de la suscripción en MP
// (`perfil_usuario.pasarela_suscripcion_id`). Devuelve el plan resultante, o null si no había
// ningún usuario con esa suscripción (o ya estaba con premium manual).
async function procesarSuscripcion(suscripcion, dataId, supabaseAdmin) {
  const nuevoPlan = planSegunEstado(suscripcion.status);
  const cambios = {
    suscripcion_estado: suscripcion.status,
    siguiente_cobro_en: suscripcion.next_payment_date ?? null,
  };
  if (nuevoPlan) {
    cambios.plan = nuevoPlan;
    if (nuevoPlan === 'gratis') {
      cambios.tipo_plan = null;
      cambios.siguiente_cobro_en = null;
    }
  }

  const { data: filaAnterior } = await supabaseAdmin
    .from('perfil_usuario')
    .select('id, nombre, tipo_plan, siguiente_cobro_en')
    .eq('pasarela_suscripcion_id', dataId)
    .eq('premium_manual', false)
    .maybeSingle();
  if (!filaAnterior) return null;

  const { error } = await supabaseAdmin
    .from('perfil_usuario')
    .update(cambios)
    .eq('pasarela_suscripcion_id', dataId)
    .eq('premium_manual', false);
  if (error) throw error;

  const huboCobroNuevo = nuevoPlan === 'premium' && cambios.siguiente_cobro_en !== (filaAnterior.siguiente_cobro_en ?? null);
  if (huboCobroNuevo) {
    const resultado = await enviarRecibo(filaAnterior.id, {
      tipoPlan: filaAnterior.tipo_plan || 'mensual',
      monto: suscripcion.auto_recurring?.transaction_amount,
      siguienteCobroEn: cambios.siguiente_cobro_en,
      nombre: filaAnterior.nombre,
    });
    if (!resultado.ok) console.error('No se pudo mandar el recibo de pago (suscripción):', resultado.error);
  }

  return nuevoPlan;
}

// Punto de entrada único para "reconciliar el pago de este usuario contra MP ahora mismo" —
// usado tanto por `POST /api/pagos/verificar` (un usuario, disparado por la app) como por el
// cron de reintento (`cron/reintentarPagosPendientes.js`, varios usuarios en batch). Decide solo
// la rama correcta (suscripción vs. pago único) a partir de lo que ya hay guardado en
// `perfil_usuario` — evita duplicar esa decisión en los dos callers.
async function verificarYAplicarPago(usuarioId, supabaseAdmin) {
  const { data: perfil, error: errorPerfil } = await supabaseAdmin
    .from('perfil_usuario')
    .select('plan, pasarela_suscripcion_id, premium_manual')
    .eq('id', usuarioId)
    .single();
  if (errorPerfil) throw errorPerfil;

  if (perfil.plan === 'premium' || perfil.premium_manual) return perfil.plan;
  if (!mercadopagoAccessToken) return perfil.plan;

  const client = new MercadoPagoConfig({ accessToken: mercadopagoAccessToken });

  if (perfil.pasarela_suscripcion_id) {
    const preApproval = new PreApproval(client);
    const suscripcion = await preApproval.get({ id: perfil.pasarela_suscripcion_id });
    const plan = await procesarSuscripcion(suscripcion, perfil.pasarela_suscripcion_id, supabaseAdmin);
    return plan ?? perfil.plan;
  }

  // Plan permanente: no hay id de suscripción guardado, el pago se busca por
  // external_reference (seteado al crear la Preference en /pagos/pago-unico).
  const payment = new Payment(client);
  const { results } = await payment.search({
    options: { external_reference: usuarioId, sort: 'date_approved', criteria: 'desc' },
  });
  const pagoAprobado = results?.find((p) => p.status === 'approved');
  if (!pagoAprobado) return perfil.plan;

  const plan = await procesarPagoAprobado(pagoAprobado, supabaseAdmin);
  return plan ?? perfil.plan;
}

module.exports = { procesarPagoAprobado, procesarSuscripcion, verificarYAplicarPago };
