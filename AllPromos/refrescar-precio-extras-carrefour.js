/**
 * Refresca precio+promo de los productos que YA están en catalogo-carrefour-extras.json (los
 * que encontró completar-carrefour-por-ean.js), SIN volver a buscar candidatos nuevos.
 *
 * Por qué existe (2026-08-26, mismo día que se implementó el diseño de extras.json — ver
 * completador_catalogos.md § 6/§ 11): el catálogo base se refresca cada 2hs vía el cron normal,
 * pero los productos en `-extras.json` solo se refrescaban corriendo de nuevo el completador
 * completo (~4.400 candidatos, ~25 min) — la mayoría de ese tiempo se gasta confirmando que un
 * candidato NO existe (necesario para *descubrir*, inútil para *refrescar* algo que ya sabés que
 * existe). Acá en cambio se pide directo por los skuId ya conocidos (unos pocos cientos a
 * ~1.500), así que "buscar candidatos nuevos" puede quedar en un cron aparte, poco frecuente
 * (semanal/mensual), mientras esto corre junto al cron normal de 2hs.
 *
 * Batch confirmado en vivo: VTEX acepta varios `fq=skuId:X` repetidos en la misma request como
 * OR, hasta 50 por página (ver core/batchPorSkuId.js) — así que 1.500 productos son ~30
 * requests, no 1.500.
 *
 * Un producto que ya no aparece disponible (sin stock, discontinuado) se SACA de
 * catalogo-carrefour-extras.json — igual que el scraper normal ya hace con su propio recorte.
 *
 * Uso: node refrescar-precio-extras-carrefour.js
 */

const fs = require('fs');
const { escribirAtomico } = require('./core/escrituraAtomica');
const { buscarPorSkuIds } = require('./core/batchPorSkuId');

const BASE_URL = 'https://www.carrefour.com.ar';
const SC = 1;
const SELLER = '1';
const RUTA_EXTRAS = './catalogo-carrefour-extras.json';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
  'Accept': 'application/json',
};

// Copiado sin cambios de completar-carrefour-por-ean.js — mismo parseo de teasers.
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

/** Mismo parseo por-producto que buscarPorEAN() en completar-carrefour-por-ean.js, pero
 *  filtrando por `skuIdsPedidos` (el lote que pedimos) en vez de por un único EAN objetivo —
 *  acá una sola request trae muchos productos distintos a la vez. */
function parsearProductos(productos, skuIdsPedidos) {
  const porSkuId = new Map();
  for (const product of productos) {
    for (const sku of product.items || []) {
      if (!skuIdsPedidos.has(String(sku.itemId))) continue;
      const sellerInfo = sku.sellers?.find(s => s.sellerId === SELLER) || sku.sellers?.[0];
      if (!sellerInfo) continue;
      const offer = sellerInfo.commertialOffer;
      if (!offer?.IsAvailable) continue;

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
          }
        : null;
      const teasersInternos = teasers.filter(t => !t.esBancaria);
      const teasersBancarios = teasers.filter(t => t.esBancaria);

      porSkuId.set(String(sku.itemId), {
        skuId: sku.itemId,
        ean: sku.ean,
        productName: product.productName,
        skuName: sku.name,
        categoria: product.categories?.[0]?.replace(/\//g, ' > ').replace(/^ > | > $/g, '') || null,
        seller: sellerInfo.sellerId,
        precioBase: listPrice || price,
        precioActual: price,
        descuentoDirecto,
        promosInternas: teasersInternos.length ? teasersInternos : null,
        promosBancarias: teasersBancarios.length ? teasersBancarios : null,
        imagenUrl: sku.images?.[0]?.imageUrl || null,
      });
    }
  }
  return porSkuId;
}

async function main() {
  console.log('=== Refrescar precio de extras de Carrefour (sin buscar candidatos nuevos) ===\n');

  let data;
  try {
    data = JSON.parse(fs.readFileSync(RUTA_EXTRAS, 'utf8'));
  } catch {
    console.log(`No existe ${RUTA_EXTRAS} todavía — nada para refrescar. Corré primero completar-carrefour-por-ean.js.`);
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

  const productos = await buscarPorSkuIds(BASE_URL, skuIds, { sc: SC, headers: HEADERS });
  const skuIdsPedidos = new Set(skuIds);
  const refrescados = parsearProductos(productos, skuIdsPedidos);

  const nuevosExtras = [];
  let caidos = 0;
  for (const s of conSkuId) {
    const actualizado = refrescados.get(String(s.skuId));
    if (actualizado) nuevosExtras.push(actualizado);
    else caidos++; // ya no disponible — se saca, igual que el scraper normal
  }
  nuevosExtras.push(...sinSkuId);

  console.log(`✅ Refrescados: ${nuevosExtras.length - sinSkuId.length}/${skuIds.length}`);
  console.log(`   Caídos (ya no disponibles, se sacan): ${caidos}`);

  const conPromo = nuevosExtras.filter(p => p.descuentoDirecto || p.promosInternas);
  const meta = { fecha: new Date().toISOString(), supermercado: 'Carrefour', seller: SELLER };

  escribirAtomico(RUTA_EXTRAS, JSON.stringify({
    ...meta,
    total_skus: nuevosExtras.length,
    skus: nuevosExtras,
  }, null, 2));

  escribirAtomico('./promos-carrefour-extras.json', JSON.stringify({
    ...meta,
    total_skus_analizados: nuevosExtras.length,
    total_con_promo: conPromo.length,
    productos: conPromo,
  }, null, 2));

  console.log(`\n=== RESULTADO ===`);
  console.log(`  Extras antes:    ${extrasActuales.length}`);
  console.log(`  Extras ahora:    ${nuevosExtras.length}`);
  console.log(`  Guardado en:     ${RUTA_EXTRAS} + promos-carrefour-extras.json`);
}

main().catch(err => {
  console.error('Error fatal:', err);
  process.exit(1);
});
