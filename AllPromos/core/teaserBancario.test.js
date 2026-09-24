/**
 * Clasificación de teasers bancarios (auditoría 2026-09-24): los scrapers marcaban como
 * bancario todo teaser con la subcadena "bin", y "Combinable" la tiene — ~560 SKUs de
 * Carrefour perdían su 2do al X%/NxM en el camino cacheado (precioCache) mientras el fallback
 * en vivo (core/fetchers.js) sí los aplicaba. Nombres tomados del catalogo-carrefour.json real.
 *
 * Correr con: node --test AllPromos/core/teaserBancario.test.js
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { esTeaserBancario, calcularCosto } = require('../promo-engine');
const { parsearProductosCarrefour } = require('./fetchers');
const { _test: precioCacheTest } = require('../../backend/src/precioCache');

const COMBINABLE = 'PROMO-2do al 50% Max 8 unidades Combinable DOVE-Reg-2-50-Gigante4 al 10.8';
const COMBINABLE_MI_CRF = 'PROMO-2do al 70% Mi Crf Max 8 unidades Combinable OREO-Reg-2-70-Gigante4 al 10.8';
const TARJETA = 'Tarjeta Carrefour 15%';

describe('esTeaserBancario', () => {
  test('"Combinable" no es bancario (bin como subcadena)', () => {
    for (const n of [
      COMBINABLE,
      COMBINABLE_MI_CRF,
      'PROMO-3x2 Max 72 unidades Combinable TANG-Reg-3-100-Gigante4 al 10.8',
      'PROMO-Exclusivo online 2x1 Combinable Dove Masc-Reg-2-100-Unilever6/8 al 31/8',
      'PROMO-2do al 50% Max 8 unidades Combinable BIALCOHOL-Reg-2-50-Gigante19 al 25.8',
    ]) assert.equal(esTeaserBancario(n), false, n);
  });

  test('tarjeta / cuenta digital / banco / BIN suelto siguen siendo bancarios', () => {
    for (const n of [
      TARJETA,
      'Tarjeta Carrefour 20% Off Martes',
      '35% Off Tarjeta Carrefour o Cuenta digital Max 8  19 al 25.8 ',
      'Banco Nación 20%',
      'Promo BIN 454545',
    ]) assert.equal(esTeaserBancario(n), true, n);
  });

  test('sin nombre no es bancario ni tira', () => {
    assert.equal(esTeaserBancario(undefined), false);
    assert.equal(esTeaserBancario(''), false);
  });
});

describe('camino cacheado vs fallback en vivo (Carrefour)', () => {
  // SKU real del catálogo del 25/08 (Galletitas Oreo 354 g), con el split viejo del scraper:
  // el "Combinable ... Mi Crf" quedó guardado en promosBancarias.
  const skuCatalogoViejo = {
    skuId: '126397', ean: '7622201735258', seller: '1',
    productName: 'Galletitas Oreo Rellenas con crema sabor original 354 g.',
    skuName: 'Galletitas Oreo Rellenas con crema sabor original 354 g.',
    precioBase: 6370, precioActual: 6370, descuentoDirecto: null,
    promosInternas: null,
    promosBancarias: [
      { nombre: TARJETA, descuentoPct: '15', cantidadMinima: 0, esBancaria: true },
      { nombre: COMBINABLE_MI_CRF, descuentoPct: null, cantidadMinima: 2, esBancaria: true },
    ],
  };

  const mejorTotal = (entradas, cantidad, tarjetas = []) => Math.min(...entradas.map(e => {
    const promo = e.promo?.requiereTarjeta && !tarjetas.includes(e.promo.requiereTarjeta) ? null : e.promo;
    return calcularCosto(promo, e.precioBase, cantidad).totalConPromo;
  }));

  test('precioCache aplica el 2do al 70% aunque el catálogo viejo lo tenga en promosBancarias', () => {
    const entradas = precioCacheTest.entradasVtexConTeasers(skuCatalogoViejo, 'Carrefour', { conTarjetaPropia: true });
    assert.ok(entradas.some(e => e.promo?.tipo === 'ndo_al_pct' && e.promo.descuentoSegunda === 0.7));
    assert.equal(mejorTotal(entradas, 1), 6370);
    assert.equal(mejorTotal(entradas, 2), 6370 + 6370 * 0.3);
    // El teaser de tarjeta propia sigue detectándose como tal (solo con la tarjeta elegida).
    assert.ok(entradas.some(e => e.promo?.requiereTarjeta === 'Tarjeta Carrefour Crédito'));
  });

  test('mismo resultado que parsearProductosCarrefour con los Teasers crudos de VTEX', () => {
    const crudo = [{
      productName: skuCatalogoViejo.productName,
      items: [{
        itemId: '126397', name: skuCatalogoViejo.skuName, ean: skuCatalogoViejo.ean,
        sellers: [{
          sellerId: '1',
          commertialOffer: {
            IsAvailable: true, Price: 6370, ListPrice: 6370,
            Teasers: [
              {
                '<Name>k__BackingField': TARJETA,
                '<Effects>k__BackingField': { '<Parameters>k__BackingField': [
                  { '<Name>k__BackingField': 'PercentualDiscount', '<Value>k__BackingField': '15' },
                ] },
              },
              { '<Name>k__BackingField': COMBINABLE_MI_CRF },
            ],
          },
        }],
      }],
    }];
    const tarjetas = ['Tarjeta Carrefour Crédito'];
    const enVivo = parsearProductosCarrefour(crudo, { tarjetas });
    const cacheado = precioCacheTest.entradasVtexConTeasers(skuCatalogoViejo, 'Carrefour', { conTarjetaPropia: true });
    for (const q of [1, 2, 3]) {
      assert.equal(mejorTotal(cacheado, q), mejorTotal(enVivo, q), `sin tarjeta, cantidad ${q}`);
      assert.equal(mejorTotal(cacheado, q, tarjetas), mejorTotal(enVivo, q, tarjetas), `con tarjeta, cantidad ${q}`);
    }
  });
});
