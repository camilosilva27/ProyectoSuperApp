/**
 * Tests de la baja de un clic de mails no transaccionales (routes/bajaMails.js, token HMAC en
 * plantillaMail.js, migración 0027): token válido/inválido/de otro usuario, GET que NO da de baja,
 * POST (botón y RFC 8058 One-Click) que sí, headers List-Unsubscribe con el link, y que un usuario
 * dado de baja no recibe el resumen semanal (el push sí). Sin red: Supabase simulado en memoria,
 * fetch a Brevo simulado; el único HTTP es contra un Express local en un puerto efímero.
 *
 * Correr con: node --test backend/test/bajaMails.test.js
 */

const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');

// Antes de cargar config.js (dotenv no pisa variables ya seteadas).
process.env.BAJA_MAILS_SECRET = 'secreto-de-prueba-baja';
process.env.URL_PUBLICA_BACKEND = 'https://backend.ejemplo.test/';
process.env.BREVO_API_KEY = 'test-key-no-real';

const config = require('../src/config');
// Los crons escriben su reporte en rutaLogs: que no pisen los logs reales del repo.
config.rutaLogs = fs.mkdtempSync(path.join(os.tmpdir(), 'baja-mails-test-'));

function stub(modulo, exports) {
  const ruta = require.resolve(modulo);
  require.cache[ruta] = { id: ruta, filename: ruta, loaded: true, exports };
}

// --- Supabase en memoria (solo lo que usan la ruta y el resumen semanal) --------------------
let tablas;
let usuariosAuth;
function crearSupabase() {
  function consulta(tabla) {
    const filtros = [];
    let cambios = null;
    let borrar = false;
    const filas = () => (tablas[tabla] ??= []);
    const coinciden = () => filas().filter(f => filtros.every(fn => fn(f)));
    const q = {
      select() { return q; },
      order() { return q; },
      gte() { return q; },
      lt() { return q; },
      in(col, vals) { filtros.push(f => vals.includes(f[col])); return q; },
      eq(col, val) { filtros.push(f => f[col] === val); return q; },
      update(obj) { cambios = obj; return q; },
      delete() { borrar = true; return q; },
      insert(obj) {
        const dup = filas().some(f => f.usuario_id === obj.usuario_id && f.tipo === obj.tipo && f.periodo === obj.periodo);
        if (dup) return Promise.resolve({ error: { code: '23505', message: 'duplicate' } });
        filas().push({ ...obj });
        return Promise.resolve({ error: null });
      },
      range(desde, hasta) { return Promise.resolve({ data: coinciden().slice(desde, hasta + 1).map(f => ({ ...f })), error: null }); },
      then(ok, mal) {
        if (cambios) coinciden().forEach(f => Object.assign(f, cambios));
        if (borrar) tablas[tabla] = filas().filter(f => !filtros.every(fn => fn(f)));
        return Promise.resolve({ error: null }).then(ok, mal);
      },
    };
    return q;
  }
  return {
    from: consulta,
    auth: { admin: { listUsers: async () => ({ data: { users: usuariosAuth }, error: null }) } },
  };
}
const supabase = crearSupabase();
stub(path.join(__dirname, '../src/clienteSupabaseAdmin.js'), { clienteSupabaseAdmin: () => supabase });

const pushEnviados = [];
let suscripcionesPush = new Map();
stub(path.join(__dirname, '../src/clientePush.js'), {
  obtenerSuscripcionesPorUsuario: async () => suscripcionesPush,
  enviarPush: async (_cliente, subs, payload) => {
    if (subs.length) pushEnviados.push(payload);
    return { enviados: subs.length, errores: [] };
  },
});

const express = require('express');
const { tokenBaja, tokenBajaValido, urlBaja, HEADERS_NO_TRANSACCIONAL, PIE_BAJA, armarMailBase } = require('../src/plantillaMail');
const { enviarMail } = require('../src/clienteBrevo');
const bajaMailsRouter = require('../src/routes/bajaMails');
const { resumenSemanalAhorro } = require('../src/cron/resumenSemanalAhorro');

const USUARIO = '11111111-1111-1111-1111-111111111111';
const OTRO = '22222222-2222-2222-2222-222222222222';

beforeEach(() => {
  tablas = {
    perfil_usuario: [
      { id: USUARIO, nombre: 'Uno', plan: 'premium', plan_bajado_a_gratis_en: null, mails_no_transaccionales: true },
      { id: OTRO, nombre: 'Dos', plan: 'premium', plan_bajado_a_gratis_en: null, mails_no_transaccionales: true },
    ],
    ahorro_registro: [],
    envio_mail_periodico: [],
  };
  usuariosAuth = [];
  pushEnviados.length = 0;
  suscripcionesPush = new Map();
});

