/**
 * Chequeo manual de elegibilidad para el derecho de arrepentimiento (Ley de Defensa del
 * Consumidor 24.240, Argentina): 10 días corridos desde la contratación para pedir el reembolso
 * completo. No confundir con cancelar la suscripción (eso se puede hacer siempre, desde la app,
 * sin límite de días — ver .claude/docs/TERMINOS_DE_SERVICIO.md § "Cancelación"): esto es
 * específicamente para cuando alguien pide la DEVOLUCIÓN de lo pagado, algo que hoy no tiene
 * ningún camino automático en el código (ni la ruta de cancelar ni el webhook devuelven plata) —
 * es una decisión humana, y este script solo calcula si el pedido cae dentro de la ventana legal.
 *
 * Uso: node src/scripts/verificarReembolso.js <mail-del-usuario>
 *
 * Fuente de la fecha de contratación:
 * - Plan permanente: `pagado_en` (fecha del pago único aprobado).
 * - Plan mensual/anual: `date_created` de la suscripción, consultado en vivo contra la API de
 *   Mercado Pago (no hay ninguna columna que guarde la fecha de alta real de la suscripción en
 *   `perfil_usuario` — `siguiente_cobro_en` es la fecha del PRÓXIMO cobro, no la de contratación).
 */

const { MercadoPagoConfig, PreApproval } = require('mercadopago');
const { clienteSupabaseAdmin } = require('../clienteSupabaseAdmin');
const { mercadopagoAccessToken } = require('../config');

const DIAS_ARREPENTIMIENTO = 10;

async function buscarUsuarioPorEmail(cliente, email) {
  // No hay filtro por email en la API admin de supabase-js — se trae la lista completa (un
  // puñado de usuarios en esta app) y se filtra acá. Si la base crece mucho, paginar con
  // `page`/`perPage` en vez de perPage:1000 fijo.
  const { data, error } = await cliente.auth.admin.listUsers({ perPage: 1000 });
  if (error) throw error;
  return data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase()) ?? null;
}

async function verificarReembolso(email) {
  const cliente = clienteSupabaseAdmin();
  if (!cliente) throw new Error('Falta SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY');

  const usuario = await buscarUsuarioPorEmail(cliente, email);
  if (!usuario) return { encontrado: false, email };

  const { data: perfil, error: errorPerfil } = await cliente
    .from('perfil_usuario')
    .select('plan, tipo_plan, pagado_en, pasarela_suscripcion_id, premium_manual')
    .eq('id', usuario.id)
    .single();
  if (errorPerfil) throw errorPerfil;

  if (perfil.premium_manual) {
    return {
      encontrado: true, email, plan: perfil.plan, tipoPlan: perfil.tipo_plan,
      nota: 'Premium otorgado a mano (premium_manual), nunca se le cobró — no aplica reembolso.',
    };
  }

  let fechaContratacion = null;
  if (perfil.tipo_plan === 'permanente') {
    fechaContratacion = perfil.pagado_en;
  } else if (perfil.pasarela_suscripcion_id) {
    if (!mercadopagoAccessToken) throw new Error('Falta MERCADOPAGO_ACCESS_TOKEN para consultar la suscripción');
    const client = new MercadoPagoConfig({ accessToken: mercadopagoAccessToken });
    const preApproval = new PreApproval(client);
    const suscripcion = await preApproval.get({ id: perfil.pasarela_suscripcion_id });
    fechaContratacion = suscripcion.date_created;
  }

  if (!fechaContratacion) {
    return {
      encontrado: true, email, plan: perfil.plan, tipoPlan: perfil.tipo_plan,
      nota: 'No se encontró ninguna fecha de contratación (nunca pagó, o no hay suscripción/pago asociado).',
    };
  }

  const diasTranscurridos = (Date.now() - new Date(fechaContratacion).getTime()) / (1000 * 60 * 60 * 24);
  const elegible = diasTranscurridos <= DIAS_ARREPENTIMIENTO;

  return {
    encontrado: true,
    email,
    plan: perfil.plan,
    tipoPlan: perfil.tipo_plan,
    fechaContratacion,
    diasTranscurridos: Math.floor(diasTranscurridos),
    elegible,
    nota: elegible
      ? `Dentro de los ${DIAS_ARREPENTIMIENTO} días — corresponde el reembolso completo si lo pide.`
      : `Fuera de los ${DIAS_ARREPENTIMIENTO} días — no corresponde reembolso por derecho de arrepentimiento (puede cancelar la suscripción igual, sin devolución de lo ya pagado).`,
  };
}

if (require.main === module) {
  const email = process.argv[2];
  if (!email) {
    console.error('Uso: node src/scripts/verificarReembolso.js <mail-del-usuario>');
    process.exit(1);
  }
  verificarReembolso(email)
    .then((r) => { console.log(JSON.stringify(r, null, 2)); process.exit(0); })
    .catch((err) => { console.error('❌ Error verificando reembolso:', err); process.exit(1); });
}

module.exports = { verificarReembolso };
