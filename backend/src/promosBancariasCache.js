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
const SUPER_KEYS = ['vea', 'carr', 'changomas', 'dia', 'coto'];

let cacheado = null; // { mtimeMs, data }

// vigenciaDesde/vigenciaHasta son Date en memoria (promos-bancarias.js) pero se serializan
// como string en JSON — promosAplicablesHoy las compara con >=/<=, así que si no se reviven
// acá la comparación queda contra un string y el resultado es basura silenciosa, no un error.
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
  return Object.fromEntries(SUPER_KEYS.map(key => [key, revivir(datosPorSuper[key])]));
}

/**
 * @returns { vea, carr, changomas, dia, coto: {promos,error} } | null si el cron todavía no
 * generó el archivo (server recién levantado, o primer deploy).
 */
function leerPromosBancariasCache() {
  try {
    const { mtimeMs } = fs.statSync(RUTA_ARCHIVO);
    if (cacheado && cacheado.mtimeMs === mtimeMs) return cacheado.data;
    const crudo = JSON.parse(fs.readFileSync(RUTA_ARCHIVO, 'utf8'));
    const data = revivirFechas(crudo.datosPorSuper);
    cacheado = { mtimeMs, data };
    return data;
  } catch {
    return null;
  }
}

/** Para /api/health: cuándo se generó el archivo, para poder marcarlo vencido igual que un catálogo. */
function fechaGeneracionPromosBancarias() {
  try {
    const crudo = JSON.parse(fs.readFileSync(RUTA_ARCHIVO, 'utf8'));
    return crudo.generado ?? null;
  } catch {
    return null;
  }
}

module.exports = { leerPromosBancariasCache, fechaGeneracionPromosBancarias };
