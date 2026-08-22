/**
 * Tests de `elegirSupersConTope` (y sus vecinos `combinaciones`/`filtrarOpcionesPorSupers`/
 * `filtrarSugerenciaPorSupers`) — la lógica nueva del tope de supers en la hoja "Qué supers
 * comparar".
 *
 * La parte que más puede fallar en silencio no es "¿arma bien las combinaciones?" (eso es
 * mecánico) sino "¿el subconjunto que devuelve es realmente el mejor?". Por eso la mayoría de
 * los casos de abajo no comparan contra un resultado fijo a mano, sino contra un oráculo
 * `totalIndependiente()` escrito distinto (suma directa sobre `mejores`, sin pasar por
 * `calcularResumenFinal`) que prueba TODAS las combinaciones del tamaño pedido y se queda con
 * la mejor — si `elegirSupersConTope` alguna vez elige algo peor que eso, el test lo detecta.
 *
 * Correr con: node --test AllPromos/core/comparador.test.js
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const {
  combinaciones,
  elegirSupersConTope,
  filtrarOpcionesPorSupers,
  filtrarSugerenciaPorSupers,
} = require('./comparador');

// --- helpers de construcción de datos sintéticos --------------------------------------------

function super_(key) {
  return { key, nombre: key, tag: key[0].toUpperCase() };
}

/** Un ítem del `resumen` que espera calcularResumenFinal/elegirSupersConTope.
 * @param precios { [key]: total|undefined } — undefined/ausente = ese super no lo vende. */
function item(precios) {
  const mejores = {};
  for (const [key, total] of Object.entries(precios)) {
    if (total == null) continue;
    mejores[key] = {
      total, productoNombre: 'producto', oferta: 'sin promoción', promo: null,
      esOnlineExclusivo: false, ean: '7790000000000', skuId: null, sellerId: null,
    };
  }
  return { input: 'producto', cantidad: 1, mejores, ambiguo: false };
}

/** PRNG determinístico (LCG) — nada de Math.random: los casos aleatorios tienen que ser
 *  reproducibles cuando un test falla. */
function crearRng(semilla) {
  let estado = semilla;
  return () => {
    estado = (estado * 1103515245 + 12345) & 0x7fffffff;
    return estado / 0x7fffffff;
  };
}

function itemAleatorio(rng, keys, precioMax, probabilidadAusente) {
  const precios = {};
  for (const key of keys) {
    if (rng() < probabilidadAusente) continue;
    precios[key] = Math.round(rng() * precioMax * 100) / 100;
  }
  return item(precios);
}

/** Oráculo independiente: para un combo de keys, suma el mínimo disponible por ítem, sin usar
 *  calcularResumenFinal — código distinto a propósito, para no compartir el mismo bug. */
function totalIndependiente(resumenItems, comboKeys) {
  const keys = new Set(comboKeys);
  let total = 0;
  let noEncontrados = 0;
  for (const it of resumenItems) {
    const precios = Object.entries(it.mejores)
      .filter(([k]) => keys.has(k))
      .map(([, v]) => v.total);
    if (!precios.length) { noEncontrados++; continue; }
    total += Math.min(...precios);
  }
  return { noEncontrados, total: Math.round(total * 100) / 100 };
}

/** Mejor puntaje posible entre TODAS las combinaciones de `keys` de tamaño `tamano`, según el
 *  oráculo independiente. Sirve de vara para juzgar lo que devuelve elegirSupersConTope. */
function mejorPuntajePosible(resumenItems, keys, tamano) {
  let mejor = null;
  for (const combo of combinaciones(keys, tamano)) {
    const p = totalIndependiente(resumenItems, combo);
    if (!mejor || p.noEncontrados < mejor.noEncontrados
        || (p.noEncontrados === mejor.noEncontrados && p.total < mejor.total)) {
      mejor = p;
    }
  }
  return mejor;
}

// --- combinaciones() -------------------------------------------------------------------------

describe('combinaciones', () => {
  test('tamaño 0 siempre da [[]], incluso con lista vacía', () => {
    assert.deepEqual(combinaciones([], 0), [[]]);
    assert.deepEqual(combinaciones([1, 2, 3], 0), [[]]);
  });

  test('tamaño mayor que la lista da []', () => {
    assert.deepEqual(combinaciones([1, 2], 3), []);
  });

  test('cuenta C(n,k) y no repite combinaciones, para varios n/k', () => {
    function factorial(n) { return n <= 1 ? 1 : n * factorial(n - 1); }
    function combinatoria(n, k) { return factorial(n) / (factorial(k) * factorial(n - k)); }

    for (let n = 0; n <= 7; n++) {
      const lista = Array.from({ length: n }, (_, i) => `s${i}`);
      for (let k = 0; k <= n; k++) {
        const combos = combinaciones(lista, k);
        assert.equal(combos.length, combinatoria(n, k), `C(${n},${k})`);
        for (const c of combos) {
          assert.equal(c.length, k);
          assert.equal(new Set(c).size, k, 'sin repetidos dentro de una combinación');
        }
        const firmas = new Set(combos.map(c => JSON.stringify(c)));
        assert.equal(firmas.size, combos.length, 'sin combinaciones duplicadas');
      }
    }
  });
});

