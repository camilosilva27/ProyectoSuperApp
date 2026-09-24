/**
 * Tests de procesarPagoMercadoPago.js con Supabase y Mercado Pago simulados en memoria:
 * cambio de plan (la suscripción vieja se cancela recién al confirmarse la nueva), permanente
 * que limpia suscripciones viejas, cobros de suscripción que no se confunden con el permanente,
 * y recibo que no se duplica. Nacieron de la auditoría 2026-09-24.
 *
 * Correr con: node --test backend/test/procesarPagoMercadoPago.test.js
 */

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

// --- Stubs de módulos antes de cargar el código bajo prueba ---------------------------------
process.env.MERCADOPAGO_ACCESS_TOKEN = 'TEST-token-de-prueba';

const canceladasEnMP = [];
const recibos = [];

function stub(modulo, exports) {
  const ruta = require.resolve(modulo, { paths: [path.join(__dirname, '../src')] });
  require.cache[ruta] = { id: ruta, filename: ruta, loaded: true, exports };
}

stub('mercadopago', {
  MercadoPagoConfig: class {},
  PreApproval: class {
    async update({ id, body }) { if (body.status === 'cancelled') canceladasEnMP.push(id); return { id, status: body.status }; }
    async get() { throw new Error('no usado en estos tests'); }
  },
  Payment: class { async search() { return { results: [] }; } },
});
stub(path.join(__dirname, '../src/reciboPago.js'), {
  enviarRecibo: async (usuarioId, detalles) => { recibos.push({ usuarioId, ...detalles }); return { ok: true }; },
});

const { procesarSuscripcion, procesarPagoAprobado } = require('../src/procesarPagoMercadoPago');

// --- Supabase en memoria: solo lo que usa el módulo -----------------------------------------
function crearSupabase(filas) {
  function consulta() {
    const filtros = [];
    let cambios = null;
    const q = {
      select() { return q; },
      update(obj) { cambios = obj; return q; },
      eq(col, val) { filtros.push(f => f[col] === val); return q; },
      or(expr) {
        const alternativas = expr.split(',').map(p => { const [col, , val] = p.split('.'); return [col, val]; });
        filtros.push(f => alternativas.some(([col, val]) => f[col] === val));
        return q;
      },
      maybeSingle() { const r = filas.filter(f => filtros.every(fn => fn(f))); return Promise.resolve({ data: r[0] ? { ...r[0] } : null, error: null }); },
      single() { return q.maybeSingle(); },
      then(ok, mal) {
        if (cambios) filas.filter(f => filtros.every(fn => fn(f))).forEach(f => Object.assign(f, cambios));
        return Promise.resolve({ error: null }).then(ok, mal);
      },
    };
    return q;
  }
  return { from: () => consulta() };
}

const USUARIO = '11111111-1111-1111-1111-111111111111';
let fila;
let supabase;

beforeEach(() => {
  canceladasEnMP.length = 0;
  recibos.length = 0;
  fila = {
    id: USUARIO, plan: 'premium', tipo_plan: 'mensual', nombre: 'Test', premium_manual: false,
    pasarela_suscripcion_id: 'SUB_MENSUAL', pasarela_suscripcion_anterior_id: null,
    suscripcion_estado: 'authorized', siguiente_cobro_en: '2026-10-20T10:00:00.000-04:00',
    acceso_premium_hasta: null, pagado_en: null,
  };
  supabase = crearSupabase([fila]);
});

function suscripcion(id, status, extra = {}) {
  return {
    id, status, external_reference: USUARIO,
    auto_recurring: { frequency: 12, transaction_amount: 80000 },
    next_payment_date: '2027-09-24T10:00:00.000-04:00',
    ...extra,
  };
}

// Estado que deja routes/pagos.js al abrir el checkout anual con la mensual activa.
function abrirCheckoutAnual() {
  fila.pasarela_suscripcion_anterior_id = 'SUB_MENSUAL';
  fila.pasarela_suscripcion_id = 'SUB_ANUAL';
}

