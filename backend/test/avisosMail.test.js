/**
 * Tests de los fixes de mails/avisos de la auditoría 2026-09-24: huella de identidad de promo
 * (Alertas), clasificación de productos seguidos (plan activo, migración de huellas viejas),
 * escape HTML en plantillas, pie/header de baja, clienteBrevo que nunca lanza, secreto del
 * webhook en tiempo constante. Sin red: fetch se simula, Supabase no se toca.
 *
 * Correr con: node --test backend/test/avisosMail.test.js
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

process.env.BREVO_API_KEY = process.env.BREVO_API_KEY || 'test-key-no-real';

const { huellaIdentidadPromo, esHuellaVigente, estadoPromoPorEan } = require('../src/cron/diffCatalogos');
const { clasificarSeguidos, armarHtml: htmlAlertas } = require('../src/avisoProductosSeguidos');
const { escaparHtml, armarMailBase, HEADERS_NO_TRANSACCIONAL } = require('../src/plantillaMail');
const { tienePlanActivo, leerTodasLasFilas } = require('../src/usuariosAuth');
const { armarHtml: htmlBienvenida } = require('../src/mailBienvenida');
const { armarHtml: htmlFinTrial } = require('../src/cron/avisoFinTrial');
const { armarHtml: htmlInactividad, esElegible: elegibleInactividad } = require('../src/cron/avisoInactividad');
const { armarHtml: htmlMensual } = require('../src/cron/resumenMensualAhorro');
const { armarHtml: htmlSemanal, semanaIsoArgentina } = require('../src/cron/resumenSemanalAhorro');
const { armarHtml: htmlRecibo } = require('../src/reciboPago');
const { secretoValido } = require('../src/routes/webhookAuthUsuarios');

const MALICIOSO = '<img src=x onerror="alert(1)">&\'';

describe('huellaIdentidadPromo', () => {
  const teaser = (extra = {}) => ({
    ean: '1', promocion: {
      nombre: 'OFERTA COCINERO', codigo: 'Oferta', descuento: '0.09', descuentoPct: '9%',
      precioFinal: 4995.9, vigenciaDesde: '2026-08-19', vigenciaHasta: '2026-08-31', ...extra,
    },
  });
  const estructurado = (dd = {}, extra = {}) => ({
    ean: '2',
    descuentoDirecto: { tipo: 'descuento_directo', precioBase: 2800, precioFinal: 1650, descuentoPct: '41%', descuento: '0.4107', ...dd },
    promosInternas: [{ nombre: '2do al 50%', descuentoPct: null, cantidadMinima: 2, esBancaria: false }],
    promosBancarias: [{ banco: 'Galicia', descuentoPct: 20 }],
    ...extra,
  });

  test('teaser VTEX: mismo promo con otro precio/vigencia → misma huella', () => {
    assert.equal(
      huellaIdentidadPromo(teaser()),
      huellaIdentidadPromo(teaser({ precioFinal: 5300, descuento: '0.0901', vigenciaHasta: '2026-09-15' }))
    );
  });

  test('teaser VTEX: otra promo (nombre o %) → huella distinta', () => {
    assert.notEqual(huellaIdentidadPromo(teaser()), huellaIdentidadPromo(teaser({ nombre: '2do al 50% COCA' })));
    assert.notEqual(huellaIdentidadPromo(teaser()), huellaIdentidadPromo(teaser({ descuentoPct: '25%' })));
  });

  test('estructurado: cambio de precio o de bancarias → misma huella', () => {
    const base = huellaIdentidadPromo(estructurado());
    assert.equal(base, huellaIdentidadPromo(estructurado({ precioBase: 3000, precioFinal: 1770 })));
    assert.equal(base, huellaIdentidadPromo(estructurado({}, { promosBancarias: [] })));
    assert.equal(base, huellaIdentidadPromo(estructurado({}, { promosBancarias: [{ banco: 'Nación', descuentoPct: 35 }] })));
    assert.equal(base, huellaIdentidadPromo(estructurado({ descuentoPct: 41 }))); // "41%" y 41 son lo mismo
  });

  test('estructurado: otro %, otra promo interna o sin directo → huella distinta', () => {
    const base = huellaIdentidadPromo(estructurado());
    assert.notEqual(base, huellaIdentidadPromo(estructurado({ descuentoPct: '30%' })));
    assert.notEqual(base, huellaIdentidadPromo(estructurado({}, { promosInternas: [{ nombre: '3x2', cantidadMinima: 3 }] })));
    assert.notEqual(base, huellaIdentidadPromo({ ...estructurado(), descuentoDirecto: undefined }));
  });

  test('orden de promosInternas no importa; bancarias marcadas dentro de internas se ignoran', () => {
    const a = { promosInternas: [{ nombre: 'A' }, { nombre: 'B' }] };
    const b = { promosInternas: [{ nombre: 'B' }, { nombre: 'A' }, { nombre: 'Banco X', esBancaria: true }] };
    assert.equal(huellaIdentidadPromo(a), huellaIdentidadPromo(b));
  });

  test('versionada: v2 vigente, formato viejo/null no', () => {
    const h = huellaIdentidadPromo(teaser());
    assert.ok(esHuellaVigente(h));
    assert.ok(!esHuellaVigente(JSON.stringify(teaser().promocion)));
    assert.ok(!esHuellaVigente(null));
  });

  test('estadoPromoPorEan usa la huella de identidad', () => {
    const mapa = estadoPromoPorEan({ skus: [teaser()] }, 'Vea');
    assert.equal(mapa.get('1').huella, huellaIdentidadPromo(teaser()));
  });
});

describe('clasificarSeguidos (Alertas)', () => {
  const AHORA = Date.parse('2026-09-24T12:00:00Z');
  const huella = 'v2:{"x":1}';
  const estado = new Map([['E1', { ean: 'E1', nombre: 'Yerba', super: 'Coto', huella }]]);
  const perfiles = new Map([
    ['premium', { plan: 'premium', alertas_activas: true }],
    ['trialOk', { plan: 'trial', trial_termina_en: '2026-10-01T00:00:00Z', alertas_activas: true }],
    ['trialVencido', { plan: 'trial', trial_termina_en: '2026-09-20T00:00:00Z', alertas_activas: true }],
    ['gratis', { plan: 'gratis', alertas_activas: true }],
    ['apagado', { plan: 'premium', alertas_activas: false }],
  ]);
  const fila = (id, usuario_id, h = null) => ({ id, usuario_id, ean: 'E1', huella_promo_avisada: h });

  test('avisa solo a plan activo; sin plan / apagado no avisa ni marca', () => {
    const { porUsuario, actualizacionesHuella } = clasificarSeguidos(
      [fila(1, 'premium'), fila(2, 'trialOk'), fila(3, 'trialVencido'), fila(4, 'gratis'), fila(5, 'apagado'), fila(6, 'sinPerfil')],
      estado, perfiles, AHORA
    );
    assert.deepEqual([...porUsuario.keys()].sort(), ['premium', 'trialOk']);
    assert.deepEqual(actualizacionesHuella.map(u => u.id).sort(), [1, 2]);
  });

  test('huella vieja (sin prefijo) se migra sin avisar', () => {
    const { porUsuario, actualizacionesHuella } = clasificarSeguidos(
      [fila(1, 'premium', '{"nombre":"viejo","precioFinal":10}')], estado, perfiles, AHORA
    );
    assert.equal(porUsuario.size, 0);
    assert.deepEqual(actualizacionesHuella, [{ id: 1, huella_promo_avisada: huella }]);
  });

  test('misma huella no re-avisa; promo apagada resetea a null', () => {
    const r1 = clasificarSeguidos([fila(1, 'premium', huella)], estado, perfiles, AHORA);
    assert.equal(r1.porUsuario.size, 0);
    assert.equal(r1.actualizacionesHuella.length, 0);
    const r2 = clasificarSeguidos([fila(1, 'premium', huella)], new Map(), perfiles, AHORA);
    assert.deepEqual(r2.actualizacionesHuella, [{ id: 1, huella_promo_avisada: null }]);
  });
});

describe('tienePlanActivo', () => {
  const AHORA = Date.parse('2026-09-24T12:00:00Z');
  test('casos', () => {
    assert.ok(tienePlanActivo({ plan: 'premium' }, AHORA));
    assert.ok(tienePlanActivo({ plan: 'trial', trial_termina_en: null }, AHORA));
    assert.ok(tienePlanActivo({ plan: 'trial', trial_termina_en: '2026-09-25T00:00:00Z' }, AHORA));
    assert.ok(!tienePlanActivo({ plan: 'trial', trial_termina_en: '2026-09-24T11:00:00Z' }, AHORA));
    assert.ok(!tienePlanActivo({ plan: 'gratis' }, AHORA));
    assert.ok(!tienePlanActivo(undefined, AHORA));
  });

  test('inactividad excluye a gratis aunque lleve 14+ días sin loguearse', () => {
    const base = { ultimoLogin: '2026-08-01T00:00:00Z', avisoInactividadEnviadoEn: null };
    assert.ok(elegibleInactividad({ ...base, perfil: { plan: 'premium' } }, AHORA));
    assert.ok(!elegibleInactividad({ ...base, perfil: { plan: 'gratis' } }, AHORA));
  });
});

describe('leerTodasLasFilas', () => {
  test('pagina con range hasta una página incompleta', async () => {
    const total = Array.from({ length: 5 }, (_, i) => ({ i }));
    const rangos = [];
    const armar = () => ({ range: async (d, h) => { rangos.push([d, h]); return { data: total.slice(d, h + 1), error: null }; } });
    const { data, error } = await leerTodasLasFilas(armar, 2);
    assert.equal(error, null);
    assert.equal(data.length, 5);
    assert.deepEqual(rangos, [[0, 1], [2, 3], [4, 5]]);
  });
});

describe('escape HTML', () => {
  test('escaparHtml escapa los 5 caracteres y tolera null', () => {
    assert.equal(escaparHtml('<a href="x">&\'</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
    assert.equal(escaparHtml(null), '');
    assert.equal(escaparHtml(undefined), '');
    assert.equal(escaparHtml(41), '41');
  });

  const plantillas = {
    bienvenida: () => htmlBienvenida({ nombre: MALICIOSO }),
    finTrial: () => htmlFinTrial({ nombre: MALICIOSO, diasRestantes: 2 }),
    inactividad: () => htmlInactividad({ nombre: MALICIOSO }),
    mensual: () => htmlMensual({ nombre: MALICIOSO, nombreMes: 'agosto 2026', monto: 100, cantidad: 2 }),
    semanal: () => htmlSemanal({ nombre: MALICIOSO, monto: 100, cantidad: 2 }),
    recibo: () => htmlRecibo({ nombre: MALICIOSO, tipoPlan: MALICIOSO, monto: 100, siguienteCobroEn: null }),
    alertas: () => htmlAlertas({ nombreUsuario: MALICIOSO, productos: [{ nombre: MALICIOSO, super: 'Coto', descuentoPct: 25, precioFinal: 1000 }] }),
  };
  for (const [nombre, armar] of Object.entries(plantillas)) {
    test(`${nombre}: no deja pasar HTML del usuario/producto`, () => {
      const html = armar();
      assert.ok(!html.includes('<img src=x'), 'quedó el <img> crudo');
      assert.ok(html.includes('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;'));
    });
  }

  test('armarMailBase escapa titulo/preheader pero no cuerpoHtml', () => {
    const html = armarMailBase({ preheader: '<b>p</b>', titulo: '<i>t</i>', cuerpoHtml: '<p>ok</p>' });
    assert.ok(html.includes('&lt;b&gt;p&lt;/b&gt;'));
    assert.ok(html.includes('&lt;i&gt;t&lt;/i&gt;'));
    assert.ok(html.includes('<p>ok</p>'));
  });
});

describe('baja de mails no transaccionales', () => {
  test('pie de baja solo con noTransaccional', () => {
    assert.ok(armarMailBase({ titulo: 't', cuerpoHtml: '', noTransaccional: true }).includes('subject=baja'));
    assert.ok(!armarMailBase({ titulo: 't', cuerpoHtml: '' }).includes('subject=baja'));
    assert.ok(htmlSemanal({ nombre: 'A', monto: 1, cantidad: 1 }).includes('subject=baja'));
    assert.ok(htmlAlertas({ nombreUsuario: 'A', productos: [{ nombre: 'x', super: 'Vea' }] }).includes('subject=baja'));
    assert.ok(!htmlRecibo({ nombre: 'A', tipoPlan: 'mensual', monto: 1 }).includes('subject=baja'));
  });

  test('header List-Unsubscribe con mailto', () => {
    assert.equal(HEADERS_NO_TRANSACCIONAL['List-Unsubscribe'], '<mailto:contacto@mi-superapp.com.ar?subject=baja>');
  });
});

describe('clienteBrevo (fetch simulado)', () => {
  // config.js lee BREVO_API_KEY al cargarse; se fuerza una key de prueba antes de requerirlo.
  const { enviarMail } = require('../src/clienteBrevo');
  const fetchOriginal = global.fetch;
  const args = { destinatarioEmail: 'x@ejemplo.test', asunto: 'a', html: '<p>h</p>' };

  test('error de red → {ok:false}, no lanza', async (t) => {
    t.after(() => { global.fetch = fetchOriginal; });
    global.fetch = async () => { throw new TypeError('fetch failed'); };
    const r = await enviarMail(args);
    assert.equal(r.ok, false);
    assert.match(r.error, /fetch failed|BREVO_API_KEY/);
  });

  test('429 reintenta una vez; header List-Unsubscribe con noTransaccional', async (t) => {
    t.after(() => { global.fetch = fetchOriginal; });
    const cuerpos = [];
    global.fetch = async (_url, opciones) => {
      cuerpos.push(JSON.parse(opciones.body));
      if (cuerpos.length === 1) return new Response('rate', { status: 429, headers: { 'retry-after': '0' } });
      return new Response('{}', { status: 201 });
    };
    const r = await enviarMail({ ...args, noTransaccional: true });
    if (cuerpos.length === 0) return t.skip('sin BREVO_API_KEY en config (entorno sin .env)');
    assert.equal(r.ok, true);
    assert.equal(cuerpos.length, 2);
    assert.equal(cuerpos[0].headers['List-Unsubscribe'], HEADERS_NO_TRANSACCIONAL['List-Unsubscribe']);
  });
});

describe('otros', () => {
  test('secretoValido del webhook', () => {
    assert.ok(secretoValido('abc123', 'abc123'));
    assert.ok(!secretoValido('abc12', 'abc123'));
    assert.ok(!secretoValido('', 'abc123'));
    assert.ok(!secretoValido(undefined, 'abc123'));
  });

  test('semanaIsoArgentina', () => {
    assert.equal(semanaIsoArgentina(new Date('2026-09-21T15:00:00Z')), '2026-W39');
    // domingo 27/09 23hs Argentina sigue siendo la semana 39 aunque en UTC ya sea lunes
    assert.equal(semanaIsoArgentina(new Date('2026-09-28T02:00:00Z')), '2026-W39');
  });
});
