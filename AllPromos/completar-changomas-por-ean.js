/**
 * Completa catalogo-changomas.json con productos que Chango Más sí vende pero el scraper normal
 * (scraper-promos-changomas.js) no trajo, por el techo de ~2.550 SKUs del endpoint de
 * paginación masiva de VTEX.
 *
 * MISMO PATRÓN que completar-vea-por-ean.js / completar-carrefour-por-ean.js (2026-08-25):
 * busca puntualmente cada EAN que ya sabemos que existe en Vea, Carrefour, Día o Coto, contra
 * `fq=alternateIds_Ean:{EAN}`. Mismos dos fixes de infraestructura ya encontrados en Vea
 * (cache-busting contra CloudFront + agente `https` sin keep-alive) — ver la cabecera de
 * completar-vea-por-ean.js para el detalle de cómo se encontraron.
 *
 * Salida: NUNCA toca catalogo-changomas.json (eso es 100% del scraper normal, se resetea cada
 * corrida). Escribe/actualiza catalogo-changomas-extras.json — solo lo que aportó este script —
 * y promos-changomas-extras.json. `core/catalogo.js` (leerCatalogo) mezcla base+extras de forma
 * transparente para cualquier consumidor (ver completador_catalogos.md § 6).
 */

const fs = require('fs');
const { escribirAtomico } = require('./core/escrituraAtomica');
const https = require('https');
const { leerCatalogo } = require('./core/catalogo');
const { cargarCheckpoint, guardarCheckpoint, borrarCheckpoint } = require('./core/checkpointEAN');

const BASE_URL = 'https://www.masonline.com.ar';
const SC = 1;
const SELLER = '1';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
  'Accept': 'application/json',
};

const AGENTE_SIN_KEEPALIVE = new https.Agent({ keepAlive: false });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const PACE_MS = 250;

const FUENTES_CANDIDATAS = [
  'catalogo-vea.json',
  'catalogo-carrefour.json',
  'catalogo-dia.json',
  'catalogo-coto.json',
];

