/**
 * Tests de src/referidos.js con Supabase en memoria: asociar invitada ↔ invitador (y sus
 * rechazos), validación con la primera comparación (incluida la del tutorial), plazo de 30 días,
 * antiabuso mínimo (mail descartable, misma casilla de Gmail) y el disparo del premio con la
 * tercera válida. La lógica del premio en sí vive en SQL (otorgar_premio_referido, migración
 * 0030); acá se simula solo su contrato (≥ N válidas y sin premio previo → 'otorgado' una vez).
 *
 * Correr con: node --test backend/test/referidos.test.js
 */

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const {
  asociarInvitada, registrarComparacion, estadoDelUsuario, obtenerCodigo,
  normalizarMail, esMailDescartable, normalizarCodigo, motivoNoAplica, generarCodigo, nombreDePila,
  _sinReferidoPendiente,
} = require('../src/referidos');

const DIA = 24 * 60 * 60 * 1000;
const AHORA = new Date('2026-10-12T15:00:00Z');
const hace = dias => new Date(AHORA.getTime() - dias * DIA).toISOString();

// --- Supabase en memoria: solo lo que usa referidos.js ----------------------------------------
function crearSupabase({ tablas, usuarios }) {
  let siguienteId = 1;
  const premiosOtorgados = [];

  function consulta(nombre) {
    const filas = tablas[nombre];
    const filtros = [];
    let operacion = 'select';
    let datos = null;
    let orden = null;
    let limite = null;
    let devolver = false;

    const aplicarFiltros = () => filas.filter(f => filtros.every(fn => fn(f)));
    function ejecutar() {
      if (operacion === 'insert') {
        if (nombre === 'referido' && filas.some(f => f.invitada_id === datos.invitada_id)) {
          return { data: null, error: { code: '23505', message: 'duplicate' } };
        }
        const nueva = { id: siguienteId++, asociada_en: AHORA.toISOString(), primera_comparacion_en: null, ...datos };
        filas.push(nueva);
        return { data: [{ ...nueva }], error: null };
      }
      if (operacion === 'update') {
        if (datos.codigo_referido && filas.some(f => f.codigo_referido === datos.codigo_referido)) {
          return { data: null, error: { code: '23505', message: 'duplicate' } };
        }
        const afectadas = aplicarFiltros();
        afectadas.forEach(f => Object.assign(f, datos));
        return { data: devolver ? afectadas.map(f => ({ ...f })) : null, error: null };
      }
      let r = aplicarFiltros();
      if (orden) r = [...r].sort((a, b) => (a[orden.col] === b[orden.col] ? 0 : (a[orden.col] > b[orden.col] ? 1 : -1) * (orden.asc ? 1 : -1)));
      if (limite != null) r = r.slice(0, limite);
      return { data: r.map(f => ({ ...f })), error: null };
    }

    const q = {
      select() { if (operacion !== 'select') devolver = true; return q; },
      insert(obj) { operacion = 'insert'; datos = obj; return q; },
      update(obj) { operacion = 'update'; datos = obj; return q; },
      eq(col, val) { filtros.push(f => f[col] === val); return q; },
      is(col, val) { filtros.push(f => (f[col] ?? null) === val); return q; },
      in(col, vals) { filtros.push(f => vals.includes(f[col])); return q; },
      lt(col, val) { filtros.push(f => new Date(f[col]) < new Date(val)); return q; },
      gte(col, val) { filtros.push(f => new Date(f[col]) >= new Date(val)); return q; },
      order(col, { ascending }) { orden = { col, asc: ascending }; return q; },
      limit(n) { limite = n; return q; },
      maybeSingle() {
        const { data, error } = ejecutar();
        return Promise.resolve({ data: data?.[0] ?? null, error });
      },
      single() { return q.maybeSingle(); },
      then(ok, mal) { return Promise.resolve(ejecutar()).then(ok, mal); },
    };
    return q;
  }

  return {
    premiosOtorgados,
    from: nombre => consulta(nombre),
    rpc: async (fn, { p_usuario, p_necesarias }) => {
      assert.equal(fn, 'otorgar_premio_referido');
      if (premiosOtorgados.includes(p_usuario)) return { data: 'ya_tenia', error: null };
      const validas = tablas.referido.filter(r => r.invitador_id === p_usuario && r.estado === 'valida').length;
      if (validas < p_necesarias) return { data: 'faltan', error: null };
      premiosOtorgados.push(p_usuario);
      return { data: 'otorgado', error: null };
    },
    auth: {
      admin: {
        getUserById: async id => ({ data: { user: usuarios[id] ?? null }, error: null }),
      },
    },
  };
}

