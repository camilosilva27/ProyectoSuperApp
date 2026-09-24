/**
 * Helpers compartidos por los 6 scrapers VTEX (`scraper-promos-{vea,jumbo,disco,carrefour,
 * changomas,dia}.js`). Extraído el 2026-09-24 (auditoría) de la lógica que cada scraper tenía
 * copiada inline en `getCatalogPage` (retry por error de red + 429/5xx, 3 intentos de 10s —
 * ver commits 0116118 / de7337d y CONTEXTO_TECNICO.md § "Glitches de scraper"), para poder
 * reusarla también en `_v/search-promotions` (Vea/Jumbo/Disco), que no tenía NINGÚN retry y
 * ante un 429/5xx guardaba el lote sin promos en silencio.
 *
 * Sin console.log (regla de core/): el aviso de progreso lo imprime el scraper vía `onReintento`.
 */
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const REINTENTOS = 3;
const ESPERA_MS = 10000;
// Timeout por intento. Sin esto, un socket colgado espera el default de undici (~300s) por
// cada intento; 60s sobra para una página de 50 productos (normalmente <2s).
const TIMEOUT_MS = 60000;

/**
 * fetch con reintento ante error de red/timeout y ante 429/5xx. Si se agotan los intentos:
 * error de red → lanza; 429/5xx → devuelve la última respuesta (el llamador decide con res.ok).
 */
async function fetchConReintentoHTTP(url, opts = {}, {
  reintentos = REINTENTOS, esperaMs = ESPERA_MS, timeoutMs = TIMEOUT_MS, onReintento = () => {}, esperar = sleep,
} = {}) {
  for (let intento = 0; ; intento++) {
    const quedan = intento < reintentos;
    let res;
    try {
      res = await fetch(url, { ...opts, signal: AbortSignal.timeout(timeoutMs) });
    } catch (err) {
      if (!quedan) throw err;
      onReintento(` [error de red, esperando ${Math.round(esperaMs / 1000)}s]`);
      await esperar(esperaMs);
      continue;
    }
    if ((res.status === 429 || res.status >= 500) && quedan) {
      onReintento(` [${res.status}, esperando ${Math.round(esperaMs / 1000)}s]`);
      await esperar(esperaMs);
      continue;
    }
    return res;
  }
}

/** Error con el status HTTP adjunto, para que el loop de paginación pueda distinguir el 400 del techo. */
function errorHTTP(prefijo, res) {
  const err = new Error(`${prefijo}: ${res.status} ${res.statusText}`);
  err.status = res.status;
  return err;
}

// Techo documentado del endpoint legacy `catalog_system/pub/products/search`: pedir `_from`
// más allá de ~2550 responde 400 (CONTEXTO_TECNICO.md § "Límite de paginación de ~2550
// ítems"). Ese 400 ES el fin legítimo de la paginación. Cualquier OTRO error de página
// (429/5xx que sobrevivió a los reintentos, error de red, JSON roto, o un 400 muy antes del
// techo) antes se trataba igual ("catch → break") y se guardaba un catálogo truncado; ahora
// aborta la corrida. El margen (2000, no 2550) es por si VTEX mueve el techo un poco.
const DESDE_MINIMO_TECHO_VTEX = 2000;

function esFinLegitimoDePaginacion(err, from) {
  return err?.status === 400 && from >= DESDE_MINIMO_TECHO_VTEX;
}

module.exports = { fetchConReintentoHTTP, errorHTTP, esFinLegitimoDePaginacion, DESDE_MINIMO_TECHO_VTEX };
