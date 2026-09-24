/**
 * Promos "fixed_price" de Vea/Jumbo/Disco (`/_v/search-promotions`) y seller de los extras de
 * Disco — bugs reales del 2026-09-24 (ver core/promoCencosud.js y CONTEXTO_TECNICO.md § "API de
 * Vea — quirks críticos").
 *
 * Las promos de ejemplo son respuestas reales de search-promotions (recortadas).
 * Sin red: el fallback en vivo se prueba mockeando globalThis.fetch.
 *
 * Correr con: node --test AllPromos/core/cencosud-precio-fijo.test.js
 */

const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { promocionCatalogoCencosud, promoMotorCencosud } = require('./promoCencosud');
const { interpretarPromoPorTexto, calcularCosto } = require('../promo-engine');
const { parsearProductosVea, parsearProductosCencosud } = require('./fetchers');
const { _test: precioCacheTest } = require('../../backend/src/precioCache');

const fetchOriginal = globalThis.fetch;
afterEach(() => { globalThis.fetch = fetchOriginal; });

const VIGENCIA = { start: '2026-09-15T00:01:00-03:00', end: '2099-09-29T23:59:00-03:00' };
const TRAVIATA = { name: 'OFERTA TRAVIATA | Ofertas Trafico', categoryType: 'fixed_price', discountType: 'fixed_price', value: 790, code: 'Oferta', effectiveDiscount: '0.19', ...VIGENCIA };
const KREA = { name: 'OFERTA KREA | Ofertas Internas', categoryType: 'fixed_price', discountType: 'fixed_price', value: 1490, code: 'Oferta', effectiveDiscount: '0.32', ...VIGENCIA };
const NXM = { name: '3x2 MOGUL | Ofertas Internas', categoryType: 'nxm', discountType: 'percentual', value: 0, code: '3x2', effectiveDiscount: '0.33', ...VIGENCIA };
const SEGUNDO = { name: '2do al 50% COCA COLA PUNTERA | Ofertas Internas', categoryType: 'segundo_al', discountType: 'percentual', value: 0, code: '2do al 50%', effectiveDiscount: '0.25', ...VIGENCIA };
const PCT = { name: '35% VILLAVICENCIO | Ofertas Internas', categoryType: 'percentual', discountType: 'percentual', value: 0, code: '35%', effectiveDiscount: '0.35', ...VIGENCIA };
const LLEVANDO = { name: 'OFERTA LINEA PEPSI | Ofertas Trafico', categoryType: 'Llevando n x', discountType: 'percentual', value: 0, code: 'Llevando 6', ...VIGENCIA };

const totalCon = (promo, precioBase, cantidad) => calcularCosto(promo, precioBase, cantidad).totalConPromo;
/** Lo que hacía el código anterior: effectiveDiscount como % directo (si era > 0). */
const promoAnterior = (p) => (parseFloat(p.effectiveDiscount) > 0 ? interpretarPromoPorTexto(p.name, p.effectiveDiscount) : null);

describe('fixed_price usa `value`, no effectiveDiscount', () => {
  // Precio base real de cada super el 2026-09-24 y lo que mostraba la app antes.
  for (const [superNombre, precioBase, antes] of [['Vea', 950, 769.5], ['Disco', 1000, 810], ['Jumbo', 1050, 850.5]]) {
    test(`Traviata en ${superNombre}: $${antes} antes → $790 (precio fijo real)`, () => {
      assert.equal(totalCon(promoAnterior(TRAVIATA), precioBase, 1), antes);
      const cat = promocionCatalogoCencosud(TRAVIATA, precioBase);
      assert.equal(cat.categoryType, 'fixed_price');
      assert.equal(cat.value, 790);
      assert.equal(cat.precioFinal, 790);
      const promo = promoMotorCencosud(cat, precioBase);
      assert.equal(promo.tipo, 'oferta_precio_fijo');
      assert.equal(promo.nUnidades, 1);
      assert.equal(promo.cantidadMinima, 1);
      assert.equal(promo.esOnline, true); // "| Ofertas Trafico", mismo criterio que antes
      for (const q of [1, 2, 3, 7]) assert.equal(totalCon(promo, precioBase, q), 790 * q);
    });
  }

  test('pelador Krea (skuId 412145): $2.383,40 antes → $1.490', () => {
    assert.equal(Math.round(totalCon(promoAnterior(KREA), 3505, 1) * 100) / 100, 2383.4);
    const promo = promoMotorCencosud(promocionCatalogoCencosud(KREA, 3505), 3505);
    assert.equal(totalCon(promo, 3505, 1), 1490);
    assert.equal(promo.esOnline, false); // "| Ofertas Internas"
  });

  test('`descuento` guardado es el % real, así un lector viejo también llega al precio correcto', () => {
    const cat = promocionCatalogoCencosud(TRAVIATA, 1000);
    assert.equal(cat.descuento, '0.2100');
    assert.equal(cat.descuentoPct, '21%');
    assert.equal(Math.round(totalCon(interpretarPromoPorTexto(cat.nombre, cat.descuento), 1000, 1)), 790);
  });

  test('value >= precioBase (ej. soda Cuisine & Co en Disco: base $1.100, "oferta" $1.480) → sin promo', () => {
    const p = { ...TRAVIATA, value: 1480, effectiveDiscount: '0.12' };
    assert.equal(promocionCatalogoCencosud(p, 1100), null);
    assert.equal(promocionCatalogoCencosud({ ...TRAVIATA, value: 1100 }, 1100), null);
    // Aunque un catálogo traiga un value que dejó de bajar el precio (precioBase cambió), sin promo.
    assert.equal(promoMotorCencosud({ nombre: 'OFERTA X', categoryType: 'fixed_price', value: 1480, descuento: '0.12' }, 1100), null);
  });

  test('value ausente, 0 o no numérico → sin promo (no se inventa)', () => {
    for (const value of [undefined, null, 0, -5, 'abc']) {
      assert.equal(promocionCatalogoCencosud({ ...TRAVIATA, value }, 1000), null, String(value));
    }
  });
});

