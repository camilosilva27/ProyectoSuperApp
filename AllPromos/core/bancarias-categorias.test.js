/**
 * Promos bancarias "por ticket" limitadas a categorías / con exclusiones / "no acumulables"
 * (decisión del usuario 2026-09-24). Textos REALES recortados de los feeds de ese día (Cencosud
 * bankDiscount, GraphQL de Carrefour y Chango Más). Ver "Promos limitadas a categorías" en
 * .claude/docs/CONTEXTO_TECNICO.md.
 *
 * Correr con: node --test AllPromos/core/bancarias-categorias.test.js
 */

const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const pb = require('../promos-bancarias');
const { calcularResumenFinal } = require('./comparador');
const { categoriasDeProducto } = require('./categoriasPromo');
const { _test: compararTest } = require('../../backend/src/routes/comparar');

const fetchOriginal = globalThis.fetch;
afterEach(() => { globalThis.fetch = fetchOriginal; });
const respuesta = body => ({ ok: true, json: async () => body, text: async () => JSON.stringify(body) });
const aDocs = objetos => ({ data: { documents: objetos.map(o => ({ fields: Object.entries(o).map(([key, value]) => ({ key, value })) })) } });

const VIGENCIA = { vigenciaDesde: new Date('2020-01-01'), vigenciaHasta: new Date('2099-01-01') };
const TODOS_LOS_DIAS = [1, 2, 3, 4, 5, 6, 7];

