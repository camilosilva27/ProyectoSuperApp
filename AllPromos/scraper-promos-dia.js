/**
 * Scraper de Día Argentina — catálogo completo con precios y promociones.
 *
 * Corre sobre VTEX, igual que Carrefour y Chango Más — mismo mecanismo de descuento
 * directo (Price < ListPrice) y Teasers para promos condicionales. Confirmado en vivo
 * (2026-08-10): sin cookie ni sales channel especial (funciona con sc=1 o sin sc), catálogo
 * real de 5.567 SKUs (bastante más chico que los otros 3), mismo tope de paginación de
 * ~2.550 ítems del endpoint legacy de VTEX (ver quirk ya documentado para Vea/Carrefour/
 * Chango Más en CONTEXTO_TECNICO.md — no es un límite nuevo, es el mismo de siempre).
 *
 * Teasers confirmados en vivo: "2do al X%", "3x2", "2x1" — mismo formato que Carrefour, así
 * que `interpretarPromoCarrefour()` en promo-engine.js los interpreta sin cambios. También
 * aparece un formato no visto en los otros 3: "2x$2500" / "2x$3500" (precio fijo por N
 * unidades, no un % de descuento) — implementado en promo-engine.js (2026-08-19) como tipo
 * `oferta_precio_fijo`, así que el comparador en vivo también lo entiende.
 *
 * Salida:
 *   catalogo-dia.json  — todos los SKUs con EAN, precio y promo
 *   promos-dia.json    — solo los SKUs con algún tipo de descuento
 */

const fs = require('fs');
const { esTeaserBancario } = require('./promo-engine');
const { guardarCatalogoConGuardrail } = require('./core/guardrailCatalogo');
const { fetchConReintentoHTTP, errorHTTP, esFinLegitimoDePaginacion } = require('./core/reintentoVTEX');
const { extrasDescuentoDirecto, esExclusivoOnline } = require('./core/datosPromoVtex');

const BASE_URL = 'https://diaonline.supermercadosdia.com.ar';
const SC = 1;
const SELLER = '1';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
  'Accept': 'application/json',
};

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const avisarReintento = (msg) => process.stdout.write(msg);

function parseTeasers(teasers = []) {
  return teasers
    .map(t => ({
      nombre: t['<Name>k__BackingField'] || '',
      descuentoPct: t['<Effects>k__BackingField']?.['<Parameters>k__BackingField']
        ?.find(p => p['<Name>k__BackingField'] === 'PercentualDiscount')
        ?.['<Value>k__BackingField'] || null,
      cantidadMinima: t['<Conditions>k__BackingField']?.['<MinimumQuantity>k__BackingField'] || 0,
      // Criterio compartido con el fallback en vivo (promo-engine.js § esTeaserBancario):
      // antes `includes('bin')` marcaba como bancario todo teaser "Combinable".
      esBancaria: esTeaserBancario(t['<Name>k__BackingField']),
    }))
    .filter(t => t.nombre);
}

