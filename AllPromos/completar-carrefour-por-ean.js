/**
 * Completa catalogo-carrefour.json con productos que Carrefour sí vende pero el scraper normal
 * (scraper-promos-carrefour.js) no trajo, por el techo de ~2.550 SKUs del endpoint de
 * paginación masiva (`_from`/`_to` — no es una decisión, es un techo de la API).
 *
 * MISMO PATRÓN que completar-vea-por-ean.js (2026-08-25, primero probado ahí): busca
 * puntualmente cada EAN que ya sabemos que existe en Vea, Chango Más, Día o Coto, contra
 * `fq=alternateIds_Ean:{EAN}` de VTEX — un camino distinto del de paginación masiva, sin ese
 * techo. Jumbo y Disco quedan afuera de los candidatos: comparten la misma cuenta VTEX que Vea
 * (no Carrefour), así que sus EAN ya están cubiertos por lo que aporta Vea.
 *
 * DOS PROBLEMAS DE INFRAESTRUCTURA encontrados en vivo con Vea (2026-08-25, se replican acá
 * tal cual porque es la misma plataforma VTEX + CloudFront delante):
 *   1. CloudFront cachea una respuesta vacía por `s-maxage=300` (5 min) — se necesita un
 *      parámetro de cache-busting único por request (`_cb`).
 *   2. `fetch`/undici con keep-alive puede devolver un producto con `sellers: []` (o con
 *      `IsAvailable: false`) para un EAN que sí existe, tras varios requests seguidos al mismo
 *      host — se necesita `https` nativo de Node con un agente `keepAlive: false`.
 * A diferencia de Vea, acá también hay que sumar el problema YA CONOCIDO de Carrefour: rate
 * limit real con 429 frecuente (documentado en `scraper-promos-carrefour.js` y
 * `AllPromos/CLAUDE.md`) — el retry con backoff de 10s de más abajo es el mismo patrón que ya
 * usa el scraper normal, no algo nuevo.
 *
 * Salida: NUNCA toca catalogo-carrefour.json (eso es 100% del scraper normal, se resetea cada
 * corrida). Escribe/actualiza catalogo-carrefour-extras.json — solo lo que aportó este script —
 * y promos-carrefour-extras.json. `core/catalogo.js` (leerCatalogo) mezcla base+extras de forma
 * transparente para cualquier consumidor (ver completador_catalogos.md § 6).
 */

const fs = require('fs');
const { escribirAtomico } = require('./core/escrituraAtomica');
const https = require('https');
const { leerCatalogo } = require('./core/catalogo');
const { cargarCheckpoint, guardarCheckpoint, borrarCheckpoint } = require('./core/checkpointEAN');

const BASE_URL = 'https://www.carrefour.com.ar';
const SC = 1;
const SELLER = '1';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
  'Accept': 'application/json',
};

// Mismo fix que completar-vea-por-ean.js: agente sin keep-alive, cada request abre su propia
// conexión — evita el problema de `sellers`/`IsAvailable` inconsistente bajo requests seguidos.
const AGENTE_SIN_KEEPALIVE = new https.Agent({ keepAlive: false });

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const PACE_MS = 250;

