/**
 * Tests de los fixes de la auditoría del 2026-09-24: día de la semana en hora argentina,
 * guardrail de catálogo con referencia que no se erosiona, fin de paginación VTEX, retry de
 * fetch, NaN en promos, tope "Max N unidades", vigencia de promos en precioCache y fallback
 * en vivo (IsAvailable/precio 0, un super caído no tira los otros 6, timeout).
 *
 * Sin red: todo fetch se mockea reemplazando globalThis.fetch.
 *
 * Correr con: node --test AllPromos/core/auditoria-2026-09-24.test.js
 */

const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { diaSemanaISOArgentina, fechaISOArgentina } = require('./fechaArgentina');
const { diaISO, promosAplicablesHoy } = require('../promos-bancarias');
const { evaluarGuardrail, guardarCatalogoConGuardrail } = require('./guardrailCatalogo');
const { fetchConReintentoHTTP, esFinLegitimoDePaginacion } = require('./reintentoVTEX');
const { interpretarPromoPorTexto, interpretarPromoCarrefour, calcularCosto } = require('../promo-engine');
const { parsearProductosCarrefour, parsearProductosDia, parsearProductosChangoMas, buscarPorEAN } = require('./fetchers');
const { _test: precioCacheTest } = require('../../backend/src/precioCache');

const fetchOriginal = globalThis.fetch;
afterEach(() => { globalThis.fetch = fetchOriginal; });

describe('día de la semana en hora argentina', () => {
  test('lunes 22:30 ART (= martes 01:30 UTC) sigue siendo lunes', () => {
    const f = new Date('2026-09-22T01:30:00Z');
    assert.equal(diaSemanaISOArgentina(f), 1);
    assert.equal(diaISO(f), 1);
    assert.equal(fechaISOArgentina(f), '2026-09-21');
  });

  test('martes 00:00 ART (= 03:00 UTC) ya es martes', () => {
    assert.equal(diaISO(new Date('2026-09-22T03:00:00Z')), 2);
  });

  test('domingo es 7', () => {
    assert.equal(diaISO(new Date('2026-09-27T15:00:00Z')), 7);
  });

  test('una promo de martes NO aplica el lunes a las 22:30 ART', () => {
    const promo = {
      dias: [2], vigenciaDesde: new Date('2026-01-01'), vigenciaHasta: new Date('2027-01-01'),
    };
    assert.equal(promosAplicablesHoy([promo], { fecha: new Date('2026-09-22T01:30:00Z') }).length, 0);
    assert.equal(promosAplicablesHoy([promo], { fecha: new Date('2026-09-22T03:00:00Z') }).length, 1);
  });
});

describe('guardrail de catálogo', () => {
  const AHORA = Date.parse('2026-09-24T12:00:00Z');
  const hace = (horas) => new Date(AHORA - horas * 3600000).toISOString();

  test('catálogo viejo sin historial: se siembra con su total_skus', () => {
    const r = evaluarGuardrail({ fecha: hace(2), total_skus: 2550 }, 2000, AHORA);
    assert.equal(r.referencia, 2550);
    assert.equal(r.ok, false); // 2000 < 85% de 2550
  });

  test('sin catálogo anterior: acepta', () => {
    assert.equal(evaluarGuardrail(null, 10, AHORA).ok, true);
  });

  test('no se erosiona escalonadamente: la vara es el máximo reciente, no la última corrida', () => {
    const anterior = {
      fecha: hace(2), total_skus: 2200,
      guardrail: { historial: [{ fecha: hace(4), total_skus: 2550 }, { fecha: hace(2), total_skus: 2200 }] },
    };
    // 1900 es 86% de 2200 (la corrida inmediata anterior) pero 74% de 2550 → bloquea.
    const r = evaluarGuardrail(anterior, 1900, AHORA);
    assert.equal(r.referencia, 2550);
    assert.equal(r.ok, false);
  });

  test('entradas fuera de la ventana de 7 días no cuentan (salida ante baja real sostenida)', () => {
    const anterior = { fecha: hace(8 * 24), total_skus: 2550, guardrail: { historial: [{ fecha: hace(8 * 24), total_skus: 2550 }] } };
    const r = evaluarGuardrail(anterior, 1000, AHORA);
    assert.equal(r.ok, true);
    assert.deepEqual(r.historial.map(h => h.total_skus), [1000]);
  });

  test('en disco: acepta y guarda historial; bloquea sin pisar el archivo', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'guardrail-'));
    const ruta = path.join(dir, 'catalogo-x.json');
    guardarCatalogoConGuardrail(ruta, { fecha: hace(4), total_skus: 2550, skus: [] }, { ahora: AHORA - 4 * 3600000 });
    guardarCatalogoConGuardrail(ruta, { fecha: hace(2), total_skus: 2400, skus: [] }, { ahora: AHORA - 2 * 3600000 });
    const guardado = JSON.parse(fs.readFileSync(ruta, 'utf8'));
    assert.deepEqual(guardado.guardrail.historial.map(h => h.total_skus), [2550, 2400]);

    assert.throws(() => guardarCatalogoConGuardrail(ruta, { fecha: hace(0), total_skus: 2100, skus: [] }, { ahora: AHORA }), /sospechosamente chico/);
    assert.equal(JSON.parse(fs.readFileSync(ruta, 'utf8')).total_skus, 2400);
    fs.rmSync(dir, { recursive: true });
  });
});