// ─── Textos reales ────────────────────────────────────────────────────────────
const CENCOPAY_25_JUMBO = {
  banks: [{ name: 'CencoPay' }],
  websites: ['discoargentina', 'jumboargentina', 'jumboargentinaio'],
  days: ['4'], discount: '25.00', discountText: '',
  dateStart: '1751338800', dateEnd: '4102444800',
  info: 'PROMOCIÓN VÁLIDA EN LOS LOCALES HABILITADOS Y SITIOS WEB OBTENIENDO UN 25% DE DESCUENTO EN PRODUCTOS SELECCIONADOS DE LAS SECCIONES GALLETITAS, BEBIDAS SIN ALCOHOL, PERFUMERÍA Y LIMPIEZA. PROMOCIÓN LOS DÍAS JUEVES.',
  legals: 'PARA MÁS INFORMACIÓN Y CONDICIONES O LIMITACIONES APLICABLES, CONSULTE EN CENCOPAY.AR PROMOCIONES VÁLIDAS PARA COMPRAS REALIZADAS LOS DÍAS JUEVES DEL 01/07/2026 AL 30/09/2026 EN LA REPÚBLICA ARGENTINA CON TARJETA DE CRÉDITO CENCOPAY. NO ACUMULABLES CON OTRAS PROMOCIONES Y/O DESCUENTOS. ESTAS PROMOCIONES NO APLICAN PARA CLIENTES EN MORA O INHABILITADOS, TAMPOCO APLICA PARA PAGOS REALIZADOS CON QR NI PARA COMPRAS EN LOS LOCALES "DISCO EXPRESS".   (1) PROMOCIÓN VÁLIDA EN LOS LOCALES HABILITADOS Y SITIOS WEB OBTENIENDO UN 25% DE DESCUENTO EN PRODUCTOS SELECCIONADOS DE GALLETITAS, BEBIDAS SIN ALCOHOL, PERFUMERÍA Y LIMPIEZA. EL DESCUENTO SE EFECTIVIZARÁ EN EL CHECK OUT (2) PROMOCIÓN VÁLIDA LOS DIAS JUEVES EN LOS LOCALES HABILITADOS Y SITIOS WEB OBTENIENDO SOLO 3 CUOTAS SIN INTERÉS EN TODA LA COMPRA.',
};
const CENCOPAY_40 = {
  banks: [{ name: 'CencoPay Cuenta' }],
  websites: ['jumboargentina', 'veaargentina', 'discoargentina', 'jumboargentinaio'],
  days: ['5', '6'], discount: '40.00', discountText: '',
  dateStart: '1751338800', dateEnd: '4102444800',
  info: 'TOPE DE REINTEGRO $15.000 (QUINCE MIL PESOS ARGENTINOS) POR DÍA. NO INCLUYE ELECTRODOMÉSTICOS. EXCLUSIVO PARA VENTAS PRESENCIALES. EL DESCUENTO SE EFECTIVIZARÁ EN EL CHECK OUT O LÍNEA DE CAJAS.',
  legals: 'PROMOCIONES VÁLIDAS PARA COMPRAS REALIZADAS LOS VIERNES, SÁBADOS Y DOMINGOS DESDE EL 01/08/2026 AL 30/09/2026 EN LOS LOCALES HABILITADOS, OBTENIENDO UN 40% DE DESCUENTO EN GALLETITAS, CERVEZAS, CHOCOLATE Y GOLOSINAS, CONSERVAS DE VERDURAS, LEGUMBRES Y FRUTAS. TOPE DE REINTEGRO $15.000 (QUINCE MIL PESOS ARGENTINOS) POR DÍA. NO INCLUYE ELECTRODOMÉSTICOS. EXCLUSIVO PARA VENTAS PRESENCIALES.',
};
const CARREFOUR_EMPLEADO_PUBLICO = {
  title: 'Si sos empleado/a público todos los jueves',
  sub_title: 'En Alimentos secos, Congelados, Lácteos, Fiambres,  Bebidas, Limpieza y Perfumería. Tope máximo de descuento mensual $ 20.000',
  legal: 'PROMOCIÓN VÁLIDA LOS DIAS JUEVES HASTA EL 30/09/2026, EXCLUSIVO EN HIPERMERCADOS CARREFOUR Y CARREFOUR MARKET DE LAS PROVINCIAS DE: SANTA FE, FORMOSA, NEUQUÉN. NO ACUMULABLE CON OTRAS PROMOCIONES VIGENTES.',
};
const CHANGO_ANSES = {
  sub_title: 'Tope: $12.000 por transacción. No acumulable con otras promociones. Aplican exclusiones.(A)*',
  legal: 'PROMOCIÓN EXCLUSIVA PARA BENEFICIARIOS DE ANSES EN COMPRAS PRESENCIALES Y ONLINE EN TODAS LAS TIENDAS DEL PAÍS. ÚNICAMENTE EN LOS PRODUCTOS DETALLADOS A CONTINUACIÓN: CONSERVA DE TOMATES, PASTAS SECAS Y REFRIGERADAS, ARROZ, ADEREZOS, SALCHICHAS, LECHE UAT, CAFÉ, TÉ, ENDULZANTES, ALMACÉN SIN TACC, LECHE FRESCA, LECHES MATERNAS, CONSERVA DE VEGETALES, CACAO, SAL, CEREALES, DULCE DE LECHE.',
};
const CHANGO_MP = {
  sub_title: 'Pagando con QR. No acumulable con otras promociones.  Aplican exclusiones. (MP)*',
  legal: 'EXCLUIDOS-NO INCLUYE: CARNICERIA, GRANJA, ELABORADOS, EMBUTIDOS, QUESOS: (QUESOS BLANDOS, QUESOS DUROS, QUESOS FETEADOS, QUESOS RALLADOS, QUESOS SEMIDUROS), FRUTAS Y VERDURAS, HUEVOS. ACEITES COMESTIBLES, HARINAS, LECHES FLUIDAS, AZÚCARES. BEBIDAS BLANCAS, VINOS, FERNET, CERVEZAS Y GASEOSAS DE “CERVECERIA Y MALTERIA QUILMES” (STELLA ARTOIS, BUDWEISER, CORONA, QUILMES, BRAHMA, MICHELOB, PATAGONIA, EAZY, GOOSE ISLAND, ANDES, TEMPLE, PEPSI, SEVEN UP, PASO DE LOS TOROS, GATORADE, GLACIAR, ECO DE LOS ANDES, H20, AGUAS NESTLÉ, AWAFRUT, MIRINDA, RED BULL, ROCKSTAR), LÍNEA COCA COLA (ORIGINAL, LIGHT, ZERO SIN AZUCAR, SABOR LIVIANO), FANTA, SPRITE (ORIGINAL, SIN AZÚCAR), SCHWEPPES, POWERADE, CEPITA, ADES, AQUARIUS, BENEDICTINO, BONAQUA, SMART WATER, MONSTER, CRUSH, FIGURITAS Y ÁLBUM MUNDIAL 2026. ELECTRODOMÉSTICOS Y ELECTRÓNICOS, RODADOS, INFORMÁTICA.',
};