describe('los demás categoryType siguen igual que antes', () => {
  for (const [nombre, p, precioBase] of [['nxm', NXM, 1000], ['segundo_al', SEGUNDO, 5900], ['percentual', PCT, 3190]]) {
    test(`${nombre}: mismo total que el código anterior para 1..6 unidades`, () => {
      const cat = promocionCatalogoCencosud(p, precioBase);
      assert.equal(cat.categoryType, p.categoryType);
      assert.equal(cat.descuento, p.effectiveDiscount);
      const nueva = promoMotorCencosud(cat, precioBase);
      for (let q = 1; q <= 6; q++) {
        assert.equal(totalCon(nueva, precioBase, q), totalCon(promoAnterior(p), precioBase, q), `q=${q}`);
      }
    });
  }

  test('"Llevando n x" (value 0, sin effectiveDiscount, code "Llevando 6") → sin promo', () => {
    assert.equal(promocionCatalogoCencosud(LLEVANDO, 3000), null);
  });

  test('catálogo viejo (sin categoryType) → mismo resultado que antes', () => {
    const viejo = { nombre: 'OFERTA TRAVIATA | Ofertas Trafico', codigo: 'Oferta', descuento: '0.19' };
    assert.deepEqual(promoMotorCencosud(viejo, 1000), interpretarPromoPorTexto(viejo.nombre, viejo.descuento));
  });
});

describe('precioCache.entradasCencosud', () => {
  const sku = (promocion, precioBase = 1050) => ({ skuId: '1361830', ean: '7790040143944', productName: 'Traviata', skuName: 'Traviata', seller: '1', precioBase, promocion });

  test('catálogo nuevo con fixed_price → oferta_precio_fijo a $790', () => {
    const [e] = precioCacheTest.entradasCencosud(sku(promocionCatalogoCencosud(TRAVIATA, 1050)), 'Jumbo');
    assert.equal(e.promo.tipo, 'oferta_precio_fijo');
    assert.equal(totalCon(e.promo, e.precioBase, 2), 1580);
    // La vigencia se sigue aplicando igual.
    const g = precioCacheTest.aplicarVigencia({ jumbo: [e] }, Date.parse('2026-09-24T12:00:00Z'));
    assert.ok(g.jumbo[0].promo);
  });

  test('catálogo viejo → mismo pct_directo que antes', () => {
    const [e] = precioCacheTest.entradasCencosud(sku({ nombre: 'OFERTA TRAVIATA | Ofertas Trafico', descuento: '0.19' }), 'Jumbo');
    assert.equal(e.promo.tipo, 'pct_directo');
    assert.equal(totalCon(e.promo, 1050, 1), 850.5);
  });
});

describe('fallback en vivo (parsearProductosVea / parsearProductosCencosud)', () => {
  const productos = [{ productName: 'Traviata', items: [{ itemId: '1361830', name: 'Traviata', ean: '7790040143944', sellers: [{ sellerId: '1', commertialOffer: { Price: 1000, IsAvailable: true } }] }] }];
  const mockPromos = (promo) => {
    globalThis.fetch = async (url, opts) => {
      assert.match(url, /_v\/search-promotions$/);
      assert.equal(JSON.parse(opts.body).seller, 'jumboargentinav700cordoba700');
      return { ok: true, json: async () => ({ promotions: { generic: { promotions: { 1361830: promo } } } }) };
    };
  };

  test('Disco: fixed_price → $790', async () => {
    mockPromos(TRAVIATA);
    const [r] = await parsearProductosCencosud(productos, 'https://www.disco.com.ar');
    assert.equal(r.super, 'Disco');
    assert.equal(totalCon(r.promo, r.precioBase, 1), 790);
  });

  test('Vea: fixed_price → $790; "Llevando n x" → sin promo', async () => {
    mockPromos(TRAVIATA);
    let [r] = await parsearProductosVea(productos);
    assert.equal(totalCon(r.promo, r.precioBase, 3), 2370);
    mockPromos(LLEVANDO);
    [r] = await parsearProductosVea(productos);
    assert.equal(r.promo, null);
  });
});

describe('seller de search-promotions en los extras de Disco', () => {
  // Con 'discoargentinav700cordoba700' el endpoint responde 200 pero siempre vacío (confirmado
  // en vivo 2026-09-24); el que funciona es el mismo que usa scraper-promos-disco.js.
  const sellerDe = (archivo) => fs.readFileSync(path.join(__dirname, '..', archivo), 'utf8').match(/^const PROMO_SELLER = '([^']+)'/m)?.[1];
  for (const archivo of ['completar-disco-por-ean.js', 'refrescar-precio-extras-disco.js']) {
    test(`${archivo} usa el mismo seller que scraper-promos-disco.js`, () => {
      assert.equal(sellerDe(archivo), 'jumboargentinav700cordoba700');
      assert.equal(sellerDe(archivo), sellerDe('scraper-promos-disco.js'));
    });
  }
});
