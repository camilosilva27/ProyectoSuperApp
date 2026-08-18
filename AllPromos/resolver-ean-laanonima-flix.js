/**
 * Resuelve el EAN REAL de cada producto de La Anónima, leyendo el atributo `data-flix-ean`
 * que el widget de Flix Media (media.flixfacts.com, contenido enriquecido de fabricante)
 * necesita para funcionar — está en la página de producto individual (`/slug/art_id/`), NO
 * en la de categoría. Confirmado en vivo 2026-08-18: 100% de cobertura en una muestra de 36
 * productos across las 9 categorías de supermercado, incluida marca propia "La Anónima".
 *
 * A diferencia de enriquecer-catalogo-laanonima.js (matching por nombre, best-effort, con
 * error real confirmado ~25% en una muestra de validación), esto es la fuente real — gana
 * siempre que esté disponible.
 *
 * COSTO: una página por producto (no por categoría) — con 8197 SKUs y espaciado conservador,
 * esto tarda horas, no minutos. Por eso NO corre en el cron de refresco de precio (que espera
 * los scrapers en minutos) ni en la VM de producción — se corre acá (dev), una vez, y el
 * resultado (`laanonima-ean-flix.json`, ~150 KB) se commitea. Reintentable/incremental: guarda
 * checkpoint cada CHECKPOINT_CADA productos y, en una corrida futura, saltea los idInterno que
 * ya estén resueltos — así agregar productos nuevos de La Anónima más adelante es barato.
 *
 * Uso:
 *   node resolver-ean-laanonima-flix.js            # resuelve todo lo que falte
 *   node resolver-ean-laanonima-flix.js --limit 20 # solo los primeros N sin resolver (smoke test)
 */

const fs = require('fs');
const path = require('path');

const ARCHIVO_CATALOGO = path.join(__dirname, 'catalogo-laanonima.json');
const ARCHIVO_MAPA = path.join(__dirname, 'laanonima-ean-flix.json');

// HALLAZGO 2026-08-18: la corrida original (headers "desnudos": solo User-Agent) se bloqueó
// después de exactamente ~100 requests en ~3.6 min — un umbral clásico de rate-based rule de
// AWS WAF (100 req/5min es un default común), NO una degradación gradual. El bloqueo fue de
// TODO laanonima.com.ar (incluida la página de categoría, que nunca se había bloqueado antes
// con bajo volumen, y api.laanonima.com.ar, un subdominio distinto) — o sea es por IP, no por
// ruta. Esta versión agrega headers realistas de navegador + cookies de sesión + Referer
// simulando navegación real (categoría → producto), para reducir la chance de que un scoring
// de bot (aparte del rate-limit puro) contribuya al bloqueo. Sigue siendo mucho más lento que
// el scraper de categorías: no corre en el cron ni en la VM (ver cabecera del archivo).
const HEADERS_BASE = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'es-AR,es;q=0.9,en;q=0.8',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'same-origin',
  'Sec-Fetch-User': '?1',
  'Upgrade-Insecure-Requests': '1',
  'sec-ch-ua': '"Chromium";v="120", "Google Chrome";v="120", "Not=A?Brand";v="99"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
};

const DELAY_MS = 4500; // muy por debajo del umbral de ~100/5min encontrado (≈ 66 req/5min)
const RETRY_ESPERA_MS = 10000;
const CHECKPOINT_CADA = 50;
const MAX_ERRORES_CONSECUTIVOS = 5; // circuit breaker: no seguir golpeando una pared

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function leerMapa() {
  try {
    return JSON.parse(fs.readFileSync(ARCHIVO_MAPA, 'utf8'));
  } catch {
    return {};
  }
}

function guardarMapa(mapa) {
  fs.writeFileSync(ARCHIVO_MAPA, JSON.stringify(mapa, null, 2));
}

// Cookie jar mínimo: captura Set-Cookie de cada respuesta y lo reusa en la siguiente request,
// simulando una sesión de navegador continua en vez de requests aislados sin estado.
let cookieJar = '';
function actualizarCookieJar(res) {
  const crudas = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  if (!crudas.length) return;
  const nuevas = Object.fromEntries(crudas.map((c) => c.split(';')[0].split('=')));
  const actuales = Object.fromEntries(cookieJar.split('; ').filter(Boolean).map((c) => c.split('=')));
  cookieJar = Object.entries({ ...actuales, ...nuevas }).map(([k, v]) => `${k}=${v}`).join('; ');
}

/** Visita la categoría de origen antes del producto — arma cookies + un Referer real, en vez
 *  de pedir la página de producto "en frío" sin haber navegado nunca por el sitio. */
async function calentarSesion(urlCategoria) {
  try {
    const res = await fetch(urlCategoria, { headers: { ...HEADERS_BASE, 'Sec-Fetch-Site': 'none' } });
    actualizarCookieJar(res);
    await res.text();
  } catch {
    /* si falla el calentamiento, seguimos igual sin Referer/cookies frescas */
  }
}

/** Envuelve fetch para tratar errores de RED (ECONNRESET, timeout) igual que un 403/429/5xx
 *  — reintentable con backoff, nunca una excepción que tire abajo todo el proceso (bug real
 *  encontrado 2026-08-18: un ECONNRESET sin capturar crasheó la corrida completa). */