const FUENTES_CANDIDATAS = [
  'catalogo-vea.json',
  'catalogo-changomas.json',
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

// Copiado sin cambios de scraper-promos-carrefour.js — misma forma de datos, mismo parseo.
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

async function buscarPorEAN(ean) {
  // `_cb` (cache-bust): necesario contra CloudFront, ver cabecera del archivo.
  const url = `${BASE_URL}/api/catalog_system/pub/products/search?fq=alternateIds_Ean:${ean}&sc=${SC}&_cb=${Date.now()}${Math.random().toString(36).slice(2)}`;
  const productos = await getJSON(url);
  const skus = [];
  for (const product of productos) {
    for (const sku of product.items || []) {
      const sellerInfo = sku.sellers?.find(s => s.sellerId === SELLER) || sku.sellers?.[0];
      if (!sellerInfo) continue;
      const offer = sellerInfo.commertialOffer;
      if (!offer?.IsAvailable) continue;
      // Confirmación extra: el fq puede devolver variantes/relacionados además del EAN pedido.
      if (String(sku.ean) !== String(ean)) continue;

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

function candidatosDeEAN(eansYaEnCarrefour) {
  const vistos = new Map();
  for (const archivo of FUENTES_CANDIDATAS) {
    const data = leerCatalogo(archivo);
    const skus = Array.isArray(data?.skus) ? data.skus : [];
    for (const s of skus) {
      if (!s.ean) continue;
      const ean = String(s.ean);
      if (eansYaEnCarrefour.has(ean)) continue;
      if (!vistos.has(ean)) vistos.set(ean, s.productName || s.skuName || s.nombre || null);
    }
  }
  return [...vistos.keys()];
}

const NOMBRE_CHECKPOINT = 'carrefour';

async function main() {
  console.log('=== Completar catálogo de Carrefour por EAN (huecos del techo de 2.550) ===\n');

  const actual = leerCatalogo('catalogo-carrefour.json');
  const skusActuales = Array.isArray(actual?.skus) ? actual.skus : [];
  const eansYaEnCarrefour = new Set(skusActuales.filter(s => s.ean).map(s => String(s.ean)));
  console.log(`Catálogo actual de Carrefour: ${skusActuales.length} SKUs (${eansYaEnCarrefour.size} EAN únicos)`);

  let candidatos = candidatosDeEAN(eansYaEnCarrefour);

  const argLimit = process.argv.find(a => a.startsWith('--limit='));
  if (argLimit) {
    const n = parseInt(argLimit.split('=')[1], 10);
    if (Number.isFinite(n) && n > 0) candidatos = candidatos.slice(0, n);
  }

  console.log(`EAN candidatos a probar (de Vea/Chango Más/Día/Coto, fuera del catálogo actual): ${candidatos.length}${argLimit ? ' (recortado por --limit)' : ''}\n`);

  // Retoma un checkpoint si existe y corresponde a este mismo conjunto de candidatos — estos
  // scripts tardan 20-40 min y ya se cortaron solos sin error visible más de una vez en esta
  // sesión; sin esto, cada corte hacía perder todo el progreso y arrancar de cero.
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

  console.log(`✅ Nuevos SKUs encontrados en Carrefour: ${encontrados.length}`);
  console.log(`   Negativos: ${negativos.length}`);
  console.log(`   Errores de red: ${erroresRed}`);

  if (!encontrados.length) {
    console.log('\nNada para agregar — no se toca catalogo-carrefour-extras.json.');
    borrarCheckpoint(NOMBRE_CHECKPOINT);
    return;
  }

  // Extras existentes (archivo aparte del catalogo-carrefour.json que reescribe el scraper
  // normal — ver completador_catalogos.md § 6): se le suman los nuevos hits de esta corrida.
  const RUTA_EXTRAS = './catalogo-carrefour-extras.json';
  let extrasActuales = [];
  try {
    const dataExtras = JSON.parse(fs.readFileSync(RUTA_EXTRAS, 'utf8'));
    extrasActuales = Array.isArray(dataExtras.skus) ? dataExtras.skus : [];
  } catch { /* todavía no hay extras */ }

  const extrasCompleto = [...extrasActuales, ...encontrados];
  const conPromo = extrasCompleto.filter(p => p.descuentoDirecto || p.promosInternas);

  const meta = { fecha: new Date().toISOString(), supermercado: 'Carrefour', seller: SELLER };

  escribirAtomico(RUTA_EXTRAS, JSON.stringify({
    ...meta,
    total_skus: extrasCompleto.length,
    skus: extrasCompleto,
  }, null, 2));

  escribirAtomico('./promos-carrefour-extras.json', JSON.stringify({
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
  console.log(`  Guardado en:                     catalogo-carrefour-extras.json + promos-carrefour-extras.json`);
  borrarCheckpoint(NOMBRE_CHECKPOINT);
}

main().catch(err => {
  console.error('Error fatal:', err);
  process.exit(1);
});