// ─── Extracción ───────────────────────────────────────────────────────────────
describe('restriccionesDeCategoria: textos reales', () => {
  test('Cencopay 25% jueves Jumbo/Disco → galletitas, bebidas sin alcohol, perfumería, limpieza + no acumulable', () => {
    const r = pb.restriccionesDeCategoria(CENCOPAY_25_JUMBO.info, CENCOPAY_25_JUMBO.legals);
    assert.deepEqual(r.categoriasIncluidas, ['galletitas', 'bebidas sin alcohol', 'perfumeria', 'limpieza']);
    assert.equal(r.noAcumulable, true);
  });

  test('Cencopay 40% vie-dom → galletitas, golosinas, conservas de frutas y verduras, cervezas; excluye electro', () => {
    const r = pb.restriccionesDeCategoria(CENCOPAY_40.info, CENCOPAY_40.legals);
    assert.deepEqual(r.categoriasIncluidas, ['galletitas', 'golosinas', 'conservas vegetales', 'cervezas']);
    assert.deepEqual(r.categoriasExcluidas, ['electro']);
    assert.equal(r.noAcumulable, undefined);
  });

  test('Carrefour Empleado público: "En Alimentos secos, …" del sub_title', () => {
    const r = pb.restriccionesDeCategoria(`${CARREFOUR_EMPLEADO_PUBLICO.title}. ${CARREFOUR_EMPLEADO_PUBLICO.sub_title}`, CARREFOUR_EMPLEADO_PUBLICO.legal);
    assert.deepEqual(r.categoriasIncluidas, ['almacen', 'bebidas', 'lacteos', 'fiambres', 'congelados', 'perfumeria', 'limpieza']);
    assert.equal(r.noAcumulable, true);
  });

  test('REGLA DE SEGURIDAD: Chango Más ANSES "únicamente en los productos…" con rubros no mapeables → descartar', () => {
    assert.deepEqual(pb.restriccionesDeCategoria(CHANGO_ANSES.sub_title, CHANGO_ANSES.legal), { descartar: true });
    assert.deepEqual(pb.restriccionesDeCategoria('', 'OBTENIENDO UN 20% DE DESCUENTO EN PRODUCTOS SELECCIONADOS.'), { descartar: true },
      '"productos seleccionados" sin decir cuáles tampoco se aplica al ticket entero');
  });

  test('Chango Más MP/MasClub: categorías y marcas excluidas (Quilmes, Coca Cola…), sin excluir TODAS las cervezas', () => {
    const r = pb.restriccionesDeCategoria(CHANGO_MP.sub_title, CHANGO_MP.legal);
    assert.equal(r.categoriasIncluidas, undefined);
    for (const c of ['carniceria', 'embutidos', 'quesos', 'frutas y verduras', 'huevos', 'aceites', 'harinas', 'leches', 'azucar', 'bebidas blancas', 'vinos', 'fernet', 'electro']) {
      assert.ok(r.categoriasExcluidas.includes(c), c);
    }
    assert.ok(!r.categoriasExcluidas.includes('cervezas'));
    for (const m of ['quilmes', 'patagonia', 'coca cola', 'h2oh', 'eco de los andes', 'sprite']) assert.ok(r.marcasExcluidas.includes(m), m);
    assert.equal(r.noAcumulable, true);
  });

  test('Carrefour "no incluye productos Carrefour de alimentos, lácteos, … bebidas": marca propia, no categorías', () => {
    const r = pb.restriccionesDeCategoria('Acumulable con promociones vigentes. Tope semanal:$5000. No incluye  electrodomésticos, electrónica, telefonía celular carnicería ni huevos de gallina.',
      'NO INCLUYE MOTOS, CUATRICICLOS, ELECTRODOMÉSTICOS. NO INCLUYE PRODUCTOS CARREFOUR DE ALIMENTOS, LÁCTEOS, QUESOS, FIAMBRES, BEBIDAS, PERFUMERÍA Y LIMPIEZA. NO ACUMULABLE CON OTRAS PROMOCIONES.');
    assert.ok(r.marcasExcluidas.includes('carrefour'));
    assert.ok(!r.categoriasExcluidas.includes('lacteos') && !r.categoriasExcluidas.includes('quesos'));
    assert.ok(r.categoriasExcluidas.includes('carniceria') && r.categoriasExcluidas.includes('huevos'));
    assert.equal(r.noAcumulable, undefined, 'el texto corto dice "Acumulable" y manda sobre el legal');
  });

  test('frases que NO son listas de categorías', () => {
    assert.deepEqual(pb.restriccionesDeCategoria('15% de descuento en tu compra Acumulable con todas las promos', ''), {});
    assert.deepEqual(pb.restriccionesDeCategoria('En el acto y sin tope! No incluye electro ni carnicería.', ''), { categoriasExcluidas: ['carniceria', 'electro'] });
    assert.deepEqual(pb.restriccionesDeCategoria('Aplica en los productos sin oferta, aplican excluidos, ver legales.', ''), {});
  });
});

