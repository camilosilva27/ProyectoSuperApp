/**
 * Índice de precio+promo derivado de catalogo-{vea,carrefour,changomas,dia,coto,laanonima}.json
 * — los mismos archivos que ya escriben los scrapers diarios, que además del EAN/nombre YA traen
 * precio y promo capturados (`descuentoDirecto`/`promosInternas`/`promosBancarias`/`promocion`
 * según el super). Antes se descartaban a propósito para el precio (ver unificarCatalogo.js);
 * acá se usan como la fuente primaria de /api/comparar y /api/precios, refrescada por el cron
 * cada 1-2 hs en vez de en cada request de usuario.
 *
 * La Anónima es un caso aparte: no tiene EAN propio, así que solo entra acá el subconjunto que
 * enriquecer-catalogo-laanonima.js pudo emparejar por nombre contra otro super (ver su cabecera
 * y AllPromos/core/catalogo.js) — el resto de su catálogo queda fuera del índice por EAN, como
 * cualquier producto "fuera del recorte" de cualquier otro super (mismo criterio ya documentado
 * abajo). El gate de cobertura por CP del usuario NO vive acá — este módulo es agnóstico de
 * usuario/request, el filtro de "¿tiene cobertura este CP?" se resuelve en comparar.js.
 *
 * Por qué: antes, cada comparación pegaba en vivo a los 5 supers en el momento del request.
 * Con tráfico concurrente eso multiplica conexiones contra Carrefour/Chango Más, que ya
 * rate-limitean con uso normal de una sola familia (ver sondaEnVivo.js, comparar.js). Leer de
 * acá saca ese fetch del camino común: el volumen hacia los supers pasa a depender solo del
 * cron, nunca de cuántos usuarios comparan a la vez.
 *
 * No reinterpreta promociones por su cuenta: traduce la forma ya calculada por cada scraper a
 * la misma forma que devuelven los parsers en vivo de AllPromos/core/fetchers.js, llamando a
 * las mismas funciones de promo-engine.js (interpretarPromoPorTexto/interpretarPromoCarrefour/
 * interpretarTeaserTarjetaPropia). Así no hay una segunda lógica de cálculo de promos que
 * pueda divergir de la que ya usan la CLI y el fetch en vivo — solo una traducción de forma.
 *
 * Producto no encontrado acá (EAN fuera del recorte de ~2550 SKUs que captura cada scraper,
 * ver AllPromos/CLAUDE.md) es responsabilidad de quien llama: cae al fallback en vivo angosto
 * (ver comparar.js + limitadorGlobal.js), esto solo expone lo que SÍ está cacheado.
 */

const { leerCatalogo } = require('../../AllPromos/core/catalogo');
const {
  interpretarPromoPorTexto, interpretarPromoCarrefour, interpretarTeaserTarjetaPropia,
} = require('../../AllPromos/promo-engine');

const FUENTES = [
  { key: 'vea', archivo: 'catalogo-vea.json', nombre: 'Vea' },
  { key: 'carr', archivo: 'catalogo-carrefour.json', nombre: 'Carrefour' },
  { key: 'changomas', archivo: 'catalogo-changomas.json', nombre: 'Chango Más' },
  { key: 'dia', archivo: 'catalogo-dia.json', nombre: 'Día' },
  { key: 'coto', archivo: 'catalogo-coto.json', nombre: 'Coto' },
  { key: 'laanonima', archivo: 'catalogo-laanonima.json', nombre: 'La Anónima' },
];

// Único teaser de "tarjeta propia" que interpreta hoy el fetch en vivo (ver
// TARJETAS_QUE_AFECTAN_PRODUCTO en comparar.js) — se busca por nombre en promosBancarias
// igual que fetchers.js lo busca por nombre en los Teasers crudos de VTEX.
const NOMBRE_TARJETA_PROPIA = 'tarjeta carrefour';

/** Vea: un solo precio y una sola promo (opcional) por SKU — ver catalogo-vea.json. */
function entradasVea(sku) {
  const resultados = [{
    super: 'Vea', skuId: sku.skuId, sellerId: sku.seller ?? '1',
    productName: sku.productName, skuName: sku.skuName, ean: sku.ean,
    precioBase: sku.precioBase,
    promo: sku.promocion
      ? interpretarPromoPorTexto(sku.promocion.nombre, sku.promocion.descuento)
      : null,
  }];
  return resultados;
}

/**
 * Carrefour/Chango Más/Día comparten forma en el catálogo (descuentoDirecto/promosInternas/
 * promosBancarias) — misma lógica de reconstrucción para los tres, solo cambia el nombre del
 * super y si corresponde buscar el teaser de tarjeta propia (solo Carrefour la tiene hoy).
 */
