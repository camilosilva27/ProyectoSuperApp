/**
 * Lector con caché por mtime de rutaLogs/promos-bancarias.json — el archivo que persiste
 * backend/src/cron/refrescarCatalogos.js (refrescarPromosBancarias()) con las promos
 * bancarias crudas de los 5 supers cubiertos (TODAS las tarjetas conocidas, sin filtrar por
 * usuario). Mismo patrón que AllPromos/core/catalogo.js (leerCatalogo): cachea en memoria y
 * revalida por mtime, así el cron se refleja sin reiniciar el server.
 *
 * Deliberado: este módulo NUNCA pega en vivo a los supers. Antes /api/mis-descuentos tenía su
 * propio cache TTL-en-memoria que sí hacía el fetch dentro del camino de request (tolerable
 * ahí por ser una pantalla poco visitada) — /api/comparar es el endpoint más caliente del
 * backend, así que ese patrón no es aceptable acá. Ver refrescarCatalogos.js para el porqué.
 */

const fs = require('fs');
const path = require('path');
const { rutaLogs } = require('./config');

const RUTA_ARCHIVO = path.join(rutaLogs, 'promos-bancarias.json');

let cacheado = null; // { mtimeMs, data, generado }

// vigenciaDesde/vigenciaHasta son Date en memoria (promos-bancarias.js) pero se serializan
// como string en JSON — promosAplicablesHoy las compara con >=/<=, así que si no se reviven
// acá la comparación queda contra un string y el resultado es basura silenciosa, no un error.
//
// Genérico sobre las keys que trae `datosPorSuper` (antes era una lista fija SUPER_KEYS de 5
// supers) para que un super nuevo no se quede afuera en silencio — pasó exactamente eso con
// Jumbo/Disco (2026-08-21): el archivo en disco ya los traía, pero esta función los tiraba
// acá antes de que /api/mis-descuentos llegara a verlos. Mismo tipo de bug ya encontrado en
// promos-bancarias.js (filtrarPromosBancariasPorTarjetas) y precioCache.js (FUENTES).
function revivirFechas(datosPorSuper) {
  const revivir = resultado => {
    if (!resultado || resultado.error) return resultado;
    return {
      ...resultado,
      promos: resultado.promos.map(p => ({
        ...p,
        vigenciaDesde: new Date(p.vigenciaDesde),
        vigenciaHasta: new Date(p.vigenciaHasta),
      })),
    };
  };
  return Object.fromEntries(Object.entries(datosPorSuper).map(([key, resultado]) => [key, revivir(resultado)]));
}

/**
 * @returns mismas keys que trae el archivo en disco (cada una {promos,error}), o null si el
 * cron todavía no generó el archivo (server recién levantado, o primer deploy).
 *
 * Si el archivo existe pero no se puede leer/parsear (2026-09-24, auditoría: antes el cron lo
 * escribía sin tmp+rename y un request justo en ese momento veía un JSON truncado), se devuelve
 * el ÚLTIMO valor bueno ya cacheado en vez de null — null hacía que /api/comparar avisara "el
 * cache de promos bancarias todavía no está listo" y comparara sin descuentos bancarios. La
 * escritura ya es atómica (refrescarCatalogos.js), esto queda como segunda red.
 */
function leerPromosBancariasCache() {
  try {
    const { mtimeMs } = fs.statSync(RUTA_ARCHIVO);
    if (cacheado && cacheado.mtimeMs === mtimeMs) return cacheado.data;
    const crudo = JSON.parse(fs.readFileSync(RUTA_ARCHIVO, 'utf8'));
    const data = revivirFechas(crudo.datosPorSuper);
    cacheado = { mtimeMs, data, generado: crudo.generado ?? null };
    return data;
  } catch {
    return cacheado?.data ?? null;
  }
}

/**
 * Para /api/health: cuándo se generó el archivo, para poder marcarlo vencido igual que un
 * catálogo. Reusa el mismo caché por mtime de arriba — antes hacía un JSON.parse completo del
 * archivo (varios cientos de KB) en cada ping de UptimeRobot.
 */
function fechaGeneracionPromosBancarias() {
  leerPromosBancariasCache();
  return cacheado?.generado ?? null;
}

module.exports = { leerPromosBancariasCache, fechaGeneracionPromosBancarias };