describe('paginación y retry VTEX', () => {
  test('solo el 400 cerca del techo de ~2550 es fin legítimo', () => {
    assert.equal(esFinLegitimoDePaginacion({ status: 400 }, 2550), true);
    assert.equal(esFinLegitimoDePaginacion({ status: 400 }, 800), false);
    assert.equal(esFinLegitimoDePaginacion({ status: 429 }, 2550), false);
    assert.equal(esFinLegitimoDePaginacion(new Error('ECONNRESET'), 2550), false);
  });

  test('reintenta 429/5xx y error de red, y devuelve la respuesta buena', async () => {
    const respuestas = [new Error('socket'), { status: 429 }, { status: 502 }, { status: 200, ok: true }];
    let llamadas = 0;
    globalThis.fetch = async () => {
      const r = respuestas[llamadas++];
      if (r instanceof Error) throw r;
      return r;
    };
    const avisos = [];
    const res = await fetchConReintentoHTTP('http://x', {}, { esperar: async () => {}, onReintento: m => avisos.push(m) });
    assert.equal(res.status, 200);
    assert.equal(llamadas, 4);
    assert.equal(avisos.length, 3);
  });

  test('agotados los reintentos devuelve el último 429 (el llamador decide lanzar)', async () => {
    let llamadas = 0;
    globalThis.fetch = async () => { llamadas++; return { status: 429, ok: false }; };
    const res = await fetchConReintentoHTTP('http://x', {}, { esperar: async () => {} });
    assert.equal(res.status, 429);
    assert.equal(llamadas, 4); // 1 + 3 reintentos
  });
});

describe('promo-engine', () => {
  test('effectiveDiscount no numérico no produce NaN: sin promo', () => {
    assert.equal(interpretarPromoPorTexto('OFERTA SERENISIMA BA | Ofertas Trafico', 'abc'), null);
    assert.equal(interpretarPromoPorTexto('OFERTA X', null), null);
  });

  test('effectiveDiscount no numérico con % en el nombre usa el del nombre', () => {
    assert.equal(interpretarPromoPorTexto('20% algo', 'abc').descuentoPct, 0.2);
  });

  test('"Max 8 unidades" de Carrefour limita las unidades con promo', () => {
    const p = interpretarPromoCarrefour({ nombre: 'PROMO-2do al 50% Max 8 unidades Combinable SUSSEX-Reg-2-50-Gigante4 al 10.8' });
    assert.equal(p.tipo, 'ndo_al_pct');
    assert.equal(p.maxUnidades, 8);
    // 10 unidades a $100: 4 grupos (8 u.) → 4 × (100 + 50) = 600, + 2 a precio lleno = 800.
    assert.equal(calcularCosto(p, 100, 10).totalConPromo, 800);
    // Dentro del tope, igual que antes.
    assert.equal(calcularCosto(p, 100, 4).totalConPromo, 300);
  });

  test('sin "Max", sin tope (comportamiento anterior)', () => {
    const p = interpretarPromoCarrefour({ nombre: 'PROMO-2x1 Iguales-Reg-2-100' });
    assert.equal(p.maxUnidades, undefined);
    assert.equal(calcularCosto(p, 100, 10).totalConPromo, 500);
  });
});

