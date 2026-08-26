/**
 * Refresca precio+promo de los productos que YA están en catalogo-disco-extras.json (los que
 * encontró completar-disco-por-ean.js), SIN volver a buscar candidatos nuevos.
 * Ver refrescar-precio-extras-carrefour.js (por qué) y refrescar-precio-extras-vea.js (promo
 * aparte, mismo esquema que Disco por compartir cuenta VTEX) para el detalle completo.
 *
 * Uso: node refrescar-precio-extras-disco.js
 */

const fs = require('fs');
const { escribirAtomico } = require('./core/escrituraAtomica');
const https = require('https');
const { buscarPorSkuIds } = require('./core/batchPorSkuId');

const PROMO_SELLER = 'discoargentinav700cordoba700';
const BASE_URL = 'https://www.disco.com.ar';
const RUTA_EXTRAS = './catalogo-disco-extras.json';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
  'Accept': 'application/json',
};

const AGENTE_SIN_KEEPALIVE = new https.Agent({ keepAlive: false });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function postJSON(url, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = https.request(url, {
      method: 'POST',
      agent: AGENTE_SIN_KEEPALIVE,
      headers: { ...HEADERS, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
    }, res => {
      if (res.statusCode !== 200) { res.resume(); resolve(null); return; }
      let chunk = '';
      res.on('data', c => { chunk += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(chunk)); } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.write(payload);
    req.end();
  });
}

async function getPromotionsForSkus(skuIds) {
  if (!skuIds.length) return {};
  const data = await postJSON(`${BASE_URL}/_v/search-promotions`, { seller: PROMO_SELLER, skus: skuIds });
  return data?.promotions?.generic?.promotions || {};
}

function chunk(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}

/** Mismo parseo de precio que buscarPorEAN() en completar-disco-por-ean.js, filtrando por el
 *  lote de skuId pedido en vez de por un único EAN objetivo. Sin `sc=` — igual que el scraper
 *  normal de Disco. */
function parsearProductos(productos, skuIdsPedidos) {
  const porSkuId = new Map();
  for (const product of productos) {
    for (const sku of product.items || []) {
      if (!skuIdsPedidos.has(String(sku.itemId))) continue;
      if (!sku.sellers?.length) continue;
      const sellerInfo = sku.sellers.find(s => s.sellerId === PROMO_SELLER) || sku.sellers[0];
      if (!sellerInfo?.commertialOffer?.IsAvailable) continue;

      porSkuId.set(String(sku.itemId), {
        skuId: sku.itemId,
        ean: sku.ean,
        productName: product.productName,
        skuName: sku.name,
        categoria: product.categories?.[0]?.replace(/\//g, ' > ').replace(/^ > | > $/g, '') || null,
        price: sellerInfo?.commertialOffer?.Price || 0,
        seller: sellerInfo?.sellerId || PROMO_SELLER,
        imagenUrl: sku.images?.[0]?.imageUrl || null,
      });
    }
  }
  return porSkuId;
}

async function main() {
  console.log('=== Refrescar precio de extras de Disco (sin buscar candidatos nuevos) ===\n');

  let data;
  try {
    data = JSON.parse(fs.readFileSync(RUTA_EXTRAS, 'utf8'));
  } catch {
    console.log(`No existe ${RUTA_EXTRAS} todavía — nada para refrescar. Corré primero completar-disco-por-ean.js.`);
    return;
  }
  const extrasActuales = Array.isArray(data.skus) ? data.skus : [];
  const conSkuId = extrasActuales.filter(s => s.skuId);
  const sinSkuId = extrasActuales.filter(s => !s.skuId);
  const skuIds = [...new Set(conSkuId.map(s => String(s.skuId)))];

  console.log(`Extras actuales: ${extrasActuales.length} (${skuIds.length} con skuId a refrescar, ${sinSkuId.length} sin skuId — se dejan como están)`);

  if (!skuIds.length) {
    console.log('Nada para refrescar.');
    return;
  }

  const productos = await buscarPorSkuIds(BASE_URL, skuIds, { headers: HEADERS });
  const skuIdsPedidos = new Set(skuIds);
  const refrescados = parsearProductos(productos, skuIdsPedidos);

  const encontrados = [...refrescados.values()];
  console.log(`✅ Precio refrescado: ${encontrados.length}/${skuIds.length}`);
  console.log(`   Caídos (ya no disponibles, se sacan): ${skuIds.length - encontrados.length}`);

  console.log('\n🏷️  Consultando promociones...');
  const lotesSkuId = chunk(encontrados.map(s => s.skuId), 10);
  const promosNuevas = {};
  for (let i = 0; i < lotesSkuId.length; i++) {
    process.stdout.write(`\r  Lote ${i + 1}/${lotesSkuId.length}...`);
    Object.assign(promosNuevas, await getPromotionsForSkus(lotesSkuId[i]));
    await sleep(200);
  }
  console.log(`\n✅ Con promo: ${Object.keys(promosNuevas).length}\n`);

  const conPromoActualizado = encontrados.map(sku => {
    const promo = promosNuevas[sku.skuId] || null;
    const descuento = promo ? parseFloat(promo.effectiveDiscount) : NaN;
    const tienePromoUsable = promo && Number.isFinite(descuento) && descuento > 0;
    return {
      skuId: sku.skuId,
      ean: sku.ean,
      productName: sku.productName,
      skuName: sku.skuName,
      categoria: sku.categoria,
      seller: sku.seller,
      precioBase: sku.price,
      imagenUrl: sku.imagenUrl,
      promocion: tienePromoUsable ? {
        nombre: promo.name,
        codigo: promo.code,
        descuento: promo.effectiveDiscount,
        descuentoPct: (descuento * 100).toFixed(0) + '%',
        precioFinal: Math.round(sku.price * (1 - descuento) * 100) / 100,
        vigenciaDesde: promo.start || null,
        vigenciaHasta: promo.end || null,
      } : null,
    };
  });

  const nuevosExtras = [...conPromoActualizado, ...sinSkuId];
  const conPromo = nuevosExtras.filter(p => p.promocion !== null);
  const meta = { fecha: new Date().toISOString(), supermercado: 'Disco', seller: PROMO_SELLER };

  escribirAtomico(RUTA_EXTRAS, JSON.stringify({
    ...meta,
    total_skus: nuevosExtras.length,
    skus: nuevosExtras,
  }, null, 2));

  escribirAtomico('./promos-disco-extras.json', JSON.stringify({
    ...meta,
    total_skus_analizados: nuevosExtras.length,
    total_con_promo: conPromo.length,
    productos: conPromo,
  }, null, 2));

  console.log(`=== RESULTADO ===`);
  console.log(`  Extras antes:    ${extrasActuales.length}`);
  console.log(`  Extras ahora:    ${nuevosExtras.length}`);
  console.log(`  Guardado en:     ${RUTA_EXTRAS} + promos-disco-extras.json`);
}

main().catch(err => {
  console.error('Error fatal:', err);
  process.exit(1);
});
