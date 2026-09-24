/**
 * Tests del webhook de Mercado Pago (routes/webhookMercadoPago.js) sin red: MP, Supabase y la
 * lógica de pagos simulados. Cubren el enrutamiento por tópico (auditoría 2026-09-24: antes todo
 * lo que no era type=payment iba a preApproval.get() → 404 → 500 → MP reintentaba sin fin).
 *
 * Correr con: node --test backend/test/webhookMercadoPago.test.js
 */

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

process.env.MERCADOPAGO_ACCESS_TOKEN = 'TEST-token-de-prueba';
process.env.MERCADOPAGO_WEBHOOK_SECRET = 'secreto-de-prueba';

function stub(modulo, exports) {
  const ruta = require.resolve(modulo, { paths: [path.join(__dirname, '../src')] });
  require.cache[ruta] = { id: ruta, filename: ruta, loaded: true, exports };
}

// Lo que "devuelve MP" por recurso; un id ausente responde 404 como el SDK real.
let recursos;
const llamadas = [];
function noEncontrado() { return Object.assign(new Error('not found'), { status: 404 }); }
function clienteMP(nombre) {
  return class {
    async get({ id }) {
      llamadas.push(`${nombre}:${id}`);
      if (recursos.errorRed) throw new Error('ECONNRESET');
      const r = recursos[nombre]?.[id];
      if (!r) throw noEncontrado();
      return r;
    }
  };
}
class InvalidWebhookSignatureError extends Error {}
stub('mercadopago', {
  MercadoPagoConfig: class {},
  PreApproval: clienteMP('preapproval'),
  Payment: clienteMP('payment'),
  Invoice: clienteMP('invoice'),
  Chargeback: clienteMP('chargeback'),
  InvalidWebhookSignatureError,
  WebhookSignatureValidator: { validate: ({ xSignature }) => { if (xSignature !== 'ok') throw new InvalidWebhookSignatureError(); } },
});
stub(path.join(__dirname, '../src/clienteSupabaseAdmin.js'), { clienteSupabaseAdmin: () => ({}) });
const procesados = [];
stub(path.join(__dirname, '../src/procesarPagoMercadoPago.js'), {
  procesarPagoUnico: async (pago) => { procesados.push(['pago', pago.id, pago.status]); return null; },
  procesarSuscripcion: async (sus, id) => { procesados.push(['suscripcion', id]); return null; },
});

const router = require('../src/routes/webhookMercadoPago');
const { resolverEventoWebhook } = router;
const handler = router.stack.find(l => l.route?.path === '/webhooks/mercadopago').route.stack[0].handle;

async function llamar({ query = {}, body = {}, firma = 'ok' } = {}) {
  let codigo = null;
  const res = { status(c) { codigo = c; return res; }, end() { return res; } };
  const req = { query, body, get: (h) => (h === 'x-signature' ? firma : 'req-1') };
  await handler(req, res);
  return codigo;
}

beforeEach(() => {
  recursos = {
    payment: { 123: { id: 123, status: 'refunded' }, 456: { id: 456, status: 'charged_back' } },
    preapproval: { SUB1: { id: 'SUB1', status: 'authorized' } },
    invoice: { 777: { id: 777, preapproval_id: 'SUB1' } },
    chargeback: { CB1: { id: 'CB1', payment_id: 456 } },
  };
  llamadas.length = 0;
  procesados.length = 0;
});

describe('resolverEventoWebhook (puro)', () => {
  test('Webhooks: query data.id + type', () => {
    assert.deepEqual(resolverEventoWebhook({ 'data.id': '123', type: 'payment' }), { accion: 'pago', topico: 'payment', dataId: '123' });
  });
  test('IPN legado: query id + topic', () => {
    assert.equal(resolverEventoWebhook({ id: '9', topic: 'chargebacks' }).accion, 'contracargo');
    assert.equal(resolverEventoWebhook({ id: '9', topic: 'preapproval' }).accion, 'suscripcion');
  });
  test('solo body (type / action / data.id)', () => {
    assert.deepEqual(resolverEventoWebhook({}, { type: 'subscription_authorized_payment', data: { id: 777 } }),
      { accion: 'cobro_suscripcion', topico: 'subscription_authorized_payment', dataId: '777' });
    assert.equal(resolverEventoWebhook({}, { action: 'payment.updated', data: { id: '1' } }).accion, 'pago');
  });
  test('sin tópico → suscripción (legado)', () => {
    assert.equal(resolverEventoWebhook({ 'data.id': 'SUB1' }).accion, 'suscripcion');
  });
  test('tópico desconocido → ignorar', () => {
    assert.equal(resolverEventoWebhook({ 'data.id': '1', type: 'merchant_order' }).accion, 'ignorar');
    assert.equal(resolverEventoWebhook({ 'data.id': '1', type: 'subscription_preapproval_plan' }).accion, 'ignorar');
  });
  test('sin id → dataId null', () => {
    assert.equal(resolverEventoWebhook({ type: 'payment' }).dataId, null);
  });
});

describe('handler', () => {
  test('pago reembolsado llega a procesarPagoUnico', async () => {
    assert.equal(await llamar({ query: { 'data.id': '123', type: 'payment' } }), 200);
    assert.deepEqual(procesados, [['pago', 123, 'refunded']]);
  });

  test('subscription_preapproval → procesarSuscripcion', async () => {
    assert.equal(await llamar({ query: { 'data.id': 'SUB1', type: 'subscription_preapproval' } }), 200);
    assert.deepEqual(procesados, [['suscripcion', 'SUB1']]);
  });

  test('subscription_authorized_payment → reconcilia la suscripción asociada', async () => {
    assert.equal(await llamar({ query: { 'data.id': '777', type: 'subscription_authorized_payment' } }), 200);
    assert.deepEqual(llamadas, ['invoice:777', 'preapproval:SUB1']);
    assert.deepEqual(procesados, [['suscripcion', 'SUB1']]);
  });

  test('contracargo → procesa el pago asociado', async () => {
    assert.equal(await llamar({ query: { id: 'CB1', topic: 'chargebacks' } }), 200);
    assert.deepEqual(procesados, [['pago', 456, 'charged_back']]);
  });

  test('tópico desconocido → 200 sin consultar MP', async () => {
    assert.equal(await llamar({ query: { 'data.id': '55', type: 'merchant_order' } }), 200);
    assert.deepEqual(llamadas, []);
  });

  test('recurso no encontrado en MP → 200', async () => {
    assert.equal(await llamar({ query: { 'data.id': 'NOEXISTE', type: 'payment' } }), 200);
    assert.deepEqual(procesados, []);
  });

  test('error real (red) → 500 para que MP reintente', async () => {
    recursos.errorRed = true;
    assert.equal(await llamar({ query: { 'data.id': '123', type: 'payment' } }), 500);
  });

  test('firma inválida → 401 (validación intacta)', async () => {
    assert.equal(await llamar({ query: { 'data.id': '123', type: 'payment' }, firma: 'mala' }), 401);
    assert.deepEqual(llamadas, []);
  });

  test('sin id → 400', async () => {
    assert.equal(await llamar({ query: { type: 'payment' } }), 400);
  });
});
