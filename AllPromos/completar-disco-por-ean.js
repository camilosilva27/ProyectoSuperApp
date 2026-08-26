/**
 * Completa catalogo-disco.json con productos que Disco sí vende pero el scraper normal
 * (scraper-promos-disco.js) no trajo, por el techo de ~2.550 SKUs del endpoint de paginación
 * masiva de VTEX.
 *
 * MISMO PATRÓN que completar-vea-por-ean.js (2026-08-25) — de hecho usa exactamente el mismo
 * esquema de catálogo que Vea (precio + `promocion` vía `_v/search-promotions`, no promos
 * embebidas como Carrefour/Chango Más/Día), porque Disco comparte la MISMA cuenta VTEX que Vea
 * (mismo EAN/master data, ver scraper-promos-disco.js). Aun así, cada sitio pagina su propio
 * top ~2.550 por relevancia/ventas DE ESE SITIO, así que el recorte de Disco puede diferir del
 * de Vea — por eso vale la pena cruzar Disco también contra Vea y Jumbo, no solo contra
 * Carrefour/Chango Más/Día/Coto.
 *
 * Mismos dos fixes de infraestructura que Vea (cache-bust contra CloudFront + agente https sin
 * keep-alive) — ver la cabecera de completar-vea-por-ean.js para el detalle. Sin `sc=` acá,
 * igual que el scraper normal de Disco (no hizo falta para Jumbo/Disco, a diferencia de Vea).
 *
 * Salida: NUNCA toca catalogo-disco.json (eso es 100% del scraper normal, se resetea cada
 * corrida). Escribe/actualiza catalogo-disco-extras.json — solo lo que aportó este script — y
 * promos-disco-extras.json. `core/catalogo.js` (leerCatalogo) mezcla base+extras de forma
 * transparente para cualquier consumidor (ver completador_catalogos.md § 6).
 */

const fs = require('fs');
const https = require('https');
const { leerCatalogo } = require('./core/catalogo');
const { cargarCheckpoint, guardarCheckpoint, borrarCheckpoint } = require('./core/checkpointEAN');

const PROMO_SELLER = 'discoargentinav700cordoba700';
const BASE_URL = 'https://www.disco.com.ar';

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
  'catalogo-changomas.json',
  'catalogo-dia.json',
  'catalogo-coto.json',
  'catalogo-jumbo.json',
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
      res.on('end', () => { try { resolve(JSON.parse(chunk)); } catch { resolve(null); } });
    });
    req.on('error', () => resolve(null));
    req.write(payload);
    req.end();
  });
}

