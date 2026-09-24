/**
 * GET /api/health — estado operativo del backend.
 *
 * Existe para detectar sin mirar logs los modos de falla silenciosa del proyecto:
 *   1. Catálogos locales viejos (el scraper dejó de correr o viene fallando) — como
 *      precioCache.js sirve el precio de la app desde esos mismos catalogo-*.json, esto es
 *      directamente "la app muestra precios viejos como vigentes".
 *   2. Fallos de scrapers en GitHub Actions (tabla `scraper_errores` de Supabase).
 *   3. El último post-proceso en la VM falló (unificar, promos bancarias, avisos).
 * Todos se ven igual que "no hay promos hoy" si no se reportan explícitamente.
 *
 * UptimeRobot mira este endpoint con un monitor Keyword: alerta cuando NO aparece `"ok":true`
 * en la respuesta. Por eso `ok` va siempre primero y es `problemas.length === 0` — cualquier
 * cosa que se sume a `problemas` dispara una alerta; lo que es solo informativo va a `avisos`.
 *
 * Cambios de la auditoría 2026-09-24:
 *   - El umbral de antigüedad de catálogo pasó de 30 días a `horasMaximoCatalogo` (12hs, ver
 *     config.js): con scrapers cada 2hs, 30 días dejaba pasar semanas de precio congelado.
 *   - Se leen los fallos recientes de `scraper_errores`: los scrapers corren en GitHub
 *     Actions y registran ahí (registrarError), pero `logs/ultimo-refresco.json` lo escribe el
 *     post-proceso de la VM solo con sus propios errores — antes, un scraper roto nunca
 *     llegaba a health y UptimeRobot no avisaba.
 *   - La respuesta pública ya no expone mensajes de error crudos (stderr de scrapers, errores
 *     de red, cuántos usuarios se avisaron): el detalle completo sigue disponible con el token
 *     de `HEALTH_TOKEN` (header `x-health-token` o `?token=`).
 *
 * (La cookie `vtex_segment` de Vea que podía expirar se sacó del código por completo el
 * 2026-08-20 — ver CONTEXTO_TECNICO.md § "API de Vea". Si el cron de Vea falla hoy, no
 * sospechar de una cookie.)
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const { estadoCatalogos } = require('../../../AllPromos/core/catalogo');
const { leerEstadoUnificado } = require('../catalogoUnificado');
const precioCache = require('../precioCache');
const {
  horasMaximoCatalogo, horasMaximoPromosBancarias, horasVentanaErroresScrapers,
  corridasFallidasParaAlerta, healthToken, rutaLogs, entorno,
} = require('../config');
const sondaEnVivo = require('../sondaEnVivo');
const { fechaGeneracionPromosBancarias } = require('../promosBancariasCache');
const { clienteSupabaseAdmin } = require('../clienteSupabaseAdmin');

const router = express.Router();

function leerLog(nombre) {
  try {
    return JSON.parse(fs.readFileSync(path.join(rutaLogs, nombre), 'utf8'));
  } catch {
    return null;
  }
}

// --- scraper_errores (Supabase) ---------------------------------------------------------------
//
// Cacheado en memoria unos minutos: UptimeRobot pega cada 5 min y no hace falta una query a
// Supabase por ping (los scrapers corren cada 2hs, el dato no cambia más rápido que eso).
const TTL_ERRORES_SCRAPERS_MS = 5 * 60 * 1000;
const TIMEOUT_CONSULTA_SUPABASE_MS = 5000;
let cacheErroresScrapers = null; // { expira, valor: { filas, error, configurado } }

async function erroresRecientesScrapers() {
  const ahora = Date.now();
  if (cacheErroresScrapers && cacheErroresScrapers.expira > ahora) return cacheErroresScrapers.valor;

  const supabaseAdmin = clienteSupabaseAdmin();
  let valor;
  if (!supabaseAdmin) {
    // Entorno local sin credenciales: no se puede saber, pero tampoco es un problema de prod.
    valor = { configurado: false, filas: [], error: null };
  } else {
    try {
      const desde = new Date(ahora - horasVentanaErroresScrapers * 3_600_000).toISOString();
      const { data, error } = await supabaseAdmin
        .from('scraper_errores')
        .select('super, etapa, script, corrida_en, mensaje')
        .gte('corrida_en', desde)
        .order('corrida_en', { ascending: false })
        .limit(200)
        .abortSignal(AbortSignal.timeout(TIMEOUT_CONSULTA_SUPABASE_MS));
      valor = error
        ? { configurado: true, filas: [], error: error.message || String(error) }
        : { configurado: true, filas: data ?? [], error: null };
    } catch (err) {
      valor = { configurado: true, filas: [], error: err.message || String(err) };
    }
  }
  cacheErroresScrapers = { expira: ahora + TTL_ERRORES_SCRAPERS_MS, valor };
  return valor;
}

/**
 * Agrupa las filas de scraper_errores por (super, etapa) y decide si cada grupo es un problema
 * real o solo un aviso. Para `etapa: 'scraper'` se descartan los fallos anteriores a la última
 * escritura exitosa del catálogo de ese super (la `fecha` de catalogo-X.json es posterior al
 * `corrida_en` del fallo = ya se recuperó en una corrida posterior).
 */
