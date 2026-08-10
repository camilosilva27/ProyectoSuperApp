/**
 * Consultas en vivo a las APIs VTEX de Vea, Carrefour y Chango Más.
 * Precio y promo SIEMPRE salen de acá, nunca del catálogo local (ver ../CLAUDE.md).
 *
 * Extraído de buscar-promos.js sin cambiar comportamiento, con un único cambio de firma:
 * `tarjetas` (qué tarjetas tiene el usuario) ahora se pasa por parámetro en vez de leerse
 * de mis-tarjetas.json a nivel de módulo. Motivo: el backend recibe la lista en cada
 * request (cada teléfono de la familia puede tener tarjetas distintas), mientras el CLI
 * sigue leyendo el archivo y pasándolo explícitamente.
 */

const {
  interpretarPromoPorTexto,
  interpretarPromoCarrefour,
  interpretarTeaserTarjetaPropia,
} = require('../promo-engine');
const { skuIdVeaPorEAN } = require('./catalogo');

const VEA_SEGMENT = 'eyJjYW1wYWlnbnMiOm51bGwsImNoYW5uZWwiOiIzNCIsInByaWNlVGFibGVzIjpudWxsLCJyZWdpb25JZCI6IlUxY2phblZ0WW05aGNtZGxiblJwYm1GMk1UWXliSFZxWVc0PSIsInV0bV9jYW1wYWlnbiI6bnVsbCwidXRtX3NvdXJjZSI6bnVsbCwidXRtaV9jYW1wYWlnbiI6bnVsbCwiY3VycmVuY3lDb2RlIjoiQVJTIiwiY3VycmVuY3lTeW1ib2wiOiIkIiwiY291bnRyeUNvZGUiOiJBUkciLCJjdWx0dXJlSW5mbyI6ImVzLUFSIiwiYWRtaW5fY3VsdHVyZUluZm8iOiJlcy1BUiIsImNoYW5uZWxQcml2YWN5IjoicHVibGljIn0';
const VEA_SELLER = 'jumboargentinav700cordoba700';

// Chango Más migró su web a masonline.com.ar (changomas.com.ar redirige ahí).
// A diferencia de Vea, no encontramos evidencia de precios específicos por sucursal:
// el mismo skuId devuelve el mismo precio para regiones distintas bajo sc=1/seller "1"
// (ver CONTEXTO_TECNICO.md). Se trata como catálogo nacional único, igual que Carrefour.
const CHANGOMAS_HOST   = 'https://www.masonline.com.ar';
const CHANGOMAS_SELLER = '1';

const SUPERMERCADOS = [
  { key: 'vea',       nombre: 'Vea',        tag: '🟢' },
  { key: 'carr',      nombre: 'Carrefour',  tag: '🔵' },
  { key: 'changomas', nombre: 'Chango Más', tag: '🟣' },
];

// ─── Live: Carrefour ──────────────────────────────────────────────────────────

function parsearProductosCarrefour(products, { tarjetas = [] } = {}) {
  const resultados = [];
  for (const p of products) {
    for (const sku of p.items || []) {
      const offer = sku.sellers?.[0]?.commertialOffer;
      if (!offer) continue;
      const price     = offer.Price     || 0;
      const listPrice = offer.ListPrice || 0;

      if (listPrice > 0 && price < listPrice) {
        resultados.push({
          super: 'Carrefour',
          productName: p.productName, skuName: sku.name, ean: sku.ean,
          precioBase: listPrice,
          promo: interpretarPromoPorTexto('', (1 - price / listPrice).toFixed(4)),
        });
      }

      const teasersInternos = (offer.Teasers || []).filter(t => {
        const n = (t['<Name>k__BackingField'] || '').toLowerCase();
        return !n.includes('tarjeta') && !n.includes('cuenta digital') && !n.includes('banco');
      });

      for (const t of teasersInternos) {
        const promo = interpretarPromoCarrefour({ nombre: t['<Name>k__BackingField'] || '' });
        if (promo) {
          resultados.push({
            super: 'Carrefour',
            productName: p.productName, skuName: sku.name, ean: sku.ean,
            precioBase: price, promo,
          });
        }
      }

      // Promo por producto condicionada a tarjeta propia (tipo 1, Fase 3): el teaser
      // "Tarjeta Carrefour X%" existe en casi todos los productos (confirmado en vivo,
      // ~mismo BIN/% en decenas de categorías). Solo se agrega como candidato si el
      // usuario tiene "Mi Carrefour" entre sus tarjetas — si no, ni se calcula (4.1).
      if (tarjetas.includes('Mi Carrefour')) {
        const teaserTarjetaPropia = (offer.Teasers || []).find(t =>
          (t['<Name>k__BackingField'] || '').toLowerCase().includes('tarjeta carrefour')
        );
        const promo = teaserTarjetaPropia && interpretarTeaserTarjetaPropia(teaserTarjetaPropia, 'Mi Carrefour');
        if (promo) {
          resultados.push({
            super: 'Carrefour',
            productName: p.productName, skuName: sku.name, ean: sku.ean,
            precioBase: price, promo,
          });
        }
      }

      if (price > 0 && (!listPrice || price >= listPrice) && teasersInternos.length === 0) {
        resultados.push({
          super: 'Carrefour',
          productName: p.productName, skuName: sku.name, ean: sku.ean,
          precioBase: price, promo: null,
        });
      }
    }
  }
  return resultados;
}

