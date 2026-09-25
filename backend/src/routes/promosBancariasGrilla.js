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
const { promoAplicaATarjetas, normalizarTarjetasUsuario } = require('../../../AllPromos/promos-bancarias');
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

  // Propia = el usuario la puede usar (tarjeta Y requisitos, ver promoAplicaATarjetas). El logo es
  // el de la tarjeta (ICBC + MODO → logo de ICBC); sin tarjeta, el requisito ("Jubilado",
  // "Comunidad Coto") o "Todos los medios de pago" (fallback de iniciales). Las tarjetas se
  // normalizan por si llega una opción vieja "<Banco> Modo" (ver normalizarTarjetasUsuario).
  const propias = normalizarTarjetasUsuario(tarjetasPropias);
  const esPropia = p => promoAplicaATarjetas(p, propias);
  const bancoDe = p => p.canonicosPosibles.find(c => propias.includes(c))
    ?? p.canonicosPosibles[0]
    ?? ((p.requisitos || []).join(' + ') || 'Todos los medios de pago');
  // Prioridad (2026-09-24): primero las que el usuario puede usar; entre las que no, las que no
  // piden un requisito (segmento/MasGO/Comunidad) antes que las que sí — "Supervielle 25%" de
  // jubilados no debería taparle la general del 20% a quien no marcó "Jubilado".
  const prioridad = p => (esPropia(p) ? 2 : ((p.requisitos || []).length ? 0 : 1));

  // Una sola promo por banco (la de mayor prioridad y después mayor % ese día).
  const mejorPorBanco = new Map();
  for (const p of candidatas) {
    const banco = bancoDe(p);
    const actual = mejorPorBanco.get(banco);
    if (!actual || prioridad(p) > prioridad(actual)
      || (prioridad(p) === prioridad(actual) && p.descuentoPct > actual.descuentoPct)) mejorPorBanco.set(banco, p);
  }

  return [...mejorPorBanco.entries()]
    .map(([banco, p]) => ({ banco, pct: p.descuentoPct, propia: esPropia(p), prioridad: prioridad(p) }))
    .sort((a, b) => (b.prioridad - a.prioridad) || (b.pct - a.pct))
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
// Solo para tests (AllPromos/core/bancarias-tarjetas-segmentos.test.js).
module.exports._test = { elegirPromosDelDia, armarFilas };