describe('esNoAcumulable', () => {
  test('negativos reales', () => {
    assert.equal(pb.esNoAcumulable('', 'NO ACUMULABLES CON OTRAS PROMOCIONES Y/O DESCUENTOS.'), true);
    assert.equal(pb.esNoAcumulable('No acumulable con otras promociones y/ó folletos vigentes.', ''), true);
    assert.equal(pb.esNoAcumulable('', 'NO ACUMULABLE CON OTROS DESCUENTOS, EXCEPTO LOS PROMOVIDOS POR EL BANCO O MODO PARA PAGOS CON QR.'), true);
    assert.equal(pb.esNoAcumulable('', 'No acumulable con otras ofertas o promociones vigentes.'), true);
  });
  test('"no acumulable con otras promociones bancarias" no es con la promo de producto', () => {
    assert.equal(pb.esNoAcumulable('No acumulable con otras promociones bancarias. Aplican exclusiones. (CDNI)', ''), false);
  });
  test('afirmativos reales: no restringen', () => {
    assert.equal(pb.esNoAcumulable('Acumulable con todas las promos ¡Sin Tope!.', ''), false);
    assert.equal(pb.esNoAcumulable('Mínimo de compra $15.000. Promoción acumulable.', 'NO ACUMULABLE CON OTRAS PROMOCIONES.'), false, 'el corto manda');
    assert.equal(pb.esNoAcumulable('', 'ACUMULABLE CON PRODUCTOS EN OFERTA.'), false);
    assert.equal(pb.esNoAcumulable('', 'BENEFICIO ACUMULABLE CON OTRAS PROMOCIONES VIGENTES APLICABLES A PAGOS REALIZADOS CON MODO.'), false);
  });
});

