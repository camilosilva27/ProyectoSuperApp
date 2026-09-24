/**
 * Tests de interpretarPromoPorTexto/calcularCosto con nombres de promo reales de los catálogos.
 * Nacieron del bug de la auditoría 2026-09-24: " 2x1 Legumbres | Ofertas Internas" (con espacio
 * adelante) no matcheaba la regex anclada con ^ y se calculaba como 50% en cada unidad.
 *
 * Correr con: node --test AllPromos/promo-engine.test.js
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { interpretarPromoPorTexto, calcularCosto } = require('./promo-engine');

describe('interpretarPromoPorTexto — NxM', () => {
  test('2x1 con espacio adelante (Vea/Jumbo/Disco) es nxm, no pct_directo', () => {
    const p = interpretarPromoPorTexto(' 2x1 Legumbres | Ofertas Internas', 0.5);
    assert.equal(p.tipo, 'nxm');
    assert.equal(p.nUnidades, 2);
    assert.equal(p.pagaM, 1);
  });

  test('2x1 con una sola unidad no descuenta nada', () => {
    const p = interpretarPromoPorTexto(' 2x1 Legumbres | Ofertas Internas', 0.5);
    assert.equal(calcularCosto(p, 2690, 1).totalConPromo, 2690);
  });

  test('2x1 con dos unidades paga una', () => {
    const p = interpretarPromoPorTexto(' 2x1 Legumbres | Ofertas Internas', 0.5);
    assert.equal(calcularCosto(p, 2690, 2).totalConPromo, 2690);
  });

  test('3x2 sin espacio sigue funcionando', () => {
    const p = interpretarPromoPorTexto('3x2 Galletitas | Ofertas Trafico', 0.333);
    assert.equal(p.tipo, 'nxm');
    assert.equal(p.esOnline, true);
    assert.equal(calcularCosto(p, 1000, 3).totalConPromo, 2000);
  });
});

describe('interpretarPromoPorTexto — otros tipos con espacio adelante', () => {
  test('" 2do al 70%" es ndo_al_pct', () => {
    const p = interpretarPromoPorTexto(' 2do al 70% Lácteos', 0.35);
    assert.equal(p.tipo, 'ndo_al_pct');
    assert.equal(calcularCosto(p, 1000, 1).totalConPromo, 1000);
  });

  test('" 70% 2da" (Coto) es ndo_al_pct', () => {
    const p = interpretarPromoPorTexto(' 70% 2da', undefined);
    assert.equal(p.tipo, 'ndo_al_pct');
    assert.equal(p.descuentoSegunda, 0.7);
  });

  test('" 25%" es pct_directo', () => {
    const p = interpretarPromoPorTexto(' 25% Limpieza', undefined);
    assert.equal(p.tipo, 'pct_directo');
    assert.equal(p.descuentoPct, 0.25);
  });
});
