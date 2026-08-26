/**
 * Batch de precio+disponibilidad por skuId contra el endpoint de búsqueda de VTEX
 * (`fq=skuId:X`, repetible). Confirmado en vivo 2026-08-26 en los 6 supers VTEX (Vea, Carrefour,
 * Chango Más, Día, Jumbo, Disco): VTEX trata los `fq=skuId:` repetidos como OR, y devuelve hasta
 * 50 productos por request con `_from=0&_to=49` (mismo tope de página que ya usa la paginación
 * legacy del scraper normal — no es casualidad, es el mismo límite de página del endpoint).
 *
 * Esto es lo que separa "refrescar precio de lo ya conocido" (barato: unas pocas requests de
 * hasta 50 skuId cada una) de "buscar candidatos nuevos" (caro: una request por EAN candidato,
 * porque ahí no sabemos de antemano cuáles van a dar resultado — ver completar-*-por-ean.js).
 *
 * Reutilizado por los 6 refrescar-precio-extras-*.js. El parseo de cada producto (que sí difiere
 * por super — Carrefour/Chango Más/Día traen la promo embebida, Vea/Jumbo/Disco la piden aparte)
 * queda en cada script, esto solo trae los productos crudos.
 */
const https = require('https');

// Mismo fix que completar-*-por-ean.js: agente sin keep-alive, cada request abre su propia
// conexión — evita el problema de `sellers`/`IsAvailable` inconsistente bajo requests seguidos.
const AGENTE_SIN_KEEPALIVE = new https.Agent({ keepAlive: false });

const TAMANO_LOTE = 50;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function chunk(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}

function getJSON(url, headers, retries = 3) {
  return new Promise((resolve, reject) => {
    https.get(url, { agent: AGENTE_SIN_KEEPALIVE, headers }, res => {
      if ((res.statusCode === 429 || res.statusCode >= 500) && retries > 0) {
        res.resume();
        sleep(10000).then(() => resolve(getJSON(url, headers, retries - 1)));
        return;
      }
      // 206 (Partial Content) es la respuesta normal de VTEX cuando hay más resultados que el
      // tamaño de página pedido con `_from`/`_to` — no es un error.
      if (res.statusCode !== 200 && res.statusCode !== 206) {
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

/**
 * Trae los productos VTEX crudos (misma forma que `products/search?fq=alternateIds_Ean`, un
 * array de "product" con `.items[]`) para un lote de skuId, paginando de a `TAMANO_LOTE`.
 * `sc` es opcional — Jumbo/Disco no lo usan, igual que en sus scrapers normales.
 */
async function buscarPorSkuIds(baseUrl, skuIds, { sc, headers, paceMs = 250 } = {}) {
  const lotes = chunk(skuIds, TAMANO_LOTE);
  const productos = [];
  for (let i = 0; i < lotes.length; i++) {
    const fq = lotes[i].map(id => `fq=skuId:${id}`).join('&');
    const scParam = sc ? `&sc=${sc}` : '';
    const url = `${baseUrl}/api/catalog_system/pub/products/search?${fq}${scParam}&_from=0&_to=${lotes[i].length - 1}&_cb=${Date.now()}${Math.random().toString(36).slice(2)}`;
    const resultado = await getJSON(url, headers);
    productos.push(...resultado);
    if (i < lotes.length - 1) await sleep(paceMs);
  }
  return productos;
}

module.exports = { buscarPorSkuIds, chunk };
