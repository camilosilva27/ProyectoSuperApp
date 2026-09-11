/**
 * Aviso de "promo nueva" para productos que el usuario sigue (ver
 * .claude/docs/mails_y_notificaciones.md, tipo #8, y supabase/migrations/0016_producto_seguido.sql
 * / 0017_alertas_resumen_y_categorias.sql).
 *
 * Lo dispara refrescarCatalogos.js al final de cada corrida (cada 1-2hs), con el estado ACTUAL
 * de promo por EAN de esa corrida (ver `estadoPromoPorEan` en cron/diffCatalogos.js) — no es un
 * cron aparte, es un paso más del mismo refresco, igual que registrarDiff.
 *
 * Push y mail salen juntos, en el momento, agrupados en un solo envío por usuario (no uno por
 * producto) — a propósito NO es un resumen diario: si un producto que seguís se prende a las
 * 14hs, te enterás en la corrida de las 14hs, no al otro día. Ambos canales respetan el único
 * interruptor "Recibir notificaciones" (`perfil_usuario.alertas_activas`, diseño 20a/20c) — no
 * hay opción de activar uno sin el otro.
 *
 * Idempotencia por (usuario, producto): `producto_seguido.huella_promo_avisada` guarda la
 * huella de la última promo de la que ya se avisó a ESE usuario por ESE producto — no un estado
 * global. Esto es lo que resuelve el caso de alguien que empieza a seguir un producto que YA
 * tenía promo activa: como nunca se le avisó nada (huella_promo_avisada arranca en null), la
 * primera corrida después de seguirlo ya dispara el aviso, aunque a nivel global esa promo no
 * sea "nueva". Si la promo se apaga, se resetea a null para que la próxima vez que se prenda
 * vuelva a avisar.
 */

const { clienteSupabaseAdmin } = require('./clienteSupabaseAdmin');
const { listarTodosLosUsuarios } = require('./usuariosAuth');
const { enviarMail } = require('./clienteBrevo');
const { armarMailBase, URL_APP } = require('./plantillaMail');
const { obtenerSuscripcionesPorUsuario, enviarPush } = require('./clientePush');

