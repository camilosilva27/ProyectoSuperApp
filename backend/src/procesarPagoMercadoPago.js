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
 *
 * Cambio de plan (auditoría 2026-09-24): al abrir el checkout de otro plan, la suscripción que
 * estaba activa se guarda en `pasarela_suscripcion_anterior_id` (ver routes/pagos.js) y recién
 * se cancela en MP cuando el pago nuevo se confirma — acá, en `procesarSuscripcion` (plan
 * recurrente nuevo autorizado) o en `procesarPagoAprobado` (permanente aprobado).
 */

const { MercadoPagoConfig, PreApproval, Payment } = require('mercadopago');
const { planSegunEstado } = require('./planSegunEstadoSuscripcion');
const { enviarRecibo } = require('./reciboPago');
const { mercadopagoAccessToken } = require('./config');

// El pago único del permanente se crea con external_reference = "perm:<usuarioId>" (routes/
// pagos.js). El prefijo lo distingue de los cobros de una suscripción, que se crean con el
// usuarioId pelado: sin él, si MP copiaba ese external_reference a cada cuota, un cobro mensual
// se tomaba como compra del permanente (auditoría 2026-09-24).
const PREFIJO_PERMANENTE = 'perm:';

function referenciaPermanente(usuarioId) {
  return `${PREFIJO_PERMANENTE}${usuarioId}`;
}

function usuarioDeReferenciaPermanente(externalReference) {
  if (typeof externalReference !== 'string' || !externalReference.startsWith(PREFIJO_PERMANENTE)) return null;
  return externalReference.slice(PREFIJO_PERMANENTE.length) || null;
}

/** Cancela suscripciones en MP. No lanza: una que ya estaba cancelada o nunca se autorizó puede
 *  fallar y no importa; si falla una que sí cobraba, queda en el log para revisarla a mano. */
async function cancelarSuscripcionesEnMP(ids) {
  const pendientes = [...new Set(ids.filter(Boolean))];
  if (!pendientes.length || !mercadopagoAccessToken) return;
  const preApproval = new PreApproval(new MercadoPagoConfig({ accessToken: mercadopagoAccessToken }));
  for (const id of pendientes) {
    try {
      await preApproval.update({ id, body: { status: 'cancelled' } });
    } catch (err) {
      console.error(`No se pudo cancelar la suscripción ${id} en MP (revisar a mano si seguía cobrando):`, err?.message ?? err);
    }
  }
}

// Pago único del plan permanente. Devuelve el plan resultante, o null si no había nada que
// aplicar (pago no aprobado, no es del permanente, o ya estaba aplicado antes).
async function procesarPagoAprobado(pago, supabaseAdmin) {
  if (pago.status !== 'approved') return null;
  const usuarioId = usuarioDeReferenciaPermanente(pago.external_reference);
  if (!usuarioId) return null;

  const { data: filaAnterior } = await supabaseAdmin
    .from('perfil_usuario')
    .select('nombre, pagado_en, pasarela_suscripcion_id, pasarela_suscripcion_anterior_id')
    .eq('id', usuarioId)
    .eq('premium_manual', false)
    .maybeSingle();
  if (!filaAnterior) return null;

  // Se limpia todo rastro de suscripción: si quedaba un id viejo, un 'cancelled' posterior de
  // esa suscripción (o el botón "Cancelar suscripción", que se muestra si hay id) podía bajar a
  // gratis a alguien que pagó el permanente (auditoría 2026-09-24).
  const { error } = await supabaseAdmin
    .from('perfil_usuario')
    .update({
      plan: 'premium',
      tipo_plan: 'permanente',
      pagado_en: pago.date_approved ?? null,
      pasarela_suscripcion_id: null,
      pasarela_suscripcion_anterior_id: null,
      suscripcion_estado: null,
      siguiente_cobro_en: null,
      acceso_premium_hasta: null,
    })
    .eq('id', usuarioId)
    .eq('premium_manual', false);
  if (error) throw error;

  await cancelarSuscripcionesEnMP([filaAnterior.pasarela_suscripcion_id, filaAnterior.pasarela_suscripcion_anterior_id]);

  if (!filaAnterior.pagado_en) {
    const resultado = await enviarRecibo(usuarioId, {
      tipoPlan: 'permanente',
      monto: pago.transaction_amount,
      siguienteCobroEn: null,
      nombre: filaAnterior.nombre,
    });
    if (!resultado.ok) console.error('No se pudo mandar el recibo de pago (permanente):', resultado.error);
  }

  return 'premium';
}