describe('fetchers: los campos llegan a la promo normalizada', () => {
  test('Cencosud: Cencopay 25% jueves en Jumbo con categorías + soloSinOferta; 40% solo en el local', async () => {
    globalThis.fetch = async () => respuesta({ value: JSON.stringify([CENCOPAY_25_JUMBO, CENCOPAY_40]) });
    const { promos } = await pb.fetchJumbo();
    const p25 = promos.find(p => p.descuentoPct === 0.25);
    assert.deepEqual(p25.categoriasIncluidas, ['galletitas', 'bebidas sin alcohol', 'perfumeria', 'limpieza']);
    assert.equal(p25.soloSinOferta, true);
    assert.equal(p25.noAcumulable, true);
    assert.equal(p25.canales, null, 'válida en locales y sitios web');
    const p40 = promos.find(p => p.descuentoPct === 0.4);
    assert.deepEqual(p40.canales, ['tienda'], '"EXCLUSIVO PARA VENTAS PRESENCIALES"');
    assert.equal(p40.soloSinOferta, undefined);
  });

  test('Chango Más: la promo ANSES con lista no mapeable se descarta', async () => {
    globalThis.fetch = async url => {
      if (String(url).includes('GetBanks') || String(url).includes('GetCards')) return respuesta(aDocs([]));
      return respuesta(aDocs([{ id: 'a', title: 'Todos los medios de pago.', sub_title: CHANGO_ANSES.sub_title, legal: CHANGO_ANSES.legal,
        discount_percentage: '10', active: 'true', active_from: '2026-01-01T00:00:00Z', active_to: '2099-01-01T00:00:00Z',
        monday: 'true', tuesday: 'true', express: 'true' }]));
    };
    const { promos } = await pb.fetchChangoMas();
    assert.equal(promos.length, 0);
  });
});

// ─── Cálculo ──────────────────────────────────────────────────────────────────
// Carrito mixto real en Jumbo: galletitas + carne + gaseosa (categorías del catálogo de Jumbo).
const CAT = {
  galletitas: categoriasDeProducto('Almacén > Desayuno y Merienda > Galletitas Dulces'),
  carne: categoriasDeProducto('Carnes > Carne Vacuna > Novillito'),
  gaseosa: categoriasDeProducto('Bebidas > Gaseosas > Cola'),
};
const PROMO_25 = {
  canonicosPosibles: ['Cencopay'], requisitos: [], dias: TODOS_LOS_DIAS, ...VIGENCIA, canales: null,
  descuentoPct: 0.25, tope: null, montoMinimo: null,
  categoriasIncluidas: ['galletitas', 'bebidas sin alcohol', 'perfumeria', 'limpieza'], soloSinOferta: true, noAcumulable: true,
};

describe('mejorPromoTicket con filas', () => {
  const lineas = [
    { precio: 2000, sinOferta: true, categorias: CAT.galletitas },
    { precio: 10000, sinOferta: true, categorias: CAT.carne },
    { precio: 3000, sinOferta: true, categorias: CAT.gaseosa },
  ];
  test('Cencopay 25%: base = galletitas + gaseosa ($5.000), no el ticket ($15.000)', () => {
    const m = pb.mejorPromoTicket([PROMO_25], 15000, lineas);
    assert.equal(m.base, 5000);
    assert.equal(m.descuento, 1250);
  });
  test('no acumulable: la galletita con promo de producto sale de la base', () => {
    const conOferta = [{ ...lineas[0], sinOferta: false }, lineas[1], lineas[2]];
    assert.equal(pb.mejorPromoTicket([PROMO_25], 15000, conOferta).descuento, 750);
  });
  test('el tope se aplica sobre el descuento de la base', () => {
    assert.equal(pb.mejorPromoTicket([{ ...PROMO_25, tope: 1000 }], 15000, lineas).descuento, 1000);
  });
  test('sin filas (CLI, número): una promo con categorías no aplica; una sin restricción, sobre todo el ticket', () => {
    assert.equal(pb.mejorPromoTicket([PROMO_25], 15000), null);
    const general = { ...PROMO_25, categoriasIncluidas: undefined, soloSinOferta: undefined };
    assert.equal(pb.mejorPromoTicket([general], 15000, lineas).descuento, 3750);
  });
});

