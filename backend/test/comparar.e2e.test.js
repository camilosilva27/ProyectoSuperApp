/**
 * Batería end-to-end de `POST /api/comparar` — en particular el tope de supers, pero también
 * un chequeo de estructura general de la respuesta.
 *
 * A diferencia de `AllPromos/core/comparador.test.js` (que prueba `elegirSupersConTope` con
 * datos sintéticos, en memoria), esto levanta el server Express real y le pega por HTTP con
 * un carrito armado a partir del `catalogo-unificado.json` local — así se prueba también el
 * wiring real de la ruta (validación de `tope`, filtrado de `opciones`/`mejor` por el
 * subconjunto ganador, `totalOptimoSinTope`), no solo la función pura.
 *
 * El carrito se arma a propósito con:
 * - 3 productos disponibles en los 7 supers (el "grueso" del carrito),
 * - 1 producto exclusivo de un solo super (para probar que el tope no lo deja afuera por error
 *   de coordinación entre `filtrarOpcionesPorSupers` y `elegirSupersConTope`),
 * - 1 producto disponible en un subconjunto chico que NO incluye ese super exclusivo (para que
 *   con tope=1 sea imposible cubrir el carrito completo con cualquier super, un caso real de
 *   `noEncontrados` con datos reales, no inventado).
 *
 * El grupo "cross-check contra oráculo" (más abajo) es el más importante: pide una vez la
 * comparación SIN tope sobre un subconjunto chico de supers para tener el precio real de cada
 * ítem en cada uno de esos supers, arma con eso un oráculo independiente (suma del mínimo por
 * ítem sobre cada combinación), y confirma que lo que el endpoint devuelve con cada tope
 * coincide EXACTO con lo que ese oráculo dice que es el óptimo — con datos reales, con precios
 * reales, pasando por el server real.
 *
 * Corre contra los catálogos locales (backend/catalogo-unificado.json + AllPromos/catalogo-
 * *.json vía precioCache) — no depende de que las APIs de los supers estén arriba ni de tener
 * el cache de promos bancarias generado (si no está, aplicarPromosBancarias avisa y sigue).
 *
 * Correr con: node --test backend/test/comparar.e2e.test.js
 */

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { combinaciones } = require('../../AllPromos/core/comparador');

let server;
let base;

