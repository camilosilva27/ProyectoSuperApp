/**
 * Tests del mail "¿Por qué no seguiste?" (mailFeedbackTrial.js, routes/feedbackTrial.js,
 * cron/feedbackTrialVencido.js, migración 0034): token, GET que NO guarda, POST que sí,
 * elegibilidad del cron (solo trial, ventana de días, una sola vez, baja respetada), línea de
 * ahorro solo si > $0 y replyTo a contacto@. Sin red: Supabase en memoria, fetch a Brevo simulado.
 *
 * Correr con: node --test backend/test/feedbackTrial.test.js
 */

const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');

process.env.BAJA_MAILS_SECRET = 'secreto-de-prueba-feedback';
process.env.URL_PUBLICA_BACKEND = 'https://backend.ejemplo.test';
process.env.BREVO_API_KEY = 'test-key-no-real';

const config = require('../src/config');
config.rutaLogs = fs.mkdtempSync(path.join(os.tmpdir(), 'feedback-trial-test-'));

function stub(modulo, exports) {
  const ruta = require.resolve(modulo);
  require.cache[ruta] = { id: ruta, filename: ruta, loaded: true, exports };
}

let tablas;
let usuariosAuth;
const supabase = {
  from(tabla) {
    const filtros = [];
    let cambios = null;
    const filas = () => (tablas[tabla] ??= []);
    const coinciden = () => filas().filter(f => filtros.every(fn => fn(f)));
    const q = {
      select() { return q; },
      order() { return q; },
      eq(col, val) { filtros.push(f => f[col] === val); return q; },
      update(obj) { cambios = obj; return q; },
      upsert(obj) {
        const i = filas().findIndex(f => f.usuario_id === obj.usuario_id);
        if (i >= 0) filas()[i] = { ...filas()[i], ...obj };
        else filas().push({ ...obj });
        return Promise.resolve({ error: null });
      },
      range(desde, hasta) { return Promise.resolve({ data: coinciden().slice(desde, hasta + 1).map(f => ({ ...f })), error: null }); },
      then(ok, mal) {
        if (cambios) coinciden().forEach(f => Object.assign(f, cambios));
        return Promise.resolve({ error: null }).then(ok, mal);
      },
    };
    return q;
  },
  auth: { admin: { listUsers: async () => ({ data: { users: usuariosAuth }, error: null }) } },
};
stub(path.join(__dirname, '../src/clienteSupabaseAdmin.js'), { clienteSupabaseAdmin: () => supabase });

const express = require('express');
const { tokenFeedback, tokenFeedbackValido, urlFeedback, armarHtml } = require('../src/mailFeedbackTrial');
const { tokenBaja, tokenBajaValido } = require('../src/plantillaMail');
const feedbackRouter = require('../src/routes/feedbackTrial');
const { feedbackTrialVencido, esElegible } = require('../src/cron/feedbackTrialVencido');

const USUARIO = '11111111-1111-1111-1111-111111111111';
const OTRO = '22222222-2222-2222-2222-222222222222';
const DIA = 24 * 60 * 60 * 1000;
const haceDias = d => new Date(Date.now() - d * DIA).toISOString();

describe('token', () => {
  test('válido solo para su usuario y no intercambiable con el de baja', () => {
    const t = tokenFeedback(USUARIO);
    assert.ok(tokenFeedbackValido(USUARIO, t));
    assert.ok(!tokenFeedbackValido(OTRO, t));
    assert.ok(!tokenFeedbackValido(USUARIO, t + 'x'));
    assert.ok(!tokenFeedbackValido(USUARIO, tokenBaja(USUARIO)), 'el token de baja no sirve para feedback');
    assert.ok(!tokenBajaValido(USUARIO, t), 'el token de feedback no sirve para dar de baja');
  });
});

describe('html del mail', () => {
  test('con ahorro: muestra el monto; sin ahorro: no', () => {
    const con = armarHtml({ nombre: 'Juan', usuarioId: USUARIO, ahorroTotal: 12450 });
    assert.match(con, /Hola Juan, soy Camilo, creador de SuperAhorro\./);
    assert.match(con, /Durante la prueba ahorraste/);
    assert.match(con, /12\.450/);
    const sin = armarHtml({ nombre: 'Juan', usuarioId: USUARIO, ahorroTotal: 0 });
    assert.doesNotMatch(sin, /ahorraste/);
  });

  test('5 botones con su link, nombre escapado y sin link de baja', () => {
    const html = armarHtml({ nombre: '<b>x</b>', usuarioId: USUARIO, ahorroTotal: 0 });
    for (const r of ['caro', 'poco_ahorro', 'falta_super', 'no_la_use', 'otra']) {
      assert.ok(html.includes(urlFeedback(USUARIO, r).replace(/&/g, '&amp;')), `falta el botón ${r}`);
    }
    assert.ok(!html.includes('<b>x</b>'));
    assert.doesNotMatch(html, /date de baja/);
  });
});

