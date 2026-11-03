/**
 * Sonda de salud de la comparación EN VIVO (no del catálogo/scraper diario, que ya cubre
 * `/api/health` con `catalogos[].vencido` y `ultimoRefresco`).
 *
 * `/api/comparar` le pega en tiempo real a las APIs de los 5 supers cada vez que alguien usa
 * la app — eso puede romperse en cualquier momento del día (cookie de Vea vencida, key de
 * Coto revocada, un super le cambia el formato a su API) sin relación con el cron diario, y
 * hoy nada lo detecta: un fetch roto devuelve simplemente "sin resultados" para ese super,
 * indistinguible de "este producto no lo vende" salvo que se pruebe con un producto que se
 * sabe que SÍ existe ahí.
 *
 * Corre en background dentro del mismo proceso del server cada INTERVALO_MS, no en cada
 * request a /api/health — así el health check sigue respondiendo instantáneo (lee el último
 * resultado ya calculado) y no se le suma tráfico de monitoreo a los supers en cada ping
 * externo (UptimeRobot pega cada 5 min; si disparara la sonda en cada ping serían ~1400
 * requests/día extra a cada super, con riesgo real de rate-limit — Carrefour ya devuelve 429
 * con tráfico normal).
 */

const { buscarPorEAN, SUPERMERCADOS } = require('../../AllPromos/core/fetchers');

// Productos de prueba, en orden. El fetcher en vivo descarta a propósito los SKUs sin stock
// (VTEX los devuelve con Price 0 — ver `precioValido` en core/fetchers.js), así que un producto
// SIN STOCK es indistinguible de "API rota" mirando un solo EAN: pasó con el principal en Chango
// Más el 2026-11-03 (falso `ok:false` → UptimeRobot avisando caída). Por eso hay respaldos: un
// super cuenta como OK si devuelve precio para CUALQUIERA de estos. Los de respaldo solo se
// consultan si a algún super le faltó el anterior (en el caso normal, 1 sola consulta por corrida).
// Todos presentes en los 7 catálogos (catalogo-unificado, 2026-11-03).
const EANS_SONDA = [
  '7790060023684', // Aceite de Girasol 1.5 L Cocinero (el original, 2026-08-11)
  '7792180001665', // Aceite de Girasol 1.5 L Cañuelas
  '7790070431431', // Arroz Doble Carolina 500 g Gallo
  '7791866001203', // Mayonesa Natura 237 g
];
const EAN_SONDA = EANS_SONDA[0]; // compatibilidad con quien lo importe

const INTERVALO_MS = 15 * 60 * 1000;

let estado = { ultimaCorrida: null, resultados: null, error: null };

async function correrSonda() {
  try {
    const okPorSuper = {};
    for (const ean of EANS_SONDA) {
      const pendientes = SUPERMERCADOS.filter(s => !okPorSuper[s.key]);
      if (!pendientes.length) break;
      const grupo = await buscarPorEAN(ean);
      for (const s of pendientes) {
        if ((grupo[s.key] || []).some(r => r.precioBase > 0)) okPorSuper[s.key] = ean;
      }
    }
    const resultados = {};
    for (const s of SUPERMERCADOS) {
      resultados[s.key] = { nombre: s.nombre, ok: Boolean(okPorSuper[s.key]), ...(okPorSuper[s.key] ? { ean: okPorSuper[s.key] } : {}) };
    }
    estado = { ultimaCorrida: new Date().toISOString(), resultados, error: null };
  } catch (err) {
    // No se pisa el último resultado bueno conocido — solo se anota que la corrida falló.
    estado = { ...estado, ultimaCorrida: new Date().toISOString(), error: err.message };
  }
}

function iniciar() {
  correrSonda(); // primera corrida al arrancar, no esperar los 15 min iniciales
  setInterval(correrSonda, INTERVALO_MS);
}

function estadoActual() {
  return estado;
}

module.exports = { iniciar, estadoActual, EAN_SONDA, EANS_SONDA, INTERVALO_MS };