// Estados de un pago que deshacen una compra ya aprobada (auditoría 2026-09-24): antes solo se
// miraba 'approved', así que un permanente reembolsado o contracargado conservaba el plan.
// 'cancelled' entra por las dudas (MP lo usa sobre todo para pagos que nunca se aprobaron, ej. un
// ticket vencido — ver el chequeo de `date_approved` abajo). 'in_mediation' (disputa abierta)
// NO: todavía puede resolverse a favor nuestro; recién 'charged_back' es la pérdida.
const ESTADOS_PAGO_REVERTIDO = new Set(['refunded', 'charged_back', 'cancelled']);

function mismoInstante(a, b) {
  return new Date(a).getTime() === new Date(b).getTime();
}

// Pago único del permanente reembolsado / contracargado / cancelado: baja a gratis. Devuelve
// 'gratis' si bajó el plan, o null si no había nada que deshacer.
async function procesarPagoRevertido(pago, supabaseAdmin) {
  if (!ESTADOS_PAGO_REVERTIDO.has(pago.status)) return null;
  const usuarioId = usuarioDeReferenciaPermanente(pago.external_reference);
  if (!usuarioId) {
    // Cobro de una suscripción (external_reference = usuarioId pelado) reembolsado o
    // contracargado: no se toca el plan por el pago. La suscripción se reconcilia por su propio
    // estado (procesarSuscripcion); si hace falta cortarle el acceso, es cancelarla a mano en MP.
    if (pago.external_reference) {
      console.warn(`Pago ${pago.id} de suscripción (ref ${pago.external_reference}) quedó '${pago.status}'; no se toca el plan por el pago`);
    }
    return null;
  }
  // Un pago que nunca se aprobó (ej. 'cancelled' de un ticket vencido) no dio acceso: nada que deshacer.
  if (!pago.date_approved) return null;

  const { data: fila } = await supabaseAdmin
    .from('perfil_usuario')
    .select('pagado_en')
    .eq('id', usuarioId)
    .eq('premium_manual', false)
    .eq('tipo_plan', 'permanente')
    .maybeSingle();
  if (!fila) return null;

  // Si el permanente vigente vino de OTRO pago (ej. compró de nuevo después de un reembolso y
  // llega tarde el contracargo del primero), este evento no le corresponde.
  if (fila.pagado_en && !mismoInstante(fila.pagado_en, pago.date_approved)) {
    console.warn(`Pago ${pago.id} del permanente quedó '${pago.status}' pero el plan de ${usuarioId} viene de otro pago; no se toca`);
    return null;
  }

  const { error } = await supabaseAdmin
    .from('perfil_usuario')
    .update({ plan: 'gratis', tipo_plan: null, pagado_en: null })
    .eq('id', usuarioId)
    .eq('premium_manual', false)
    .eq('tipo_plan', 'permanente');
  if (error) throw error;

  console.warn(`Permanente de ${usuarioId} revertido a gratis: pago ${pago.id} quedó '${pago.status}'`);
  return 'gratis';
}

// Punto de entrada para cualquier evento de un pago (webhook type=payment, contracargos): aplica
// el permanente si se aprobó o lo deshace si se revirtió. Cualquier otro estado ('pending',
// 'in_process', 'in_mediation', 'rejected'…) no toca nada.
async function procesarPagoUnico(pago, supabaseAdmin) {
  if (pago.status === 'approved') return procesarPagoAprobado(pago, supabaseAdmin);
  if (ESTADOS_PAGO_REVERTIDO.has(pago.status)) return procesarPagoRevertido(pago, supabaseAdmin);
  return null;
}

function tipoPlanSegunFrecuencia(suscripcion) {
  return suscripcion.auto_recurring?.frequency === 12 ? 'anual' : 'mensual';
}

