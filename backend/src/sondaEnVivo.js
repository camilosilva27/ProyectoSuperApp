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

// Aceite de Girasol 1.5 Lts Cocinero — presente en los 5 catálogos locales originales al
// momento de escribir esto (confirmado 2026-08-11). Si en algún refresco futuro deja de estar
// en alguno, esa fuente puntual va a reportar `ok:false` en la sonda aunque no sea un problema
// real — revisar y cambiar el EAN si eso empieza a pasar seguido.
const EAN_SONDA = '7790060023684';

// La Anónima necesita un EAN propio para la sonda: no tiene EAN nativo, solo el subconjunto
// que enriquecer-catalogo-laanonima.js pudo emparejar por nombre (~22% del catálogo, ver su
// cabecera) — usar EAN_SONDA de arriba ahí reportaría `ok:false` siempre por "no matcheó",
// indistinguible de un fetch roto de verdad. Este EAN SÍ está confirmado emparejado
// (Acondicionador Keratina Pantene 250cc, confirmado 2026-08-18). También necesita un CP de
// referencia con cobertura confirmada (Comodoro Rivadavia) — sin CP, laAnonimaLiveEAN corta
// antes de tocar la red (ver core/fetchers.js), y la sonda nunca detectaría nada.
const EAN_SONDA_LAANONIMA = '7500435241106';
const CP_SONDA_LAANONIMA = '9000';

const INTERVALO_MS = 15 * 60 * 1000;

let estado = { ultimaCorrida: null, resultados: null, error: null };

async function correrSonda() {
  try {
    const [grupo, grupoLaAnonima] = await Promise.all([
      buscarPorEAN(EAN_SONDA),
      buscarPorEAN(EAN_SONDA_LAANONIMA, { codigoPostal: CP_SONDA_LAANONIMA, coberturaConfirmada: true }),
    ]);
    const resultados = {};
    for (const s of SUPERMERCADOS) {
      if (s.key === 'laanonima') continue; // se evalúa aparte, con su propio EAN/CP
      const encontrados = (grupo[s.key] || []).filter(r => r.precioBase > 0);
      resultados[s.key] = { nombre: s.nombre, ok: encontrados.length > 0 };
    }
    const encontradosLaAnonima = (grupoLaAnonima.laanonima || []).filter(r => r.precioBase > 0);
    resultados.laanonima = { nombre: 'La Anónima', ok: encontradosLaAnonima.length > 0 };
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

module.exports = { iniciar, estadoActual, EAN_SONDA, INTERVALO_MS };