describe('reoptimizarAsignacion usa la misma base', () => {
  test('la carne no se muda a Jumbo por un 25% que no le aplica; la galletita sí', () => {
    const supers = [{ key: 'vea' }, { key: 'jumbo' }];
    const items = [
      { id: 'galletitas', preciosPorSuper: { vea: 1900, jumbo: 2000 }, esOnlineExclusivoPorSuper: {},
        sinOfertaPorSuper: { vea: true, jumbo: true }, categoriasPorSuper: { vea: CAT.galletitas, jumbo: CAT.galletitas } },
      { id: 'carne', preciosPorSuper: { vea: 9500, jumbo: 10000 }, esOnlineExclusivoPorSuper: {},
        sinOfertaPorSuper: { vea: true, jumbo: true }, categoriasPorSuper: { vea: CAT.carne, jumbo: CAT.carne } },
      // Ya va a Jumbo por precio: es lo que hace aparecer la promo de Jumbo en la heurística.
      { id: 'gaseosa', preciosPorSuper: { vea: 3100, jumbo: 3000 }, esOnlineExclusivoPorSuper: {},
        sinOfertaPorSuper: { vea: true, jumbo: true }, categoriasPorSuper: { vea: CAT.gaseosa, jumbo: CAT.gaseosa } },
    ];
    const datos = { vea: { promos: [], error: null }, jumbo: { promos: [PROMO_25], error: null } };
    const r = pb.reoptimizarAsignacion(items, datos, supers, { hoy: new Date() });
    assert.deepEqual(r.asignacion, ['jumbo', 'vea', 'jumbo']);
    assert.equal(r.oportunidades.jumbo.mejor.descuento, 1250, '25% de galletitas + gaseosa ($5.000)');
    assert.equal(r.total, 5000 - 1250 + 9500);
  });
});

describe('comparar.js: base, reparto y "solo en …"', () => {
  test('Cencopay 25% en Jumbo con galletitas + carne + gaseosa: ahorro y reparto solo sobre galletitas y gaseosa', () => {
    const supers = [{ key: 'jumbo', nombre: 'Jumbo' }];
    const fila = (ean, total, categorias) => ({ total, esOnlineExclusivo: false, ean, sinOferta: true, categorias, nombreProducto: ean });
    const resumen = calcularResumenFinal([
      { input: 'galletitas', cantidad: 1, ambiguo: false, mejores: { jumbo: fila('1', 2000, CAT.galletitas) } },
      { input: 'carne', cantidad: 1, ambiguo: false, mejores: { jumbo: fila('2', 10000, CAT.carne) } },
      { input: 'gaseosa', cantidad: 1, ambiguo: false, mejores: { jumbo: fila('3', 3000, CAT.gaseosa) } },
    ], supers);
    const datos = pb.filtrarPromosBancariasPorTarjetas({ jumbo: { promos: [PROMO_25], error: null } }, ['Cencopay']);
    const bancario = compararTest.aplicarPromosBancarias(resumen, supers, ['Cencopay'], datos, []);
    assert.equal(bancario.porSuper.jumbo.descuento, 1250, 'antes: 25% de $15.000 = $3.750');
    assert.equal(bancario.porSuper.jumbo.categorias, 'galletitas, bebidas sin alcohol, perfumería y limpieza');
    assert.equal(bancario.porSuper.jumbo.noAcumulable, true);

    const items = ['1', '2', '3'].map((ean, i) => ({ ean, opciones: [{ key: 'jumbo', total: [2000, 10000, 3000][i], totalSinPromo: [2000, 10000, 3000][i], promo: null }] }));
    compararTest.repartirDescuentoBancarioEntreFilas(items, resumen, bancario, supers);
    assert.deepEqual(items.map(it => it.opciones[0].total), [1500, 10000, 2250]);
    assert.equal(resumen.subtotalAsignadoPorSuper.jumbo, 13750);
    assert.equal(items[1].opciones[0].promo, null, 'la carne no lleva el badge del ticket');
  });
});
