/**
 * GET /api/promos-bancarias/grilla — para la grilla de promos por super×día del estado inicial
 * de Buscar (turno 17, ver design_handoff_allpromos_v2/PROMPT-claude-code-turno-17-grilla-promos.md).
 *
 * A diferencia de /api/mis-descuentos (agrupa por tarjeta → lista de supers), acá se agrupa al
 * revés: por super → 7 celdas, una por día ISO (1=lunes...7=domingo, misma convención que
 * diaISO() en AllPromos/promos-bancarias.js). Mismo cache que mis-descuentos — nunca pega en
 * vivo a los supers desde el camino de request (ver promosBancariasCache.js).
 *
 * Reactivada 2026-09-09 (había quedado parkeada el 2026-09-08: un super puede tener hasta ~18
 * promos vigentes el mismo día, y mostrar UNA sola como "la" promo del día le pareció al usuario
 * confuso/engañoso). Ahora cada celda trae hasta 3 promos (`promos: [{banco, pct}]`), una por
 * banco: primero las de las tarjetas propias del usuario (`?tarjetas=Galicia,BBVA`), completando
 * con las de mayor % hasta llegar a 3 — decisión tomada con el usuario el 2026-09-09.
 */

const express = require('express');
const { leerPromosBancariasCache, fechaGeneracionPromosBancarias } = require('../promosBancariasCache');
const { requiereSesion, requierePlanActivo } = require('../middleware/requiereSesion');

const router = express.Router();

/** Entre las promos de un super que caen en un día dado, elige hasta 3 (una por banco): primero
 *  las de `tarjetasPropias`, completando con las de mayor % hasta llegar a 3. Mismo criterio de
 *  vigencia que calcularDescuentos() en misDescuentos.js: las vigentes hoy; si ninguna está
 *  vigente pero hay alguna con `dias` definido (patrón con periodicidad conocida que
 *  probablemente vuelva), esas igual. */
function elegirPromosDelDia(promos, dia, tarjetasPropias) {
  const ahora = new Date();
  const delDia = promos.filter(p => p.dias.includes(dia));

  const vigentes = delDia.filter(p => ahora >= p.vigenciaDesde && ahora <= p.vigenciaHasta);
  const candidatas = vigentes.length ? vigentes : delDia.filter(p => p.dias.length);
  if (!candidatas.length) return [];

  const esPropia = p => p.canonicosPosibles.some(c => tarjetasPropias.includes(c));
  const bancoDe = p => p.canonicosPosibles.find(c => tarjetasPropias.includes(c)) ?? p.canonicosPosibles[0];

  // Una sola promo por banco (la de mayor % entre las que le corresponden a ese banco ese día).
  const mejorPorBanco = new Map();
  for (const p of candidatas) {
    const banco = bancoDe(p);
    const actual = mejorPorBanco.get(banco);
    if (!actual || p.descuentoPct > actual.descuentoPct) mejorPorBanco.set(banco, p);
  }

  return [...mejorPorBanco.entries()]
    .map(([banco, p]) => ({ banco, pct: p.descuentoPct, propia: esPropia(p) }))
    .sort((a, b) => (Number(b.propia) - Number(a.propia)) || (b.pct - a.pct))
    .slice(0, 3)
    .map(({ banco, pct }) => ({ banco, pct }));
}

function armarFilas(datosPorSuper, tarjetasPropias) {
  const filas = [];
  for (const [superKey, resultado] of Object.entries(datosPorSuper)) {
    if (resultado.error) continue;
    const celdas = [];
    for (let dia = 1; dia <= 7; dia++) {
      const promos = elegirPromosDelDia(resultado.promos, dia, tarjetasPropias);
      celdas.push({ tiene: promos.length > 0, promos });
    }
    filas.push({ superKey, celdas });
  }
  return filas;
}

router.get('/promos-bancarias/grilla', requiereSesion, requierePlanActivo, (req, res) => {
  const datosPorSuper = leerPromosBancariasCache();
  if (!datosPorSuper) {
    res.json({ filas: [], generadoEl: null });
    return;
  }
  const tarjetasPropias = typeof req.query.tarjetas === 'string' && req.query.tarjetas.length
    ? req.query.tarjetas.split(',')
    : [];
  res.json({ filas: armarFilas(datosPorSuper, tarjetasPropias), generadoEl: fechaGeneracionPromosBancarias() });
});

module.exports = router;