describe('precioCache — vigencia de promos Vea/Jumbo/Disco', () => {
  const sku = (vigenciaHasta, descuento = '0.2') => ({
    skuId: '1', ean: '779', productName: 'X', skuName: 'X', seller: '1', precioBase: 1000,
    promocion: { nombre: 'OFERTA X | Ofertas Internas', descuento, vigenciaDesde: '2026-09-01T00:01:00-03:00', vigenciaHasta },
  });

  test('promo vencida se anula al consultar (el SKU queda a precio base)', () => {
    const [e] = precioCacheTest.entradasCencosud(sku('2026-09-20T23:59:00-03:00'), 'Vea');
    assert.ok(e.promo);
    const g = precioCacheTest.aplicarVigencia({ vea: [e] }, Date.parse('2026-09-24T12:00:00Z'));
    assert.equal(g.vea.length, 1);
    assert.equal(g.vea[0].promo, null);
    assert.equal(g.vea[0].precioBase, 1000);
  });

  test('vigenciaHasta es un instante con offset: 23:59 ART del 30 sigue vigente a las 02:00 UTC del 1', () => {
    const [e] = precioCacheTest.entradasCencosud(sku('2026-09-30T23:59:00-03:00'), 'Vea');
    const g = precioCacheTest.aplicarVigencia({ vea: [e] }, Date.parse('2026-10-01T02:00:00Z'));
    assert.ok(g.vea[0].promo);
  });

  test('descuento no numérico: el SKU se muestra sin promo, no desaparece con NaN', () => {
    const [e] = precioCacheTest.entradasCencosud(sku('2026-12-31T23:59:00-03:00', 'no-numérico'), 'Vea');
    assert.equal(e.promo, null);
    assert.equal(e.precioBase, 1000);
  });
});

describe('fallback en vivo', () => {
  const productoVTEX = ({ price, listPrice, disponible = true, teasers = [] }) => [{
    productName: 'P', items: [{
      itemId: '9', name: 'P', ean: '779',
      sellers: [{ sellerId: '1', commertialOffer: { Price: price, ListPrice: listPrice, IsAvailable: disponible, Teasers: teasers } }],
    }],
  }];

  test('Carrefour/Día/Chango Más descartan SKUs sin stock o con precio 0', () => {
    const teaser = { '<Name>k__BackingField': 'PROMO-2x1 Iguales-Reg-2-100' };
    for (const parsear of [parsearProductosCarrefour, parsearProductosDia, parsearProductosChangoMas]) {
      assert.deepEqual(parsear(productoVTEX({ price: 0, listPrice: 1000, teasers: [teaser] })), []);
      assert.deepEqual(parsear(productoVTEX({ price: 900, listPrice: 1000, disponible: false })), []);
      assert.ok(parsear(productoVTEX({ price: 900, listPrice: 1000 })).length > 0);
    }
  });

  test('un super que falla no descarta el resultado de los otros 6', async () => {
    const calls = [];
    globalThis.fetch = async (url, opts) => {
      calls.push(opts?.signal);
      if (String(url).includes('coto')) throw new Error('timeout');
      const body = String(url).includes('carrefour') ? productoVTEX({ price: 900, listPrice: 900 }) : [];
      return { ok: true, json: async () => body };
    };
    const r = await buscarPorEAN('779', { skuIdVea: null });
    assert.equal(r.coto.length, 0);
    assert.equal(r.carr.length, 1);
    assert.ok(calls.every(s => s instanceof AbortSignal), 'todo fetch en vivo lleva timeout');
  });
});