const INVITADOR = 'aaaaaaaa-0000-0000-0000-000000000001';
const INV = n => `bbbbbbbb-0000-0000-0000-00000000000${n}`;

let tablas;
let usuarios;
let supabase;

function nuevaInvitada(n, extra = {}) {
  usuarios[INV(n)] = {
    id: INV(n), email: `amiga${n}@hotmail.com`, created_at: hace(1),
    email_confirmed_at: hace(1), ...extra,
  };
  tablas.perfil_usuario.push({ id: INV(n), codigo_referido: null, plan: 'trial', nombre: extra.nombre ?? null });
}

beforeEach(() => {
  _sinReferidoPendiente.clear();
  tablas = {
    perfil_usuario: [{
      id: INVITADOR, codigo_referido: 'CAMI4K', plan: 'trial', tipo_plan: null,
      premium_manual: false, acceso_premium_hasta: null,
    }],
    referido: [],
    premio_referido: [],
    ahorro_registro: [],
  };
  usuarios = {
    [INVITADOR]: { id: INVITADOR, email: 'camilo.silva@gmail.com', created_at: hace(100), email_confirmed_at: hace(100) },
  };
  supabase = crearSupabase({ tablas, usuarios });
});

describe('funciones puras', () => {
  test('normaliza Gmail: sin puntos ni +sufijo, googlemail = gmail', () => {
    assert.equal(normalizarMail('Camilo.Silva+promo@GMAIL.com'), 'camilosilva@gmail.com');
    assert.equal(normalizarMail('camilosilva@googlemail.com'), 'camilosilva@gmail.com');
  });

  test('en otros dominios saca el +sufijo pero respeta los puntos', () => {
    assert.equal(normalizarMail('ana.perez+x@hotmail.com'), 'ana.perez@hotmail.com');
    assert.equal(normalizarMail('sin-arroba'), null);
  });

  test('detecta mails descartables', () => {
    assert.equal(esMailDescartable('x@mailinator.com'), true);
    assert.equal(esMailDescartable('x@YOPMAIL.com'), true);
    assert.equal(esMailDescartable('x@gmail.com'), false);
  });

  test('normaliza el código y rechaza formatos raros', () => {
    assert.equal(normalizarCodigo(' cami4k '), 'CAMI4K');
    assert.equal(normalizarCodigo('ab'), null);
    assert.equal(normalizarCodigo('CAMI-4K'), null);
    assert.equal(normalizarCodigo(42), null);
  });

  test('nombre de pila: solo la primera palabra, nunca el apellido', () => {
    assert.equal(nombreDePila('  María José Pérez '), 'María');
    assert.equal(nombreDePila('Lucas'), 'Lucas');
    assert.equal(nombreDePila('   '), null);
    assert.equal(nombreDePila(null), null);
  });

  test('el código generado no usa caracteres que se confunden', () => {
    for (let i = 0; i < 200; i++) assert.match(generarCodigo(), /^[A-HJKMNP-Z2-9]{6}$/);
  });

  test('el premio no aplica con suscripción paga, permanente o premium manual', () => {
    assert.equal(motivoNoAplica({ plan: 'premium', acceso_premium_hasta: null }), 'suscripcion_activa');
    assert.equal(motivoNoAplica({ plan: 'premium', tipo_plan: 'permanente' }), 'permanente');
    assert.equal(motivoNoAplica({ plan: 'trial', premium_manual: true }), 'premium_manual');
    assert.equal(motivoNoAplica({ plan: 'premium', acceso_premium_hasta: hace(-10) }), null);
    assert.equal(motivoNoAplica({ plan: 'trial' }), null);
    assert.equal(motivoNoAplica({ plan: 'gratis' }), null);
  });
});

