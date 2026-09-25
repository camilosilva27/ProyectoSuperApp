/**
 * Promos exclusivas de Comunidad Coto (2026-09-24). Coto marca con discountImage
 * ".../ofertas/comunidad.png" los descuentos solo para socios de Comunidad ("1 Pago X%", "+X%",
 * "15%"). Desde la auditoría de hoy no se aplicaban a nadie; ahora se aplican SOLO a quien marca
 * 'Comunidad Coto', con el mismo mecanismo que la Tarjeta Carrefour (promo.requiereTarjeta).
 * Fixtures: respuestas reales de Constructor.io recortadas (comunidadCoto.fixture.json).
 *
 * Correr con: node --test AllPromos/core/comunidadCoto.test.js
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const {
  COMUNIDAD_COTO, esDescuentoComunidadCoto, esPromoInternaComunidadCoto, promoComunidadCoto, calcularCosto,
} = require('../promo-engine');
const { parsearProductosCoto } = require('./fetchers');
const { mejorOpcion } = require('./comparador');
const { parsearProducto } = require('../scraper-coto-por-ean');
const { _test: precioCacheTest } = require('../../backend/src/precioCache');

const FIX = require('./comunidadCoto.fixture.json');
const UN_PAGO_30 = FIX['74101944686'];      // "1 Pago 30%" sobre $54.999 → $38.499,30
const EXCLUSIVAS = FIX['3016661173493'];    // sale_type "Exclusivas" pero discount comunidad.png
const MAS_10 = FIX['7790244941551'];        // 25%Dto ($2.793,75) + "+10%" ($2.421,25) sobre $3.725
const QUINCE = FIX['7790895007217'];        // "15%" suelto sobre $5.150 → $4.377,50
const TRES_X_DOS = FIX['7797942006933'];    // 3x2 para todos (sin comunidad.png)

/** Total que vería el usuario con esas tarjetas (mismo criterio que comparar.js). */
function total(entradas, cantidad, tarjetas) {
  const o = mejorOpcion(entradas, cantidad, tarjetas);
  const promo = o.promo?.requiereTarjeta && !tarjetas.includes(o.promo.requiereTarjeta) ? null : o.promo;
  return Math.round(calcularCosto(promo, o.precioBase, cantidad).totalConPromo * 100) / 100;
}

describe('marca de Comunidad', () => {
  test('la marca es discountImage comunidad.png, no sale_type', () => {
    assert.equal(esDescuentoComunidadCoto(UN_PAGO_30.data.discounts[0]), true);
    assert.equal(esDescuentoComunidadCoto(EXCLUSIVAS.data.discounts[0]), true);
    assert.ok(!EXCLUSIVAS.data.sale_type.includes('Miembros Comunidad'));
    // "Miembros Comunidad" en sale_type convive con un 25%Dto que es para todos
    assert.ok(MAS_10.data.sale_type.includes('Miembros Comunidad'));
    assert.equal(esDescuentoComunidadCoto(MAS_10.data.discounts[0]), false);
    assert.equal(esDescuentoComunidadCoto(MAS_10.data.discounts[1]), true);
    assert.equal(esDescuentoComunidadCoto(TRES_X_DOS.data.discounts[0]), false);
  });

  test('catálogo viejo sin marca: cae al criterio por texto', () => {
    assert.equal(esPromoInternaComunidadCoto({ nombre: '1 Pago 30%' }), true);
    assert.equal(esPromoInternaComunidadCoto({ nombre: '3x2' }), false);
    assert.equal(esPromoInternaComunidadCoto({ nombre: '2x1', comunidad: true }), true);
  });
});

describe('scraper (interpretarDescuentos)', () => {
  test('marca la promo de Comunidad con precioFinal y no toca las demás', () => {
    const p = parsearProducto(MAS_10);
    assert.equal(p.precioBase, 3725);
    assert.equal(p.descuentoDirecto.precioFinal, 2793.75);
    assert.deepEqual(p.promosInternas, [
      { nombre: '+10%', comentarios: 'No acumulable con otras promos', comunidad: true, precioFinal: 2421.25 },
    ]);
    // Sin campos nuevos en las promos para todos (la huella de Alertas no cambia)
    assert.deepEqual(parsearProducto(TRES_X_DOS).promosInternas, [
      { nombre: '3x2', comentarios: 'No acumulable con otras promos' },
    ]);
  });
});