// --- elegirSupersConTope: casos "no-op" ------------------------------------------------------

describe('elegirSupersConTope — sin tope efectivo', () => {
  const supers = [super_('a'), super_('b'), super_('c'), super_('d')];
  const resumen = [item({ a: 10, b: 20, c: 30, d: 40 })];

  for (const tope of [undefined, null, 0, -1, 1.5, NaN, 4, 5, 100]) {
    test(`tope=${tope} devuelve los supermercados sin recortar`, () => {
      const resultado = elegirSupersConTope(resumen, supers, tope);
      assert.equal(resultado, supers, 'misma referencia: no hay motivo para copiar el array');
    });
  }
});

// --- elegirSupersConTope: casos explícitos --------------------------------------------------

describe('elegirSupersConTope — casos puntuales', () => {
  test('con un ítem que solo vende UN super, el tope tiene que incluirlo aunque no sea el más barato en los demás', () => {
    // a y b son baratísimos para el único ítem que venden los 4, pero "candado" solo lo vende d.
    const supers = [super_('a'), super_('b'), super_('c'), super_('d')];
    const resumen = [
      item({ a: 1, b: 1, c: 100, d: 100 }), // barato en a/b
      item({ d: 50 }), // "candado": solo en d
    ];
    const elegido = elegirSupersConTope(resumen, supers, 2);
    const keys = elegido.map(s => s.key).sort();
    assert.ok(keys.includes('d'), `tiene que incluir "d" (único que vende el segundo ítem) — eligió ${keys}`);

    // Verificación contra el oráculo: el puntaje elegido tiene que ser el mejor posible.
    const puntajeElegido = totalIndependiente(resumen, elegido.map(s => s.key));
    const mejor = mejorPuntajePosible(resumen, supers.map(s => s.key), 2);
    assert.deepEqual(puntajeElegido, mejor);
  });

  test('empate de precio entre combos: elige alguno con el puntaje óptimo (no necesariamente uno fijo)', () => {
    const supers = [super_('a'), super_('b'), super_('c')];
    const resumen = [item({ a: 10, b: 10, c: 999 })]; // a y b empatan, c es carísimo
    const elegido = elegirSupersConTope(resumen, supers, 1);
    const puntajeElegido = totalIndependiente(resumen, elegido.map(s => s.key));
    assert.deepEqual(puntajeElegido, { noEncontrados: 0, total: 10 });
  });

  test('n=2, tope=1: elige el super más barato', () => {
    const supers = [super_('a'), super_('b')];
    const resumen = [item({ a: 30, b: 20 })];
    const elegido = elegirSupersConTope(resumen, supers, 1);
    assert.deepEqual(elegido.map(s => s.key), ['b']);
  });

  test('carrito vacío: cualquier combo del tamaño pedido sirve, total 0 sin noEncontrados', () => {
    const supers = [super_('a'), super_('b'), super_('c')];
    const elegido = elegirSupersConTope([], supers, 2);
    assert.equal(elegido.length, 2);
    assert.deepEqual(totalIndependiente([], elegido.map(s => s.key)), { noEncontrados: 0, total: 0 });
  });

  test('ningún super cubre un ítem: ese ítem queda como no encontrado en cualquier combo', () => {
    const supers = [super_('a'), super_('b'), super_('c')];
    const resumen = [item({ a: 10 }), item({})]; // el segundo ítem no lo vende nadie
    const elegido = elegirSupersConTope(resumen, supers, 1);
    const puntaje = totalIndependiente(resumen, elegido.map(s => s.key));
    assert.equal(puntaje.noEncontrados, 1);
    assert.deepEqual(elegido.map(s => s.key), ['a']); // igual elige el que sí cubre el otro ítem
  });
});

// --- elegirSupersConTope: barrido aleatorio contra el oráculo -------------------------------

