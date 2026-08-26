/**
 * GET /api/health — estado operativo del backend.
 *
 * Existe para detectar sin mirar logs los dos modos de falla silenciosa del proyecto:
 *   1. Catálogos locales vencidos (el scraper dejó de correr).
 *   2. El último refresco del cron falló (el sha256Hash de las queries GraphQL de promos
 *      bancarias quedó desactualizado, u otro error del scraper).
 * Ambos se ven igual que "no hay promos hoy" si no se reportan explícitamente.
 *
 * (Ya no aplica como causa de (2): la cookie `vtex_segment` de Vea que podía expirar se sacó
 * del código por completo el 2026-08-20 — ver CONTEXTO_TECNICO.md § "API de Vea". Si el cron
 * de Vea falla hoy, no sospechar de una cookie.)
 *
 * No requiere token: es el endpoint que se usa para verificar que el server está vivo.
 */

const fs = require('fs');
const express = require('express');
const { estadoCatalogos } = require('../../../AllPromos/core/catalogo');
const { leerEstadoUnificado } = require('../catalogoUnificado');
const precioCache = require('../precioCache');
const { diasMaximoCatalogo, horasMaximoPromosBancarias, rutaLogs, entorno } = require('../config');
const sondaEnVivo = require('../sondaEnVivo');
const { fechaGeneracionPromosBancarias } = require('../promosBancariasCache');
const path = require('path');

const router = express.Router();

function leerUltimoRefresco() {
  try {
    return JSON.parse(fs.readFileSync(path.join(rutaLogs, 'ultimo-refresco.json'), 'utf8'));
  } catch {
    return null;
  }
}

// Descubrimiento de candidatos nuevos por EAN (mensual, ver
// backend/src/cron/descubrirCandidatosExtras.js) — separado de ultimoRefresco porque corre en
// un cron distinto y mucho menos frecuente; no reportarlo acá haría que un fallo quedara
// invisible hasta que alguien lo notara a mano.
function leerUltimoDescubrimiento() {
  try {
    return JSON.parse(fs.readFileSync(path.join(rutaLogs, 'ultimo-descubrimiento.json'), 'utf8'));
  } catch {
    return null;
  }
}

// Ping semanal a Supabase (ver src/cron/pingSupabase.js) — evita que el free tier pause el
// proyecto tras 7 días sin actividad. Si esto deja de correr, el síntoma real sería la app
// entera sin poder loguear/leer datos de cuenta, mucho más grave que un catálogo vencido — por
// eso vale la pena verlo acá aunque el cron sea semanal, no cada 2hs como el resto.
function leerUltimoPingSupabase() {
  try {
    return JSON.parse(fs.readFileSync(path.join(rutaLogs, 'ultimo-ping-supabase.json'), 'utf8'));
  } catch {
    return null;
  }
}

router.get('/health', (req, res) => {
  const catalogos = estadoCatalogos({ diasMaximo: diasMaximoCatalogo });
  const unificado = leerEstadoUnificado();
  const ultimoRefresco = leerUltimoRefresco();
  const ultimoDescubrimiento = leerUltimoDescubrimiento();
  const ultimoPingSupabase = leerUltimoPingSupabase();
  const sonda = sondaEnVivo.estadoActual();
  const generadoPromosBancarias = fechaGeneracionPromosBancarias();
  const horasPromosBancarias = generadoPromosBancarias
    ? (Date.now() - new Date(generadoPromosBancarias).getTime()) / 3_600_000
    : null;

  const problemas = [];
  for (const c of catalogos) {
    if (!c.disponible) problemas.push(`Falta ${c.archivo} — generalo con: node ${c.scraper}`);
    else if (c.vencido) problemas.push(`${c.archivo} tiene ${c.dias} dias — regeneralo con: node ${c.scraper}`);
  }
  if (!unificado.disponible) {
    problemas.push('Falta catalogo-unificado.json — generalo con: npm run unificar');
  }
  if (ultimoRefresco?.errores?.length) {
    problemas.push(...ultimoRefresco.errores);
  }
  if (ultimoDescubrimiento?.errores?.length) {
    problemas.push(...ultimoDescubrimiento.errores);
  }
  if (ultimoPingSupabase?.errores?.length) {
    problemas.push(...ultimoPingSupabase.errores);
  }
  const diasSinPingSupabase = ultimoPingSupabase
    ? (Date.now() - new Date(ultimoPingSupabase.fin).getTime()) / 86_400_000
    : null;
  // Margen sobre el límite real de 7 días del free tier: si a los 10 días no hubo un ping OK,
  // el cron semanal dejó de correr (o viene fallando) y el proyecto puede pausarse solo.
  if (diasSinPingSupabase === null) {
    problemas.push('Nunca corrió el ping a Supabase — el free tier puede pausarse por inactividad (correlo con: npm run ping-supabase)');
  } else if (diasSinPingSupabase > 10) {
    problemas.push(`Último ping a Supabase hace ${diasSinPingSupabase.toFixed(1)} días — riesgo de pausa por inactividad (correlo con: npm run ping-supabase)`);
  }
  if (sonda.error) {
    problemas.push(`Sonda en vivo no pudo correr: ${sonda.error}`);
  }
  if (sonda.resultados) {
    for (const [key, r] of Object.entries(sonda.resultados)) {
      if (!r.ok) problemas.push(`Comparación en vivo de ${r.nombre} sin resultados para el EAN de prueba (${key}) — puede estar rota`);
    }
  }
  if (!generadoPromosBancarias) {
    problemas.push('Falta logs/promos-bancarias.json — el cron todavía no lo generó, o se perdió (correlo con: npm run refrescar)');
  } else if (horasPromosBancarias > horasMaximoPromosBancarias) {
    problemas.push(`logs/promos-bancarias.json tiene ${horasPromosBancarias.toFixed(1)}hs — como estas promos son día-específicas, un cache viejo puede mostrar el día equivocado (regeneralo con: npm run refrescar)`);
  }

  res.json({
    ok: problemas.length === 0,
    entorno,
    ahora: new Date().toISOString(),
    catalogos,
    catalogoUnificado: unificado,
    // Misma fecha que ya reportan `catalogos[].vencido` arriba (es la fuente de
    // precioCache.js) — se repite acá para ver de un vistazo si /comparar y /precios están
    // sirviendo precio de hace 1 hora o de hace 3 semanas, sin tener que cruzar campos.
    cachePrecio: { fuentes: precioCache.estadoFuentes() },
    promosBancarias: { generado: generadoPromosBancarias, horas: horasPromosBancarias },
    ultimoRefresco,
    ultimoDescubrimiento,
    ultimoPingSupabase,
    sondaEnVivo: sonda,
    problemas,
  });
});

module.exports = router;