describe('código de referido', () => {
  test('se crea la primera vez y después se reusa', async () => {
    nuevaInvitada(1);
    const codigo = await obtenerCodigo(supabase, INV(1));
    assert.match(codigo, /^[A-Z0-9]{6}$/);
    assert.equal(await obtenerCodigo(supabase, INV(1)), codigo);
  });

  test('sin perfil devuelve null', async () => {
    assert.equal(await obtenerCodigo(supabase, 'no-existe'), null);
  });
});

describe('asociar invitada', () => {
  test('queda pendiente con el mail confirmado guardado', async () => {
    nuevaInvitada(1);
    const r = await asociarInvitada(supabase, { invitadaId: INV(1), codigo: 'cami4k', ahora: AHORA });
    assert.equal(r.resultado, 'asociada');
    assert.equal(tablas.referido[0].estado, 'pendiente');
    assert.equal(tablas.referido[0].invitador_id, INVITADOR);
    assert.equal(tablas.referido[0].mail_confirmado_en, usuarios[INV(1)].email_confirmed_at);
  });

  test('es idempotente: la segunda vez no cambia nada', async () => {
    nuevaInvitada(1);
    await asociarInvitada(supabase, { invitadaId: INV(1), codigo: 'CAMI4K', ahora: AHORA });
    const r = await asociarInvitada(supabase, { invitadaId: INV(1), codigo: 'CAMI4K', ahora: AHORA });
    assert.equal(r.resultado, 'ya_asociada');
    assert.equal(tablas.referido.length, 1);
  });

  test('rechaza código inexistente, el propio y cuentas viejas', async () => {
    nuevaInvitada(1);
    assert.equal((await asociarInvitada(supabase, { invitadaId: INV(1), codigo: 'NOEXISTE', ahora: AHORA })).resultado, 'codigo_invalido');
    assert.equal((await asociarInvitada(supabase, { invitadaId: INVITADOR, codigo: 'CAMI4K', ahora: AHORA })).resultado, 'propio');
    nuevaInvitada(2, { created_at: hace(45) });
    assert.equal((await asociarInvitada(supabase, { invitadaId: INV(2), codigo: 'CAMI4K', ahora: AHORA })).resultado, 'cuenta_vieja');
    assert.equal(tablas.referido.length, 0);
  });

  test('no cuenta a quien se registró después de la fecha de corte', async () => {
    nuevaInvitada(1, { created_at: '2027-01-02T12:00:00Z' });
    const r = await asociarInvitada(supabase, { invitadaId: INV(1), codigo: 'CAMI4K', ahora: new Date('2027-01-03T00:00:00Z') });
    assert.equal(r.resultado, 'promo_cerrada');
  });

  test('descarta mail descartable y la misma casilla de Gmail que el invitador', async () => {
    nuevaInvitada(1, { email: 'x@mailinator.com' });
    nuevaInvitada(2, { email: 'Camilo.Silva+2@gmail.com' });
    assert.equal((await asociarInvitada(supabase, { invitadaId: INV(1), codigo: 'CAMI4K', ahora: AHORA })).resultado, 'descartada');
    assert.equal((await asociarInvitada(supabase, { invitadaId: INV(2), codigo: 'CAMI4K', ahora: AHORA })).resultado, 'descartada');
    assert.deepEqual(tablas.referido.map(r => r.motivo_descarte), ['mail_descartable', 'mismo_mail_que_invitador']);
  });

  test('descarta la misma casilla repetida entre invitadas del mismo invitador', async () => {
    nuevaInvitada(1, { email: 'ana.p@gmail.com' });
    nuevaInvitada(2, { email: 'anap+otra@gmail.com' });
    await asociarInvitada(supabase, { invitadaId: INV(1), codigo: 'CAMI4K', ahora: AHORA });
    const r = await asociarInvitada(supabase, { invitadaId: INV(2), codigo: 'CAMI4K', ahora: AHORA });
    assert.equal(r.resultado, 'descartada');
    assert.equal(tablas.referido[1].motivo_descarte, 'mail_repetido');
  });

  test('si ya había comparado antes de asociarse (ahorro_registro), queda válida al toque', async () => {
    nuevaInvitada(1);
    tablas.ahorro_registro.push({ usuario_id: INV(1), fecha: hace(0.5), monto: 0 });
    const r = await asociarInvitada(supabase, { invitadaId: INV(1), codigo: 'CAMI4K', ahora: AHORA });
    assert.equal(r.validacion, 'valida');
    assert.equal(tablas.referido[0].estado, 'valida');
  });
});