// Suscripción (mensual/anual): `dataId` es el id de la suscripción en MP. Puede ser la vigente
// (`pasarela_suscripcion_id`) o la anterior de un cambio de plan todavía no confirmado
// (`pasarela_suscripcion_anterior_id`, que hasta entonces sigue siendo la que da acceso).
// Devuelve el plan resultante si cambió en la fila, o null si no hubo cambio de plan (incluye
// el caso de gracia post-cancelación, ver abajo) o si no había ningún usuario con esa
// suscripción (o ya estaba con premium manual).
async function procesarSuscripcion(suscripcion, dataId, supabaseAdmin) {
  const nuevoPlan = planSegunEstado(suscripcion.status);
  // dataId va interpolado en el filtro .or() de abajo: los ids de preapproval de MP son
  // alfanuméricos, cualquier otra cosa se descarta antes de armar el filtro.
  if (typeof dataId !== 'string' || !/^[A-Za-z0-9_-]+$/.test(dataId)) return null;

  const { data: filaAnterior } = await supabaseAdmin
    .from('perfil_usuario')
    .select('id, plan, nombre, tipo_plan, siguiente_cobro_en, pasarela_suscripcion_id, pasarela_suscripcion_anterior_id')
    .or(`pasarela_suscripcion_id.eq.${dataId},pasarela_suscripcion_anterior_id.eq.${dataId}`)
    .eq('premium_manual', false)
    .maybeSingle();
  if (!filaAnterior) return null;

  // La suscripción se crea con external_reference = usuarioId (routes/pagos.js). Si no coincide
  // con la fila que la tiene guardada, alguien apuntó su `pasarela_suscripcion_id` a la
  // suscripción de otro usuario (auditoría 2026-09-24): no se aplica nada.
  if (suscripcion.external_reference && suscripcion.external_reference !== filaAnterior.id) {
    console.error(`Suscripción ${dataId} pertenece a otro usuario; se ignora para ${filaAnterior.id}`);
    return null;
  }

  const esLaAnterior = filaAnterior.pasarela_suscripcion_anterior_id === dataId
    && filaAnterior.pasarela_suscripcion_id !== dataId;
  const cambios = {};
  let cancelarAnterior = null;

  if (esLaAnterior) {
    // Evento de la suscripción vieja mientras el cambio de plan no se confirmó: sigue siendo
    // la que da acceso. Si se cancela o pausa por su lado, se trata como una cancelación normal
    // (con gracia) y deja de ser "anterior".
    if (nuevoPlan === 'premium') return null;
    cambios.pasarela_suscripcion_anterior_id = null;
  } else {
    cambios.suscripcion_estado = suscripcion.status;
  }

  if (nuevoPlan === 'premium') {
    cambios.plan = 'premium';
    cambios.tipo_plan = tipoPlanSegunFrecuencia(suscripcion);
    cambios.siguiente_cobro_en = suscripcion.next_payment_date ?? null;
    cambios.acceso_premium_hasta = null;
    if (filaAnterior.pasarela_suscripcion_anterior_id) {
      cancelarAnterior = filaAnterior.pasarela_suscripcion_anterior_id;
      cambios.pasarela_suscripcion_anterior_id = null;
    }
  } else if (nuevoPlan === 'gratis' && filaAnterior.plan === 'premium') {
    // Cancelada o pausada: no se corta el acceso ya pagado de una. `siguiente_cobro_en` (la
    // fecha del próximo cobro que ya no va a pasar) es justo el límite de lo ya pagado, así
    // que el plan queda en premium hasta ahí — recién `bajar_planes_vencidos()` (migración
    // 0020/0025) lo baja de verdad cuando esa fecha pasa. Si no hay `siguiente_cobro_en`
    // (nunca llegó a cobrarse ni una vez), no hay nada "ya pagado" que honrar: se baja ya.
    //
    // Si hay un cambio de plan en curso y la que se cancela es la NUEVA (checkout abandonado),
    // no se toca el plan: el acceso lo sigue dando la anterior.
    const cancelaLaNuevaConAnteriorViva = !esLaAnterior && !!filaAnterior.pasarela_suscripcion_anterior_id;
    if (cancelaLaNuevaConAnteriorViva) {
      // La anterior vuelve a ser la vigente, así "Cancelar suscripción" y los webhooks
      // siguientes apuntan a la que de verdad cobra.
      cambios.pasarela_suscripcion_id = filaAnterior.pasarela_suscripcion_anterior_id;
      cambios.pasarela_suscripcion_anterior_id = null;
      cambios.suscripcion_estado = 'authorized';
    } else {
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
  }
  // Si nuevoPlan === 'gratis' pero filaAnterior.plan no era 'premium' (ej. 'trial'), esta
  // suscripción nunca llegó a autorizarse — el usuario abrió el checkout y volvió atrás sin
  // pagar. No hay ningún acceso pagado que cortar, así que no se toca `plan`: bug real
  // encontrado 2026-09-14, un intento de pago abandonado bajaba a 'gratis' a alguien que
  // todavía tenía trial vigente. Solo se deja constancia en `suscripcion_estado`.

  const { error } = await supabaseAdmin
    .from('perfil_usuario')
    .update(cambios)
    .eq('id', filaAnterior.id)
    .eq('premium_manual', false);
  if (error) throw error;

  // Se cancela después de escribir la fila: así el webhook 'cancelled' de la vieja ya no la
  // encuentra como anterior y no dispara la lógica de gracia sobre el plan nuevo.
  if (cancelarAnterior) await cancelarSuscripcionesEnMP([cancelarAnterior]);

  const fechaAntes = filaAnterior.siguiente_cobro_en ? new Date(filaAnterior.siguiente_cobro_en).getTime() : null;
  const fechaAhora = cambios.siguiente_cobro_en ? new Date(cambios.siguiente_cobro_en).getTime() : null;
  const huboCobroNuevo = nuevoPlan === 'premium' && !esLaAnterior && fechaAhora !== fechaAntes;
  if (huboCobroNuevo) {
    const resultado = await enviarRecibo(filaAnterior.id, {
      tipoPlan: cambios.tipo_plan,
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
    .select('plan, tipo_plan, pasarela_suscripcion_id, pasarela_suscripcion_anterior_id, premium_manual')
    .eq('id', usuarioId)
    .single();
  if (errorPerfil) throw errorPerfil;

  if (perfil.premium_manual) return perfil.plan;
  // Premium sin cambio de plan en curso: no hay nada que verificar. Con un cambio en curso
  // (hay anterior), sí: hay que ver si el plan nuevo ya se confirmó para cancelar el viejo.
  if (perfil.plan === 'premium' && !perfil.pasarela_suscripcion_anterior_id) return perfil.plan;
  if (perfil.plan === 'premium' && perfil.tipo_plan === 'permanente') return perfil.plan;
  if (!mercadopagoAccessToken) return perfil.plan;

  const client = new MercadoPagoConfig({ accessToken: mercadopagoAccessToken });
  const huboCambioEnCurso = !!perfil.pasarela_suscripcion_anterior_id;

  // `pasarela_suscripcion_id` puede ser un intento viejo que nunca se autorizó (checkout
  // abandonado y después pago del permanente, bug real 2026-09-11) — así que se prueban las dos
  // fuentes y gana la que confirme premium. Ambas son idempotentes.
  let plan = perfil.plan;

  if (perfil.pasarela_suscripcion_id) {
    const preApproval = new PreApproval(client);
    const suscripcion = await preApproval.get({ id: perfil.pasarela_suscripcion_id });
    const resultado = await procesarSuscripcion(suscripcion, perfil.pasarela_suscripcion_id, supabaseAdmin);
    plan = resultado ?? plan;
    if (resultado === 'premium') return plan;
  }

  const payment = new Payment(client);
  const { results } = await payment.search({
    options: { external_reference: referenciaPermanente(usuarioId), sort: 'date_approved', criteria: 'desc' },
  });
  const pagoAprobado = results?.find((p) => p.status === 'approved');
  if (!pagoAprobado) return plan;

  // Con un cambio en curso el usuario ya es premium por la anterior: procesarPagoAprobado
  // igual corre (idempotente) para pasarlo a permanente y cancelar lo viejo.
  if (huboCambioEnCurso || plan !== 'premium') {
    return (await procesarPagoAprobado(pagoAprobado, supabaseAdmin)) ?? plan;
  }
  return plan;
}

module.exports = {
  procesarPagoAprobado, procesarPagoRevertido, procesarPagoUnico, procesarSuscripcion,
  verificarYAplicarPago, referenciaPermanente, cancelarSuscripcionesEnMP,
};
