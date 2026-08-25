/**
 * Catálogo local: resolución nombre → EAN (+ skuId de Vea) y estado de frescura.
 *
 * INVARIANTE (ver ../CLAUDE.md): los precios NUNCA salen del catálogo local. Los archivos
 * catalogo-*.json sí traen campos `precioBase`/`precioActual`/`promocion` de la fecha del
 * scraping, pero este módulo jamás los expone — solo devuelve identidad del producto
 * (ean, nombre, skuId de Vea, categoría). Cualquier consumidor que necesite precio tiene
 * que pedirlo en vivo vía core/fetchers.js.
 *
 * Extraído de buscar-promos.js sin cambiar comportamiento, para que el CLI y el backend
 * compartan la misma lógica en vez de duplicarla.
 */

const fs   = require('fs');
const path = require('path');

const DIR_DATOS = path.join(__dirname, '..');

const CATALOGOS = [
  { key: 'vea',       archivo: 'catalogo-vea.json',       scraper: 'scraper-promos-vea.js' },
  { key: 'carrefour', archivo: 'catalogo-carrefour.json', scraper: 'scraper-promos-carrefour.js' },
  { key: 'changomas', archivo: 'catalogo-changomas.json', scraper: 'scraper-promos-changomas.js' },
  { key: 'dia',       archivo: 'catalogo-dia.json',       scraper: 'scraper-promos-dia.js' },
  { key: 'coto',      archivo: 'catalogo-coto.json',      scraper: 'scraper-coto-por-ean.js' },
  { key: 'jumbo',     archivo: 'catalogo-jumbo.json',     scraper: 'scraper-promos-jumbo.js' },
  { key: 'disco',     archivo: 'catalogo-disco.json',     scraper: 'scraper-promos-disco.js' },
];

// ─── Utils de texto ───────────────────────────────────────────────────────────

function normalize(str) {
  return str.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// Unidades pegadas al número: "357g" → "357", "400ml" → "400"
// Solo aplica si el número tiene 2+ dígitos para evitar ambigüedad ("1" solo es muy genérico)
const UNIDADES_RE = /^(\d{2,}\.?\d*)(g|gr|grs|kg|ml|cc|l|lt|lts|un|u|unid)$/i;

function matchesBusqueda(productName, skuName, palabras) {
  const haystack = normalize((productName || '') + ' ' + (skuName || ''));
  return palabras.every(p => {
    if (haystack.includes(p)) return true;
    const m = p.match(UNIDADES_RE);
    return m ? haystack.includes(m[1]) : false;
  });
}

function esEANvalido(str) {
  return /^\d{8,14}$/.test(str.trim());
}

/** Texto libre → palabras normalizadas, listo para matchesBusqueda/resolverEANporNombre. */
function palabrasDeBusqueda(texto) {
  return normalize(texto).split(/\s+/).filter(Boolean);
}

// ─── Lectura de catálogos (con caché por mtime) ────────────────────────────────
// El CLI leía cada catálogo de disco en cada llamada (1.2-1.7 MB × 3 por búsqueda). Para
// el CLI da igual, pero el backend resuelve muchas búsquedas por proceso, así que cacheamos
// en memoria y revalidamos por mtime — así el cron que regenera los catálogos se refleja
// sin reiniciar el servidor, y el comportamiento observable no cambia.

const cache = new Map(); // archivo → { mtimeMs, data }

function leerCatalogo(archivo) {
  const ruta = path.join(DIR_DATOS, archivo);
  try {
    const { mtimeMs } = fs.statSync(ruta);
    const guardado = cache.get(archivo);
    if (guardado && guardado.mtimeMs === mtimeMs) return guardado.data;
    const data = JSON.parse(fs.readFileSync(ruta, 'utf8'));
    cache.set(archivo, { mtimeMs, data });
    return data;
  } catch {
    return null;
  }
}

function skusDe(archivo) {
  const data = leerCatalogo(archivo);
  return Array.isArray(data?.skus) ? data.skus : [];
}

/**
 * Estado de frescura de los 3 catálogos. Devuelve datos, no imprime — el CLI decide cómo
 * avisar por consola y el backend lo expone en /api/health.
 * @returns [{ key, archivo, scraper, fecha, dias, totalSkus, disponible, vencido }]
 */
function estadoCatalogos({ diasMaximo = 30 } = {}) {
  return CATALOGOS.map(({ key, archivo, scraper }) => {
    const data = leerCatalogo(archivo);
    if (!data) {
      return { key, archivo, scraper, fecha: null, dias: null, totalSkus: 0, disponible: false, vencido: true };
    }
    const dias = (Date.now() - new Date(data.fecha)) / (1000 * 60 * 60 * 24);
    return {
      key, archivo, scraper,
      fecha: data.fecha ?? null,
      dias: Math.round(dias),
      totalSkus: Array.isArray(data.skus) ? data.skus.length : 0,
      disponible: true,
      vencido: dias > diasMaximo,
    };
  });
}

// ─── Resolución nombre → EAN ──────────────────────────────────────────────────

/**
 * Busca en el catálogo local por palabras clave y devuelve candidatos únicos por EAN.
 * Incluye el skuId de Vea cuando el producto está en el catálogo de Vea,
 * porque la API de Vea responde mejor por skuId que por EAN.
 *
 * El orden de las fuentes importa y no debe cambiarse: Vea primero para capturar su skuId,
 * después Carrefour y Chango Más solo para EANs que Vea no tenga.
 *
 * @returns [{ ean, productName, skuName, skuIdVea }]
 */
function resolverEANporNombre(palabras) {
  const vistos = new Map(); // ean → { productName, skuName, skuIdVea }

  // Primero Vea: así capturamos el skuId cuando el producto está en Vea
  for (const s of skusDe('catalogo-vea.json')) {
    if (!s.ean || vistos.has(s.ean)) continue;
    if (matchesBusqueda(s.productName, s.skuName, palabras)) {
      vistos.set(s.ean, { productName: s.productName, skuName: s.skuName, skuIdVea: s.skuId });
    }
  }

  // Luego el resto: agregan EANs que no estén ya vistos (skuIdVea = null).
  for (const archivo of ['catalogo-carrefour.json', 'catalogo-changomas.json', 'catalogo-dia.json', 'catalogo-coto.json', 'catalogo-jumbo.json', 'catalogo-disco.json']) {
    for (const s of skusDe(archivo)) {
      if (!s.ean || vistos.has(s.ean)) continue;
      if (matchesBusqueda(s.productName, s.skuName, palabras)) {
        vistos.set(s.ean, { productName: s.productName, skuName: s.skuName, skuIdVea: null });
      }
    }
  }

  return [...vistos.entries()].map(([ean, info]) => ({ ean, ...info }));
}

/** Busca en el catálogo de Vea el skuId para un EAN dado (para búsqueda directa por EAN). */
function skuIdVeaPorEAN(ean) {
  return skusDe('catalogo-vea.json').find(s => s.ean === ean)?.skuId ?? null;
}

module.exports = {
  CATALOGOS,
  DIR_DATOS,
  normalize,
  UNIDADES_RE,
  matchesBusqueda,
  esEANvalido,
  palabrasDeBusqueda,
  leerCatalogo,
  skusDe,
  estadoCatalogos,
  resolverEANporNombre,
  skuIdVeaPorEAN,
};
