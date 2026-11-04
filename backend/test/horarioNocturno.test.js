/**
 * Avisos de productos seguidos: entre 0 y 6 AM hora Argentina no sale nada y no se toca la base
 * (avisoProductosSeguidos.js, decisión 2026-11-04). Correr con: node --test backend/test/horarioNocturno.test.js
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

let consultas = 0;
const ruta = require.resolve(path.join(__dirname, '../src/clienteSupabaseAdmin.js'));
require.cache[ruta] = { id: ruta, filename: ruta, loaded: true, exports: { clienteSupabaseAdmin: () => ({ from() { consultas++; throw new Error('no debería consultar'); } }) } };

const { esHorarioNocturno, avisarProductosSeguidos } = require('../src/avisoProductosSeguidos');

test('límites del horario nocturno en hora Argentina (UTC-3)', () => {
  assert.equal(esHorarioNocturno(new Date('2026-11-04T02:59:00Z')), false, '23:59 AR');
  assert.equal(esHorarioNocturno(new Date('2026-11-04T03:00:00Z')), true, '00:00 AR');
  assert.equal(esHorarioNocturno(new Date('2026-11-04T08:59:00Z')), true, '05:59 AR');
  assert.equal(esHorarioNocturno(new Date('2026-11-04T09:00:00Z')), false, '06:00 AR');
});

test('de noche no avisa ni toca la base', async () => {
  const r = await avisarProductosSeguidos(new Map(), { ahoraFecha: new Date('2026-11-04T06:00:00Z') });
  assert.deepEqual(r, { avisados: 0, errores: [], postergado: true });
  assert.equal(consultas, 0);
});
