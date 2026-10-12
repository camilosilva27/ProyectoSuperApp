/**
 * Tests del aviso "¡Ganaste 2 meses gratis!" (src/mailPremioReferidos.js): texto según el plan
 * previo, escape del nombre, y que solo sale una vez, con el premio otorgado y el mail confirmado.
 *
 * Correr con: node --test backend/test/mailPremioReferidos.test.js
 */

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const enviados = [];
function stub(modulo, exports) {
  const ruta = require.resolve(path.join(__dirname, '../src', modulo));
  require.cache[ruta] = { id: ruta, filename: ruta, loaded: true, exports };
}
stub('clienteBrevo.js', { enviarMail: async m => { enviados.push(m); return { ok: true }; } });
stub('clientePush.js', { obtenerSuscripcionesDeUsuario: async () => [], enviarPush: async () => ({ enviados: 0 }) });

const { armarHtml, enviarAvisoPremio } = require('../src/mailPremioReferidos');

const USUARIO = 'aaaaaaaa-0000-0000-0000-000000000001';
let premio;
let usuario;

function cliente() {
  return {
    from: tabla => {
      const q = {
        select: () => q,
        eq: () => q,
        is: () => q,
        update: cambios => { Object.assign(premio, cambios); return q; },
        maybeSingle: async () => ({
          data: tabla === 'premio_referido' ? (premio && { ...premio }) : { nombre: 'Ana <b>Pérez</b>' },
          error: null,
        }),
        then: (ok, mal) => Promise.resolve({ error: null }).then(ok, mal),
      };
      return q;
    },
    auth: { admin: { getUserById: async () => ({ data: { user: usuario }, error: null }) } },
  };
}

beforeEach(() => {
  enviados.length = 0;
  premio = { estado: 'otorgado', dias: 60, hasta: '2027-01-10T15:00:00Z', plan_antes: 'trial', mail_enviado_en: null };
  usuario = { email: 'ana@example.com', email_confirmed_at: '2026-10-01T00:00:00Z' };
});

describe('texto del aviso', () => {
  test('en prueba: dice que se sumó a la prueba y hasta cuándo', () => {
    const html = armarHtml({ nombre: 'Ana', dias: 60, hasta: '2027-01-10T15:00:00Z', planAntes: 'trial', invitadas: 3 });
    assert.match(html, /Tus 3 amigos ya se sumaron/);
    assert.match(html, /2 MESES GRATIS/);
    assert.match(html, /ahora vence el <strong>10 de enero de 2027<\/strong>/);
  });

  test('sin plan (gratis): dice hasta cuándo tiene acceso completo', () => {
    const html = armarHtml({ nombre: null, dias: 60, hasta: '2027-01-10T15:00:00Z', planAntes: 'gratis', invitadas: 3 });
    assert.match(html, /acceso completo a SuperAhorro hasta el <strong>10 de enero de 2027<\/strong>/);
    assert.match(html, /Hola,/);
  });
});

describe('envío', () => {
  test('manda el mail una vez, con el nombre de pila escapado, y deja constancia', async () => {
    const r = await enviarAvisoPremio(cliente(), USUARIO, 3);
    assert.equal(r.ok, true);
    assert.equal(enviados.length, 1);
    assert.equal(enviados[0].destinatarioEmail, 'ana@example.com');
    assert.equal(enviados[0].asunto, '¡Ganaste 2 meses gratis en SuperAhorro!');
    assert.match(enviados[0].html, /Hola Ana,/);
    assert.ok(premio.mail_enviado_en);
    const otra = await enviarAvisoPremio(cliente(), USUARIO, 3);
    assert.equal(otra.yaEnviado, true);
    assert.equal(enviados.length, 1);
  });

  test('no manda si el premio no está otorgado o el mail no está confirmado', async () => {
    premio.estado = 'no_aplica';
    assert.equal((await enviarAvisoPremio(cliente(), USUARIO, 3)).ok, false);
    premio.estado = 'otorgado';
    usuario.email_confirmed_at = null;
    assert.equal((await enviarAvisoPremio(cliente(), USUARIO, 3)).ok, false);
    assert.equal(enviados.length, 0);
  });
});