async function fetchConReintento(url, headers, retries) {
  try {
    const res = await fetch(url, { headers });
    return { res };
  } catch (err) {
    if (retries <= 0) return { networkError: err.message };
    process.stdout.write(` [error de red: ${err.message}, esperando 10s]`);
    await sleep(RETRY_ESPERA_MS);
    return fetchConReintento(url, headers, retries - 1);
  }
}

async function obtenerFlixEAN(sku, retries = 3) {
  const headers = {
    ...HEADERS_BASE,
    ...(cookieJar ? { Cookie: cookieJar } : {}),
    ...(sku.urlCategoria ? { Referer: sku.urlCategoria } : {}),
  };
  const { res, networkError } = await fetchConReintento(sku.urlProducto, headers, retries);
  if (networkError) return { error: `red: ${networkError}` };

  if ((res.status === 403 || res.status === 429 || res.status >= 500) && retries > 0) {
    process.stdout.write(` [${res.status}, esperando 10s]`);
    await sleep(RETRY_ESPERA_MS);
    return obtenerFlixEAN(sku, retries - 1);
  }
  actualizarCookieJar(res);
  if (!res.ok) return { error: `${res.status} ${res.statusText}` };

  const html = await res.text();
  const m = html.match(/data-flix-ean="([^"]*)"/);
  if (!m) return { ean: null }; // sin widget de Flix en esta página (raro, pero posible)
  return { ean: m[1] || null }; // atributo presente pero vacío: Flix no tiene EAN para esto
}

async function main() {
  const soloLimite = process.argv.includes('--limit')
    ? parseInt(process.argv[process.argv.indexOf('--limit') + 1], 10)
    : null;

  console.log('=== Resolver EAN real de La Anónima (Flix Media) ===\n');

  const catalogo = JSON.parse(fs.readFileSync(ARCHIVO_CATALOGO, 'utf8'));
  const mapa = leerMapa();

  const pendientes = catalogo.skus.filter((s) => !(s.idInterno in mapa) && s.urlProducto);
  const aProcesar = soloLimite ? pendientes.slice(0, soloLimite) : pendientes;

  console.log(`Total SKUs: ${catalogo.skus.length}`);
  console.log(`Ya resueltos (en ${path.basename(ARCHIVO_MAPA)}): ${Object.keys(mapa).length}`);
  console.log(`Pendientes: ${pendientes.length}${soloLimite ? ` (procesando solo ${aProcesar.length})` : ''}\n`);

  if (aProcesar.length) {
    console.log('Calentando sesión (visitando la categoría de origen del primer producto)...');
    await calentarSesion(aProcesar[0].urlCategoria || aProcesar[0].urlProducto);
    await sleep(2000);
  }

  let resueltos = 0;
  let sinFlix = 0;
  let errores = 0;
  let erroresConsecutivos = 0;
  const inicio = Date.now();

  for (let i = 0; i < aProcesar.length; i++) {
    const sku = aProcesar[i];
    const { ean, error } = await obtenerFlixEAN(sku);

    if (error) {
      mapa[sku.idInterno] = { ean: null, error };
      errores++;
      erroresConsecutivos++;
    } else if (ean) {
      mapa[sku.idInterno] = { ean };
      resueltos++;
      erroresConsecutivos = 0;
    } else {
      mapa[sku.idInterno] = { ean: null };
      sinFlix++;
      erroresConsecutivos = 0;
    }

    const transcurridoMin = ((Date.now() - inicio) / 60000).toFixed(1);
    process.stdout.write(
      `\r  ${i + 1}/${aProcesar.length} | resueltos: ${resueltos} | sin flix: ${sinFlix} | errores: ${errores} | ${transcurridoMin} min`
    );

    if ((i + 1) % CHECKPOINT_CADA === 0) {
      guardarMapa(mapa);
      process.stdout.write(' [checkpoint guardado]');
    }

    // Circuit breaker: si venimos de MAX_ERRORES_CONSECUTIVOS fallos seguidos, algo bloqueó
    // la sesión entera (mismo patrón que el bloqueo real de 2026-08-18) — seguir mandando
    // requests solo empeora la situación. Frenar ya, con el progreso ya guardado.
    if (erroresConsecutivos >= MAX_ERRORES_CONSECUTIVOS) {
      guardarMapa(mapa);
      console.log(`\n\n⚠️  ${erroresConsecutivos} errores consecutivos — probablemente bloqueados de nuevo. Corte automático (circuit breaker), progreso guardado.`);
      process.exit(2);
    }

    await sleep(DELAY_MS);
  }

  guardarMapa(mapa);

  console.log('\n\n=== RESULTADO ===');
  console.log(`  Procesados esta corrida: ${aProcesar.length}`);
  console.log(`  Resueltos con EAN:       ${resueltos}`);
  console.log(`  Sin EAN en Flix:         ${sinFlix}`);
  console.log(`  Errores:                 ${errores}`);
  console.log(`  Total en el mapa:        ${Object.keys(mapa).length} / ${catalogo.skus.length}`);
  console.log(`  Guardado en:             ${path.basename(ARCHIVO_MAPA)}`);
}

main().catch((err) => {
  console.error('\nError fatal:', err);
  process.exit(1);
});
