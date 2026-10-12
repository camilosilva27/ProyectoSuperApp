/**
 * Referidos: "invitá a 3 y llevate 2 meses gratis" (.claude/docs/PLAN_REFERIDOS.md).
 *
 * Flujo:
 * 1. Cada usuario tiene un código (`perfil_usuario.codigo_referido`), generado acá la primera vez
 *    que pide su estado — no en el trigger de alta, a propósito (ver migración 0030).
 * 2. La invitada llega con `?ref=CODIGO`, la app lo guarda y, ya con sesión, llama a
 *    `asociarInvitada` (POST /api/referidos/asociar). Queda una fila `referido` en 'pendiente'.
 * 3. Su primera comparación (`registrarComparacion`, llamada desde POST /api/comparar — la del
 *    tutorial alcanza) la pasa a 'valida' si tiene el mail confirmado y está dentro de los 30 días
 *    desde que se registró. Si no comparó a tiempo, queda 'expirada'.
 * 4. Al validarse, se intenta el premio (`otorgar_premio_referido`, SQL, migración 0030): con 3
 *    válidas y sin premio previo, suma 60 días en el mismo momento, y le avisa por mail (+ push)
 *    a quien invitó (`mailPremioReferidos.js`) — el único aviso del programa.
 *
 * Antiabuso mínimo por decisión del usuario (12/10): mail confirmado + una comparación, sin mails
 * descartables, sin la misma casilla de Gmail con otra cuenta, un premio por cuenta y premio
 * revertible a mano. No se guarda IP ni huella de dispositivo.
 *
 * Todas las funciones reciben el cliente de Supabase con service role (bypasea RLS: las tablas de
 * referidos no tienen policies) para poder testearlas con un cliente en memoria.
 */

const crypto = require('crypto');
const { referidos: config } = require('./config');
const { enviarAvisoPremio } = require('./mailPremioReferidos');

const DIA_MS = 24 * 60 * 60 * 1000;

// Sin I, L, O, 0 ni 1: el código se dicta y se copia a mano, no tiene que confundirse.
const ALFABETO_CODIGO = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const LARGO_CODIGO = 6;
// Mismo formato que el check de la columna (0030).
const FORMATO_CODIGO = /^[A-Z0-9]{4,12}$/;

// Los servicios de mail descartable más comunes. No pretende ser exhaustiva (antiabuso mínimo):
// solo frena el atajo obvio de crear 3 cuentas con casillas de 10 minutos.
const DOMINIOS_DESCARTABLES = new Set([
  'mailinator.com', 'mailinator.net', 'yopmail.com', 'yopmail.net', 'guerrillamail.com',
  'guerrillamail.net', 'guerrillamail.org', 'guerrillamailblock.com', 'sharklasers.com',
  'grr.la', 'pokemail.net', 'spam4.me', '10minutemail.com', '10minutemail.net',
  '10minutemail.co.uk', '20minutemail.com', 'temp-mail.org', 'temp-mail.io', 'tempmail.com',
  'tempmail.net', 'tempmailo.com', 'tempail.com', 'tmpmail.org', 'tmpmail.net',
  'throwawaymail.com', 'trashmail.com', 'trashmail.de', 'getnada.com', 'nada.email',
  'dispostable.com', 'maildrop.cc', 'mailnesia.com', 'mintemail.com', 'mohmal.com',
  'emailondeck.com', 'fakeinbox.com', 'mailcatch.com', 'mytemp.email', 'burnermail.io',
  'spamgourmet.com', 'tempinbox.com', 'getairmail.com', 'moakt.com', 'emltmp.com',
  'discard.email', 'inboxkitten.com', 'mail.tm', 'linshiyouxiang.net', 'tempr.email',
]);

function generarCodigo() {
  let codigo = '';
  for (let i = 0; i < LARGO_CODIGO; i++) codigo += ALFABETO_CODIGO[crypto.randomInt(ALFABETO_CODIGO.length)];
  return codigo;
}