function evaluarFallosScrapers(filas, catalogos) {
  const fechaCatalogoPorSuper = new Map(catalogos.map(c => [c.key, c.fecha ? new Date(c.fecha).getTime() : 0]));
  const grupos = new Map();
  for (const f of filas) {
    const clave = `${f.super}|${f.etapa}`;
    if (!grupos.has(clave)) grupos.set(clave, { super: f.super, etapa: f.etapa, script: f.script, corridas: new Set(), ultimo: f });
    const corridaMs = new Date(f.corrida_en).getTime();
    if (f.etapa === 'scraper' && corridaMs < (fechaCatalogoPorSuper.get(f.super) ?? 0)) continue;
    grupos.get(clave).corridas.add(f.corrida_en);
  }
  return [...grupos.values()]
    .filter(g => g.corridas.size > 0)
    .map(g => ({
      super: g.super,
      etapa: g.etapa,
      script: g.script,
      corridasFallidas: g.corridas.size,
      ultimaCorridaFallida: g.ultimo.corrida_en,
      ultimoMensaje: g.ultimo.mensaje,
      esProblema: g.corridas.size >= corridasFallidasParaAlerta,
    }));
}

function tokenValido(req) {
  if (!healthToken) return false;
  const recibido = req.get('x-health-token') || (typeof req.query.token === 'string' ? req.query.token : '');
  const a = Buffer.from(recibido);
  const b = Buffer.from(healthToken);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

router.get('/health', async (req, res) => {
  const detallado = tokenValido(req);
  const catalogos = estadoCatalogos({ diasMaximo: horasMaximoCatalogo / 24 }).map(c => ({
    ...c,
    horas: c.fecha ? Math.round(((Date.now() - new Date(c.fecha).getTime()) / 3_600_000) * 10) / 10 : null,
  }));
  const unificado = leerEstadoUnificado();
  const ultimoRefresco = leerLog('ultimo-refresco.json');
  const ultimoDescubrimiento = leerLog('ultimo-descubrimiento.json');
  const ultimoPingSupabase = leerLog('ultimo-ping-supabase.json');
  const sonda = sondaEnVivo.estadoActual();
  const generadoPromosBancarias = fechaGeneracionPromosBancarias();
  const horasPromosBancarias = generadoPromosBancarias
    ? (Date.now() - new Date(generadoPromosBancarias).getTime()) / 3_600_000
    : null;
  const erroresScrapers = await erroresRecientesScrapers();
  const fallosScrapers = evaluarFallosScrapers(erroresScrapers.filas, catalogos);

  // Cada entrada tiene un texto público (sin mensajes crudos de errores internos) y, cuando
  // aplica, un detalle que solo se muestra con token.
  const problemas = [];
  const avisos = [];
  const agregar = (lista, publico, detalle = null) => lista.push({ publico, detalle });

  for (const c of catalogos) {
    if (!c.disponible) agregar(problemas, `Falta ${c.archivo}`, `generalo con: node ${c.scraper}`);
    else if (c.vencido) agregar(problemas, `${c.archivo} tiene ${c.horas}hs (máximo ${horasMaximoCatalogo}hs) — precios desactualizados`, `regeneralo con: node ${c.scraper}`);
  }
  if (!unificado.disponible) {
    agregar(problemas, 'Falta catalogo-unificado.json', 'generalo con: npm run unificar');
  }
  for (const f of fallosScrapers) {
    const texto = `${f.etapa === 'extra' ? 'Refresco de extras' : 'Scraper'} de ${f.super} falló en ${f.corridasFallidas} corrida(s) seguida(s) en las últimas ${horasVentanaErroresScrapers}hs`;
    agregar(f.esProblema ? problemas : avisos, texto, `${f.script} @ ${f.ultimaCorridaFallida}: ${f.ultimoMensaje?.slice(0, 500)}`);
  }
  if (erroresScrapers.error) {
    agregar(problemas, 'No se pudo consultar el historial de fallos de scrapers (Supabase)', erroresScrapers.error);
  }
  if (ultimoRefresco?.errores?.length) {
    agregar(problemas, `El último post-proceso de catálogos terminó con ${ultimoRefresco.errores.length} error(es)`, ultimoRefresco.errores.join(' | '));
  }
  if (ultimoDescubrimiento?.errores?.length) {
    agregar(problemas, `El último descubrimiento de candidatos terminó con ${ultimoDescubrimiento.errores.length} error(es)`, ultimoDescubrimiento.errores.join(' | '));
  }
  if (ultimoPingSupabase?.errores?.length) {
    agregar(problemas, `El último ping a Supabase terminó con ${ultimoPingSupabase.errores.length} error(es)`, ultimoPingSupabase.errores.join(' | '));
  }
  const diasSinPingSupabase = ultimoPingSupabase
    ? (Date.now() - new Date(ultimoPingSupabase.fin).getTime()) / 86_400_000
    : null;
  // Margen sobre el límite real de 7 días del free tier: si a los 10 días no hubo un ping OK,
  // el cron semanal dejó de correr (o viene fallando) y el proyecto puede pausarse solo.
  if (diasSinPingSupabase === null) {
    agregar(problemas, 'Nunca corrió el ping a Supabase — el free tier puede pausarse por inactividad', 'correlo con: npm run ping-supabase');
  } else if (diasSinPingSupabase > 10) {
    agregar(problemas, `Último ping a Supabase hace ${diasSinPingSupabase.toFixed(1)} días — riesgo de pausa por inactividad`, 'correlo con: npm run ping-supabase');
  }
  if (sonda.error) {
    agregar(problemas, 'La sonda en vivo no pudo correr', sonda.error);
  }
  if (sonda.resultados) {
    for (const [key, r] of Object.entries(sonda.resultados)) {
      if (!r.ok) agregar(problemas, `Comparación en vivo de ${r.nombre} sin resultados para el EAN de prueba (${key}) — puede estar rota`);
    }
  }
  if (!generadoPromosBancarias) {
    agregar(problemas, 'Falta logs/promos-bancarias.json', 'el cron todavía no lo generó, o se perdió (correlo con: npm run refrescar)');
  } else if (horasPromosBancarias > horasMaximoPromosBancarias) {
    agregar(problemas, `promos-bancarias.json tiene ${horasPromosBancarias.toFixed(1)}hs — puede mostrar promos del día equivocado`, 'regeneralo con: npm run refrescar');
  }

  const ok = problemas.length === 0;
  const aTexto = e => (detallado && e.detalle ? `${e.publico} — ${e.detalle}` : e.publico);

  // Respuesta pública: solo lo necesario para saber si está sano y qué está mal, sin volcados
  // de errores internos. `ok` primero: es lo que busca el monitor Keyword de UptimeRobot.
  const publico = {
    ok,
    ahora: new Date().toISOString(),
    catalogos: catalogos.map(({ key, archivo, fecha, horas, totalSkus, disponible, vencido }) => ({
      key, archivo, fecha, horas, totalSkus, disponible, vencido,
    })),
    catalogoUnificado: { disponible: unificado.disponible, generado: unificado.generado ?? null, total: unificado.total ?? null },
    promosBancarias: { generado: generadoPromosBancarias, horas: horasPromosBancarias },
    sondaEnVivo: {
      ultimaCorrida: sonda.ultimaCorrida,
      resultados: sonda.resultados,
      ok: !sonda.error && Object.values(sonda.resultados ?? {}).every(r => r.ok),
    },
    problemas: problemas.map(aTexto),
    avisos: avisos.map(aTexto),
  };
  if (!detallado) return res.json(publico);

  res.json({
    ...publico,
    entorno,
    catalogos,
    catalogoUnificado: unificado,
    // Misma fecha que ya reportan `catalogos[].vencido` arriba (es la fuente de
    // precioCache.js) — se repite acá para ver de un vistazo si /comparar y /precios están
    // sirviendo precio de hace 1 hora o de hace 3 semanas, sin tener que cruzar campos.
    cachePrecio: { fuentes: precioCache.estadoFuentes() },
    erroresScrapers: { ventanaHoras: horasVentanaErroresScrapers, ...erroresScrapers, evaluacion: fallosScrapers },
    ultimoRefresco,
    ultimoDescubrimiento,
    ultimoPingSupabase,
    sondaEnVivo: sonda,
  });
});

module.exports = router;
