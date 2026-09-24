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
 *
 * Elegibilidad (auditoría 2026-09-24 — antes no filtraba nada): solo se avisa a quien tiene la
 * app habilitada (`tienePlanActivo`: premium o trial vigente), tanto por push como por mail; un
 * usuario en 'gratis' / trial vencido no puede abrir la app sin pagar, así que el aviso no le
 * sirve. Igual que con el interruptor apagado, a ese usuario NO se le actualiza la huella: si
 * paga más adelante, la promo que siga vigente le llega. El mail además exige mail confirmado
 * (`emailConfirmado`, mismo criterio que los demás crons); el push no (sin confirmar el mail no
 * hay forma de loguearse y suscribir push, así que en la práctica no pasa).
 */

const { clienteSupabaseAdmin } = require('./clienteSupabaseAdmin');
const { listarTodosLosUsuarios, tienePlanActivo, leerTodasLasFilas } = require('./usuariosAuth');
const { enviarMail } = require('./clienteBrevo');
const { armarMailBase, escaparHtml, URL_APP } = require('./plantillaMail');
const { esHuellaVigente } = require('./cron/diffCatalogos');
const { obtenerSuscripcionesPorUsuario, enviarPush } = require('./clientePush');

function formatoArs(monto) {
  return Number(monto).toLocaleString('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });
}

function armarHtml({ nombreUsuario, productos }) {
  const saludo = nombreUsuario ? `Hola ${escaparHtml(nombreUsuario)},` : 'Hola,';
  const items = productos
    .map(p => {
      const chip = p.descuentoPct
        ? `<span style="display:inline-block; background:#FFD400; color:#14161A; font-weight:700; padding:2px 8px; border-radius:5px; font-size:13px;">${escaparHtml(p.descuentoPct)}%</span> `
        : '';
      const precio = p.precioFinal ? formatoArs(p.precioFinal) : '';
      // nombre viene scrapeado del super (y super es nuestro, pero se escapa igual por las dudas).
      return `<li style="margin-bottom:8px;">${escaparHtml(p.nombre)} — <strong>${escaparHtml(p.super)}</strong>${chip || precio ? ` · ${chip}${precio}` : ''}</li>`;
    })
    .join('');

  const cuerpo = `
    <p style="margin:0 0 16px 0;">${saludo}</p>
    <p style="margin:0 0 16px 0;">Le apareció una promoción a ${productos.length === 1 ? 'un producto que seguís' : 'productos que seguís'}:</p>
    <ul style="margin:0 0 16px 0; padding-left:20px;">${items}</ul>
    <p style="margin:0;">Abrí SuperAhorro para ver el detalle y comparar contra el resto de los supermercados.</p>
  `;

  return armarMailBase({
    preheader: 'Le apareció una promoción a un producto que seguís en SuperAhorro.',
    titulo: productos.length === 1 ? '¡Nueva promoción!' : `¡${productos.length} nuevas promociones!`,
    cuerpoHtml: cuerpo,
    cta: { texto: 'Ver en SuperAhorro', url: `${URL_APP}/alertas` },
    footerTexto: 'Recibís este mail porque seguís productos en Alertas de SuperAhorro. Podés apagar los avisos desde la pestaña Alertas.',
    noTransaccional: true,
  });
}

// Un solo push por corrida, aunque el usuario tenga varios productos con promo nueva a la vez.
function armarPush(productos) {
  if (productos.length === 1) {
    const p = productos[0];
    const detalle = p.descuentoPct
      ? `${p.nombre} tiene ${p.descuentoPct}% off en ${p.super}`
      : `${p.nombre} tiene una promo nueva en ${p.super}`;
    return { title: 'SuperAhorro', body: detalle, url: `${URL_APP}/alertas` };
  }
  return {
    title: 'SuperAhorro',
    body: `${productos.length} productos que seguís tienen una promo nueva`,
    url: `${URL_APP}/alertas`,
  };
}

/**
 * Decide, por cada fila de producto_seguido, si hay que avisar y qué huella guardar. Pura (sin
 * red) para poder testearla — ver backend/test/avisosMail.test.js.
 */
function clasificarSeguidos(seguidos, estadoActualPromoPorEan, perfilPorId, ahora = Date.now()) {
  const porUsuario = new Map(); // usuarioId -> productos a avisar en esta corrida
  const actualizacionesHuella = []; // { id, huella_promo_avisada }

  for (const fila of seguidos) {
    const actual = estadoActualPromoPorEan.get(fila.ean);
    if (actual) {
      if (actual.huella === fila.huella_promo_avisada) continue; // ya se avisó de esta misma promo
      // Huella guardada con el formato viejo (pre-auditoría 2026-09-24, incluía precio y
      // bancarias): ya se le avisó de ALGO en este producto y la promo sigue activa. Se reescribe
      // al formato nuevo sin avisar — si no, el primer deploy re-avisaba a todos de golpe. Costo
      // aceptado: si justo esa promo vieja fue reemplazada por otra distinta, esa se pierde una vez.
      if (fila.huella_promo_avisada !== null && !esHuellaVigente(fila.huella_promo_avisada)) {
        actualizacionesHuella.push({ id: fila.id, huella_promo_avisada: actual.huella });
        continue;
      }
      const perfil = perfilPorId.get(fila.usuario_id);
      // Con el interruptor apagado o sin plan activo no se marca como avisado — si el usuario lo
      // reactiva / paga más adelante, la promo que siga vigente en ese momento le tiene que llegar.
      if (perfil?.alertas_activas === false) continue;
      if (!tienePlanActivo(perfil, ahora)) continue;
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

  return { porUsuario, actualizacionesHuella };
}

/**
 * @param {Map<string, {ean: string, nombre: string, categoria: string|null, super: string, huella: string, descuentoPct: number|null, precioFinal: number|null}>} estadoActualPromoPorEan -
 *   estado ACTUAL (no un diff) de qué EAN tienen promo de producto en esta corrida, ver
 *   `estadoPromoPorEan` en cron/diffCatalogos.js.
 */
async function avisarProductosSeguidos(estadoActualPromoPorEan) {
  const cliente = clienteSupabaseAdmin();
  if (!cliente) return { avisados: 0, errores: ['Falta SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY'] };

  // Paginado: tope de 20 por usuario, pero con 50+ usuarios ya se pasa de las 1000 filas que
  // devuelve PostgREST por respuesta.
  const { data: seguidos, error } = await leerTodasLasFilas(() =>
    cliente.from('producto_seguido').select('id, usuario_id, ean, huella_promo_avisada').order('id')
  );
  if (error) return { avisados: 0, errores: [`No se pudo leer producto_seguido: ${error.message}`] };
  if (!seguidos?.length) return { avisados: 0, errores: [] };

  const errores = [];
  const usuarioIds = [...new Set(seguidos.map(f => f.usuario_id))];
  const [{ data: perfiles, error: errorPerfiles }, listaUsuarios, suscripcionesPush] = await Promise.all([
    leerTodasLasFilas(() =>
      cliente.from('perfil_usuario').select('id, nombre, alertas_activas, plan, trial_termina_en').in('id', usuarioIds).order('id')
    ),
    listarTodosLosUsuarios(cliente).catch(err => {
      errores.push(`No se pudo listar usuarios: ${err.message}`);
      return [];
    }),
    obtenerSuscripcionesPorUsuario(cliente).catch(() => new Map()),
  ]);
  if (errorPerfiles) return { avisados: 0, errores: [...errores, `No se pudo leer perfil_usuario: ${errorPerfiles.message}`] };

  const emailPorId = new Map(listaUsuarios.map(u => [u.id, u.email]));
  const confirmadoPorId = new Map(listaUsuarios.map(u => [u.id, u.emailConfirmado]));
  const ahora = Date.now();
  const perfilPorId = new Map((perfiles ?? []).map(p => [p.id, p]));

  const { porUsuario, actualizacionesHuella } = clasificarSeguidos(seguidos, estadoActualPromoPorEan, perfilPorId, ahora);

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
    } else if (!confirmadoPorId.get(usuarioId)) {
      // Mail sin confirmar: no se le manda mail (ver fix-crons-mail-sin-confirmar); el push sí.
    } else {
      const resultadoMail = await enviarMail({
        destinatarioEmail: email,
        destinatarioNombre: perfil?.nombre,
        asunto: productos.length === 1 ? '¡Nueva promoción en un producto que seguís!' : `¡${productos.length} nuevas promociones en productos que seguís!`,
        html: armarHtml({ nombreUsuario: perfil?.nombre, productos }),
        noTransaccional: true,
      });
      // Se loguea el id, no el mail: este reporte termina en logs/archivos de la VM.
      if (!resultadoMail.ok) errores.push(`Mail a usuario ${usuarioId}: ${resultadoMail.error}`);
    }

    avisados++;
  }

  return { avisados, errores };
}

module.exports = { avisarProductosSeguidos, clasificarSeguidos, armarHtml };