/** Código tal como lo guarda la base, o null si no tiene el formato. */
function normalizarCodigo(codigo) {
  if (typeof codigo !== 'string') return null;
  const normal = codigo.trim().toUpperCase();
  return FORMATO_CODIGO.test(normal) ? normal : null;
}

/**
 * La casilla real detrás de un mail: sin `+sufijo` y, en Gmail, sin puntos (`a.b+1@gmail.com`,
 * `ab@googlemail.com` y `ab@gmail.com` llegan al mismo lugar). Sirve para detectar la misma
 * persona con dos cuentas.
 */
function normalizarMail(mail) {
  if (typeof mail !== 'string' || !mail.includes('@')) return null;
  const limpio = mail.trim().toLowerCase();
  const arroba = limpio.lastIndexOf('@');
  let local = limpio.slice(0, arroba);
  let dominio = limpio.slice(arroba + 1);
  local = local.split('+')[0];
  if (dominio === 'googlemail.com') dominio = 'gmail.com';
  if (dominio === 'gmail.com') local = local.replace(/\./g, '');
  if (!local || !dominio) return null;
  return `${local}@${dominio}`;
}

function esMailDescartable(mail) {
  if (typeof mail !== 'string') return false;
  const dominio = mail.trim().toLowerCase().split('@')[1];
  return Boolean(dominio) && DOMINIOS_DESCARTABLES.has(dominio);
}

/**
 * Por qué el premio no aplicaría hoy a este perfil, o null si aplica. Espejo de las reglas de
 * `otorgar_premio_referido()` (0030) — la que manda es la de SQL; esto es solo para que la
 * pantalla pueda avisarlo antes.
 */
function motivoNoAplica(perfil) {
  if (!perfil) return null;
  if (perfil.premium_manual) return 'premium_manual';
  if (perfil.tipo_plan === 'permanente') return 'permanente';
  if (perfil.plan === 'premium' && !perfil.acceso_premium_hasta) return 'suscripcion_activa';
  return null;
}

// --- Cache de "este usuario no tiene un referido pendiente" ------------------------------------
// /api/comparar llama a registrarComparacion en cada comparación: casi todos los usuarios no son
// invitadas pendientes, así que se recuerda el "no" un rato para no consultar la base cada vez.
// asociarInvitada lo borra para ese usuario (puede asociarse después de haber comparado).
const TTL_SIN_PENDIENTE_MS = 6 * 60 * 60 * 1000;
const MAX_SIN_PENDIENTE = 20_000;
const sinReferidoPendiente = new Map();

function recordarSinPendiente(usuarioId, ahora) {
  if (sinReferidoPendiente.size >= MAX_SIN_PENDIENTE) sinReferidoPendiente.clear();
  sinReferidoPendiente.set(usuarioId, ahora.getTime() + TTL_SIN_PENDIENTE_MS);
}

/** Código de referido del usuario; lo crea si todavía no tiene. null si no existe el perfil. */
async function obtenerCodigo(cliente, usuarioId) {
  const { data, error } = await cliente
    .from('perfil_usuario').select('codigo_referido').eq('id', usuarioId).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  if (data.codigo_referido) return data.codigo_referido;

  for (let intento = 0; intento < 5; intento++) {
    const { data: fila, error: errorUpdate } = await cliente
      .from('perfil_usuario')
      .update({ codigo_referido: generarCodigo() })
      .eq('id', usuarioId)
      .is('codigo_referido', null)
      .select('codigo_referido')
      .maybeSingle();
    if (!errorUpdate) {
      if (fila) return fila.codigo_referido;
      // Otro pedido en paralelo lo generó primero: se usa ese.
      const { data: otra, error: errorRelectura } = await cliente
        .from('perfil_usuario').select('codigo_referido').eq('id', usuarioId).maybeSingle();
      if (errorRelectura) throw errorRelectura;
      return otra?.codigo_referido ?? null;
    }
    // 23505 = el código al azar ya lo tiene otro usuario: se prueba con otro.
    if (errorUpdate.code !== '23505') throw errorUpdate;
  }
  throw new Error('No se pudo generar un código de referido único');
}

