/**
 * Scraper de Vea — guarda TODO el catálogo con EAN y marca promos activas.
 * (El canal `sc=34` no resultó ser específico de Luján ni de ninguna sucursal — el precio es
 * el mismo a nivel país, confirmado en vivo. Ver CONTEXTO_TECNICO.md.)
 *
 * SIN cookie `vtex_segment` a propósito (encontrado 2026-08-20, mismo motivo ya documentado en
 * `core/fetchers.js` para las queries en vivo desde 2026-08-13, pero ahí nunca se corrigió este
 * scraper): un cookie fijo con un regionId de una sucursal puntual devuelve precio y
 * disponibilidad de una tabla vieja/rota para un subconjunto de productos — confirmado en vivo
 * un caso real (~9% de una muestra de 2551 SKUs) donde, sacando el cookie, el precio pasó a
 * coincidir con el de la página real. No volver a agregar un `vtex_segment` fijo sin volver a
 * confirmar que sigue devolviendo precio vigente.
 *
 * Salida:
 *   catalogo-vea.json  — todos los SKUs con EAN, precio y promo (null si no tiene)
 *   promos-vea.json    — solo los SKUs con promo activa (para búsqueda rápida)
 */

const fs = require('fs');

const SELLER = 'jumboargentinav700cordoba700';
const BASE_URL = 'https://www.vea.com.ar';
const SC = 34;

const HEADERS = {
  'Content-Type': 'application/json',
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
  'Accept': 'application/json',
};

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function getCatalogPage(from, to) {
  const url = `${BASE_URL}/api/catalog_system/pub/products/search?_from=${from}&_to=${to}&sc=${SC}`;
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`Catálogo falló: ${res.status} ${res.statusText}`);

  const products = await res.json();
  const skus = [];
  for (const product of products) {
    for (const sku of product.items || []) {
      if (!sku.sellers?.length) continue;
      const sellerInfo = sku.sellers.find(s => s.sellerId === SELLER) || sku.sellers[0];
      if (!sellerInfo?.commertialOffer?.IsAvailable) continue; // SKU sin stock — VTEX lo devuelve con Price: 0, mismo criterio que Coto (ver "SKUs fantasma" en scraper-promos-coto.js): no le sirve a la app, se descarta en vez de cachear un precio 0
      skus.push({
        skuId: sku.itemId,
        ean: sku.ean || null,
        productName: product.productName,
        skuName: sku.name,
        categoria: product.categories?.[0]?.replace(/\//g, ' > ').replace(/^ > | > $/g, '') || null,
        price: sellerInfo?.commertialOffer?.Price || 0,
        seller: sellerInfo?.sellerId || SELLER,
        // Ya viene en la misma respuesta que el precio — no hace falta un scrape aparte.
        imagenUrl: sku.images?.[0]?.imageUrl || null,
      });
    }
  }
  return { skus, count: products.length };
}

async function getPromotionsForSkus(skuIds) {
  const res = await fetch(`${BASE_URL}/_v/search-promotions`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({ seller: SELLER, skus: skuIds }),
  });
  if (!res.ok) {
    console.warn(`  search-promotions falló para lote: ${res.status}`);
    return {};
  }
  const data = await res.json();
  return data.promotions?.generic?.promotions || {};
}

function chunk(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}

async function main() {
  console.log('=== Scraper Vea — Catálogo completo + Promociones ===\n');

  // --- PASO 1: Catálogo completo ---
  console.log('📦 Paso 1: Paginando catálogo...');
  const allSkus = [];
  const PAGE_SIZE = 50;
  let from = 0;

  while (true) {
    try {
      const { skus, count } = await getCatalogPage(from, from + PAGE_SIZE - 1);
      allSkus.push(...skus);
      process.stdout.write(`\r  ${allSkus.length} SKUs recolectados...`);
      if (count < PAGE_SIZE) break;
      from += PAGE_SIZE;
      await sleep(300);
    } catch (err) {
      console.log(`\n  Fin de catálogo en página ${from}: ${err.message}`);
      break;
    }
  }
  console.log(`\n✅ Total SKUs: ${allSkus.length}\n`);

  // --- PASO 2: Promociones en lotes de 10 ---
  console.log('🏷️  Paso 2: Consultando promociones...');
  const skuIds = allSkus.map(s => s.skuId);
  const batches = chunk(skuIds, 10);
  const allPromos = {};

  for (let i = 0; i < batches.length; i++) {
    process.stdout.write(`\r  Lote ${i + 1}/${batches.length}...`);
    const promos = await getPromotionsForSkus(batches[i]);
    Object.assign(allPromos, promos);
    await sleep(200);
  }
  console.log(`\n✅ SKUs con promo: ${Object.keys(allPromos).length}\n`);

  // --- PASO 3: Armar catálogo completo con promo embebida ---
  console.log('🔍 Paso 3: Cruzando datos...');
  const catalogo = allSkus.map(sku => {
    const promo = allPromos[sku.skuId] || null;
    return {
      skuId: sku.skuId,
      ean: sku.ean,
      productName: sku.productName,
      skuName: sku.skuName,
      categoria: sku.categoria,
      seller: sku.seller,
      precioBase: sku.price,
      imagenUrl: sku.imagenUrl,
      promocion: promo ? {
        nombre: promo.name,
        codigo: promo.code,
        descuento: promo.effectiveDiscount,
        descuentoPct: (parseFloat(promo.effectiveDiscount) * 100).toFixed(0) + '%',
        precioFinal: Math.round(sku.price * (1 - parseFloat(promo.effectiveDiscount)) * 100) / 100,
        vigenciaDesde: promo.start || null,
        vigenciaHasta: promo.end || null,
      } : null,
    };
  });

  const conPromo = catalogo.filter(p => p.promocion !== null);
  conPromo.sort((a, b) => parseFloat(b.promocion.descuento) - parseFloat(a.promocion.descuento));

  // --- PASO 4: Guardar ambos archivos ---
  const meta = { fecha: new Date().toISOString(), supermercado: 'Vea', seller: SELLER };

  fs.writeFileSync('./catalogo-vea.json', JSON.stringify({
    ...meta,
    total_skus: catalogo.length,
    skus: catalogo,
  }, null, 2));

  fs.writeFileSync('./promos-vea.json', JSON.stringify({
    ...meta,
    total_skus_analizados: catalogo.length,
    total_con_promo: conPromo.length,
    productos: conPromo,
  }, null, 2));

  console.log(`\n=== RESULTADO ===`);
  console.log(`  SKUs totales:    ${catalogo.length}`);
  console.log(`  Con EAN:         ${catalogo.filter(p => p.ean).length}`);
  console.log(`  Con promoción:   ${conPromo.length}`);
  console.log(`  Guardado en:     catalogo-vea.json + promos-vea.json`);
  console.log('\nTop 10 descuentos:');
  conPromo.slice(0, 10).forEach((p, i) => {
    console.log(`  ${i + 1}. ${p.productName} — ${p.promocion.descuentoPct} (${p.promocion.nombre})`);
  });
}

main().catch(err => {
  console.error('Error fatal:', err);
  process.exit(1);
});