describe('cambio de plan mensual → anual', () => {
  test('al autorizarse la anual se cancela la mensual y queda anual', async () => {
    abrirCheckoutAnual();
    const plan = await procesarSuscripcion(suscripcion('SUB_ANUAL', 'authorized'), 'SUB_ANUAL', supabase);
    assert.equal(plan, 'premium');
    assert.equal(fila.tipo_plan, 'anual');
    assert.equal(fila.pasarela_suscripcion_id, 'SUB_ANUAL');
    assert.equal(fila.pasarela_suscripcion_anterior_id, null);
    assert.deepEqual(canceladasEnMP, ['SUB_MENSUAL']);
    assert.equal(recibos.length, 1);
    assert.equal(recibos[0].tipoPlan, 'anual');
  });

  test('si la anual queda pendiente no se toca nada', async () => {
    abrirCheckoutAnual();
    await procesarSuscripcion(suscripcion('SUB_ANUAL', 'pending'), 'SUB_ANUAL', supabase);
    assert.equal(fila.plan, 'premium');
    assert.equal(fila.tipo_plan, 'mensual');
    assert.equal(fila.pasarela_suscripcion_anterior_id, 'SUB_MENSUAL');
    assert.deepEqual(canceladasEnMP, []);
  });

  test('si abandona (la anual se cancela) vuelve a la mensual sin perder nada', async () => {
    abrirCheckoutAnual();
    await procesarSuscripcion(suscripcion('SUB_ANUAL', 'cancelled'), 'SUB_ANUAL', supabase);
    assert.equal(fila.plan, 'premium');
    assert.equal(fila.tipo_plan, 'mensual');
    assert.equal(fila.pasarela_suscripcion_id, 'SUB_MENSUAL');
    assert.equal(fila.pasarela_suscripcion_anterior_id, null);
    assert.equal(fila.suscripcion_estado, 'authorized');
    assert.equal(fila.acceso_premium_hasta, null);
    assert.deepEqual(canceladasEnMP, []);
  });

  test('un cobro de la mensual durante el cambio no altera nada', async () => {
    abrirCheckoutAnual();
    const plan = await procesarSuscripcion(
      suscripcion('SUB_MENSUAL', 'authorized', { auto_recurring: { frequency: 1 } }), 'SUB_MENSUAL', supabase,
    );
    assert.equal(plan, null);
    assert.equal(fila.pasarela_suscripcion_anterior_id, 'SUB_MENSUAL');
    assert.equal(recibos.length, 0);
  });

  test('si la mensual se cancela por su lado durante el cambio, aplica la gracia', async () => {
    abrirCheckoutAnual();
    await procesarSuscripcion(suscripcion('SUB_MENSUAL', 'cancelled'), 'SUB_MENSUAL', supabase);
    assert.equal(fila.plan, 'premium');
    assert.equal(fila.acceso_premium_hasta, '2026-10-20T10:00:00.000-04:00');
    assert.equal(fila.pasarela_suscripcion_anterior_id, null);
  });
});

describe('plan permanente', () => {
  const pagoPermanente = { status: 'approved', external_reference: `perm:${USUARIO}`, date_approved: '2026-09-24T12:00:00Z', transaction_amount: 160000 };

  test('limpia la suscripción vieja y la cancela en MP', async () => {
    fila.acceso_premium_hasta = '2026-10-20T10:00:00Z';
    const plan = await procesarPagoAprobado(pagoPermanente, supabase);
    assert.equal(plan, 'premium');
    assert.equal(fila.tipo_plan, 'permanente');
    assert.equal(fila.pasarela_suscripcion_id, null);
    assert.equal(fila.acceso_premium_hasta, null);
    assert.equal(fila.siguiente_cobro_en, null);
    assert.deepEqual(canceladasEnMP, ['SUB_MENSUAL']);
  });

  test('un cancelled posterior de la suscripción vieja ya no lo baja', async () => {
    await procesarPagoAprobado(pagoPermanente, supabase);
    const plan = await procesarSuscripcion(suscripcion('SUB_MENSUAL', 'cancelled'), 'SUB_MENSUAL', supabase);
    assert.equal(plan, null);
    assert.equal(fila.plan, 'premium');
    assert.equal(fila.tipo_plan, 'permanente');
    assert.equal(fila.acceso_premium_hasta, null);
  });

  test('un cobro de suscripción (sin prefijo perm:) no se toma como permanente', async () => {
    const cuota = { ...pagoPermanente, external_reference: USUARIO };
    const plan = await procesarPagoAprobado(cuota, supabase);
    assert.equal(plan, null);
    assert.equal(fila.tipo_plan, 'mensual');
  });

  test('el recibo del permanente sale una sola vez', async () => {
    await procesarPagoAprobado(pagoPermanente, supabase);
    await procesarPagoAprobado(pagoPermanente, supabase);
    assert.equal(recibos.length, 1);
  });
});

describe('otros', () => {
  test('una suscripción de otro usuario se ignora', async () => {
    fila.plan = 'trial';
    const ajena = suscripcion('SUB_MENSUAL', 'authorized', { external_reference: 'otro-usuario' });
    const plan = await procesarSuscripcion(ajena, 'SUB_MENSUAL', supabase);
    assert.equal(plan, null);
    assert.equal(fila.plan, 'trial');
  });

  test('la misma fecha de cobro en otro formato no manda otro recibo', async () => {
    fila.siguiente_cobro_en = '2027-09-24T14:00:00+00:00';
    await procesarSuscripcion(suscripcion('SUB_MENSUAL', 'authorized'), 'SUB_MENSUAL', supabase);
    assert.equal(recibos.length, 0);
  });

  test('un id con caracteres raros no llega al filtro', async () => {
    const plan = await procesarSuscripcion(suscripcion('x', 'authorized'), 'a,plan.eq.premium', supabase);
    assert.equal(plan, null);
  });
});
