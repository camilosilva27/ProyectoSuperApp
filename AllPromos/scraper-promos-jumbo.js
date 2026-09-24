/**
 * Scraper de Jumbo — guarda TODO el catálogo con EAN y marca promos activas.
 *
 * Jumbo, Disco y Vea son la MISMA cuenta VTEX ("Jumbo Argentina IO" / account `jumboargentina`):
 * mismo skuId/EAN, mismo master data, confirmado en vivo comparando los 3 sitios para el mismo
 * producto. Por eso este scraper es casi idéntico a `scraper-promos-vea.js`, con dos diferencias
 * encontradas en vivo:
 *
 * 1. Sin `sc=` — a diferencia de Vea (que necesita `sc=34` por una razón histórica propia, ver
 *    ese scraper), jumbo.com.ar devuelve precio y catálogo consistentes sin sales channel
 *    explícito. No se encontró evidencia de variación regional de precio (mismo criterio que
 *    Carrefour/Chango Más/Día: no inventar regionalización sin evidencia).
 * 2. El seller que hay que mandarle a `_v/search-promotions` NO es el "1" que devuelve el
 *    catálogo público (`sellers[0].sellerId`) — es el mismo string interno que ya usa Vea,
 *    `jumboargentinav700cordoba700`. Confirmado en vivo: con seller "1" el endpoint responde
 *    200 pero siempre vacío (probado contra ~2500 SKUs, ninguna promo); con el seller de Vea,
 *    aparecen inmediatamente ~660 promos reales. Es un dato de la CUENTA VTEX compartida, no
 *    de Vea en particular — por eso funciona igual en jumbo.com.ar y disco.com.ar.
 *
 * Salida:
 *   catalogo-jumbo.json  — todos los SKUs con EAN, precio y promo (null si no tiene)
 *   promos-jumbo.json    — solo los SKUs con promo activa (para búsqueda rápida)
 */

const fs = require('fs');
const { promocionCatalogoCencosud } = require('./core/promoCencosud');
const { guardarCatalogoConGuardrail } = require('./core/guardrailCatalogo');
const { fetchConReintentoHTTP, errorHTTP, esFinLegitimoDePaginacion } = require('./core/reintentoVTEX');

// Seller interno compartido por toda la cuenta VTEX de Cencosud Argentina (Jumbo/Vea/Disco),
// necesario para `_v/search-promotions` — no confundir con el "1" que sí aparece en `sellers[]`
// del catálogo público, que es el que se usa para identificar precio/disponibilidad normal.
const PROMO_SELLER = 'jumboargentinav700cordoba700';
const BASE_URL = 'https://www.jumbo.com.ar';

const HEADERS = {
  'Content-Type': 'application/json',
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
  'Accept': 'application/json',
};

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const avisarReintento = (msg) => process.stdout.write(msg);

async function getCatalogPage(from, to) {
  const url = `${BASE_URL}/api/catalog_system/pub/products/search?_from=${from}&_to=${to}`;
  // Retry por error de red/timeout y 429/5xx (3 intentos de 10s) — en core/reintentoVTEX.js
  // desde 2026-09-24, antes copiado inline acá. `errorHTTP` adjunta el status para que el
  // loop de paginación distinga el 400 del techo legítimo de VTEX de un error real.
  const res = await fetchConReintentoHTTP(url, { headers: HEADERS }, { onReintento: avisarReintento });
  if (!res.ok) throw errorHTTP('Catálogo falló', res);

  const products = await res.json();
  const skus = [];
  for (const product of products) {
    for (const sku of product.items || []) {
      if (!sku.sellers?.length) continue;
      const sellerInfo = sku.sellers[0];
      if (!sellerInfo?.commertialOffer?.IsAvailable) continue; // SKU sin stock — VTEX lo devuelve con Price: 0, mismo criterio que Coto (ver "SKUs fantasma" en scraper-promos-coto.js): no le sirve a la app, se descarta en vez de cachear un precio 0
      skus.push({
        skuId: sku.itemId,
        ean: sku.ean || null,
        productName: product.productName,
        skuName: sku.name,
        categoria: product.categories?.[0]?.replace(/\//g, ' > ').replace(/^ > | > $/g, '') || null,
        price: sellerInfo?.commertialOffer?.Price || 0,
        seller: sellerInfo?.sellerId || '1',
        imagenUrl: sku.images?.[0]?.imageUrl || null,
      });
    }
  }
  return { skus, count: products.length };
}

async function getPromotionsForSkus(skuIds) {
  // Con retry (2026-09-24, auditoría): antes un 429/5xx devolvía {} con un warn y el lote
  // quedaba guardado SIN promo, en silencio — precio más caro que el real para esos 10 SKUs
  // hasta la corrida siguiente. Ahora reintenta igual que la paginación y, si sigue fallando,
  // lanza: la corrida termina con exit 1 y el catalogo-*.json anterior queda intacto.
  const res = await fetchConReintentoHTTP(`${BASE_URL}/_v/search-promotions`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({ seller: PROMO_SELLER, skus: skuIds }),
  }, { onReintento: avisarReintento });
  if (!res.ok) throw errorHTTP('search-promotions falló para lote', res);
  const data = await res.json();
  return data.promotions?.generic?.promotions || {};
}