async function carrefourLiveEAN(ean, opciones = {}) {
  const res = await fetch(
    `https://www.carrefour.com.ar/api/catalog_system/pub/products/search?fq=alternateIds_Ean:${ean}&sc=1`,
    { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' } }
  );
  return res.ok ? parsearProductosCarrefour(await res.json(), opciones) : [];
}

async function carrefourLiveNombre(nombre, opciones = {}) {
  const res = await fetch(
    `https://www.carrefour.com.ar/api/catalog_system/pub/products/search?fq=productName:${encodeURIComponent(nombre)}&_from=0&_to=9&sc=1`,
    { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' } }
  );
  return res.ok ? parsearProductosCarrefour(await res.json(), opciones) : [];
}

// ─── Live: Chango Más ─────────────────────────────────────────────────────────
// Misma forma que Carrefour: descuento directo embebido (Price < ListPrice) confirmado
// en vivo. No se encontró ningún ejemplo real de Teasers/PromotionTeasers al escanear
// ~450 productos de categorías comunes — se deja el parseo por si aparece más adelante,
// pero no está verificado en producción (ver CONTEXTO_TECNICO.md).
function parsearProductosChangoMas(products) {
  const resultados = [];
  for (const p of products) {
    for (const sku of p.items || []) {
      const offer = sku.sellers?.find(s => s.sellerId === CHANGOMAS_SELLER)?.commertialOffer
        || sku.sellers?.[0]?.commertialOffer;
      if (!offer) continue;
      const price     = offer.Price     || 0;
      const listPrice = offer.ListPrice || 0;

      if (listPrice > 0 && price < listPrice) {
        resultados.push({
          super: 'Chango Más',
          productName: p.productName, skuName: sku.name, ean: sku.ean,
          precioBase: listPrice,
          promo: interpretarPromoPorTexto('', (1 - price / listPrice).toFixed(4)),
        });
      }

      const teasersInternos = [...(offer.Teasers || []), ...(offer.PromotionTeasers || [])]
        .map(t => ({ nombre: t['<Name>k__BackingField'] ?? t.Name ?? t.name ?? '' }))
        .filter(t => t.nombre && !/tarjeta|cuenta digital|banco/i.test(t.nombre));

      for (const t of teasersInternos) {
        const promo = interpretarPromoCarrefour(t);
        if (promo) {
          resultados.push({
            super: 'Chango Más',
            productName: p.productName, skuName: sku.name, ean: sku.ean,
            precioBase: price, promo,
          });
        }
      }

      if (price > 0 && (!listPrice || price >= listPrice) && teasersInternos.length === 0) {
        resultados.push({
          super: 'Chango Más',
          productName: p.productName, skuName: sku.name, ean: sku.ean,
          precioBase: price, promo: null,
        });
      }
    }
  }
  return resultados;
}

async function changoMasLiveEAN(ean) {
  const res = await fetch(
    `${CHANGOMAS_HOST}/api/catalog_system/pub/products/search?fq=alternateIds_Ean:${ean}&sc=1`,
    { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' } }
  );
  return res.ok ? parsearProductosChangoMas(await res.json()) : [];
}

async function changoMasLiveNombre(nombre) {
  const res = await fetch(
    `${CHANGOMAS_HOST}/api/catalog_system/pub/products/search?fq=productName:${encodeURIComponent(nombre)}&_from=0&_to=9&sc=1`,
    { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' } }
  );
  return res.ok ? parsearProductosChangoMas(await res.json()) : [];
}

// ─── Live: Vea ────────────────────────────────────────────────────────────────

// La API de Vea devuelve seller "1" en vez de VEA_SELLER sin importar el método de búsqueda
// (skuId, EAN o nombre — confirmado en vivo, no es solo un caso de skuId). Y el precio no
// varía por región: comparamos el mismo producto con sesiones armadas para Luján, Córdoba y
// La Plata y dio idéntico en los 5 casos probados (ver CONTEXTO_TECNICO.md) — sc=34 no es "el
// canal de Luján", es el único canal activo que encontramos en vea.com.ar. Por eso preferimos
// VEA_SELLER cuando aparece, pero NUNCA lo exigimos como condición excluyente — antes esto
// rechazaba resultados válidos (ej. "Detergente En Polvo X 1 Kg Finish Classic", que existe en
// Vea pero se descartaba porque exigíamos el seller exacto) en el fallback en vivo por nombre
// y en la búsqueda por EAN sin catálogo local.
async function parsearProductosVea(products) {
  const candidatos = [];
  for (const p of products) {
    for (const sku of p.items || []) {
      const sellerInfo = sku.sellers?.find(s => s.sellerId === VEA_SELLER) || sku.sellers?.[0];
      if (!sellerInfo) continue;
      candidatos.push({
        skuId: sku.itemId,
        productName: p.productName, skuName: sku.name, ean: sku.ean,
        price: sellerInfo.commertialOffer?.Price || 0,
      });
    }
  }
  if (!candidatos.length) return [];

  const promoRes = await fetch('https://www.vea.com.ar/_v/search-promotions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Cookie': `vtex_segment=${VEA_SEGMENT}` },
    body: JSON.stringify({ seller: VEA_SELLER, skus: candidatos.map(s => s.skuId) }),
  });
  const promos = promoRes.ok
    ? ((await promoRes.json()).promotions?.generic?.promotions || {})
    : {};

  return candidatos.filter(s => s.price > 0).map(s => {
    const promo = promos[s.skuId];
    return {
      super: 'Vea',
      productName: s.productName, skuName: s.skuName, ean: s.ean,
      precioBase: s.price,
      promo: promo ? interpretarPromoPorTexto(promo.name, promo.effectiveDiscount) : null,
    };
  });
}

/**
 * Consulta Vea en vivo.
 * Usa skuId (más fiable) si está disponible, si no cae a búsqueda por EAN.
 */
async function veaLive(ean, skuIdVea = null) {
  const query = skuIdVea ? `fq=skuId:${skuIdVea}` : `fq=alternateIds_Ean:${ean}`;
  const res = await fetch(
    `https://www.vea.com.ar/api/catalog_system/pub/products/search?${query}&sc=34`,
    { headers: { 'Cookie': `vtex_segment=${VEA_SEGMENT}`, Accept: 'application/json' } }
  );
  return res.ok ? parsearProductosVea(await res.json()) : [];
}

async function veaLiveNombre(nombre) {
  const res = await fetch(
    `https://www.vea.com.ar/api/catalog_system/pub/products/search?fq=productName:${encodeURIComponent(nombre)}&_from=0&_to=9&sc=34`,
    { headers: { 'Cookie': `vtex_segment=${VEA_SEGMENT}`, Accept: 'application/json' } }
  );
  return res.ok ? parsearProductosVea(await res.json()) : [];
}

// ─── Orquestación ─────────────────────────────────────────────────────────────

/**
 * Precios en vivo de un EAN en los 3 supers, en paralelo.
 * @param {string} ean
 * @param {object} opciones
 * @param {string[]} opciones.tarjetas   tarjetas del usuario (habilita promos de tarjeta propia)
 * @param {string|null} opciones.skuIdVea  si ya se conoce, evita releer el catálogo de Vea.
 *                                         Si se omite, se resuelve desde el catálogo local.
 * @returns {{ vea: [], carr: [], changomas: [] }}
 */
async function buscarPorEAN(ean, { tarjetas = [], skuIdVea } = {}) {
  const sku = skuIdVea === undefined ? skuIdVeaPorEAN(ean) : skuIdVea;
  const [vea, carr, changomas] = await Promise.all([
    veaLive(ean, sku),
    carrefourLiveEAN(ean, { tarjetas }),
    changoMasLiveEAN(ean),
  ]);
  return { vea, carr, changomas };
}

/** Fallback: búsqueda por nombre directo en las 3 APIs (menos confiable que por EAN). */
async function buscarPorNombreEnVivo(nombre, { tarjetas = [] } = {}) {
  const [vea, carr, changomas] = await Promise.all([
    veaLiveNombre(nombre),
    carrefourLiveNombre(nombre, { tarjetas }),
    changoMasLiveNombre(nombre),
  ]);
  return { vea, carr, changomas };
}

module.exports = {
  VEA_SEGMENT,
  VEA_SELLER,
  CHANGOMAS_HOST,
  CHANGOMAS_SELLER,
  SUPERMERCADOS,
  parsearProductosCarrefour,
  parsearProductosChangoMas,
  parsearProductosVea,
  carrefourLiveEAN,
  carrefourLiveNombre,
  changoMasLiveEAN,
  changoMasLiveNombre,
  veaLive,
  veaLiveNombre,
  buscarPorEAN,
  buscarPorNombreEnVivo,
};