/**
 * Pasa una invitada pendiente a 'valida' (o 'expirada') según su primera comparación, y si con
 * eso el invitador llega a las necesarias, le da el premio. Devuelve el resultado para logs/tests.
 */
async function validarInvitada(cliente, fila, primeraComparacionEn, ahora) {
  const registradaEn = new Date(fila.registrada_en);
  if (primeraComparacionEn.getTime() - registradaEn.getTime() > config.diasActividad * DIA_MS) {
    await cliente.from('referido').update({ estado: 'expirada' }).eq('id', fila.id).eq('estado', 'pendiente');
    return { resultado: 'expirada' };
  }

  let mailConfirmadoEn = fila.mail_confirmado_en;
  if (!mailConfirmadoEn) {
    // Se guardó al asociar; si en ese momento todavía no había confirmado, se vuelve a mirar.
    const { data: datos, error } = await cliente.auth.admin.getUserById(fila.invitada_id);
    if (error) throw error;
    mailConfirmadoEn = datos?.user?.email_confirmed_at ?? null;
    if (!mailConfirmadoEn) return { resultado: 'sin_mail_confirmado' };
  }

  // Condicionado a 'pendiente': si dos comparaciones llegan juntas, solo una la valida.
  const { data: actualizadas, error: errorUpdate } = await cliente
    .from('referido')
    .update({
      estado: 'valida',
      primera_comparacion_en: primeraComparacionEn.toISOString(),
      mail_confirmado_en: mailConfirmadoEn,
    })
    .eq('id', fila.id)
    .eq('estado', 'pendiente')
    .select('id');
  if (errorUpdate) throw errorUpdate;
  if (!actualizadas?.length) return { resultado: 'ya_resuelta' };

  const { data: premio, error: errorPremio } = await cliente.rpc('otorgar_premio_referido', {
    p_usuario: fila.invitador_id,
    p_necesarias: config.invitadasNecesarias,
    p_dias: config.diasPremio,
  });
  if (errorPremio) throw errorPremio;
  if (premio === 'otorgado' || premio === 'no_aplica') {
    console.log(`Referidos: premio '${premio}' para ${fila.invitador_id} (${ahora.toISOString()})`);
  }
  let aviso;
  if (premio === 'otorgado') {
    // Nunca lanza: si el mail falla, el premio ya está dado y queda `mail_enviado_en` en null.
    aviso = await enviarAvisoPremio(cliente, fila.invitador_id, config.invitadasNecesarias);
    if (!aviso.ok) console.error(`Referidos: no salió el aviso del premio a ${fila.invitador_id}: ${aviso.error}`);
  }
  return { resultado: 'valida', premio, aviso };
}

/**
 * Asocia a la usuaria recién registrada con quien la invitó. Idempotente: si ya estaba asociada
 * (con ese u otro invitador) no cambia nada. Resultados: asociada | descartada | ya_asociada |
 * codigo_invalido | propio | cuenta_vieja | promo_cerrada.
 */
