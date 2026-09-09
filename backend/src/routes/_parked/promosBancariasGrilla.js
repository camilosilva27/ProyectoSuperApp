/**
 * PARKEADO 2026-09-08 — NO montado en server.js, no lo llama nadie. Ver
 * `.claude/docs/CONTEXTO_TECNICO.md` § "Grilla de promos bancarias por día (turno 17)" para el
 * motivo: `elegirPromoDelDia` reduce a UNA sola promo por celda, pero un super puede tener
 * hasta ~18 promos vigentes el mismo día — mostrar una sola como "la" promo del día le pareció
 * al usuario confuso y potencialmente engañoso. Antes de reactivar esto hay que resolver cómo
 * mostrar/elegir entre varias promos en la misma celda (¿lista?, ¿la de mayor tope en vez de
 * mayor %?, ¿un indicador de "+N más"?) — no es un bug de esta implementación, es una decisión
 * de UX/producto sin cerrar.
 *
 * GET /api/promos-bancarias/grilla — para la grilla de promos por super×día del estado inicial
 * de Buscar (turno 17, ver design_handoff_allpromos_v2/PROMPT-claude-code-turno-17-grilla-promos.md).
 *
 * A diferencia de /api/mis-descuentos (agrupa por tarjeta → lista de supers), acá se agrupa al
 * revés: por super → 7 celdas, una por día ISO (1=lunes...7=domingo, misma convención que
 * diaISO() en AllPromos/promos-bancarias.js). Mismo cache que mis-descuentos — nunca pega en
 * vivo a los supers desde el camino de request (ver promosBancariasCache.js).
 */

const express = require('express');
const { leerPromosBancariasCache, fechaGeneracionPromosBancarias } = require('../../promosBancariasCache');
const { requiereSesion, requierePlanActivo } = require('../../middleware/requiereSesion');

const router = express.Router();

/** Entre las promos de un super que caen en un día dado, elige una — mismo criterio que
 *  calcularDescuentos() en misDescuentos.js: la de mayor % entre las vigentes hoy; si ninguna
 *  está vigente pero hay alguna con `dias` definido (patrón con periodicidad conocida que
 *  probablemente vuelva), esa igual. */
function elegirPromoDelDia(promos, dia) {
  const ahora = new Date();
  const delDia = promos.filter(p => p.dias.includes(dia));

  const vigentes = delDia.filter(p => ahora >= p.vigenciaDesde && ahora <= p.vigenciaHasta);
  if (vigentes.length) return vigentes.reduce((a, b) => (b.descuentoPct > a.descuentoPct ? b : a));

  const periodicas = delDia.filter(p => p.dias.length);
  if (periodicas.length) return periodicas.reduce((a, b) => (b.descuentoPct > a.descuentoPct ? b : a));

  return null;
}

function armarFilas(datosPorSuper) {
  const filas = [];
  for (const [superKey, resultado] of Object.entries(datosPorSuper)) {
    if (resultado.error) continue;
    const celdas = [];
    for (let dia = 1; dia <= 7; dia++) {
      const elegida = elegirPromoDelDia(resultado.promos, dia);
      celdas.push(elegida
        ? { tiene: true, banco: elegida.canonicosPosibles[0], pct: elegida.descuentoPct }
        : { tiene: false, banco: null, pct: null });
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
  res.json({ filas: armarFilas(datosPorSuper), generadoEl: fechaGeneracionPromosBancarias() });
});

module.exports = router;
