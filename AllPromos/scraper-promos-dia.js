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

const BASE_URL = 'https://diaonline.supermercadosdia.com.ar';
const SC = 1;
const SELLER = '1';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
  'Accept': 'application/json',
};

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function parseTeasers(teasers = []) {
  return teasers
    .map(t => ({
      nombre: t['<Name>k__BackingField'] || '',
      descuentoPct: t['<Effects>k__BackingField']?.['<Parameters>k__BackingField']
        ?.find(p => p['<Name>k__BackingField'] === 'PercentualDiscount')
        ?.['<Value>k__BackingField'] || null,
      cantidadMinima: t['<Conditions>k__BackingField']?.['<MinimumQuantity>k__BackingField'] || 0,
      esBancaria: (() => {
        const n = (t['<Name>k__BackingField'] || '').toLowerCase();
        return n.includes('tarjeta') || n.includes('cuenta digital') || n.includes('banco') || n.includes('bin');
      })(),
    }))
    .filter(t => t.nombre);
}

async function getCatalogPage(from, to, retries = 3) {
  const url = `${BASE_URL}/api/catalog_system/pub/products/search?_from=${from}&_to=${to}&sc=${SC}`;
  const res = await fetch(url, { headers: HEADERS });
  if (res.status === 429 && retries > 0) {
    process.stdout.write(' [rate limit, esperando 10s]');
    await sleep(10000);
    return getCatalogPage(from, to, retries - 1);
  }
  if (!res.ok) throw new Error(`Catálogo falló: ${res.status} ${res.statusText}`);

  const products = await res.json();
  const skus = [];

  for (const product of products) {
    for (const sku of product.items || []) {
      const sellerInfo = sku.sellers?.find(s => s.sellerId === SELLER) || sku.sellers?.[0];
      if (!sellerInfo) continue;

      const offer = sellerInfo.commertialOffer;
      const price = offer?.Price || 0;
      const listPrice = offer?.ListPrice || 0;
      const teasers = parseTeasers(offer?.Teasers);

      const descuentoDirecto = listPrice > 0 && price < listPrice
        ? {
            tipo: 'descuento_directo',
            precioBase: listPrice,
            precioFinal: price,
            descuentoPct: ((1 - price / listPrice) * 100).toFixed(0) + '%',
            descuento: ((1 - price / listPrice)).toFixed(4),
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
      const { skus, count } = await getCatalogPage(from, from + PAGE_SIZE - 1);
      allSkus.push(...skus);
      process.stdout.write(`\r  ${allSkus.length} SKUs recolectados...`);
      if (count < PAGE_SIZE) break;
      from += PAGE_SIZE;
      await sleep(500);
    } catch (err) {
      console.log(`\n  Fin en página ${from}: ${err.message}`);
      break;
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

  fs.writeFileSync('./catalogo-dia.json', JSON.stringify({
    ...meta,
    total_skus: allSkus.length,
    skus: allSkus,
  }, null, 2));

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
