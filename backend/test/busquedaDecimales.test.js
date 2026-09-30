const test = require('node:test');
const assert = require('node:assert');
const { buscar } = require('../src/catalogoUnificado');

// Los supers escriben "2,25" o "2.25" en el nombre: la búsqueda tiene que tratarlos igual.
test('buscar: "2.25" y "2,25" devuelven los mismos productos', () => {
  const conPunto = buscar({ q: 'coca cola 2.25', limit: 50 });
  const conComa = buscar({ q: 'coca cola 2,25', limit: 50 });
  if (!conPunto.disponible) return; // sin catálogo unificado local no hay nada que comparar
  assert.ok(conPunto.total > 0);
  assert.deepStrictEqual(
    conPunto.resultados.map(p => p.ean).sort(),
    conComa.resultados.map(p => p.ean).sort(),
  );
});
