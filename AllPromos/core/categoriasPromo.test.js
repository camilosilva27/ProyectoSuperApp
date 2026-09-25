/**
 * Tests del vocabulario de categorías de promos bancarias (core/categoriasPromo.js): mapeo de la
 * `categoria` REAL del catálogo de cada súper (rutas copiadas de los catalogo-*.json de producción
 * del 2026-09-24) y parseo de listas reales de las promos.
 *
 * Correr con: node --test AllPromos/core/categoriasPromo.test.js
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const {
  categoriasDeProducto, parsearListaCategorias, lineaCumplePromo, textoCategorias,
} = require('./categoriasPromo');

const tiene = (ruta, ...etiquetas) => {
  const c = categoriasDeProducto(ruta);
  for (const e of etiquetas) assert.ok(c.includes(e), `${ruta} debería tener "${e}" (tiene: ${c.join(', ')})`);
};
const noTiene = (ruta, ...etiquetas) => {
  const c = categoriasDeProducto(ruta);
  for (const e of etiquetas) assert.ok(!c.includes(e), `${ruta} NO debería tener "${e}" (tiene: ${c.join(', ')})`);
};

describe('categoriasDeProducto: árbol de cada súper', () => {
  test('galletitas en los 7 árboles (Coto con 5 niveles, Chango Más plano)', () => {
    tiene('Almacén > Desayuno y Merienda > Galletitas Dulces', 'galletitas', 'almacen'); // Vea/Jumbo/Disco
    tiene('Desayuno y merienda > Galletitas bizcochitos y tostadas > Galletitas de agua', 'galletitas', 'almacen'); // Carrefour
    tiene('Desayunos Y Meriendas > Galletitas Dulces > Galletitas Rellenas', 'galletitas'); // Chango Más
    tiene('Desayuno > Galletitas y Cereales > Galletitas saladas', 'galletitas'); // Día
    tiene('Almacén > Panaderia > Galletitas > Galletitas Dulces > Surtidas', 'galletitas'); // Coto
  });

  test('raíces compuestas no contagian: "Galletitas bizcochitos y tostadas > Tostadas" no es galletitas', () => {
    noTiene('Desayuno y merienda > Galletitas bizcochitos y tostadas > Tostadas, grisines y marineras', 'galletitas');
    noTiene('Quesos y Fiambres > Fiambres > Jamón Cocido y Crudo', 'quesos', 'lacteos');
    tiene('Quesos y Fiambres > Fiambres > Jamón Cocido y Crudo', 'fiambres');
    tiene('Quesos y Fiambres > Quesos > Ricota', 'quesos', 'lacteos');
    noTiene('Quesos y Fiambres > Encurtidos, Aceitunas y Pickles', 'quesos', 'fiambres');
  });

  test('golosinas y chocolates', () => {
    tiene('Almacén > Golosinas y Chocolates > Chocolates', 'golosinas');
    tiene('Kiosco > Alfajores > Triple', 'golosinas');
    tiene('Desayuno y merienda > Golosinas y chocolates > Chicles', 'golosinas');
  });

  test('bebidas: cervezas ⊂ bebidas con alcohol ⊂ bebidas; gaseosa = bebidas sin alcohol', () => {
    tiene('Bebidas > Cervezas', 'cervezas', 'bebidas con alcohol', 'bebidas');
    noTiene('Bebidas > Cervezas', 'bebidas sin alcohol');
    tiene('Bebidas > Gaseosas > Cola', 'bebidas sin alcohol', 'bebidas');
    noTiene('Bebidas > Gaseosas > Cola', 'bebidas con alcohol', 'cervezas');
    tiene('Gaseosas > Lima Limón', 'bebidas sin alcohol'); // Chango Más, raíz plana
    tiene('Bebidas > Bebidas sin Alcohol > Amargos', 'bebidas sin alcohol'); // Coto
    tiene('Vinos Y Espumantes > Vino Tinto > Malbec Vino Tinto', 'vinos', 'bebidas con alcohol');
  });

  test('cerveza sin alcohol: cerveza pero no bebida con alcohol; aperitivo sin alcohol', () => {
    tiene('Bebidas > Bebidas con Alcohol > Cerveza > Cervezas > Cervezas sin Alcohol', 'cervezas');
    noTiene('Bebidas > Bebidas con Alcohol > Cerveza > Cervezas > Cervezas sin Alcohol', 'bebidas con alcohol');
    tiene('Bebidas > Fernet y aperitivos > Aperitivos sin alcohol', 'bebidas sin alcohol');
  });

  test('una hoja que se llama "Agua" fuera de Bebidas no es bebida (Coto crackers)', () => {
    noTiene('Almacén > Panaderia > Galletitas > Galletitas Crackers > Agua', 'bebidas', 'bebidas sin alcohol');
  });

  test('perfumería y limpieza (incluidas las raíces planas de Chango Más)', () => {
    tiene('Perfumería > Cuidado Capilar > Shampoo', 'perfumeria');
    tiene('Cuidado Del Cabello > Shampoo > Shampoo Hasta 400 Ml', 'perfumeria');
    tiene('Limpieza > Limpieza de Cocina > Detergentes', 'limpieza');
    tiene('Cocina > Detergentes Y Lavavajillas', 'limpieza'); // Chango Más
    noTiene('Cocinas, Hornos y Extractores > Cocinas > Cocinas A Gas', 'limpieza');
  });

  test('carnicería, huevos, frutas y verduras', () => {
    tiene('Carnes > Carne Vacuna > Novillito', 'carniceria');
    tiene('Carnicería > Pollo Y Pavo > Pollo Entero', 'carniceria');
    noTiene('Carnes > Carbón y Leña', 'carniceria');
    tiene('Frutas y Verduras > Huevos', 'huevos');
    noTiene('Frutas y Verduras > Huevos', 'frutas y verduras');
    noTiene('Verduras > Verduras congeladas > Verduras', 'frutas y verduras');
  });

  test('aceite sí, vinagre/aderezos de la misma raíz no', () => {
    tiene('Almacén > Aceites y Vinagres > Aceites Comunes', 'aceites');
    noTiene('Almacén > Aceites y Vinagres > Vinagres', 'aceites');
    noTiene('Aceites, Vinagres Y Aderezos > Aderezos > Mayonesa', 'aceites');
    noTiene('Mundo Bebé > Higiene para bebés > Aceites, cremas y lociones', 'aceites', 'almacen');
  });

  test('lácteos: leche/yogur/queso/crema sí; leche vegetal y tapas de "Lácteos" no', () => {
    tiene('Lácteos > Leches > Leches Larga Vida', 'leches', 'lacteos');
    tiene('Lácteos y productos frescos > Yogures > Yogures enteros', 'yogures', 'lacteos');
    tiene('Lácteos > Cremas', 'lacteos');
    noTiene('Lácteos > Leches > Bebidas Vegetales', 'lacteos', 'leches');
    noTiene('Lácteos > Pastas y Tapas > Tapas', 'lacteos');
    tiene('Lácteos > Pastas y Tapas > Tapas', 'tapas');
    noTiene('Lácteos > Pastas y Tapas > Tapas', 'pastas frescas');
    tiene('Mundo Bebé > Alimento para bebé > Leches infantiles', 'leches infantiles');
    noTiene('Tiempo Libre > Libros > Infantiles', 'leches infantiles');
  });

  test('conservas de frutas/verduras vs. de pescado', () => {
    tiene('Almacén > Conservas > Conservas de Verduras y Legumbres', 'conservas vegetales', 'conservas');
    tiene('Conservas Y Enlatados > Conservas > Conservas De Verdura Y Legumbres', 'conservas vegetales');
    noTiene('Almacén > Conservas > Conservas de Pescado', 'conservas vegetales');
    tiene('Almacén > Conservas > Conservas de Pescado', 'conservas');
  });

  test('sin ruta → null; ruta desconocida → []', () => {
    assert.equal(categoriasDeProducto(null), null);
    assert.deepEqual(categoriasDeProducto('Rotiseria > Entradas > Guarniciones'), []);
  });
});

describe('parsearListaCategorias: listas reales', () => {
  test('Cencopay 40% vie-dom: "GALLETITAS, CERVEZAS, CHOCOLATE Y GOLOSINAS, CONSERVAS DE VERDURAS, LEGUMBRES Y FRUTAS"', () => {
    const r = parsearListaCategorias('GALLETITAS, CERVEZAS, CHOCOLATE Y GOLOSINAS, CONSERVAS DE VERDURAS, LEGUMBRES Y FRUTAS');
    assert.deepEqual(r.desconocidos, []);
    assert.deepEqual(r.etiquetas.sort(), ['cervezas', 'conservas vegetales', 'galletitas', 'golosinas']);
  });

  test('Cencopay 25% jueves Vea / Jumbo-Disco', () => {
    const vea = parsearListaCategorias('GALLETITAS, CHOCOLATES, GOLOSINAS, CONSERVA DE FRUTAS Y VERDURAS Y CERVEZAS');
    assert.deepEqual(vea.desconocidos, []);
    assert.deepEqual(vea.etiquetas.sort(), ['cervezas', 'conservas vegetales', 'galletitas', 'golosinas']);
    const jumbo = parsearListaCategorias('GALLETITAS, BEBIDAS SIN ALCOHOL, PERFUMERÍA Y LIMPIEZA');
    assert.deepEqual(jumbo.etiquetas.sort(), ['bebidas sin alcohol', 'galletitas', 'limpieza', 'perfumeria']);
  });

  test('Carrefour Empleado público: "Alimentos secos, Congelados, Lácteos, Fiambres,  Bebidas, Limpieza y Perfumería"', () => {
    const r = parsearListaCategorias('Alimentos secos, Congelados, Lácteos, Fiambres,  Bebidas, Limpieza y Perfumería');
    assert.deepEqual(r.desconocidos, []);
    assert.deepEqual(r.etiquetas.sort(), ['almacen', 'bebidas', 'congelados', 'fiambres', 'lacteos', 'limpieza', 'perfumeria']);
  });

  test('Chango Más empleados municipales/provinciales (lista larga, todo mapeable)', () => {
    const r = parsearListaCategorias('ALMACÉN SECO, LÁCTEOS, BEBIDA SIN ALCOHOL, GALLETITAS Y GOLOSINAS, PAPELES, TAPAS EMPANADAS Y TARTAS, PASTAS FRESCAS Y SALCHICHA, FIAMBRERÍA, QUESOS, CONGELADOS, PAÑALES Y PERFUMERÍA DEL BEBÉ, FARMACIA VENTA LIBRE (NO INCLUYE RECETADOS) Y PERFUMERÍA');
    assert.deepEqual(r.desconocidos, []);
    assert.ok(r.etiquetas.includes('bebe') && r.etiquetas.includes('farmacia') && r.etiquetas.includes('tapas'));
  });

  test('Chango Más ANSES: pedazos no mapeables → desconocidos (la promo se descarta)', () => {
    const r = parsearListaCategorias('CONSERVA DE TOMATES, PASTAS SECAS Y REFRIGERADAS, ARROZ, ADEREZOS, SALCHICHAS, LECHE UAT, CAFÉ, TÉ, ENDULZANTES, ALMACÉN SIN TACC');
    assert.ok(r.desconocidos.length > 0);
  });

  test('"tu compra" / "el acto" no son una lista de categorías (primer elemento desconocido)', () => {
    assert.equal(parsearListaCategorias('tu compra').primeroConocido, false);
    assert.equal(parsearListaCategorias('el acto y sin tope!').primeroConocido, false);
  });
});

describe('lineaCumplePromo / textoCategorias', () => {
  test('categoría incluida, excluida, sin categoría conocida', () => {
    const promo = { categoriasIncluidas: ['galletitas', 'bebidas sin alcohol'] };
    assert.equal(lineaCumplePromo(promo, { categorias: ['almacen', 'galletitas'] }), true);
    assert.equal(lineaCumplePromo(promo, { categorias: ['carniceria'] }), false);
    assert.equal(lineaCumplePromo(promo, { categorias: null }), false, 'sin categoría no entra (conservador)');
    const excl = { categoriasExcluidas: ['carniceria'] };
    assert.equal(lineaCumplePromo(excl, { categorias: ['carniceria'] }), false);
    assert.equal(lineaCumplePromo(excl, { categorias: null }), true, 'la exclusión no se puede comprobar: cuenta');
  });

  test('marcas excluidas atadas a su categoría (Chango Más: Coca Cola, Patagonia; Manaos no)', () => {
    const promo = { marcasExcluidas: ['coca cola', 'patagonia', 'rutini'] };
    const gaseosa = ['bebidas sin alcohol', 'bebidas'];
    assert.equal(lineaCumplePromo(promo, { categorias: gaseosa, nombre: 'Gaseosa Coca-Cola Sabor Original 2,25 L' }), false, 'con guion también');
    assert.equal(lineaCumplePromo(promo, { categorias: gaseosa, nombre: 'Gaseosa Coca Cola Zero 1,5 L' }), false);
    assert.equal(lineaCumplePromo(promo, { categorias: ['cervezas', 'bebidas con alcohol', 'bebidas'], nombre: 'Cerveza Patagonia Amber Lager 730 ml' }), false);
    assert.equal(lineaCumplePromo(promo, { categorias: ['almacen'], nombre: 'Merluza Patagonia congelada' }), true, 'Patagonia solo como cerveza');
    assert.equal(lineaCumplePromo(promo, { categorias: gaseosa, nombre: 'Gaseosa Manaos Cola 2,25 L' }), true);
  });

  test('marca propia Carrefour (cualquier categoría)', () => {
    const promo = { marcasExcluidas: ['carrefour'] };
    assert.equal(lineaCumplePromo(promo, { categorias: ['lacteos'], nombre: 'Leche entera Carrefour 1 L' }), false);
    assert.equal(lineaCumplePromo(promo, { categorias: ['lacteos'], nombre: 'Leche entera La Serenísima 1 L' }), true);
  });

  test('soloSinOferta', () => {
    assert.equal(lineaCumplePromo({ soloSinOferta: true }, { sinOferta: false }), false);
    assert.equal(lineaCumplePromo({ soloSinOferta: true }, { sinOferta: true }), true);
  });

  test('textoCategorias', () => {
    assert.equal(textoCategorias(['limpieza', 'galletitas', 'perfumeria', 'bebidas sin alcohol']), 'galletitas, bebidas sin alcohol, perfumería y limpieza');
    assert.equal(textoCategorias(['cervezas']), 'cervezas');
  });
});