async function asociarInvitada(cliente, { invitadaId, codigo, ahora = new Date() }) {
  const codigoNormal = normalizarCodigo(codigo);
  if (!codigoNormal) return { resultado: 'codigo_invalido' };

  const { data: existente, error: errorExistente } = await cliente
    .from('referido').select('id').eq('invitada_id', invitadaId).maybeSingle();
  if (errorExistente) throw errorExistente;
  if (existente) return { resultado: 'ya_asociada' };

  const { data: invitador, error: errorInvitador } = await cliente
    .from('perfil_usuario').select('id').eq('codigo_referido', codigoNormal).maybeSingle();
  if (errorInvitador) throw errorInvitador;
  if (!invitador) return { resultado: 'codigo_invalido' };
  if (invitador.id === invitadaId) return { resultado: 'propio' };

  const { data: datosInvitada, error: errorInvitada } = await cliente.auth.admin.getUserById(invitadaId);
  if (errorInvitada) throw errorInvitada;
  const invitada = datosInvitada?.user;
  if (!invitada) return { resultado: 'codigo_invalido' };

  const registradaEn = new Date(invitada.created_at);
  // Cuenta toda invitada que se registró antes del corte, aunque se valide después.
  if (registradaEn >= config.fechaCorte) return { resultado: 'promo_cerrada' };
  // Una cuenta vieja no es una invitada nueva (y ya no podría validarse dentro del plazo).
  if (ahora.getTime() - registradaEn.getTime() > config.diasActividad * DIA_MS) {
    return { resultado: 'cuenta_vieja' };
  }

  const mailNormalizado = normalizarMail(invitada.email);
  let motivoDescarte = null;
  if (esMailDescartable(invitada.email)) {
    motivoDescarte = 'mail_descartable';
  } else if (mailNormalizado) {
    const { data: datosInvitador, error: errorDatosInvitador } = await cliente.auth.admin.getUserById(invitador.id);
    if (errorDatosInvitador) throw errorDatosInvitador;
    if (mailNormalizado === normalizarMail(datosInvitador?.user?.email)) {
      motivoDescarte = 'mismo_mail_que_invitador';
    } else {
      const { data: repetidas, error: errorRepetidas } = await cliente
        .from('referido').select('id')
        .eq('invitador_id', invitador.id).eq('mail_normalizado', mailNormalizado).limit(1);
      if (errorRepetidas) throw errorRepetidas;
      if (repetidas?.length) motivoDescarte = 'mail_repetido';
    }
  }

  const { data: fila, error: errorInsert } = await cliente
    .from('referido')
    .insert({
      invitador_id: invitador.id,
      invitada_id: invitadaId,
      registrada_en: registradaEn.toISOString(),
      mail_confirmado_en: invitada.email_confirmed_at ?? null,
      estado: motivoDescarte ? 'descartada' : 'pendiente',
      motivo_descarte: motivoDescarte,
      mail_normalizado: mailNormalizado,
    })
    .select('id, invitador_id, invitada_id, registrada_en, mail_confirmado_en, estado')
    .single();
  if (errorInsert) {
    // 23505: otro pedido la asoció en paralelo (invitada_id es única).
    if (errorInsert.code === '23505') return { resultado: 'ya_asociada' };
    throw errorInsert;
  }
  sinReferidoPendiente.delete(invitadaId);
  if (motivoDescarte) return { resultado: 'descartada' };

  // Respaldo: si ya comparó antes de quedar asociada (ej. el pedido de asociar falló y se
  // reintentó en otra apertura de la app), esa comparación quedó en ahorro_registro — la que
  // escribe la app al ver un resultado. La fuente principal sigue siendo /api/comparar.
  const { data: primera, error: errorPrimera } = await cliente
    .from('ahorro_registro').select('fecha')
    .eq('usuario_id', invitadaId).gte('fecha', registradaEn.toISOString())
    .order('fecha', { ascending: true }).limit(1).maybeSingle();
  if (errorPrimera) throw errorPrimera;
  if (primera) {
    const validacion = await validarInvitada(cliente, fila, new Date(primera.fecha), ahora);
    return { resultado: 'asociada', validacion: validacion.resultado };
  }
  return { resultado: 'asociada' };
}

/** Llamada después de cada comparación exitosa (POST /api/comparar). */
async function registrarComparacion(cliente, usuarioId, ahora = new Date()) {
  const expira = sinReferidoPendiente.get(usuarioId);
  if (expira && expira > ahora.getTime()) return { resultado: 'sin_pendiente' };

  const { data: fila, error } = await cliente
    .from('referido')
    .select('id, invitador_id, invitada_id, registrada_en, mail_confirmado_en, estado')
    .eq('invitada_id', usuarioId)
    .maybeSingle();
  if (error) throw error;
  if (!fila || fila.estado !== 'pendiente') {
    recordarSinPendiente(usuarioId, ahora);
    return { resultado: 'sin_pendiente' };
  }
  const resultado = await validarInvitada(cliente, fila, ahora, ahora);
  if (resultado.resultado !== 'sin_mail_confirmado') recordarSinPendiente(usuarioId, ahora);
  return resultado;
}