before(() => {
  // eslint-disable-next-line global-require -- requerido recién acá para que config.js lea
  // el .env real del proyecto en vez de uno mockeado, y para no arrancar sondaEnVivo (solo la
  // dispara arrancar(), que no llamamos: levantamos el listener nosotros, en un puerto libre).
  const { app } = require('../src/server');
  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise(resolve => server.close(resolve)));

async function postComparar(body) {
  const res = await fetch(`${base}/api/comparar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  return { status: res.status, json };
}

// --- carrito real, armado desde el catálogo local -------------------------------------------

const catalogo = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'catalogo-unificado.json'), 'utf8')
);

function elegir(pred, descripcion) {
  const p = catalogo.productos.find(pred);
  assert.ok(p, `no se encontró en catalogo-unificado.json ningún producto: ${descripcion}`);
  return p;
}

const full7 = catalogo.productos.filter(p => p.disponibleEn.length === 7).slice(0, 3);
assert.ok(full7.length === 3, 'catalogo-unificado.json no tiene 3 productos disponibles en los 7 supers — ¿corrió unificarCatalogo.js?');

const exclusivoCoto = elegir(
  p => p.disponibleEn.length === 1 && p.disponibleEn[0] === 'coto',
  'exclusivo de Coto (disponibleEn.length === 1)'
);
const parcialSinCoto = elegir(
  p => p.disponibleEn.length >= 2 && p.disponibleEn.length <= 3
    && p.disponibleEn.includes('vea') && !p.disponibleEn.includes('coto'),
  'disponible en 2-3 supers incluyendo Vea pero no Coto'
);

const CARRITO = [...full7, exclusivoCoto, parcialSinCoto].map(p => ({ ean: p.ean, cantidad: 1 }));

console.log('Carrito de prueba:', CARRITO.map((it, i) => {
  const p = [...full7, exclusivoCoto, parcialSinCoto][i];
  return `${p.nombre} (${p.disponibleEn.join(',')})`;
}));

// --- grupo A: comportamiento general sobre los 7 supers --------------------------------------

describe('POST /api/comparar — tope sobre los 7 supers', () => {
  let baseline;

  test('sin tope: respuesta baseline, sin totalOptimoSinTope', async () => {
    const { status, json } = await postComparar({ items: CARRITO });
    assert.equal(status, 200);
    assert.equal(json.supermercados.length, 7);
    assert.equal(json.resumen.totalOptimoSinTope, null);
    assert.ok(json.resumen.totalOptimo > 0);
    baseline = json;
  });

  test('tope igual a la cantidad de supers: no-op, mismo total que sin tope', async () => {
    const { status, json } = await postComparar({ items: CARRITO, tope: 7 });
    assert.equal(status, 200);
    assert.equal(json.supermercados.length, 7);
    assert.equal(json.resumen.totalOptimoSinTope, null);
    assert.equal(json.resumen.totalOptimo, baseline.resumen.totalOptimo);
  });

  test('tope mayor a la cantidad de supers: no-op también', async () => {
    const { status, json } = await postComparar({ items: CARRITO, tope: 20 });
    assert.equal(status, 200);
    assert.equal(json.supermercados.length, 7);
    assert.equal(json.resumen.totalOptimo, baseline.resumen.totalOptimo);
  });

  test('tope=6: recorta a 6 supers, totalOptimoSinTope aparece y el diff es >= 0', async () => {
    const { status, json } = await postComparar({ items: CARRITO, tope: 6 });
    assert.equal(status, 200);
    assert.equal(json.supermercados.length, 6);
    assert.ok(json.resumen.totalOptimoSinTope !== null);
    assert.equal(json.resumen.totalOptimoSinTope, baseline.resumen.totalOptimo);
    assert.ok(json.resumen.totalOptimo >= json.resumen.totalOptimoSinTope);

    // El ítem exclusivo de Coto tiene que seguir cubierto: excluir a Coto del mejor 6-combo
    // dejaría ese ítem en noEncontrados, y la regla de ranking prioriza cobertura sobre precio.
    const keys = json.supermercados.map(s => s.key);
    assert.ok(keys.includes('coto'), `el mejor combo de 6 excluyó a coto (quedaron: ${keys}) — debería haber preferido cobertura completa`);
    assert.equal(json.resumen.noEncontrados.length, 0);
  });

  test('tope=1: un solo super no puede cubrir el carrito completo (dato real, no inventado)', async () => {
    const { status, json } = await postComparar({ items: CARRITO, tope: 1 });
    assert.equal(status, 200);
    assert.equal(json.supermercados.length, 1);
    // El ítem exclusivo de Coto y el ítem "sin Coto" no pueden estar cubiertos por el mismo
    // único super a la vez (uno lo tiene solo Coto, el otro nunca lo tiene Coto) — algo queda
    // en noEncontrados sin importar qué super gane.
    assert.equal(json.resumen.noEncontrados.length, 1);
  });

  test('cada ítem de la respuesta tiene `mejor` (u opciones vacías) consistente con los supers usados', async () => {
    const { json } = await postComparar({ items: CARRITO, tope: 3 });
    const keysUsados = new Set(json.supermercados.map(s => s.key));
    for (const item of json.items) {
      for (const o of item.opciones) assert.ok(keysUsados.has(o.key), `opción de un super fuera del plan capado: ${o.key}`);
      if (item.mejor) assert.ok(keysUsados.has(item.mejor.key), `item.mejor señala un super fuera del plan capado: ${item.mejor.key}`);
    }
    // comprasPorSuper/linksCarrito no tienen que traer keys fuera del subconjunto ganador.
    for (const key of Object.keys(json.resumen.comprasPorSuper)) assert.ok(keysUsados.has(key));
    for (const key of Object.keys(json.resumen.linksCarrito)) assert.ok(keysUsados.has(key));
  });
});

// --- grupo B: validación de `tope` ------------------------------------------------------------

describe('POST /api/comparar — validación de tope', () => {
  for (const tope of [0, -1, 1.5, 'dos', NaN]) {
    test(`tope=${JSON.stringify(tope)} → 400`, async () => {
      const { status, json } = await postComparar({ items: CARRITO, tope });
      assert.equal(status, 400);
      assert.match(json.error, /tope/i);
    });
  }

  test('tope ausente sigue siendo válido (comportamiento de siempre)', async () => {
    const { status } = await postComparar({ items: CARRITO });
    assert.equal(status, 200);
  });
});

// --- grupo C: cross-check contra un oráculo independiente, con precios reales ----------------

describe('POST /api/comparar — tope vs. oráculo independiente (subconjunto chico, datos reales)', () => {
  const SUPERS_SUBSET = ['vea', 'coto', 'dia', 'carr'];
  let itemsSinTope;

  function puntajeIndependiente(items, comboKeys) {
    const keys = new Set(comboKeys);
    let total = 0;
    let noEncontrados = 0;
    for (const it of items) {
      const precios = it.opciones.filter(o => keys.has(o.key)).map(o => o.total);
      if (!precios.length) { noEncontrados++; continue; }
      total += Math.min(...precios);
    }
    return { noEncontrados, total: Math.round(total * 100) / 100 };
  }

  function mejorPuntajePosible(items, keys, tamano) {
    let mejor = null;
    for (const combo of combinaciones(keys, tamano)) {
      const p = puntajeIndependiente(items, combo);
      if (!mejor || p.noEncontrados < mejor.noEncontrados
          || (p.noEncontrados === mejor.noEncontrados && p.total < mejor.total)) mejor = p;
    }
    return mejor;
  }

  test('baseline sin tope sobre el subconjunto: junta el precio real de cada ítem en cada super', async () => {
    const { status, json } = await postComparar({ items: CARRITO, supers: SUPERS_SUBSET });
    assert.equal(status, 200);
    assert.deepEqual(json.supermercados.map(s => s.key).sort(), [...SUPERS_SUBSET].sort());
    itemsSinTope = json.items;
  });

  for (const tope of [1, 2, 3]) {
    test(`tope=${tope} sobre el subconjunto coincide EXACTO con el oráculo independiente`, async () => {
      const { status, json } = await postComparar({ items: CARRITO, supers: SUPERS_SUBSET, tope });
      assert.equal(status, 200);
      assert.equal(json.supermercados.length, tope);

      const puntajeReal = { noEncontrados: json.resumen.noEncontrados.length, total: json.resumen.totalOptimo };
      const puntajeOraculo = mejorPuntajePosible(itemsSinTope, SUPERS_SUBSET, tope);

      assert.deepEqual(
        puntajeReal, puntajeOraculo,
        `endpoint devolvió ${JSON.stringify(puntajeReal)} para tope=${tope}, ` +
        `pero el oráculo (con los precios reales que trajo el propio server) calculó ${JSON.stringify(puntajeOraculo)}`
      );
    });
  }
});

// --- grupo D: no explota con tarjetas seleccionadas (promos bancarias) ----------------------

describe('POST /api/comparar — tope + tarjetas seleccionadas no rompe nada', () => {
  test('tarjetas + tope capado: responde 200 y el diff sigue siendo >= 0', async () => {
    const { status, json } = await postComparar({
      items: CARRITO, tarjetas: ['Mi Carrefour'], tope: 3,
    });
    assert.equal(status, 200);
    assert.equal(json.supermercados.length, 3);
    if (json.resumen.totalOptimoSinTope != null) {
      assert.ok(json.resumen.totalOptimo >= json.resumen.totalOptimoSinTope - 0.01);
    }
  });
});

// --- grupo E: la asignación "qué comprar y dónde" es internamente consistente ---------------
//
// Esto no es lógica nueva de hoy (calcularResumenFinal ya estaba en producción, el tope solo
// se le agregó alrededor) — pero no estaba cubierta por ningún test todavía, así que se agrega
// acá: sin esto, un bug futuro en comparador.js podría mover un producto de `comprasPorSuper`
// sin que ningún test lo note.

describe('POST /api/comparar — "qué comprar y dónde" es consistente (sin tope)', () => {
  let json;

  before(async () => {
    ({ json } = await postComparar({
      items: [...full7, exclusivoCoto, parcialSinCoto].map(p => ({ ean: p.ean, cantidad: 2 })),
    }));
  });

  test('totalOptimo == suma de item.mejor.total de cada ítem', () => {
    const sumaManual = json.items.reduce((acc, it) => acc + (it.mejor ? it.mejor.total : 0), 0);
    assert.equal(json.resumen.totalOptimo, Math.round(sumaManual * 100) / 100);
  });

  test('item.mejor es realmente el más barato entre sus propias opciones', () => {
    for (const it of json.items) {
      if (!it.opciones.length) { assert.equal(it.mejor, null); continue; }
      const minimo = Math.min(...it.opciones.map(o => o.total));
      assert.equal(it.mejor.total, minimo, `item.mejor de ${it.ean} no es el más barato de sus opciones`);
    }
  });

  test('comprasPorSuper particiona exacto según item.mejor.key — ni un producto de más ni de menos', () => {
    const eanASuper = new Map();
    for (const [key, compras] of Object.entries(json.resumen.comprasPorSuper)) {
      for (const c of compras) eanASuper.set(c.ean, key);
    }
    for (const it of json.items) {
      if (!it.mejor) { assert.ok(!eanASuper.has(it.ean)); continue; }
      assert.equal(eanASuper.get(it.ean), it.mejor.key, `${it.ean} está en comprasPorSuper de otro super`);
    }
    assert.equal(eanASuper.size, json.items.filter(it => it.mejor).length, 'comprasPorSuper tiene entradas de más o de menos');
  });

  test('subtotalAsignadoPorSuper == suma real de lo asignado a cada super', () => {
    for (const [key, compras] of Object.entries(json.resumen.comprasPorSuper)) {
      const subtotalManual = compras.reduce((acc, c) => {
        const it = json.items.find(i => i.ean === c.ean);
        return acc + it.mejor.total;
      }, 0);
      assert.equal(json.resumen.subtotalAsignadoPorSuper[key], Math.round(subtotalManual * 100) / 100);
    }
  });

  test('ningún precio asignado es <= 0 (bug histórico: VTEX sin stock devolvía $0)', () => {
    for (const it of json.items) {
      if (it.mejor) assert.ok(it.mejor.total > 0, `${it.ean} tiene precio ${it.mejor.total}`);
    }
  });
});
