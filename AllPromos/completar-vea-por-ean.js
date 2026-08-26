/**
 * Completa catalogo-vea.json con productos que Vea sí vende pero el scraper normal
 * (scraper-promos-vea.js) no trajo, por el techo de ~2.550 SKUs del endpoint de paginación
 * masiva (`_from`/`_to` — no es una decisión, es un techo de la API, ver CONTEXTO_TECNICO.md).
 *
 * MISMO PATRÓN que scraper-coto-por-ean.js (2026-08-25): en vez de pedir más páginas (imposible,
 * el techo es duro), busca puntualmente cada EAN que YA sabemos que existe en Carrefour, Chango
 * Más, Día o Coto, contra el endpoint de búsqueda por EAN de VTEX (`fq=alternateIds_Ean:{EAN}`)
 * — un camino totalmente distinto del de paginación masiva, sin ese techo (confirmado en vivo:
 * encontró "Lavandina Ayudín" en Vea buscando por un EAN que solo estaba en el catálogo local
 * de Carrefour). Este mismo endpoint ya se usa HOY en producción para pedir precio en vivo de
 * un producto que el catálogo local ya conoce (`core/fetchers.js`, veaLive()) — acá se usa por
 * primera vez para CONSTRUIR el catálogo, no solo consultarlo.
 *
 * Jumbo y Disco quedan afuera de los candidatos: comparten la misma cuenta VTEX que Vea (mismo
 * EAN/master data, confirmado en scraper-promos-jumbo.js), así que no aportan ningún EAN que
 * Vea ya no pueda tener.
 *
 * OJO — nota vieja de AllPromos/CLAUDE.md: "`fq=alternateIds_Ean` no es confiable en la API de
 * Vea", por eso el fetch en vivo prioriza `skuId` cuando lo tiene. Acá NO hay skuId para un
 * candidato que viene de otro super (es justamente lo que no sabemos), así que este script
 * corre 100% sobre el camino que esa nota marca como menos confiable — por eso se testea en
 * escalones (--limit chico, después mediano, recién después completo) en vez de ir directo a
 * los ~4.000 candidatos de una.
 *
 * Salida: NUNCA toca catalogo-vea.json (eso es 100% del scraper normal, se resetea cada
 * corrida). Escribe/actualiza catalogo-vea-extras.json — solo lo que aportó este script — y
 * promos-vea-extras.json. `core/catalogo.js` (leerCatalogo) mezcla base+extras de forma
 * transparente para cualquier consumidor (ver completador_catalogos.md § 6).
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const { leerCatalogo } = require('./core/catalogo');

const SELLER = 'jumboargentinav700cordoba700';
const BASE_URL = 'https://www.vea.com.ar';
const SC = 34;

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
  'Accept': 'application/json',
};

// CAUSA RAÍZ encontrada en vivo 2026-08-25 (la que de verdad importaba, no cosmética): con
// keep-alive (el default de `fetch`/undici), después de varios requests seguidos a EAN
// distintos contra este host, algunos devolvían un producto con `sellers: []` — el catálogo
// SÍ lo encontraba pero sin datos de precio/disponibilidad, así que se descartaba como si no
// existiera. Reproducido 3/3 veces con `fetch` (con o sin header `Connection: close`, que
// `fetch`/undici no termina de respetar para esto), 0/4 veces usando `https` nativo de Node
// con un agente `keepAlive: false` — cada request abre su propia conexión, nada para reusar
// mal. Cache-busting (más abajo) solucionaba un problema relacionado pero distinto (CloudFront
// cacheando una respuesta vacía 5 minutos) y por sí solo no alcanzaba.
const AGENTE_SIN_KEEPALIVE = new https.Agent({ keepAlive: false });

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Ritmo conservador a propósito: a diferencia de Coto (que publicó un rate limit real en los
// headers), VTEX no documenta ninguno acá — no hay un número contra el cual calibrar, así que
// se arranca lento y se sube solo si los escalones de prueba salen limpios.
const PACE_MS = 250;

const FUENTES_CANDIDATAS = [
  'catalogo-carrefour.json',
  'catalogo-changomas.json',
  'catalogo-dia.json',
  'catalogo-coto.json',
];

function getJSON(url, retries = 3) {
  return new Promise((resolve, reject) => {
    https.get(url, { agent: AGENTE_SIN_KEEPALIVE, headers: HEADERS }, res => {
      if ((res.statusCode === 429 || res.statusCode >= 500) && retries > 0) {
        res.resume(); // drena el body para liberar el socket antes de reintentar
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

async function buscarPorEAN(ean) {
  // `_cb` (cache-bust): esta URL responde detrás de CloudFront con `s-maxage=300` (confirmado
  // en vivo: `x-cache: Hit from cloudfront`) — sin esto, una respuesta vacía por cualquier
  // motivo transitorio queda cacheada 5 minutos enteros, y ni reintentar ni el fix de arriba
  // ayudan durante esa ventana. Un parámetro único por request fuerza "Miss" siempre.
  const url = `${BASE_URL}/api/catalog_system/pub/products/search?fq=alternateIds_Ean:${ean}&sc=${SC}&_cb=${Date.now()}${Math.random().toString(36).slice(2)}`;
  const productos = await getJSON(url);
  if (process.env.DEBUG_VEA_EAN) console.error(`\nDEBUG ${ean}: productos.length=${productos.length}`, JSON.stringify(productos).slice(0, 300));
  const skus = [];
  for (const product of productos) {
    for (const sku of product.items || []) {
      if (!sku.sellers?.length) { if (process.env.DEBUG_VEA_EAN) console.error(`DEBUG ${ean}: sin sellers`); continue; }
      const sellerInfo = sku.sellers.find(s => s.sellerId === SELLER) || sku.sellers[0];
      if (!sellerInfo?.commertialOffer?.IsAvailable) { if (process.env.DEBUG_VEA_EAN) console.error(`DEBUG ${ean}: IsAvailable false`); continue; } // SKU sin stock — mismo criterio que el scraper normal
      // Confirmación extra: el fq puede devolver variantes/relacionados además del EAN pedido.
      if (String(sku.ean) !== String(ean)) { if (process.env.DEBUG_VEA_EAN) console.error(`DEBUG ${ean}: EAN no matchea, sku.ean=${JSON.stringify(sku.ean)}`); continue; }
      skus.push({
        skuId: sku.itemId,
        ean: sku.ean,
        productName: product.productName,
        skuName: sku.name,
        categoria: product.categories?.[0]?.replace(/\//g, ' > ').replace(/^ > | > $/g, '') || null,
        price: sellerInfo?.commertialOffer?.Price || 0,
        seller: sellerInfo?.sellerId || SELLER,
        imagenUrl: sku.images?.[0]?.imageUrl || null,
      });
    }
  }
  return skus;
}

// `fq=alternateIds_Ean` puede devolver vacío para un EAN que sí existe. CAUSA encontrada en
// vivo 2026-08-25 con DEBUG_VEA_EAN=1: el flag `IsAvailable` que devuelve VTEX para un mismo
// EAN es en sí mismo inconsistente entre requests — el producto aparece (`productos.length: 1`)
// pero con `IsAvailable: false` en un intento y `true` en otro, sin ningún cambio real de stock
// de por medio (reproducido con "Lavandina Ayudín": false, false de nuevo 800ms después, true
// en una consulta aislada más tarde). No es algo que un cliente pueda evitar pidiendo distinto
// — es una inconsistencia real del backend de Vea, y la única mitigación que funciona es
// reintentar con una espera GENUINA (segundos, no cientos de ms). Por eso `main()` más abajo
// separa una pasada rápida (un intento por EAN) de una segunda pasada, más lenta, solo sobre
// los que dieron negativo en la primera.

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

// Mismo motivo que buscarPorEAN: agente sin keep-alive para no repetir el problema de sellers
// vacíos por conexión reusada, acá aplicado a los lotes de `_v/search-promotions`.
async function getPromotionsForSkus(skuIds) {
  if (!skuIds.length) return {};
  const data = await postJSON(`${BASE_URL}/_v/search-promotions`, { seller: SELLER, skus: skuIds });
  return data?.promotions?.generic?.promotions || {};
}

function chunk(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}

function candidatosDeEAN(eansYaEnVea) {
  const vistos = new Map();
  for (const archivo of FUENTES_CANDIDATAS) {
    const data = leerCatalogo(archivo);
    const skus = Array.isArray(data?.skus) ? data.skus : [];
    for (const s of skus) {
      if (!s.ean) continue;
      const ean = String(s.ean);
      if (eansYaEnVea.has(ean)) continue;
      if (!vistos.has(ean)) vistos.set(ean, s.productName || s.skuName || s.nombre || null);
    }
  }
  return [...vistos.keys()];
}

async function main() {
  console.log('=== Completar catálogo de Vea por EAN (huecos del techo de 2.550) ===\n');

  const actual = leerCatalogo('catalogo-vea.json');
  const skusActuales = Array.isArray(actual?.skus) ? actual.skus : [];
  const eansYaEnVea = new Set(skusActuales.filter(s => s.ean).map(s => String(s.ean)));
  console.log(`Catálogo actual de Vea: ${skusActuales.length} SKUs (${eansYaEnVea.size} EAN únicos)`);

  let candidatos = candidatosDeEAN(eansYaEnVea);

  const argLimit = process.argv.find(a => a.startsWith('--limit='));
  if (argLimit) {
    const n = parseInt(argLimit.split('=')[1], 10);
    if (Number.isFinite(n) && n > 0) candidatos = candidatos.slice(0, n);
  }

  console.log(`EAN candidatos a probar (de Carrefour/Chango Más/Día/Coto, fuera del catálogo actual): ${candidatos.length}${argLimit ? ' (recortado por --limit)' : ''}\n`);

  const encontrados = [];
  const negativos = []; // EAN sin resultado en la pasada 1 — no son negativos confirmados todavía
  let erroresRed = 0;

  // Un solo intento por EAN candidato — se sacó la segunda pasada de reintento de negativos
  // (medida en vivo 2026-08-25/26: 3 recuperados sobre ~16.650 negativos verificados en los 6
  // supers, ~0.02%; no valía el ~40-50% extra de tiempo que agregaba a cada corrida, ver
  // completador_catalogos.md § 8 punto 4).
  console.log('📦 Barrido por EAN (un intento cada uno)...');
  for (let i = 0; i < candidatos.length; i++) {
    const ean = candidatos[i];
    let skus;
    try {
      skus = await buscarPorEAN(ean);
    } catch (err) {
      erroresRed++;
      skus = [];
    }
    if (skus.length) encontrados.push(...skus);
    else negativos.push(ean);

    if ((i + 1) % 50 === 0 || i === candidatos.length - 1) {
      process.stdout.write(`\r  ${i + 1}/${candidatos.length} consultados — ${encontrados.length} encontrados, ${negativos.length} sin resultado, ${erroresRed} errores de red`);
    }
    await sleep(PACE_MS);
  }
  console.log(`\n✅ Barrido terminado: ${encontrados.length} encontrados, ${negativos.length} sin resultado.\n`);

  console.log(`✅ Nuevos SKUs encontrados en Vea: ${encontrados.length}`);
  console.log(`   Negativos: ${negativos.length}`);
  console.log(`   Errores de red: ${erroresRed}`);

  if (!encontrados.length) {
    console.log('\nNada para agregar — no se toca catalogo-vea-extras.json.');
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

  // Extras existentes (archivo aparte del catalogo-vea.json que reescribe el scraper normal —
  // ver completador_catalogos.md § 6): se le suman los nuevos hits de esta corrida.
  const RUTA_EXTRAS = './catalogo-vea-extras.json';
  let extrasActuales = [];
  try {
    const dataExtras = JSON.parse(fs.readFileSync(RUTA_EXTRAS, 'utf8'));
    extrasActuales = Array.isArray(dataExtras.skus) ? dataExtras.skus : [];
  } catch { /* todavía no hay extras */ }

  const extrasCompleto = [...extrasActuales, ...nuevosConPromo];
  const conPromo = extrasCompleto.filter(p => p.promocion !== null);

  const meta = { fecha: new Date().toISOString(), supermercado: 'Vea', seller: SELLER };

  fs.writeFileSync(RUTA_EXTRAS, JSON.stringify({
    ...meta,
    total_skus: extrasCompleto.length,
    skus: extrasCompleto,
  }, null, 2));

  fs.writeFileSync('./promos-vea-extras.json', JSON.stringify({
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
  console.log(`  Guardado en:                     catalogo-vea-extras.json + promos-vea-extras.json`);
}

main().catch(err => {
  console.error('Error fatal:', err);
  process.exit(1);
});
