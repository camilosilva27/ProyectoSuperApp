/**
 * GET /api/mis-descuentos — para la pantalla "Mis descuentos" del rediseño v2 (turno 5a,
 * ver design_handoff_allpromos_v2/SPEC.md § 4.7): qué desbloquea cada tarjeta/app/club
 * conocido, con qué día y con qué tope, agregando las promos bancarias EN VIVO de los 5
 * supers (AllPromos/promos-bancarias.js).
 *
 * Usa `obtenerTodasLasPromosBancarias()`, NO `obtenerPromosBancarias()`: esa segunda función
 * filtra por mis-tarjetas.json, que es estado de UNA persona en la CLI — acá hace falta ver
 * las promos de TODAS las tarjetas conocidas, para poder mostrarlas incluso a quien todavía
 * no las marcó como propias.
 */

const express = require('express');
const {
  obtenerTodasLasPromosBancarias, TARJETAS_CONOCIDAS,
} = require('../../../AllPromos/promos-bancarias');

const router = express.Router();

const NOMBRES_DIA = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];

function nombresDeDias(numerosDeDia) {
  return [...new Set(numerosDeDia)].sort((a, b) => a - b).map(d => NOMBRES_DIA[d - 1]);
}

// Las promos bancarias son campañas recurrentes por día de semana, no precios: cambian
// mucho menos seguido que un precio de producto. Un caché más largo que el de /comparar
// (3 min) evita disparar ~9 requests en vivo (3 por Carrefour y Chango Más + 1 cada uno de
// Vea/Día/Coto) en cada apertura de la pantalla, sin que el dato deje de ser efectivamente "de hoy".
const CACHE_TTL_MS = 15 * 60 * 1000;
let cache = null; // { expira, promise }

function obtenerTodasCacheado() {
  const ahora = Date.now();
  if (cache && cache.expira > ahora) return cache.promise;

  const promise = obtenerTodasLasPromosBancarias();
  cache = { expira: ahora + CACHE_TTL_MS, promise };
  promise.catch(() => { cache = null; }); // no dejar cacheada una promesa rota
  return promise;
}

/** Entre las promos vigentes de una tarjeta, la de mayor % — mismo criterio simple que usa
 *  la CLI para "mejor promo" (ver mejorPromoTicket), pero acá sin un subtotal: esta pantalla
 *  es informativa ("qué existe"), no un cálculo sobre el carrito actual. */
function calcularDescuentos(datosPorSuper) {
  const ahora = new Date();
  const advertencias = [];

  for (const [superKey, resultado] of Object.entries(datosPorSuper)) {
    if (resultado.error) advertencias.push(`${superKey}: no se pudieron consultar sus promos bancarias`);
  }

  const descuentos = TARJETAS_CONOCIDAS.map(nombre => {
    const vigentes = [];
    for (const [superKey, resultado] of Object.entries(datosPorSuper)) {
      if (resultado.error) continue;
      for (const promo of resultado.promos) {
        if (!promo.canonicosPosibles.includes(nombre)) continue;
        if (ahora < promo.vigenciaDesde || ahora > promo.vigenciaHasta) continue;
        vigentes.push({ ...promo, superKey });
      }
    }

    if (!vigentes.length) {
      return { nombre, disponible: false, descuentoPct: null, dias: [], tope: null, supers: [] };
    }

    const mejor = vigentes.reduce((a, b) => (b.descuentoPct > a.descuentoPct ? b : a));
    return {
      nombre,
      disponible: true,
      descuentoPct: mejor.descuentoPct,
      dias: nombresDeDias(vigentes.flatMap(p => p.dias)),
      tope: mejor.tope,
      supers: [...new Set(vigentes.map(p => p.superKey))],
    };
  });

  return { descuentos, advertencias };
}

router.get('/mis-descuentos', async (req, res) => {
  const datosPorSuper = await obtenerTodasCacheado();
  const { descuentos, advertencias } = calcularDescuentos(datosPorSuper);
  res.json({ generado: new Date().toISOString(), descuentos, advertencias });
});

module.exports = router;