async function buscarPorEAN(ean) {
  const url = `${BASE_URL}/api/catalog_system/pub/products/search?fq=alternateIds_Ean:${ean}&_cb=${Date.now()}${Math.random().toString(36).slice(2)}`;
  const productos = await getJSON(url);
  const skus = [];
  for (const product of productos) {
    for (const sku of product.items || []) {
      if (!sku.sellers?.length) continue;
      const sellerInfo = sku.sellers[0];
      if (!sellerInfo?.commertialOffer?.IsAvailable) continue;
      if (String(sku.ean) !== String(ean)) continue;
      skus.push({
        skuId: sku.itemId,
        ean: sku.ean,
        productName: product.productName,
        skuName: sku.name,
        categoria: product.categories?.[0]?.replace(/\//g, ' > ').replace(/^ > | > $/g, '') || null,
        price: sellerInfo?.commertialOffer?.Price || 0,
        seller: sellerInfo?.sellerId || '1',
        imagenUrl: sku.images?.[0]?.imageUrl || null,
      });
    }
  }
  return skus;
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

function candidatosDeEAN(eansYaEnDisco) {
  const vistos = new Map();
  for (const archivo of FUENTES_CANDIDATAS) {
    const data = leerCatalogo(archivo);
    const skus = Array.isArray(data?.skus) ? data.skus : [];
    for (const s of skus) {
      if (!s.ean) continue;
      const ean = String(s.ean);
      if (eansYaEnDisco.has(ean)) continue;
      if (!vistos.has(ean)) vistos.set(ean, s.productName || s.skuName || s.nombre || null);
    }
  }
  return [...vistos.keys()];
}

const NOMBRE_CHECKPOINT = 'disco';

async function main() {
  console.log('=== Completar catálogo de Disco por EAN (huecos del techo de 2.550) ===\n');

  const actual = leerCatalogo('catalogo-disco.json');
  const skusActuales = Array.isArray(actual?.skus) ? actual.skus : [];
  const eansYaEnDisco = new Set(skusActuales.filter(s => s.ean).map(s => String(s.ean)));
  console.log(`Catálogo actual de Disco: ${skusActuales.length} SKUs (${eansYaEnDisco.size} EAN únicos)`);

  let candidatos = candidatosDeEAN(eansYaEnDisco);

  const argLimit = process.argv.find(a => a.startsWith('--limit='));
  if (argLimit) {
    const n = parseInt(argLimit.split('=')[1], 10);
    if (Number.isFinite(n) && n > 0) candidatos = candidatos.slice(0, n);
  }

  console.log(`EAN candidatos a probar (de Vea/Carrefour/Chango Más/Día/Coto/Jumbo, fuera del catálogo actual): ${candidatos.length}${argLimit ? ' (recortado por --limit)' : ''}\n`);

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

  console.log(`✅ Nuevos SKUs encontrados en Disco: ${encontrados.length}`);
  console.log(`   Negativos: ${negativos.length}`);
  console.log(`   Errores de red: ${erroresRed}`);

  if (!encontrados.length) {
    console.log('\nNada para agregar — no se toca catalogo-disco-extras.json.');
    borrarCheckpoint(NOMBRE_CHECKPOINT);
    return;
  }

  console.log('\n🏷️  Consultando promociones de los nuevos SKUs...');
  const skuIds = encontrados.map(s => s.skuId);
  const batches = chunk(skuIds, 10);
  const promosNuevas = {};
  for (let i = 0; i < batches.length; i++) {
    process.stdout.write(`\r  Lote ${i + 1}/${batches.length}...`);
    Object.assign(promosNuevas, await getPromotionsForSkus(batches[i]));
    await sleep(200);
  }
  console.log(`\n✅ Nuevos SKUs con promo: ${Object.keys(promosNuevas).length}\n`);

  const nuevosConPromo = encontrados.map(sku => {
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

  // Extras existentes (archivo aparte del catalogo-disco.json que reescribe el scraper normal
  // — ver completador_catalogos.md § 6): se le suman los nuevos hits de esta corrida.
  const RUTA_EXTRAS = './catalogo-disco-extras.json';
  let extrasActuales = [];
  try {
    const dataExtras = JSON.parse(fs.readFileSync(RUTA_EXTRAS, 'utf8'));
    extrasActuales = Array.isArray(dataExtras.skus) ? dataExtras.skus : [];
  } catch { /* todavía no hay extras */ }

  const extrasCompleto = [...extrasActuales, ...nuevosConPromo];
  const conPromo = extrasCompleto.filter(p => p.promocion !== null);

  const meta = { fecha: new Date().toISOString(), supermercado: 'Disco', seller: PROMO_SELLER };

  fs.writeFileSync(RUTA_EXTRAS, JSON.stringify({
    ...meta,
    total_skus: extrasCompleto.length,
    skus: extrasCompleto,
  }, null, 2));

  fs.writeFileSync('./promos-disco-extras.json', JSON.stringify({
    ...meta,
    total_skus_analizados: extrasCompleto.length,
    total_con_promo: conPromo.length,
    productos: conPromo,
  }, null, 2));

  console.log(`=== RESULTADO ===`);
  console.log(`  Extras antes:                   ${extrasActuales.length}`);
  console.log(`  Extras nuevos esta corrida:      ${nuevosConPromo.length}`);
  console.log(`  Extras totales ahora:            ${extrasCompleto.length}`);
  console.log(`  Catálogo total (base + extras):  ${skusActuales.length + nuevosConPromo.length}`);
  console.log(`  Guardado en:                     catalogo-disco-extras.json + promos-disco-extras.json`);
  borrarCheckpoint(NOMBRE_CHECKPOINT);
}

main().catch(err => {
  console.error('Error fatal:', err);
  process.exit(1);
});