describe('ruta /api/mails/feedback', () => {
  let servidor;
  let base;
  before(async () => {
    const app = express();
    app.use('/api/mails', feedbackRouter);
    servidor = app.listen(0);
    await new Promise(r => servidor.once('listening', r));
    base = `http://127.0.0.1:${servidor.address().port}/api/mails/feedback`;
  });
  after(() => servidor.close());
  beforeEach(() => { tablas = { feedback_trial: [] }; });

  const cred = () => `u=${USUARIO}&t=${encodeURIComponent(tokenFeedback(USUARIO))}`;
  const post = body => fetch(`${base}?${cred()}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
  });

  test('GET muestra el formulario con la razón marcada y NO guarda', async () => {
    const res = await fetch(`${base}?${cred()}&r=caro`);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /value="caro" checked/);
    assert.match(html, /¿Querés contarme más\?/);
    assert.equal(tablas.feedback_trial.length, 0);
  });

  test('GET con "otra" pide contar qué pasó', async () => {
    const html = await (await fetch(`${base}?${cred()}&r=otra`)).text();
    assert.match(html, /Contame qué pasó/);
  });

  test('token inválido → 400', async () => {
    const res = await fetch(`${base}?u=${USUARIO}&t=malo&r=caro`);
    assert.equal(res.status, 400);
  });

  test('POST guarda razón y comentario; responder de nuevo pisa', async () => {
    let res = await post({ r: 'caro', comentario: '  muy caro para mí  ' });
    assert.equal(res.status, 200);
    assert.match(await res.text(), /¡Gracias!/);
    assert.equal(tablas.feedback_trial.length, 1);
    assert.equal(tablas.feedback_trial[0].razon, 'caro');
    assert.equal(tablas.feedback_trial[0].comentario, 'muy caro para mí');

    await post({ r: 'no_la_use', comentario: '' });
    assert.equal(tablas.feedback_trial.length, 1);
    assert.equal(tablas.feedback_trial[0].razon, 'no_la_use');
    assert.equal(tablas.feedback_trial[0].comentario, null);
  });

  test('POST sin razón válida, u "otra" sin texto → 400 sin guardar', async () => {
    assert.equal((await post({ r: 'inventada' })).status, 400);
    assert.equal((await post({ r: 'otra', comentario: '   ' })).status, 400);
    assert.equal(tablas.feedback_trial.length, 0);
  });
});

describe('cron feedbackTrialVencido', () => {
  const ahora = Date.now();
  const base = { plan: 'gratis', plan_anterior_a_gratis: 'trial', plan_bajado_a_gratis_en: haceDias(4), mail_feedback_trial_enviado_en: null, mails_no_transaccionales: true };

  test('elegibilidad', () => {
    assert.ok(esElegible(base, ahora));
    assert.ok(!esElegible({ ...base, plan_anterior_a_gratis: 'premium' }, ahora), 'pagó y canceló');
    assert.ok(!esElegible({ ...base, plan_bajado_a_gratis_en: haceDias(2) }, ahora), 'todavía no pasaron 3 días');
    assert.ok(!esElegible({ ...base, plan_bajado_a_gratis_en: haceDias(30) }, ahora), 'vencido hace mucho');
    assert.ok(!esElegible({ ...base, mail_feedback_trial_enviado_en: haceDias(1) }, ahora), 'ya enviado');
    assert.ok(esElegible({ ...base, mails_no_transaccionales: false }, ahora), 'le llega aunque se haya dado de baja');
    assert.ok(esElegible({ ...base, plan_bajado_a_gratis_en: haceDias(90) }, ahora, { sinTope: true }), '--sin-tope incluye vencidos viejos');
    assert.ok(esElegible({ ...base, plan_bajado_a_gratis_en: null }, ahora, { sinTope: true }));
    assert.ok(!esElegible({ ...base, plan_anterior_a_gratis: 'premium' }, ahora, { sinTope: true }), '--sin-tope sigue siendo solo trial');
    assert.ok(!esElegible({ ...base, plan: 'trial' }, ahora));
  });

  test('manda una vez, con ahorro y replyTo a contacto@, y marca', async (t) => {
    const enviados = [];
    const fetchOriginal = global.fetch;
    t.after(() => { global.fetch = fetchOriginal; });
    global.fetch = async (_url, opciones) => {
      enviados.push(JSON.parse(opciones.body));
      return { ok: true, status: 201, headers: new Map(), text: async () => '' };
    };
    tablas = {
      perfil_usuario: [
        { id: USUARIO, nombre: 'Juan', ...base },
        { id: OTRO, nombre: 'Ana', ...base, plan_anterior_a_gratis: 'premium' },
      ],
      ahorro_registro: [{ usuario_id: USUARIO, monto: 1000 }, { usuario_id: USUARIO, monto: 250.4 }],
    };
    usuariosAuth = [
      { id: USUARIO, email: 'juan@ejemplo.test', email_confirmed_at: haceDias(40) },
      { id: OTRO, email: 'ana@ejemplo.test', email_confirmed_at: haceDias(40) },
    ];

    const r1 = await feedbackTrialVencido();
    assert.deepEqual(r1.errores, []);
    assert.equal(r1.enviados, 1);
    assert.equal(enviados[0].to[0].email, 'juan@ejemplo.test');
    assert.deepEqual(enviados[0].replyTo, { email: 'contacto@superahorro.com.ar' });
    assert.match(enviados[0].htmlContent, /1\.250/);
    assert.ok(tablas.perfil_usuario[0].mail_feedback_trial_enviado_en);

    const r2 = await feedbackTrialVencido();
    assert.equal(r2.enviados, 0, 'no se repite');
  });
});
