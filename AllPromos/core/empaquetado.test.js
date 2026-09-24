/**
 * Tests de la detección de EAN compartido entre pack y unidad, con nombres reales de los
 * catálogos. El caso Brahma (formato "473mlx6") no se detectaba hasta la auditoría 2026-09-24.
 *
 * Correr con: node --test AllPromos/core/empaquetado.test.js
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { multiplicadorDeEmpaquetado, grupoTieneEmpaquetadoInconsistente } = require('./empaquetado');

describe('multiplicadorDeEmpaquetado', () => {
  const casos = [
    ['Cerveza Rubia x 6 Un 473 Cc Stella Artois', 6],
    ['Cerveza Rubia 710 Cc x 4 Un Budweiser', 4],
    ['Cerveza Brahma Chopp Lata 473mlx6', 6],
    ['Cerveza Brahma Pack Latas 473 CC 6 Unidades', 6],
    ['Galletitas Traviata x 5 Unid.', 5],
    ['Cerveza Brahma Lata 473 ml.', null],
    ['Leche Uat La Serenisima 1 - 1 Lt', null],
    ['Yerba Mate Playadito 1 Kg', null],
  ];
  for (const [nombre, esperado] of casos) {
    test(`"${nombre}" → ${esperado}`, () => {
      assert.equal(multiplicadorDeEmpaquetado(nombre), esperado);
    });
  }
});

describe('grupoTieneEmpaquetadoInconsistente', () => {
  test('Brahma pack x6 vs lata suelta de Día se marca', () => {
    const grupo = {
      disco: [{ productName: 'Cerveza Brahma Chopp Lata 473mlx6', precioBase: 17674 }],
      dia: [{ productName: 'Cerveza Brahma Lata 473 ml.', precioBase: 2724 }],
    };
    assert.equal(grupoTieneEmpaquetadoInconsistente(grupo), true);
  });

  test('mismo pack descripto distinto y con precio parecido no se marca', () => {
    const grupo = {
      vea: [{ productName: 'Cerveza Brahma Chopp Lata 473mlx6', precioBase: 16370 }],
      coto: [{ productName: 'Cerveza Brahma Pack Latas 473 CC', precioBase: 16344 }],
    };
    assert.equal(grupoTieneEmpaquetadoInconsistente(grupo), false);
  });
});