describe('token de baja', () => {
  test('válido para su usuario, inválido para otro o alterado', () => {
    const t = tokenBaja(USUARIO);
    assert.ok(t && t.length > 20);
    assert.ok(tokenBajaValido(USUARIO, t));
    assert.ok(!tokenBajaValido(OTRO, t), 'el token de un usuario no sirve para otro');
    assert.ok(!tokenBajaValido(USUARIO, t.slice(0, -1) + (t.endsWith('A') ? 'B' : 'A')));
    assert.ok(!tokenBajaValido(USUARIO, t + 'x'));
    assert.ok(!tokenBajaValido(USUARIO, ''));
    assert.ok(!tokenBajaValido(USUARIO, undefined));
  });

  test('sin secreto: sin token, sin link, solo mailto', (t) => {
    const original = config.bajaMailsSecret;
    t.after(() => { config.bajaMailsSecret = original; });
    config.bajaMailsSecret = null;
    assert.equal(tokenBaja(USUARIO), null);
    assert.equal(urlBaja(USUARIO), null);
    assert.deepEqual(HEADERS_NO_TRANSACCIONAL(USUARIO), { 'List-Unsubscribe': '<mailto:contacto@mi-superapp.com.ar?subject=baja>' });
    assert.ok(!PIE_BAJA(USUARIO).includes('https://'));
  });
});

describe('headers y pie con el link', () => {
  test('List-Unsubscribe con https + mailto, y List-Unsubscribe-Post', () => {
    const h = HEADERS_NO_TRANSACCIONAL(USUARIO);
    const url = `https://backend.ejemplo.test/api/mails/baja?u=${USUARIO}&t=${tokenBaja(USUARIO)}`;
    assert.equal(urlBaja(USUARIO), url);
    assert.equal(h['List-Unsubscribe'], `<${url}>, <mailto:contacto@mi-superapp.com.ar?subject=baja>`);
    assert.equal(h['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
  });

  test('sin usuarioId: solo mailto', () => {
    assert.deepEqual(Object.keys(HEADERS_NO_TRANSACCIONAL()), ['List-Unsubscribe']);
  });

  test('pie del mail con el link (escapado) y el mailto', () => {
    const html = armarMailBase({ titulo: 't', cuerpoHtml: '', noTransaccional: true, usuarioId: USUARIO });
    assert.ok(html.includes(`/api/mails/baja?u=${USUARIO}&amp;t=${tokenBaja(USUARIO)}`));
    assert.ok(html.includes('subject=baja'));
  });

  test('enviarMail manda los headers con el link a Brevo', async (t) => {
    const fetchOriginal = global.fetch;
    t.after(() => { global.fetch = fetchOriginal; });
    const cuerpos = [];
    global.fetch = async (_url, opciones) => { cuerpos.push(JSON.parse(opciones.body)); return new Response('{}', { status: 201 }); };
    const r = await enviarMail({ destinatarioEmail: 'x@ejemplo.test', asunto: 'a', html: '<p/>', noTransaccional: true, usuarioId: USUARIO });
    assert.equal(r.ok, true);
    assert.deepEqual(cuerpos[0].headers, HEADERS_NO_TRANSACCIONAL(USUARIO));
    // Transaccional: sin headers de baja.
    await enviarMail({ destinatarioEmail: 'x@ejemplo.test', asunto: 'a', html: '<p/>', usuarioId: USUARIO });
    assert.equal(cuerpos[1].headers, undefined);
  });
});

describe('endpoint /api/mails/baja', () => {
  let servidor;
  let base;
  before(async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/mails', bajaMailsRouter);
    await new Promise(ok => { servidor = app.listen(0, '127.0.0.1', ok); });
    base = `http://127.0.0.1:${servidor.address().port}/api/mails/baja`;
  });
  after(() => servidor.close());

  const perfil = id => tablas.perfil_usuario.find(p => p.id === id);
  const url = (u, t) => `${base}?u=${encodeURIComponent(u)}&t=${encodeURIComponent(t)}`;

  test('GET con token válido muestra confirmación y NO da de baja', async () => {
    const r = await fetch(url(USUARIO, tokenBaja(USUARIO)));
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type'), /text\/html/);
    const html = await r.text();
    assert.ok(html.includes('<form method="POST"'));
    assert.ok(!html.includes('Uno'), 'la página no muestra datos personales');
    assert.equal(perfil(USUARIO).mails_no_transaccionales, true);
  });

  test('GET/POST con token inválido o de otro usuario → 400 y sin cambios', async () => {
    for (const [u, t] of [[USUARIO, 'basura'], [OTRO, tokenBaja(USUARIO)], ['no-es-uuid', tokenBaja('no-es-uuid')], [USUARIO, '']]) {
      assert.equal((await fetch(url(u, t))).status, 400);
      assert.equal((await fetch(url(u, t), { method: 'POST' })).status, 400);
    }
    assert.equal(perfil(USUARIO).mails_no_transaccionales, true);
    assert.equal(perfil(OTRO).mails_no_transaccionales, true);
  });

  test('POST del botón da de baja solo a ese usuario', async () => {
    const r = await fetch(url(USUARIO, tokenBaja(USUARIO)), { method: 'POST' });
    assert.equal(r.status, 200);
    assert.ok((await r.text()).includes('te diste de baja'));
    assert.equal(perfil(USUARIO).mails_no_transaccionales, false);
    assert.equal(perfil(OTRO).mails_no_transaccionales, true);
  });

  test('POST RFC 8058 (List-Unsubscribe=One-Click) da de baja', async () => {
    const r = await fetch(url(OTRO, tokenBaja(OTRO)), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'List-Unsubscribe=One-Click',
    });
    assert.equal(r.status, 200);
    assert.equal(perfil(OTRO).mails_no_transaccionales, false);
  });

  test('sin secreto configurado → 503', async (t) => {
    const original = config.bajaMailsSecret;
    t.after(() => { config.bajaMailsSecret = original; });
    const token = tokenBaja(USUARIO);
    config.bajaMailsSecret = null;
    assert.equal((await fetch(url(USUARIO, token))).status, 503);
    assert.equal((await fetch(url(USUARIO, token), { method: 'POST' })).status, 503);
    assert.equal(perfil(USUARIO).mails_no_transaccionales, true);
  });
});

