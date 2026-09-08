/**
 * Resumen semanal de ahorro (ver .claude/docs/mails_y_notificaciones.md, tipo #4). A diferencia
 * del mensual, es CONDICIONAL: solo se manda si el ahorro de los últimos 7 días fue > $0 — evita
 * mandarle "ahorraste $0 esta semana" a quien no comparó nada.
 *
 * Ventana rolling de 7 días (no un lunes-a-domingo calendario) — a diferencia del mensual, acá
 * no hace falta alinear con ningún corte que la app le muestre al usuario (Ahorros no tiene un
 * concepto de "semana"), así que no hay bug de timezone posible por límite de calendario.
 *
 * Misma elegibilidad que el mensual (excluye plan 'gratis' hace +30 días) — reusada de ahí, no
 * duplicada.
 *
 * Uso: node src/cron/resumenSemanalAhorro.js   (o npm run resumen-semanal-ahorro)
 * Crontab sugerido en la VM (lunes, 15:00 UTC = 12:00 Argentina — distinto de
 * recordatorioSemanal, que ya usa los lunes 13:00 UTC):
 *   0 15 * * 1 cd /ruta/ProyectoSuperApp/backend && /usr/bin/node src/cron/resumenSemanalAhorro.js >> logs/cron-resumen-semanal-ahorro.log 2>&1
 * Este archivo de crontab vive en la VM, no en el repo — mismo criterio que los demás crons.
 */

const fs = require('fs');
const path = require('path');
const { rutaLogs } = require('../config');
const { clienteSupabaseAdmin } = require('../clienteSupabaseAdmin');
const { listarTodosLosUsuarios } = require('../usuariosAuth');
const { enviarMail } = require('../clienteBrevo');
const { armarMailBase, COLOR_ACENTO, COLOR_ACENTO_SUAVE, COLOR_TEXTO, URL_APP } = require('../plantillaMail');
const { esElegible } = require('./resumenMensualAhorro');

const SIETE_DIAS_MS = 7 * 24 * 60 * 60 * 1000;

function formatoArs(monto) {
  return monto.toLocaleString('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });
}

function armarHtml({ nombre, monto, cantidad }) {
  const saludo = nombre ? `Hola ${nombre},` : 'Hola,';
  const cuerpo = `
    <p style="margin:0 0 16px 0;">${saludo}</p>
    <p style="margin:0 0 16px 0;">Esto ahorraste esta semana con Super App:</p>
    <p style="margin:0 0 16px 0; text-align:center;">
      <span style="display:inline-block; background:${COLOR_ACENTO_SUAVE}; border:2px solid ${COLOR_ACENTO}; color:${COLOR_TEXTO}; padding:6px 16px; border-radius:8px; font-size:1.5em; font-weight:700;">${formatoArs(monto)}</span>
    </p>
    <p style="margin:0 0 16px 0;">ahorrados en ${cantidad} comparaci${cantidad === 1 ? 'ón' : 'ones'} de precios.</p>
    <p style="margin:0;">Seguí usando Super App para seguir ahorrando!</p>
  `;
  return armarMailBase({
    preheader: 'Esto ahorraste esta semana con Super App.',
    titulo: 'Tu resumen de la semana',
    cuerpoHtml: cuerpo,
    cta: { texto: 'Ver mi historial de ahorro', url: `${URL_APP}/ahorros` },
  });
}

async function resumenSemanalAhorro() {
  const inicio = new Date();
  console.log(`\n💰 Resumen semanal de ahorro — ${inicio.toLocaleString('es-AR')}`);

  const errores = [];
  let enviados = 0;
  let omitidosSinAhorro = 0;
  let omitidosPlan = 0;

  const cliente = clienteSupabaseAdmin();
  if (!cliente) {
    errores.push('Falta SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY — no se pudo correr el resumen');
    console.error(`   ❌ ${errores[0]}`);
  } else {
    const haceUnaSemana = new Date(inicio.getTime() - SIETE_DIAS_MS);

    const [{ data: perfiles, error: errorPerfiles }, { data: eventos, error: errorEventos }, usuarios] =
      await Promise.all([
        cliente.from('perfil_usuario').select('id, nombre, plan, plan_bajado_a_gratis_en'),
        cliente.from('ahorro_registro').select('usuario_id, monto').gte('fecha', haceUnaSemana.toISOString()),
        listarTodosLosUsuarios(cliente).catch(err => {
          errores.push(`No se pudo listar usuarios: ${err.message}`);
          return [];
        }),
      ]);

    if (errorPerfiles) errores.push(`No se pudo leer perfil_usuario: ${errorPerfiles.message}`);
    if (errorEventos) errores.push(`No se pudo leer ahorro_registro: ${errorEventos.message}`);

    if (!errorPerfiles && !errorEventos) {
      const emailPorId = new Map(usuarios.map(u => [u.id, u.email]));
      const agregadoPorUsuario = new Map();
      for (const evento of eventos ?? []) {
        const actual = agregadoPorUsuario.get(evento.usuario_id) ?? { monto: 0, cantidad: 0 };
        actual.monto += Number(evento.monto) || 0;
        actual.cantidad += 1;
        agregadoPorUsuario.set(evento.usuario_id, actual);
      }

      for (const perfil of perfiles ?? []) {
        if (!esElegible(perfil, inicio.getTime())) {
          omitidosPlan++;
          continue;
        }
        const { monto, cantidad } = agregadoPorUsuario.get(perfil.id) ?? { monto: 0, cantidad: 0 };
        if (monto <= 0) {
          omitidosSinAhorro++;
          continue;
        }
        const email = emailPorId.get(perfil.id);
        if (!email) {
          errores.push(`Usuario ${perfil.id} sin mail en auth.users — omitido`);
          continue;
        }
        const resultado = await enviarMail({
          destinatarioEmail: email,
          destinatarioNombre: perfil.nombre,
          asunto: 'Esto ahorraste esta semana con Super App',
          html: armarHtml({ nombre: perfil.nombre, monto, cantidad }),
        });
        if (resultado.ok) enviados++;
        else errores.push(`Falló el mail a ${email}: ${resultado.error}`);
      }
    }
  }

  const reporte = { inicio: inicio.toISOString(), fin: new Date().toISOString(), enviados, omitidosSinAhorro, omitidosPlan, errores };

  fs.mkdirSync(rutaLogs, { recursive: true });
  fs.writeFileSync(path.join(rutaLogs, 'ultimo-resumen-semanal-ahorro.json'), JSON.stringify(reporte, null, 2));

  console.log(`   ✅ ${enviados} enviados, ${omitidosSinAhorro} omitidos (sin ahorro), ${omitidosPlan} omitidos (plan gratis hace +30 días), ${errores.length} con error`);

  return reporte;
}

if (require.main === module) {
  resumenSemanalAhorro()
    .then(r => process.exit(r.errores.length ? 1 : 0))
    .catch(err => {
      console.error('❌ Error fatal en el resumen semanal de ahorro:', err);
      process.exit(1);
    });
}

module.exports = { resumenSemanalAhorro, armarHtml };