describe('elegirSupersConTope — barrido aleatorio contra el oráculo', () => {
  const rng = crearRng(20260821);

  for (let ronda = 0; ronda < 40; ronda++) {
    const n = 3 + Math.floor(rng() * 5); // 3..7 supers
    const m = 1 + Math.floor(rng() * 10); // 1..10 ítems
    const keys = Array.from({ length: n }, (_, i) => `s${i}`);
    const supers = keys.map(super_);
    const resumen = Array.from({ length: m }, () => itemAleatorio(rng, keys, 500, 0.25));
    const tope = 1 + Math.floor(rng() * (n - 1)); // 1..n-1

    test(`ronda ${ronda}: n=${n} supers, ${m} ítems, tope=${tope}`, () => {
      const elegido = elegirSupersConTope(resumen, supers, tope);
      assert.equal(elegido.length, tope);

      const comboKeys = elegido.map(s => s.key);
      assert.equal(new Set(comboKeys).size, tope, 'sin repetidos');
      for (const k of comboKeys) assert.ok(keys.includes(k), 'solo keys reales');

      const puntajeElegido = totalIndependiente(resumen, comboKeys);
      const mejor = mejorPuntajePosible(resumen, keys, tope);
      assert.deepEqual(
        puntajeElegido, mejor,
        `elegido ${JSON.stringify(comboKeys)} dio ${JSON.stringify(puntajeElegido)}, ` +
        `pero el mejor posible era ${JSON.stringify(mejor)}`
      );
    });
  }
});

// --- filtrarOpcionesPorSupers ----------------------------------------------------------------

describe('filtrarOpcionesPorSupers', () => {
  const opciones = [
    { key: 'a', total: 10 },
    { key: 'b', total: 20 },
    { key: 'c', total: 30 },
  ];

  test('recorta a los supers usados y el mejor es el primero que sobrevive', () => {
    const { opciones: filtradas, mejor } = filtrarOpcionesPorSupers(opciones, [super_('b'), super_('c')]);
    assert.deepEqual(filtradas.map(o => o.key), ['b', 'c']);
    assert.equal(mejor.key, 'b'); // sigue siendo el más barato de los que sobreviven
  });

  test('si ningún super usado vende el ítem, mejor es null y opciones queda vacío', () => {
    const { opciones: filtradas, mejor } = filtrarOpcionesPorSupers(opciones, [super_('z')]);
    assert.deepEqual(filtradas, []);
    assert.equal(mejor, null);
  });

  test('no reordena — asume que `opciones` ya viene ordenado por precio', () => {
    // "a" es el más barato globalmente pero queda afuera del recorte: el ganador tiene que
    // ser "b" (el más barato ENTRE LOS QUE QUEDAN), no "a" filtrado a la fuerza.
    const { mejor } = filtrarOpcionesPorSupers(opciones, [super_('c'), super_('b')]);
    assert.equal(mejor.key, 'b');
  });
});

// --- filtrarSugerenciaPorSupers --------------------------------------------------------------

describe('filtrarSugerenciaPorSupers', () => {
  test('sugerencia null pasa igual', () => {
    assert.equal(filtrarSugerenciaPorSupers(null, [super_('a')]), null);
  });

  test('descarta candidatas que se quedan sin ninguna opción tras filtrar', () => {
    const sugerencia = {
      cantidadesCandidatas: [2, 3],
      vistaPrevia: [
        { cantidad: 2, opciones: [{ key: 'a', total: 10 }] },
        { cantidad: 3, opciones: [{ key: 'z', total: 5 }] }, // "z" no está en supermercadosUsados
      ],
    };
    const resultado = filtrarSugerenciaPorSupers(sugerencia, [super_('a')]);
    assert.deepEqual(resultado.cantidadesCandidatas, [2]);
    assert.equal(resultado.vistaPrevia.length, 1);
    assert.equal(resultado.vistaPrevia[0].cantidad, 2);
  });

  test('si ninguna candidata sobrevive, devuelve null', () => {
    const sugerencia = {
      cantidadesCandidatas: [2],
      vistaPrevia: [{ cantidad: 2, opciones: [{ key: 'z', total: 5 }] }],
    };
    assert.equal(filtrarSugerenciaPorSupers(sugerencia, [super_('a')]), null);
  });

  test('filtra las opciones DENTRO de una candidata que sobrevive parcialmente', () => {
    const sugerencia = {
      cantidadesCandidatas: [2],
      vistaPrevia: [{ cantidad: 2, opciones: [{ key: 'a', total: 10 }, { key: 'z', total: 1 }] }],
    };
    const resultado = filtrarSugerenciaPorSupers(sugerencia, [super_('a')]);
    assert.deepEqual(resultado.vistaPrevia[0].opciones, [{ key: 'a', total: 10 }]);
  });
});