describe('promoComunidadCoto', () => {
  test('"1 Pago X%" y "15%": X% sobre lista, derivado de precioFinal', () => {
    const a = promoComunidadCoto({ texto: '1 Pago 30%', precioFinal: 38499.30, precioBase: 54999 });
    assert.equal(a.tipo, 'pct_directo');
    assert.equal(a.descuentoPct, 0.3);
    assert.equal(a.requiereTarjeta, COMUNIDAD_COTO);
    assert.match(a.descripcion, /30% con Comunidad Coto \(pagando en 1 cuota\)/);
    assert.equal(promoComunidadCoto({ texto: '15%', precioFinal: 4377.5, precioBase: 5150 }).descuentoPct, 0.15);
  });

  test('"+X%": X puntos más que el N%Dto, ambos sobre lista (25% + 10% = 35%)', () => {
    const p = promoComunidadCoto({ texto: '+10%', precioFinal: 2421.25, precioBase: 3725, descuentoDirecto: '0.2500' });
    assert.equal(p.descuentoPct, 0.35);
    assert.equal(calcularCosto(p, 3725, 1).totalConPromo, 2421.25);
  });

  test('sin precioFinal (catálogo viejo) se deriva del texto', () => {
    assert.equal(promoComunidadCoto({ texto: '1 Pago 30%', precioBase: 54999 }).descuentoPct, 0.3);
    assert.equal(promoComunidadCoto({ texto: '+5%', precioBase: 2750, descuentoDirecto: '0.2500' }).descuentoPct, 0.3);
    // "+X%" sin descuento directo: no se adivina la base
    assert.equal(promoComunidadCoto({ texto: '+5%', precioBase: 2750 }), null);
  });

  test('un NxM marcado como Comunidad se interpreta como siempre + requiereTarjeta', () => {
    const p = promoComunidadCoto({ texto: '2x1', precioFinal: 2755, precioBase: 5510 });
    assert.equal(p.tipo, 'nxm');
    assert.equal(p.requiereTarjeta, COMUNIDAD_COTO);
  });
});

describe('camino cacheado (precioCache.entradasCoto)', () => {
  test('catálogo nuevo: "+10%" reemplaza al 25%Dto solo con Comunidad', () => {
    const e = precioCacheTest.entradasCoto(parsearProducto(MAS_10));
    assert.equal(total(e, 1, []), 2793.75);
    assert.equal(total(e, 1, [COMUNIDAD_COTO]), 2421.25);
    assert.equal(total(e, 2, [COMUNIDAD_COTO]), 4842.5);
  });

  test('catálogo viejo (solo nombre) sigue funcionando', () => {
    const sku = {
      ean: '74101944686', nombre: 'x', precioBase: 54999, descuentoDirecto: null,
      promosInternas: [{ nombre: '1 Pago 30%', comentarios: 'No acumulable con otras promos' }],
    };
    const e = precioCacheTest.entradasCoto(sku);
    assert.equal(total(e, 1, []), 54999);
    assert.equal(total(e, 1, [COMUNIDAD_COTO]), 38499.3);
  });

  test('3x2 para todos no cambia', () => {
    const e = precioCacheTest.entradasCoto(parsearProducto(TRES_X_DOS));
    assert.equal(total(e, 3, []), 10932);
    assert.equal(total(e, 3, [COMUNIDAD_COTO]), 10932);
  });
});

describe('fallback en vivo (parsearProductosCoto)', () => {
  test('sin Comunidad: el SKU con solo promo de Comunidad sigue apareciendo, a precio de lista', () => {
    const e = parsearProductosCoto([UN_PAGO_30]);
    assert.equal(e.length, 1);
    assert.equal(e[0].promo, null);
    assert.equal(e[0].precioBase, 54999);
  });

  test('con Comunidad: entrada extra con requiereTarjeta', () => {
    const e = parsearProductosCoto([MAS_10, QUINCE, EXCLUSIVAS], { tarjetas: [COMUNIDAD_COTO] });
    const porEan = ean => e.filter(x => x.ean === ean);
    assert.equal(total(porEan('7790244941551'), 1, [COMUNIDAD_COTO]), 2421.25);
    assert.equal(total(porEan('7790244941551'), 1, []), 2793.75);
    assert.equal(total(porEan('7790895007217'), 1, [COMUNIDAD_COTO]), 4377.5);
    assert.equal(total(porEan('3016661173493'), 1, [COMUNIDAD_COTO]), 279999.3);
    assert.ok(porEan('7790895007217').some(x => x.promo?.requiereTarjeta === COMUNIDAD_COTO));
  });
});