async function getCatalogPage(from, to) {
  const url = `${BASE_URL}/api/catalog_system/pub/products/search?_from=${from}&_to=${to}&sc=${SC}`;
  // Retry por error de red/timeout y 429/5xx (3 intentos de 10s) — en core/reintentoVTEX.js
  // desde 2026-09-24, antes copiado inline acá. `errorHTTP` adjunta el status para que el
  // loop de paginación distinga el 400 del techo legítimo de VTEX de un error real.
  const res = await fetchConReintentoHTTP(url, { headers: HEADERS }, { onReintento: avisarReintento });
  if (!res.ok) throw errorHTTP('Catálogo falló', res);

  const products = await res.json();
  const skus = [];

  for (const product of products) {
    for (const sku of product.items || []) {
      const sellerInfo = sku.sellers?.find(s => s.sellerId === SELLER) || sku.sellers?.[0];
      if (!sellerInfo) continue;

      const offer = sellerInfo.commertialOffer;
      if (!offer?.IsAvailable) continue; // SKU sin stock — VTEX lo devuelve con Price: 0, mismo criterio que Coto (ver "SKUs fantasma" en scraper-promos-coto.js): no le sirve a la app, se descarta en vez de cachear un precio 0
      const price = offer.Price || 0;
      const listPrice = offer?.ListPrice || 0;
      const teasers = parseTeasers(offer?.Teasers);

      const descuentoDirecto = listPrice > 0 && price < listPrice
        ? {
            tipo: 'descuento_directo',
            precioBase: listPrice,
            precioFinal: price,
            descuentoPct: ((1 - price / listPrice) * 100).toFixed(0) + '%',
            descuento: ((1 - price / listPrice)).toFixed(4),
            ...extrasDescuentoDirecto(offer),
          }
        : null;

      const teasersInternos = teasers.filter(t => !t.esBancaria);
      const teasersBancarios = teasers.filter(t => t.esBancaria);

      skus.push({
        skuId: sku.itemId,
        ean: sku.ean || null,
        productName: product.productName,
        skuName: sku.name,
        categoria: product.categories?.[0]?.replace(/\//g, ' > ').replace(/^ > | > $/g, '') || null,
        seller: sellerInfo.sellerId,
        precioBase: listPrice || price,
        precioActual: price,
        descuentoDirecto,
        promosInternas: teasersInternos.length ? teasersInternos : null,
        promosBancarias: teasersBancarios.length ? teasersBancarios : null,
        ...(esExclusivoOnline(product) ? { exclusivoOnline: true } : {}),
        // Ya viene en la misma respuesta que el precio — no hace falta un scrape aparte.
        imagenUrl: sku.images?.[0]?.imageUrl || null,
      });
    }
  }

  return { skus, count: products.length };
}

async function main() {
  console.log('=== Scraper Día — Catálogo completo + Promociones ===\n');

  console.log('📦 Paginando catálogo...');
  const allSkus = [];
  const PAGE_SIZE = 50;
  let from = 0;

  while (true) {
    try {
      let { skus, count } = await getCatalogPage(from, from + PAGE_SIZE - 1);
      if (count < PAGE_SIZE) {
        // Página corta: puede ser el fin real del catálogo, o un corte transitorio de VTEX —
        // confirmar antes de darla por terminada. 3 intentos de 30s (no 3s): visto en vivo
        // 2026-09-23 que un throttle real de VTEX puede sostenerse varios minutos, no solo una
        // página aislada — con esperas cortas no alcanzaba a recuperarse.
        for (let intento = 0; count < PAGE_SIZE && intento < 3; intento++) {
          await sleep(30000);
          ({ skus, count } = await getCatalogPage(from, from + PAGE_SIZE - 1));
        }
      }
      allSkus.push(...skus);
      process.stdout.write(`\r  ${allSkus.length} SKUs recolectados...`);
      if (count < PAGE_SIZE) break;
      from += PAGE_SIZE;
      await sleep(500);
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

  // Filtrar los que tienen algún tipo de descuento interno
  const conPromo = allSkus.filter(s => s.descuentoDirecto || s.promosInternas);
  conPromo.sort((a, b) => {
    const pctA = parseFloat(a.descuentoDirecto?.descuento || 0);
    const pctB = parseFloat(b.descuentoDirecto?.descuento || 0);
    return pctB - pctA;
  });

  const meta = {
    fecha: new Date().toISOString(),
    supermercado: 'Día',
    seller: SELLER,
  };

  guardarCatalogoConGuardrail('./catalogo-dia.json', {
    ...meta,
    total_skus: allSkus.length,
    skus: allSkus,
  });

  fs.writeFileSync('./promos-dia.json', JSON.stringify({
    ...meta,
    total_skus_analizados: allSkus.length,
    total_con_promo: conPromo.length,
    productos: conPromo,
  }, null, 2));

  console.log(`=== RESULTADO ===`);
  console.log(`  SKUs totales:         ${allSkus.length}`);
  console.log(`  Con EAN:              ${allSkus.filter(p => p.ean).length}`);
  console.log(`  Con descuento directo: ${allSkus.filter(p => p.descuentoDirecto).length}`);
  console.log(`  Con promos internas:  ${allSkus.filter(p => p.promosInternas).length}`);
  console.log(`  Con promos bancarias: ${allSkus.filter(p => p.promosBancarias).length}`);
  console.log(`  Guardado en:          catalogo-dia.json + promos-dia.json`);

  console.log('\nTop 10 descuentos directos:');
  conPromo.filter(p => p.descuentoDirecto).slice(0, 10).forEach((p, i) => {
    console.log(`  ${i + 1}. ${p.productName} — ${p.descuentoDirecto.descuentoPct} ($${p.precioBase} → $${p.precioActual})`);
  });

  console.log('\nPromos internas (2x1, 2do al X%, 2x$X, etc.):');
  allSkus.filter(p => p.promosInternas).slice(0, 10).forEach(p => {
    console.log(`  - ${p.productName}`);
    p.promosInternas.forEach(t => console.log(`    → ${t.nombre}`));
  });
}

main().catch(err => {
  console.error('Error fatal:', err);
  process.exit(1);
});