function getJSON(url, retries = 3) {
  return new Promise((resolve, reject) => {
    https.get(url, { agent: AGENTE_SIN_KEEPALIVE, headers: HEADERS }, res => {
      if ((res.statusCode === 429 || res.statusCode >= 500) && retries > 0) {
        res.resume();
        process.stdout.write(` [${res.statusCode}, esperando 10s]`);
        sleep(10000).then(() => resolve(getJSON(url, retries - 1)));
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      let body = '';
      res.on('data', c => { body += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch (err) { reject(err); }
      });
    }).on('error', reject);
  });
}

function nombreTeaser(t) {
  return t['<Name>k__BackingField'] ?? t.Name ?? t.name ?? '';
}

function parseTeasers(teasers = []) {
  return teasers
    .map(t => ({
      nombre: nombreTeaser(t),
      esBancaria: /tarjeta|cuenta digital|banco|bin/i.test(nombreTeaser(t)),
    }))
    .filter(t => t.nombre);
}

async function buscarPorEAN(ean) {
  const url = `${BASE_URL}/api/catalog_system/pub/products/search?fq=alternateIds_Ean:${ean}&sc=${SC}&_cb=${Date.now()}${Math.random().toString(36).slice(2)}`;
  const productos = await getJSON(url);
  const skus = [];
  for (const product of productos) {
    for (const sku of product.items || []) {
      const sellerInfo = sku.sellers?.find(s => s.sellerId === SELLER) || sku.sellers?.[0];
      if (!sellerInfo) continue;
      const offer = sellerInfo.commertialOffer;
      if (!offer?.IsAvailable) continue;
      if (String(sku.ean) !== String(ean)) continue;

      const price = offer.Price || 0;
      const listPrice = offer?.ListPrice || 0;
      const teasers = parseTeasers([...(offer?.Teasers || []), ...(offer?.PromotionTeasers || [])]);
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
  return skus;
}

function candidatosDeEAN(eansYaEnChangomas) {
  const vistos = new Map();
  for (const archivo of FUENTES_CANDIDATAS) {
    const data = leerCatalogo(archivo);
    const skus = Array.isArray(data?.skus) ? data.skus : [];
    for (const s of skus) {
      if (!s.ean) continue;
      const ean = String(s.ean);
      if (eansYaEnChangomas.has(ean)) continue;
      if (!vistos.has(ean)) vistos.set(ean, s.productName || s.skuName || s.nombre || null);
    }
  }
  return [...vistos.keys()];
}

const NOMBRE_CHECKPOINT = 'changomas';

async function main() {
  console.log('=== Completar catálogo de Chango Más por EAN (huecos del techo de 2.550) ===\n');

  const actual = leerCatalogo('catalogo-changomas.json');
  const skusActuales = Array.isArray(actual?.skus) ? actual.skus : [];
  const eansYaEnChangomas = new Set(skusActuales.filter(s => s.ean).map(s => String(s.ean)));
  console.log(`Catálogo actual de Chango Más: ${skusActuales.length} SKUs (${eansYaEnChangomas.size} EAN únicos)`);

  let candidatos = candidatosDeEAN(eansYaEnChangomas);

  const argLimit = process.argv.find(a => a.startsWith('--limit='));
  if (argLimit) {
    const n = parseInt(argLimit.split('=')[1], 10);
    if (Number.isFinite(n) && n > 0) candidatos = candidatos.slice(0, n);
  }

  console.log(`EAN candidatos a probar (de Vea/Carrefour/Día/Coto, fuera del catálogo actual): ${candidatos.length}${argLimit ? ' (recortado por --limit)' : ''}\n`);

  const previo = cargarCheckpoint(NOMBRE_CHECKPOINT, candidatos.length);
  const encontrados = previo?.encontrados ?? [];
  const negativos = previo?.negativos ?? [];
  const procesados = new Set(previo?.procesados ?? []);
  let erroresRed = 0;
  if (previo) console.log(`♻️  Retomando checkpoint: ${procesados.size}/${candidatos.length} ya procesados, ${encontrados.length} encontrados hasta ahora.\n`);

  // Un solo intento por EAN candidato — se sacó la segunda pasada de reintento de negativos
  // (medida en vivo 2026-08-25/26: 3 recuperados sobre ~16.650 negativos verificados en los 6
  // supers, ~0.02%; no valía el ~40-50% extra de tiempo que agregaba a cada corrida, ver
  // completador_catalogos.md § 8 punto 4).
  console.log('📦 Barrido por EAN (un intento cada uno)...');
  for (let i = 0; i < candidatos.length; i++) {
    const ean = candidatos[i];
    if (procesados.has(ean)) continue;
    let skus;
    try {
      skus = await buscarPorEAN(ean);
    } catch (err) {
      erroresRed++;
      skus = [];
    }
    if (skus.length) encontrados.push(...skus);
    else negativos.push(ean);
    procesados.add(ean);

    if (procesados.size % 50 === 0 || i === candidatos.length - 1) {
      process.stdout.write(`\r  ${procesados.size}/${candidatos.length} consultados — ${encontrados.length} encontrados, ${negativos.length} sin resultado, ${erroresRed} errores de red`);
      guardarCheckpoint(NOMBRE_CHECKPOINT, { totalCandidatos: candidatos.length, procesados: [...procesados], encontrados, negativos });
    }
    await sleep(PACE_MS);
  }
  console.log(`\n✅ Barrido terminado: ${encontrados.length} encontrados, ${negativos.length} sin resultado.\n`);

  console.log(`✅ Nuevos SKUs encontrados en Chango Más: ${encontrados.length}`);
  console.log(`   Negativos: ${negativos.length}`);
  console.log(`   Errores de red: ${erroresRed}`);

  if (!encontrados.length) {
    console.log('\nNada para agregar — no se toca catalogo-changomas-extras.json.');
    borrarCheckpoint(NOMBRE_CHECKPOINT);
    return;
  }

  // Extras existentes (archivo aparte del catalogo-changomas.json que reescribe el scraper
  // normal — ver completador_catalogos.md § 6): se le suman los nuevos hits de esta corrida.
  const RUTA_EXTRAS = './catalogo-changomas-extras.json';
  let extrasActuales = [];
  try {
    const dataExtras = JSON.parse(fs.readFileSync(RUTA_EXTRAS, 'utf8'));
    extrasActuales = Array.isArray(dataExtras.skus) ? dataExtras.skus : [];
  } catch { /* todavía no hay extras */ }

  const extrasCompleto = [...extrasActuales, ...encontrados];
  const conPromo = extrasCompleto.filter(p => p.descuentoDirecto || p.promosInternas);

  const meta = { fecha: new Date().toISOString(), supermercado: 'Chango Más', seller: SELLER };

  escribirAtomico(RUTA_EXTRAS, JSON.stringify({
    ...meta,
    total_skus: extrasCompleto.length,
    skus: extrasCompleto,
  }, null, 2));

  escribirAtomico('./promos-changomas-extras.json', JSON.stringify({
    ...meta,
    total_skus_analizados: extrasCompleto.length,
    total_con_promo: conPromo.length,
    productos: conPromo,
  }, null, 2));

  console.log(`=== RESULTADO ===`);
  console.log(`  Extras antes:                   ${extrasActuales.length}`);
  console.log(`  Extras nuevos esta corrida:      ${encontrados.length}`);
  console.log(`  Extras totales ahora:            ${extrasCompleto.length}`);
  console.log(`  Catálogo total (base + extras):  ${skusActuales.length + encontrados.length}`);
  console.log(`  Guardado en:                     catalogo-changomas-extras.json + promos-changomas-extras.json`);
  borrarCheckpoint(NOMBRE_CHECKPOINT);
}

main().catch(err => {
  console.error('Error fatal:', err);
  process.exit(1);
});