function entradasVtexConTeasers(sku, superNombre, { conTarjetaPropia = false } = {}) {
  const resultados = [];
  const base = {
    super: superNombre, skuId: sku.skuId, sellerId: sku.seller ?? '1',
    productName: sku.productName, skuName: sku.skuName, ean: sku.ean,
  };

  if (sku.descuentoDirecto) {
    resultados.push({
      ...base,
      precioBase: sku.descuentoDirecto.precioBase,
      promo: interpretarPromoPorTexto('', sku.descuentoDirecto.descuento),
    });
  }

  for (const t of sku.promosInternas || []) {
    const promo = interpretarPromoCarrefour({ nombre: t.nombre });
    if (promo) resultados.push({ ...base, precioBase: sku.precioActual, promo });
  }

  if (conTarjetaPropia) {
    const teaserTarjeta = (sku.promosBancarias || [])
      .find(t => (t.nombre || '').toLowerCase().includes(NOMBRE_TARJETA_PROPIA));
    if (teaserTarjeta) {
      // Reconstruye el mismo teaser crudo que espera interpretarTeaserTarjetaPropia, con el
      // único dato que necesita (el % ya extraído por el scraper) — no duplica su lógica.
      const promo = interpretarTeaserTarjetaPropia({
        '<Effects>k__BackingField': {
          '<Parameters>k__BackingField': [
            { '<Name>k__BackingField': 'PercentualDiscount', '<Value>k__BackingField': teaserTarjeta.descuentoPct },
          ],
        },
      }, 'Mi Carrefour');
      if (promo) resultados.push({ ...base, precioBase: sku.precioActual, promo });
    }
  }

  if (!resultados.length) {
    resultados.push({ ...base, precioBase: sku.precioActual, promo: null });
  }

  return resultados;
}

/** Coto: no es VTEX, no tiene skuId/sellerId comparable, ni teaser de tarjeta propia. */
function entradasCoto(sku) {
  const resultados = [];
  const base = { super: 'Coto', skuId: null, sellerId: null, productName: sku.nombre, skuName: null, ean: sku.ean };

  if (sku.descuentoDirecto) {
    resultados.push({
      ...base,
      precioBase: sku.descuentoDirecto.precioBase,
      promo: interpretarPromoPorTexto('', sku.descuentoDirecto.descuento),
    });
  }

  for (const t of sku.promosInternas || []) {
    const promo = interpretarPromoPorTexto(t.nombre);
    if (promo) resultados.push({ ...base, precioBase: sku.precioBase, promo });
  }

  if (!resultados.length) {
    resultados.push({ ...base, precioBase: sku.precioBase, promo: null });
  }

  return resultados;
}

/** La Anónima: un solo precio y una sola promo (opcional) por SKU — sin skuId/sellerId (no
 *  es VTEX) y sin promos internas condicionales detectadas en el scraping (ver cabecera de
 *  scraper-promos-laanonima.js). */
function entradasLaAnonima(sku) {
  return [{
    super: 'La Anónima', skuId: null, sellerId: null,
    productName: sku.nombre, skuName: null, ean: sku.ean,
    precioBase: sku.precioBase,
    promo: sku.descuentoDirecto
      ? interpretarPromoPorTexto('', sku.descuentoDirecto.descuento)
      : null,
  }];
}

function entradasDe(key, sku) {
  if (key === 'vea') return entradasVea(sku);
  if (key === 'coto') return entradasCoto(sku);
  if (key === 'laanonima') return entradasLaAnonima(sku);
  return entradasVtexConTeasers(sku, FUENTES.find(f => f.key === key).nombre, { conTarjetaPropia: key === 'carr' });
}

let indice = null; // Map<ean, { vea:[], carr:[], changomas:[], dia:[], coto:[], laanonima:[] }>
let datosVistos = {}; // key -> referencia al objeto que devolvió leerCatalogo la última vez
let fechasPorFuente = {}; // key -> `fecha` del catalogo-*.json usado para construir el índice

function construirIndice() {
  const nuevoIndice = new Map();
  const nuevasFechas = {};

  for (const { key, archivo } of FUENTES) {
    const data = leerCatalogo(archivo);
    nuevasFechas[key] = data?.fecha ?? null;
    if (!data || !Array.isArray(data.skus)) continue;

    for (const sku of data.skus) {
      if (!sku.ean) continue;
      if (!nuevoIndice.has(sku.ean)) {
        nuevoIndice.set(sku.ean, { vea: [], carr: [], changomas: [], dia: [], coto: [], laanonima: [] });
      }
      nuevoIndice.get(sku.ean)[key].push(...entradasDe(key, sku));
    }
  }

  indice = nuevoIndice;
  fechasPorFuente = nuevasFechas;
}

/** true si alguno de los 5 catalogo-*.json cambió de identidad desde la última vez que se
 *  construyó el índice (leerCatalogo ya cachea por mtime y devuelve el mismo objeto si no
 *  cambió — comparar por referencia evita reconstruir el índice en cada request). */
function huboCambios() {
  let cambio = indice === null;
  for (const { key, archivo } of FUENTES) {
    const data = leerCatalogo(archivo);
    if (datosVistos[key] !== data) cambio = true;
    datosVistos[key] = data;
  }
  return cambio;
}

function asegurarIndice() {
  if (huboCambios()) construirIndice();
}

/**
 * Precio+promo cacheados para un EAN, misma forma que buscarPorEAN() en vivo. `null` si el
 * EAN no está en ninguno de los 5 catálogos (fuera del recorte capturado por los scrapers) —
 * quien llama decide si eso amerita un fallback en vivo.
 */
function precioPorEAN(ean) {
  asegurarIndice();
  return indice.get(ean) || null;
}

/** Fecha de generación de cada fuente — para /api/health, así se ve de un vistazo si el
 *  cron de precios dejó de correr sin tener que ir a mirar logs. */
function estadoFuentes() {
  asegurarIndice();
  return FUENTES.map(({ key, archivo, nombre }) => ({ key, archivo, nombre, fecha: fechasPorFuente[key] }));
}

module.exports = { precioPorEAN, estadoFuentes };
