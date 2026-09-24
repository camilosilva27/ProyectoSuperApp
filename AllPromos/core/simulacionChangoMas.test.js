/**
 * Parseo de la simulación de checkout de Chango Más (2026-09-24): única fuente de sus promos por
 * cantidad (2x1, "2da al X%", "2x$precio", "3x2"). Fixture = respuesta real de masonline
 * (POST /api/checkout/pub/orderForms/simulation?sc=1, lote de 50 a cantidad 2) recortada a 5
 * ítems + los 4 beneficios del lote + un ORD027 agregado a mano (formato real, visto en otra sonda).
 *
 * Correr con: node --test AllPromos/core/simulacionChangoMas.test.js
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const {
  extraerPromosDeSimulacion, simularPromosPorSku, aplicarPromosSimuladas, completarPromosPorSimulacion,
  esBeneficioDeProducto,
} = require('./simulacionChangoMas');
const { calcularCosto } = require('../promo-engine');
const { _test: precioCacheTest } = require('../../backend/src/precioCache');
const FIXTURE = require('./simulacionChangoMas.fixture.json');

const P70 = 'PromoVolumen - LLEVANDO 2 - 2da al 70% - Reg-2-70 - SURTIDO FLASH ANIVERSARIO';
const P50 = 'PromoVolumen - LLEVANDO 2 - 2da al 50% - Reg-2-50 - SURTIDO FLASH ANIVERSARIO';

describe('extraerPromosDeSimulacion (fixture real)', () => {
  const porSku = extraerPromosDeSimulacion(FIXTURE);

  test('asocia cada promo al SKU por el priceTag discount@price-{idBeneficio}', () => {
    assert.deepEqual(porSku.get('166672'), [P70]);
    assert.deepEqual(porSku.get('222792'), [P50]);
  });

  test('no asigna promo a SKUs sin priceTag (sin stock, o sin promo)', () => {
    assert.equal(porSku.has('178497'), false); // withoutPriceFulfillment
    assert.equal(porSku.has(FIXTURE.items[0].id), false);
  });

  test('descarta beneficios unitarios de checkout ("Promo Banana $1699")', () => {
    assert.equal(porSku.has('204538'), false);
  });

  test('solo los 2 SKUs con promo por cantidad', () => {
    assert.equal(porSku.size, 2);
  });

  test('formato distinto → lanza (el llamador lo cuenta como lote fallido)', () => {
    assert.throws(() => extraerPromosDeSimulacion({ error: 'x' }));
    assert.throws(() => extraerPromosDeSimulacion(null));
  });

  test('cantidad 3: VTEX parte el ítem en líneas — se acumula por id y se deduplica', () => {
    const r = extraerPromosDeSimulacion({
      items: [
        { id: '12562', quantity: 2, priceTags: [{ name: 'discount@price-aaa#1', value: -100 }] },
        { id: '12562', quantity: 1, priceTags: [] },
        { id: '12562', quantity: 1, priceTags: [{ name: 'discount@price-aaa#2', value: -50 }] },
        { id: '5', quantity: 3, priceTags: [{ name: 'discount@shipping-bbb#1', value: -10 }] },
      ],
      ratesAndBenefitsData: { rateAndBenefitsIdentifiers: [
        { id: 'aaa', name: 'PromoVolumen - LLEVANDO 3 - 3x2 - Reg-3-100 - SURTIDO FLASH ANIVERSARIO' },
        { id: 'bbb', name: 'LLEVANDO 2 - Envío gratis' },
      ] },
    });
    assert.deepEqual([...r.keys()], ['12562']);
    assert.equal(r.get('12562').length, 1);
  });
});

describe('esBeneficioDeProducto', () => {
  test('acepta los formatos por cantidad vistos en vivo', () => {
    for (const n of [P70, 'PromoVolumen - LLEVANDO 2 - 2x1 - Reg-2-100 - LEGUMBRES Y GRANOS SECOS CCQ',
      '2x$2499 ALFAJOR TRIPLE UNIT - ANIVERSARIO NANCY', '3X$3999 ARCOR RAMEN - ANIVERSARIO NANCY']) {
      assert.equal(esBeneficioDeProducto(n), true, n);
    }
  });
  test('rechaza bancarias, MasClub, envío y beneficios unitarios', () => {
    for (const n of ['2do al 50% Tarjeta Mas', '15% MasClub 2x1', 'Envío gratis llevando 2',
      'Promo Banana $1699 23/09', 'Ahorrás 35%- Exclusivo online- Carne Picada $10.349', '', null]) {
      assert.equal(esBeneficioDeProducto(n), false, String(n));
    }
  });
});

describe('aplicarPromosSimuladas + precioCache', () => {
  test('agrega promosInternas {nombre} sin duplicar lo que ya estaba', () => {
    const skus = [
      { skuId: '166672', promosInternas: null },
      { skuId: '222792', promosInternas: [{ nombre: P50, esBancaria: false }] },
      { skuId: '1', promosInternas: null },
    ];
    const n = aplicarPromosSimuladas(skus, extraerPromosDeSimulacion(FIXTURE));
    assert.equal(n, 1);
    assert.deepEqual(skus[0].promosInternas, [{ nombre: P70, esBancaria: false }]);
    assert.equal(skus[1].promosInternas.length, 1);
    assert.equal(skus[2].promosInternas, null);
  });

  test('el total que calcula la app coincide con el de la simulación a cantidad 2', () => {
    // 166672: $2.839 c/u, simulación a cantidad 2 → priceDefinition.total 369070 centavos.
    const item = FIXTURE.items.find(i => i.id === '166672');
    const sku = { skuId: '166672', ean: 'x', precioBase: 2839, precioActual: 2839, descuentoDirecto: null,
      promosInternas: [{ nombre: P70, esBancaria: false }], promosBancarias: null };
    const [entrada] = precioCacheTest.entradasVtexConTeasers(sku, 'Chango Más');
    const total = calcularCosto(entrada.promo, entrada.precioBase, 2).totalConPromo;
    assert.equal(Math.round(total * 100), item.priceDefinition.total);
  });
});

describe('simularPromosPorSku nunca rompe el scraper', () => {
  const sinEspera = async () => {};

  test('lotes con error se cuentan y se sigue; corta tras 3 fallidos seguidos', async () => {
    let llamadas = 0;
    const r = await simularPromosPorSku(Array.from({ length: 250 }, (_, i) => String(i)), {
      baseUrl: 'http://x', esperar: sinEspera,
      fetchConReintento: async () => { llamadas++; throw new Error('timeout'); },
    });
    assert.equal(llamadas, 3);
    assert.equal(r.lotesFallidos, 3);
    assert.match(r.cortado, /3 lotes seguidos/);
    assert.equal(r.promosPorSku.size, 0);
  });

  test('429 final, JSON con otro formato y lote OK conviven', async () => {
    const respuestas = [
      { ok: false, status: 429, json: async () => ({}) },
      { ok: true, status: 200, json: async () => ({ nada: true }) },
      { ok: true, status: 200, json: async () => FIXTURE },
    ];
    let i = 0;
    const r = await simularPromosPorSku(Array.from({ length: 150 }, (_, k) => String(k)), {
      baseUrl: 'http://x', esperar: sinEspera, fetchConReintento: async () => respuestas[i++],
    });
    assert.equal(r.lotesOk, 1);
    assert.equal(r.lotesFallidos, 2);
    assert.equal(r.cortado, null);
    assert.deepEqual(r.promosPorSku.get('166672'), [P70]);
  });

  test('completarPromosPorSimulacion une cantidades 2 y 3 y no lanza aunque todo falle', async () => {
    const skus = [{ skuId: '166672' }, { skuId: '12562' }];
    const porCantidad = {
      2: FIXTURE,
      3: { items: [{ id: '12562', priceTags: [{ name: 'discount@price-aaa#1', value: -1 }] }],
        ratesAndBenefitsData: { rateAndBenefitsIdentifiers: [{ id: 'aaa', name: 'PromoVolumen - LLEVANDO 3 - 3x2 - Reg-3-100' }] } },
    };
    const r = await completarPromosPorSimulacion(skus, {
      baseUrl: 'http://x', esperar: sinEspera,
      fetchConReintento: async (url, opts) => {
        const q = JSON.parse(opts.body).items[0].quantity;
        return { ok: true, status: 200, json: async () => porCantidad[q] };
      },
    });
    assert.equal(r.skusConPromo, 2);
    assert.equal(skus[1].promosInternas[0].nombre, 'PromoVolumen - LLEVANDO 3 - 3x2 - Reg-3-100');

    const skus2 = [{ skuId: '1', promosInternas: null }];
    const r2 = await completarPromosPorSimulacion(skus2, {
      baseUrl: 'http://x', esperar: sinEspera, fetchConReintento: async () => { throw new Error('ECONNRESET'); },
    });
    assert.equal(r2.skusConPromo, 0);
    assert.equal(skus2[0].promosInternas, null);
    assert.match(r2.resumen, /lotes fallidos/);
  });
});
