/**
 * Semáforo global (no por IP) para acotar cuántas búsquedas en vivo hacia los supers pueden
 * correr al mismo tiempo, sin importar cuántos usuarios distintos las disparen.
 *
 * Por qué existe: el rate limiting de server.js es por IP, así que no evita que N usuarios
 * concurrentes multipliquen conexiones contra Carrefour/Chango Más (ver discusión en el repo).
 * Esto lo resuelve en el punto de salida: cualquiera sea el origen del pedido, nunca hay más
 * de `maxConcurrentes` requests en vuelo a la vez — el resto espera su turno en una cola.
 */

function crearLimitador(maxConcurrentes) {
  let activos = 0;
  const cola = [];

  function siguiente() {
    if (activos >= maxConcurrentes || cola.length === 0) return;
    activos++;
    const { fn, resolve, reject } = cola.shift();
    fn().then(resolve, reject).finally(() => {
      activos--;
      siguiente();
    });
  }

  return function conLimite(fn) {
    return new Promise((resolve, reject) => {
      cola.push({ fn, resolve, reject });
      siguiente();
    });
  };
}

module.exports = { crearLimitador };
