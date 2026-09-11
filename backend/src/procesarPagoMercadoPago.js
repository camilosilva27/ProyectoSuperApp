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
// (`perfil_usuario.pasarela_suscripcion_id`). Devuelve el plan resultante si cambió en la fila,
// o null si no hubo cambio de plan (incluye el caso de gracia post-cancelación, ver abajo) o si
// no había ningún usuario con esa suscripción (o ya estaba con premium manual).
async function procesarSuscripcion(suscripcion, dataId, supabaseAdmin) {
  const nuevoPlan = planSegunEstado(suscripcion.status);
  const cambios = { suscripcion_estado: suscripcion.status };

  const { data: filaAnterior } = await supabaseAdmin
    .from('perfil_usuario')
    .select('id, plan, nombre, tipo_plan, siguiente_cobro_en')
    .eq('pasarela_suscripcion_id', dataId)
    .eq('premium_manual', false)
    .maybeSingle();
  if (!filaAnterior) return null;

  if (nuevoPlan === 'premium') {
    cambios.plan = 'premium';
    cambios.siguiente_cobro_en = suscripcion.next_payment_date ?? null;
    cambios.acceso_premium_hasta = null;
  } else if (nuevoPlan === 'gratis') {
    // Cancelada o pausada: no se corta el acceso ya pagado de una. `siguiente_cobro_en` (la
    // fecha del próximo cobro que ya no va a pasar) es justo el límite de lo ya pagado, así
    // que el plan queda en premium hasta ahí — recién `bajar_planes_vencidos()` (migración
    // 0020) lo baja de verdad cuando esa fecha pasa. Si no hay `siguiente_cobro_en` (nunca
    // llegó a cobrarse ni una vez), no hay nada "ya pagado" que honrar: se baja ya.
    const yaVencido = filaAnterior.siguiente_cobro_en
      && new Date(filaAnterior.siguiente_cobro_en) <= new Date();
    if (filaAnterior.siguiente_cobro_en && !yaVencido) {
      cambios.acceso_premium_hasta = filaAnterior.siguiente_cobro_en;
    } else {
      cambios.plan = 'gratis';
      cambios.tipo_plan = null;
      cambios.siguiente_cobro_en = null;
      cambios.acceso_premium_hasta = null;
    }
  }

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

  return cambios.plan ?? null;
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

  // `pasarela_suscripcion_id` NO se limpia cuando alguien abandona una suscripción a medio
  // camino y termina pagando el plan permanente (bug real encontrado probando esto en vivo,
  // 2026-09-11) — así que su sola presencia no confirma que la suscripción sea el intento
  // vigente. En vez de adivinar la rama por otro campo (que puede estar igual de
  // desactualizado), se prueban las dos fuentes y gana la que confirme premium: es la única
  // forma de no depender de que ningún campo guardado refleje bien "cuál fue el último intento
  // real". Ambas siguen siendo idempotentes, así que no hay downside en consultar de más.
  let plan = perfil.plan;

  if (perfil.pasarela_suscripcion_id) {
    const preApproval = new PreApproval(client);
    const suscripcion = await preApproval.get({ id: perfil.pasarela_suscripcion_id });
    plan = (await procesarSuscripcion(suscripcion, perfil.pasarela_suscripcion_id, supabaseAdmin)) ?? plan;
    if (plan === 'premium') return plan;
  }

  // Plan permanente: el pago se busca por external_reference (seteado al crear la Preference
  // en /pagos/pago-unico) — se revisa siempre que la rama de arriba no haya confirmado premium,
  // sin importar si hay o no una suscripción vieja colgada.
  const payment = new Payment(client);
  const { results } = await payment.search({
    options: { external_reference: usuarioId, sort: 'date_approved', criteria: 'desc' },
  });
  const pagoAprobado = results?.find((p) => p.status === 'approved');
  if (!pagoAprobado) return plan;

  return (await procesarPagoAprobado(pagoAprobado, supabaseAdmin)) ?? plan;
}

module.exports = { procesarPagoAprobado, procesarSuscripcion, verificarYAplicarPago };
