/**
 * Cobertura de La Anónima por código postal.
 *
 * OJO — esto NO selecciona un precio distinto por zona. El spike técnico (2026-08-17)
 * confirmó que el HTML de una página de categoría es BYTE A BYTE IDÉNTICO sin importar qué
 * CP/zona se le pase (probado con query params y comparando directamente el HTML servido para
 * un CP con cobertura vs uno sin cobertura) — no hay cookie de sesión ni mecanismo de zona que
 * afecte el precio mostrado. `api.laanonima.com.ar/sucursal/{cp}` es solo información de
 * disponibilidad de compra (¿hay sucursal de supermercado en esta zona?), no de precio.
 *
 * Por eso el único rol de este módulo es el gate binario de cobertura: si el CP del usuario no
 * tiene venta de supermercado online, La Anónima se excluye de esa comparación (ver comparar.js),
 * nunca se le muestra un precio "de otra zona" porque tal cosa no existe en este super.
 */

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
  'Accept': 'application/json',
};

/**
 * true si el código postal dado tiene venta de supermercado online (`haySucursalSuper`).
 * Sin cache acá a propósito: se llama una sola vez cuando el usuario guarda su CP (CLI o app),
 * no en cada comparación — cachear mal dejaría a alguien "sin cobertura" pegado si su zona se
 * habilita más adelante. `false` ante cualquier error de red (mismo criterio conservador que el
 * resto: ante duda, no mostrar el super en vez de arriesgar un falso positivo).
 */
async function tieneCobertura(codigoPostal) {
  if (!codigoPostal) return false;
  try {
    const res = await fetch(`https://api.laanonima.com.ar/sucursal/${encodeURIComponent(codigoPostal)}`, { headers: HEADERS });
    if (!res.ok) return false;
    const data = await res.json();
    return !!data?.super?.haySucursalSuper;
  } catch {
    return false;
  }
}

// Cache en memoria por CP (~1h): usado por el backend para no pegarle a la API de La Anónima
// en cada request de /comparar y /precios — se resuelve una vez por CP y se reusa mientras no
// venza. Sin TTL infinito a propósito: si la zona se habilita más adelante, no queda pegada
// "sin cobertura" para siempre. La CLI no usa esto (resuelve una sola vez al guardar el CP,
// ver mi-codigo-postal.js), solo el backend lo necesita por ser multi-usuario.
const CACHE_TTL_MS = 60 * 60 * 1000;
const cache = new Map(); // codigoPostal -> { expira, promise }

function tieneCoberturaCacheada(codigoPostal) {
  if (!codigoPostal) return Promise.resolve(false);
  const ahora = Date.now();
  const entrada = cache.get(codigoPostal);
  if (entrada && entrada.expira > ahora) return entrada.promise;

  const promise = tieneCobertura(codigoPostal);
  cache.set(codigoPostal, { expira: ahora + CACHE_TTL_MS, promise });
  promise.catch(() => cache.delete(codigoPostal));
  return promise;
}

module.exports = { tieneCobertura, tieneCoberturaCacheada };