describe('resumen semanal respeta la baja', () => {
  test('dado de baja: sin mail (el push sí); el otro recibe mail con su link', async (t) => {
    const fetchOriginal = global.fetch;
    t.after(() => { global.fetch = fetchOriginal; });
    const cuerpos = [];
    global.fetch = async (_url, opciones) => { cuerpos.push(JSON.parse(opciones.body)); return new Response('{}', { status: 201 }); };

    tablas.perfil_usuario[0].mails_no_transaccionales = false; // USUARIO se dio de baja
    tablas.ahorro_registro = [{ usuario_id: USUARIO, monto: 500 }, { usuario_id: OTRO, monto: 300 }];
    usuariosAuth = [
      { id: USUARIO, email: 'uno@ejemplo.test', email_confirmed_at: '2026-01-01', last_sign_in_at: '2026-09-01' },
      { id: OTRO, email: 'dos@ejemplo.test', email_confirmed_at: '2026-01-01', last_sign_in_at: '2026-09-01' },
    ];
    suscripcionesPush = new Map([[USUARIO, [{ endpoint: 'x' }]]]);

    const reporte = await resumenSemanalAhorro();

    assert.deepEqual(cuerpos.map(c => c.to[0].email), ['dos@ejemplo.test']);
    assert.deepEqual(cuerpos[0].headers, HEADERS_NO_TRANSACCIONAL(OTRO));
    assert.ok(cuerpos[0].htmlContent.includes(`u=${OTRO}&amp;t=${tokenBaja(OTRO)}`));
    assert.equal(pushEnviados.length, 1, 'el push al dado de baja sigue saliendo');
    assert.equal(reporte.enviados, 1);
    assert.equal(reporte.omitidosBaja, 1);
    assert.deepEqual(reporte.errores, []);
  });

  test('dado de baja y sin push: no se reclama el envío ni se manda nada', async (t) => {
    const fetchOriginal = global.fetch;
    t.after(() => { global.fetch = fetchOriginal; });
    const cuerpos = [];
    global.fetch = async (_url, opciones) => { cuerpos.push(JSON.parse(opciones.body)); return new Response('{}', { status: 201 }); };

    tablas.perfil_usuario = [tablas.perfil_usuario[0]];
    tablas.perfil_usuario[0].mails_no_transaccionales = false;
    tablas.ahorro_registro = [{ usuario_id: USUARIO, monto: 500 }];
    usuariosAuth = [{ id: USUARIO, email: 'uno@ejemplo.test', email_confirmed_at: '2026-01-01', last_sign_in_at: '2026-09-01' }];

    const reporte = await resumenSemanalAhorro();
    assert.equal(cuerpos.length, 0);
    assert.equal(tablas.envio_mail_periodico.length, 0);
    assert.equal(reporte.omitidosBaja, 1);
  });
});