/** "María José Pérez" → "María": solo el nombre de pila, nunca apellido ni mail. */
function nombreDePila(nombre) {
  if (typeof nombre !== 'string') return null;
  const primero = nombre.trim().split(/\s+/)[0];
  return primero ? primero.slice(0, 40) : null;
}

/** Lo que necesita la pantalla de referidos (GET /api/referidos). null si no existe el perfil. */
async function estadoDelUsuario(cliente, usuarioId, ahora = new Date()) {
  const codigo = await obtenerCodigo(cliente, usuarioId);
  if (!codigo) return null;

  // Pendientes que ya no pueden validarse (pasaron los 30 días sin comparar).
  const limite = new Date(ahora.getTime() - config.diasActividad * DIA_MS).toISOString();
  const { error: errorExpirar } = await cliente
    .from('referido').update({ estado: 'expirada' })
    .eq('invitador_id', usuarioId).eq('estado', 'pendiente').lt('registrada_en', limite);
  if (errorExpirar) throw errorExpirar;

  const [invitadas, premio, perfil] = await Promise.all([
    cliente.from('referido')
      .select('invitada_id, estado, registrada_en, primera_comparacion_en')
      .eq('invitador_id', usuarioId)
      .order('asociada_en', { ascending: true }),
    cliente.from('premio_referido')
      .select('estado, motivo, otorgado_en, dias, hasta, plan_antes')
      .eq('usuario_id', usuarioId)
      .maybeSingle(),
    cliente.from('perfil_usuario')
      .select('plan, tipo_plan, premium_manual, acceso_premium_hasta')
      .eq('id', usuarioId)
      .maybeSingle(),
  ]);
  for (const r of [invitadas, premio, perfil]) if (r.error) throw r.error;

  const filas = invitadas.data ?? [];
  // Nombre de pila de cada invitada (decisión 12/10: quien invita la conoce). Sale del registro de
  // la otra persona; null si no cargó nombre.
  const nombres = new Map();
  if (filas.length) {
    const { data: perfiles, error: errorNombres } = await cliente
      .from('perfil_usuario').select('id, nombre').in('id', filas.map(f => f.invitada_id));
    if (errorNombres) throw errorNombres;
    for (const p of perfiles ?? []) nombres.set(p.id, nombreDePila(p.nombre));
  }
  return {
    codigo,
    link: `${config.urlApp}/?ref=${codigo}`,
    promoVigente: ahora < config.fechaCorte,
    invitadasNecesarias: config.invitadasNecesarias,
    diasPremio: config.diasPremio,
    validas: filas.filter(f => f.estado === 'valida').length,
    // Solo nombre de pila: nunca apellido ni mail.
    invitadas: filas.map(f => ({
      nombre: nombres.get(f.invitada_id) ?? null,
      estado: f.estado,
      registradaEn: f.registrada_en,
      primeraComparacionEn: f.primera_comparacion_en,
      venceEl: f.estado === 'pendiente'
        ? new Date(new Date(f.registrada_en).getTime() + config.diasActividad * DIA_MS).toISOString()
        : null,
    })),
    premio: premio.data
      ? {
        estado: premio.data.estado,
        motivo: premio.data.motivo,
        otorgadoEn: premio.data.otorgado_en,
        dias: premio.data.dias,
        hasta: premio.data.hasta,
        // 'trial' → se extendió la prueba; 'gratis'/'premium' → quedó premium hasta `hasta`.
        planAntes: premio.data.plan_antes,
      }
      : null,
    motivoNoAplica: premio.data ? null : motivoNoAplica(perfil.data),
  };
}

module.exports = {
  asociarInvitada,
  registrarComparacion,
  estadoDelUsuario,
  obtenerCodigo,
  // Exportadas para tests.
  normalizarCodigo,
  normalizarMail,
  nombreDePila,
  esMailDescartable,
  motivoNoAplica,
  generarCodigo,
  _sinReferidoPendiente: sinReferidoPendiente,
};