function formatoArs(monto) {
  return Number(monto).toLocaleString('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });
}

function armarHtml({ nombreUsuario, productos }) {
  const saludo = nombreUsuario ? `Hola ${nombreUsuario},` : 'Hola,';
  const items = productos
    .map(p => {
      const chip = p.descuentoPct
        ? `<span style="display:inline-block; background:#FFD400; color:#14161A; font-weight:700; padding:2px 8px; border-radius:5px; font-size:13px;">${p.descuentoPct}%</span> `
        : '';
      const precio = p.precioFinal ? formatoArs(p.precioFinal) : '';
      return `<li style="margin-bottom:8px;">${p.nombre} — <strong>${p.super}</strong>${chip || precio ? ` · ${chip}${precio}` : ''}</li>`;
    })
    .join('');

  const cuerpo = `
    <p style="margin:0 0 16px 0;">${saludo}</p>
    <p style="margin:0 0 16px 0;">Le apareció una promoción a ${productos.length === 1 ? 'un producto que seguís' : 'productos que seguís'}:</p>
    <ul style="margin:0 0 16px 0; padding-left:20px;">${items}</ul>
    <p style="margin:0;">Abrí Super App para ver el detalle y comparar contra el resto de los supermercados.</p>
  `;

  return armarMailBase({
    preheader: 'Le apareció una promoción a un producto que seguís en Super App.',
    titulo: productos.length === 1 ? '¡Nueva promoción!' : `¡${productos.length} nuevas promociones!`,
    cuerpoHtml: cuerpo,
    cta: { texto: 'Ver en Super App', url: `${URL_APP}/alertas` },
  });
}

// Un solo push por corrida, aunque el usuario tenga varios productos con promo nueva a la vez.
function armarPush(productos) {
  if (productos.length === 1) {
    const p = productos[0];
    const detalle = p.descuentoPct
      ? `${p.nombre} tiene ${p.descuentoPct}% off en ${p.super}`
      : `${p.nombre} tiene una promo nueva en ${p.super}`;
    return { title: 'Super App', body: detalle, url: `${URL_APP}/alertas` };
  }
  return {
    title: 'Super App',
    body: `${productos.length} productos que seguís tienen una promo nueva`,
    url: `${URL_APP}/alertas`,
  };
}

/**
 * @param {Map<string, {ean: string, nombre: string, categoria: string|null, super: string, huella: string, descuentoPct: number|null, precioFinal: number|null}>} estadoActualPromoPorEan -
 *   estado ACTUAL (no un diff) de qué EAN tienen promo de producto en esta corrida, ver
 *   `estadoPromoPorEan` en cron/diffCatalogos.js.
 */
async function avisarProductosSeguidos(estadoActualPromoPorEan) {
  const cliente = clienteSupabaseAdmin();
  if (!cliente) return { avisados: 0, errores: ['Falta SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY'] };

  const { data: seguidos, error } = await cliente
    .from('producto_seguido')
    .select('id, usuario_id, ean, huella_promo_avisada');
  if (error) return { avisados: 0, errores: [`No se pudo leer producto_seguido: ${error.message}`] };
  if (!seguidos?.length) return { avisados: 0, errores: [] };

  const errores = [];
  const usuarioIds = [...new Set(seguidos.map(f => f.usuario_id))];
  const [{ data: perfiles, error: errorPerfiles }, listaUsuarios, suscripcionesPush] = await Promise.all([
    cliente.from('perfil_usuario').select('id, nombre, alertas_activas').in('id', usuarioIds),
    listarTodosLosUsuarios(cliente).catch(err => {
      errores.push(`No se pudo listar usuarios: ${err.message}`);
      return [];
    }),
    obtenerSuscripcionesPorUsuario(cliente).catch(() => new Map()),
  ]);
  if (errorPerfiles) return { avisados: 0, errores: [...errores, `No se pudo leer perfil_usuario: ${errorPerfiles.message}`] };

  const emailPorId = new Map(listaUsuarios.map(u => [u.id, u.email]));
  const perfilPorId = new Map((perfiles ?? []).map(p => [p.id, p]));

  const porUsuario = new Map(); // usuarioId -> productos a avisar en esta corrida
  const actualizacionesHuella = []; // { id, huella_promo_avisada }

  for (const fila of seguidos) {
    const actual = estadoActualPromoPorEan.get(fila.ean);
    if (actual) {
      if (actual.huella === fila.huella_promo_avisada) continue; // ya se avisó de esta misma promo
      // Con el interruptor apagado no se marca como avisado — si el usuario lo reactiva más
      // adelante, la promo que siga vigente en ese momento todavía le tiene que llegar.
      if (perfilPorId.get(fila.usuario_id)?.alertas_activas === false) continue;
      const lista = porUsuario.get(fila.usuario_id) ?? [];
      lista.push(actual);
      porUsuario.set(fila.usuario_id, lista);
      actualizacionesHuella.push({ id: fila.id, huella_promo_avisada: actual.huella });
    } else if (fila.huella_promo_avisada !== null) {
      // La promo que tenía esta fila se apagó: resetear para que la próxima vez que se
      // prenda (sea la misma promo u otra) vuelva a disparar el aviso. Esto no depende del
      // interruptor: es solo bookkeeping de que ya no hay nada vigente de qué avisar.
      actualizacionesHuella.push({ id: fila.id, huella_promo_avisada: null });
    }
  }

  // Guarda el estado ANTES de mandar mail/push: si el envío falla a mitad de camino, es mejor
  // perder un aviso puntual que reenviar el mismo para siempre en cada corrida.
  for (const u of actualizacionesHuella) {
    const { error: errorUpdate } = await cliente
      .from('producto_seguido')
      .update({ huella_promo_avisada: u.huella_promo_avisada })
      .eq('id', u.id);
    if (errorUpdate) errores.push(`No se pudo actualizar huella_promo_avisada de ${u.id}: ${errorUpdate.message}`);
  }

  let avisados = 0;

  for (const [usuarioId, productos] of porUsuario) {
    const perfil = perfilPorId.get(usuarioId);

    const resultadoPush = await enviarPush(cliente, suscripcionesPush.get(usuarioId) ?? [], armarPush(productos));
    errores.push(...resultadoPush.errores);

    const email = emailPorId.get(usuarioId);
    if (!email) {
      errores.push(`Usuario ${usuarioId} sin mail en auth.users — omitido del mail (push sí se mandó)`);
    } else {
      const resultadoMail = await enviarMail({
        destinatarioEmail: email,
        destinatarioNombre: perfil?.nombre,
        asunto: productos.length === 1 ? '¡Nueva promoción en un producto que seguís!' : `¡${productos.length} nuevas promociones en productos que seguís!`,
        html: armarHtml({ nombreUsuario: perfil?.nombre, productos }),
      });
      if (!resultadoMail.ok) errores.push(`Mail a ${email}: ${resultadoMail.error}`);
    }

    avisados++;
  }

  return { avisados, errores };
}

module.exports = { avisarProductosSeguidos };