function chunk(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}

async function main() {
  console.log('=== Scraper Jumbo — Catálogo completo + Promociones ===\n');

  // --- PASO 1: Catálogo completo ---
  console.log('📦 Paso 1: Paginando catálogo...');
  const allSkus = [];
  const PAGE_SIZE = 50;
  let from = 0;

  while (true) {
    try {
      let { skus, count } = await getCatalogPage(from, from + PAGE_SIZE - 1);
      if (count < PAGE_SIZE) {
        // Página corta: puede ser el fin real del catálogo, o un corte transitorio de VTEX —
        // confirmar antes de darla por terminada. 3 intentos de 30s (no 3s): visto en vivo
        // 2026-09-23 que un throttle real de la cuenta VTEX compartida (Vea/Jumbo/Disco) puede
        // sostenerse varios minutos, no solo una página aislada — con esperas cortas no
        // alcanzaba a recuperarse.
        for (let intento = 0; count < PAGE_SIZE && intento < 3; intento++) {
          await sleep(30000);
          ({ skus, count } = await getCatalogPage(from, from + PAGE_SIZE - 1));
        }
      }
      allSkus.push(...skus);
      process.stdout.write(`\r  ${allSkus.length} SKUs recolectados...`);
      if (count < PAGE_SIZE) break;
      from += PAGE_SIZE;
      await sleep(300);
    } catch (err) {
      // Solo el 400 del techo de ~2550 del endpoint legacy es fin legítimo. Cualquier otro
      // error de página (429/5xx tras los reintentos, red, JSON roto) antes también hacía
      // "break" y se guardaba un catálogo truncado; desde 2026-09-24 aborta la corrida
      // (exit 1, visible en /api/health) y el catalogo-*.json anterior queda intacto.
      if (esFinLegitimoDePaginacion(err, from)) {
        console.log(`\n  Fin de catálogo en página ${from} (techo de paginación de VTEX): ${err.message}`);
        break;
      }
      throw new Error(`Paginación abortada en página ${from} con ${allSkus.length} SKUs: ${err.message}`);
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
      // Promo de search-promotions → `promocion` del catálogo (ver core/promoCencosud.js): los
      // fixed_price ("OFERTA X") usan `value` como precio, no el effectiveDiscount de la campaña;
      // sin % ni precio usable (ej. "Llevando n x") → sin promo, no se adivina.
      promocion: promocionCatalogoCencosud(promo, sku.price),
    };
  });

  const conPromo = catalogo.filter(p => p.promocion !== null);
  conPromo.sort((a, b) => parseFloat(b.promocion.descuento) - parseFloat(a.promocion.descuento));

  // --- PASO 4: Guardar ambos archivos ---
  const meta = { fecha: new Date().toISOString(), supermercado: 'Jumbo', seller: PROMO_SELLER };

  guardarCatalogoConGuardrail('./catalogo-jumbo.json', {
    ...meta,
    total_skus: catalogo.length,
    skus: catalogo,
  });

  fs.writeFileSync('./promos-jumbo.json', JSON.stringify({
    ...meta,
    total_skus_analizados: catalogo.length,
    total_con_promo: conPromo.length,
    productos: conPromo,
  }, null, 2));

  console.log(`\n=== RESULTADO ===`);
  console.log(`  SKUs totales:    ${catalogo.length}`);
  console.log(`  Con EAN:         ${catalogo.filter(p => p.ean).length}`);
  console.log(`  Con promoción:   ${conPromo.length}`);
  console.log(`  Guardado en:     catalogo-jumbo.json + promos-jumbo.json`);
  console.log('\nTop 10 descuentos:');
  conPromo.slice(0, 10).forEach((p, i) => {
    console.log(`  ${i + 1}. ${p.productName} — ${p.promocion.descuentoPct} (${p.promocion.nombre})`);
  });
}

main().catch(err => {
  console.error('Error fatal:', err);
  process.exit(1);
});
