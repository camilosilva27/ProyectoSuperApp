/**
 * Semáforo global (no por IP) para acotar cuántas búsquedas en vivo hacia los supers pueden
 * correr al mismo tiempo, sin importar cuántos usuarios distintos las disparen.
 *
 * Por qué existe: el rate limiting de server.js es por IP, así que no evita que N usuarios
 * concurrentes multipliquen conexiones contra Carrefour/Chango Más (ver discusión en el repo).
 * Esto lo resuelve en el punto de salida: cualquiera sea el origen del pedido, nunca hay más
 * de `maxConcurrentes` requests en vuelo a la vez — el resto espera su turno en una cola.
 *
 * Cola con tope (2026-09-24, auditoría): antes la cola no tenía límite, así que un pico de EANs
 * no cacheados (cada uno = 7 requests en vivo, sin timeout propio) podía encolar cientos de
 * trabajos detrás de 2 lugares, dejando requests de /api/comparar colgados minutos y la memoria
 * de la e2-micro creciendo. Con `maxCola`, lo que no entra se rechaza al toque con un error
 * `code: 'COLA_LLENA'` — el caller lo trata como "no se pudo consultar este EAN ahora" (una
 * advertencia), no como una falla del request entero.
 */

class ColaLlenaError extends Error {
  constructor(maxCola) {
    super(`Demasiadas consultas en vivo en espera (máximo ${maxCola}) — probá de nuevo en un momento`);
    this.name = 'ColaLlenaError';
    this.code = 'COLA_LLENA';
  }
}

function crearLimitador(maxConcurrentes, { maxCola = Infinity } = {}) {
  let activos = 0;
  const cola = [];

  function siguiente() {
    if (activos >= maxConcurrentes || cola.length === 0) return;
    activos++;
    const { fn, resolve, reject } = cola.shift();
    // Promise.resolve().then(fn): si fn tira sincrónicamente, igual se libera el lugar.
    Promise.resolve().then(fn).then(resolve, reject).finally(() => {
      activos--;
      siguiente();
    });
  }

  function conLimite(fn) {
    return new Promise((resolve, reject) => {
      // Solo cuenta lo que ESPERA: si hay un lugar libre, arranca aunque la cola esté llena.
      if (activos >= maxConcurrentes && cola.length >= maxCola) {
        reject(new ColaLlenaError(maxCola));
        return;
      }
      cola.push({ fn, resolve, reject });
      siguiente();
    });
  }

  conLimite.estado = () => ({ activos, enCola: cola.length, maxConcurrentes, maxCola });
  return conLimite;
}

module.exports = { crearLimitador, ColaLlenaError };
