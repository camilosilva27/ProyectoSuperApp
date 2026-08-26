/**
 * Refresca precio+promo de los productos que YA están en catalogo-dia-extras.json (los que
 * encontró completar-dia-por-ean.js), SIN volver a buscar candidatos nuevos.
 * Ver refrescar-precio-extras-carrefour.js para el porqué completo — mismo patrón acá.
 *
 * Uso: node refrescar-precio-extras-dia.js
 */

const fs = require('fs');
const { escribirAtomico } = require('./core/escrituraAtomica');
const { buscarPorSkuIds } = require('./core/batchPorSkuId');

const BASE_URL = 'https://diaonline.supermercadosdia.com.ar';
const SC = 1;
const SELLER = '1';
const RUTA_EXTRAS = './catalogo-dia-extras.json';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
  'Accept': 'application/json',
};

// Copiado sin cambios de completar-dia-por-ean.js.
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

/** Mismo parseo que buscarPorEAN() en completar-dia-por-ean.js, filtrando por el lote de skuId
 *  pedido en vez de por un único EAN objetivo. */
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
  console.log('=== Refrescar precio de extras de Día (sin buscar candidatos nuevos) ===\n');

  let data;
  try {
    data = JSON.parse(fs.readFileSync(RUTA_EXTRAS, 'utf8'));
  } catch {
    console.log(`No existe ${RUTA_EXTRAS} todavía — nada para refrescar. Corré primero completar-dia-por-ean.js.`);
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
    else caidos++;
  }
  nuevosExtras.push(...sinSkuId);

  console.log(`✅ Refrescados: ${nuevosExtras.length - sinSkuId.length}/${skuIds.length}`);
  console.log(`   Caídos (ya no disponibles, se sacan): ${caidos}`);

  const conPromo = nuevosExtras.filter(p => p.descuentoDirecto || p.promosInternas);
  const meta = { fecha: new Date().toISOString(), supermercado: 'Día', seller: SELLER };

  escribirAtomico(RUTA_EXTRAS, JSON.stringify({
    ...meta,
    total_skus: nuevosExtras.length,
    skus: nuevosExtras,
  }, null, 2));

  escribirAtomico('./promos-dia-extras.json', JSON.stringify({
    ...meta,
    total_skus_analizados: nuevosExtras.length,
    total_con_promo: conPromo.length,
    productos: conPromo,
  }, null, 2));

  console.log(`\n=== RESULTADO ===`);
  console.log(`  Extras antes:    ${extrasActuales.length}`);
  console.log(`  Extras ahora:    ${nuevosExtras.length}`);
  console.log(`  Guardado en:     ${RUTA_EXTRAS} + promos-dia-extras.json`);
}

main().catch(err => {
  console.error('Error fatal:', err);
  process.exit(1);
});