describe('primera comparación y premio', () => {
  async function asociarYComparar(n, ahora = AHORA) {
    nuevaInvitada(n);
    await asociarInvitada(supabase, { invitadaId: INV(n), codigo: 'CAMI4K', ahora: AHORA });
    return registrarComparacion(supabase, INV(n), ahora);
  }

  test('la primera comparación la valida', async () => {
    const r = await asociarYComparar(1);
    assert.equal(r.resultado, 'valida');
    assert.equal(r.premio, 'faltan');
    assert.equal(tablas.referido[0].estado, 'valida');
    assert.equal(tablas.referido[0].primera_comparacion_en, AHORA.toISOString());
  });

  test('con la tercera válida se otorga el premio, una sola vez', async () => {
    await asociarYComparar(1);
    await asociarYComparar(2);
    const tercera = await asociarYComparar(3);
    assert.equal(tercera.premio, 'otorgado');
    assert.deepEqual(supabase.premiosOtorgados, [INVITADOR]);
    const cuarta = await asociarYComparar(4);
    assert.equal(cuarta.premio, 'ya_tenia');
  });

  test('una comparación fuera de los 30 días la deja expirada', async () => {
    const r = await asociarYComparar(1, new Date(AHORA.getTime() + 31 * DIA));
    assert.equal(r.resultado, 'expirada');
    assert.equal(tablas.referido[0].estado, 'expirada');
  });

  test('sin mail confirmado sigue pendiente (y se reintenta en la próxima comparación)', async () => {
    nuevaInvitada(1, { email_confirmed_at: null });
    await asociarInvitada(supabase, { invitadaId: INV(1), codigo: 'CAMI4K', ahora: AHORA });
    assert.equal((await registrarComparacion(supabase, INV(1), AHORA)).resultado, 'sin_mail_confirmado');
    usuarios[INV(1)].email_confirmed_at = AHORA.toISOString();
    assert.equal((await registrarComparacion(supabase, INV(1), AHORA)).resultado, 'valida');
  });

  test('las comparaciones siguientes no vuelven a consultar la base', async () => {
    await asociarYComparar(1);
    let consultas = 0;
    const from = supabase.from;
    supabase.from = n => { consultas++; return from(n); };
    assert.equal((await registrarComparacion(supabase, INV(1), AHORA)).resultado, 'sin_pendiente');
    assert.equal(consultas, 0);
  });

  test('un usuario que no es invitada no hace nada', async () => {
    assert.equal((await registrarComparacion(supabase, INVITADOR, AHORA)).resultado, 'sin_pendiente');
  });
});

describe('estado para la pantalla', () => {
  test('resume progreso y vence a las pendientes viejas', async () => {
    nuevaInvitada(1, { nombre: 'Martina López' });
    nuevaInvitada(2, { created_at: hace(20) });
    await asociarInvitada(supabase, { invitadaId: INV(1), codigo: 'CAMI4K', ahora: AHORA });
    await asociarInvitada(supabase, { invitadaId: INV(2), codigo: 'CAMI4K', ahora: AHORA });
    await registrarComparacion(supabase, INV(1), AHORA);

    const estado = await estadoDelUsuario(supabase, INVITADOR, new Date(AHORA.getTime() + 15 * DIA));
    assert.equal(estado.codigo, 'CAMI4K');
    assert.equal(estado.link, 'https://superahorro.com.ar/?ref=CAMI4K');
    assert.equal(estado.validas, 1);
    assert.deepEqual(estado.invitadas.map(i => i.estado), ['valida', 'expirada']);
    assert.deepEqual(estado.invitadas.map(i => i.nombre), ['Martina', null]);
    assert.equal('invitada_id' in estado.invitadas[0], false);
    assert.equal(estado.invitadasNecesarias, 3);
    assert.equal(estado.premio, null);
    assert.equal(estado.motivoNoAplica, null);
    assert.equal(estado.promoVigente, true);
  });
});
