/**
 * GET /api/mis-descuentos — para la pantalla "Mis descuentos" del rediseño v2 (turno 5a,
 * ver design_handoff_allpromos_v2/SPEC.md § 4.7): qué desbloquea cada tarjeta/app/club
 * conocido, con qué día y con qué tope, agregando las promos bancarias de los 5 supers
 * (AllPromos/promos-bancarias.js).
 *
 * Lee el cache por archivo (promosBancariasCache.js), alimentado por el cron
 * (refrescarCatalogos.js) — nunca pega en vivo a los supers desde el camino de request. Antes
 * este archivo tenía su propio cache TTL-en-memoria que sí hacía el fetch en vivo acá mismo;
 * se unificó con la misma fuente que usa /api/comparar para promos bancarias, sin duplicar el
 * fetch ni el cache.
 *
 * Muestra TODAS las tarjetas conocidas, no filtradas por usuario: esta pantalla es
 * informativa ("qué existe"), a diferencia de /api/comparar que sí filtra por las tarjetas
 * que el usuario tiene marcadas.
 */

const express = require('express');
const { TARJETAS_CONOCIDAS } = require('../../../AllPromos/promos-bancarias');
const { leerPromosBancariasCache } = require('../promosBancariasCache');

const router = express.Router();

const NOMBRES_DIA = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];

function nombresDeDias(numerosDeDia) {
  return [...new Set(numerosDeDia)].sort((a, b) => a - b).map(d => NOMBRES_DIA[d - 1]);
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
  const datosPorSuper = leerPromosBancariasCache();
  if (!datosPorSuper) {
    res.json({
      generado: new Date().toISOString(),
      descuentos: TARJETAS_CONOCIDAS.map(nombre => (
        { nombre, disponible: false, descuentoPct: null, dias: [], tope: null, supers: [] }
      )),
      advertencias: ['El cron todavía no generó el cache de promos bancarias — probá de nuevo en unos minutos'],
    });
    return;
  }
  const { descuentos, advertencias } = calcularDescuentos(datosPorSuper);
  res.json({ generado: new Date().toISOString(), descuentos, advertencias });
});

module.exports = router;
