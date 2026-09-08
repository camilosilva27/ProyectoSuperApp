/**
 * Resumen mensual de ahorro (ver .claude/docs/mails_y_notificaciones.md, tipo #3). Manda, el
 * primer día de cada mes, cuánto ahorró cada usuario durante el mes anterior según
 * `ahorro_registro` (Fase B, historial de ahorro).
 *
 * A diferencia del resumen semanal (todavía sin implementar), este se manda SIEMPRE que el
 * usuario sea elegible, aunque el ahorro del mes haya sido $0 o no haya comparado nada — es un
 * resumen periódico, no una alerta de logro.
 *
 * Elegibilidad: se excluye a quien está en plan 'gratis' desde hace más de 30 días (decisión
 * tomada en la conversación de diseño: alguien que cayó del trial hace 2 días todavía tiene
 * sentido que reciba el resumen de lo que ahorró mientras tuvo acceso; alguien bloqueado hace
 * meses, no). Ver la columna `plan_bajado_a_gratis_en` (migración 0013) y su trigger.
 *
 * Uso: node src/cron/resumenMensualAhorro.js   (o npm run resumen-mensual-ahorro)
 * Crontab sugerido en la VM (día 1 de cada mes, 13:00 UTC = 10:00 Argentina):
 *   0 13 1 * * cd /ruta/ProyectoSuperApp/backend && /usr/bin/node src/cron/resumenMensualAhorro.js >> logs/cron-resumen-mensual-ahorro.log 2>&1
 * Este archivo de crontab vive en la VM, no en el repo — mismo criterio que los demás crons.
 */

const fs = require('fs');
const path = require('path');
const { rutaLogs } = require('../config');
const { clienteSupabaseAdmin } = require('../clienteSupabaseAdmin');
const { listarTodosLosUsuarios } = require('../usuariosAuth');
const { enviarMail } = require('../clienteBrevo');

const TREINTA_DIAS_MS = 30 * 24 * 60 * 60 * 1000;

// Separado para poder testear la elegibilidad sin pegarle a la red.
function esElegible(perfil, ahora) {
  if (perfil.plan !== 'gratis') return true;
  if (!perfil.plan_bajado_a_gratis_en) return false; // desconocido: se trata como bloqueado hace rato
  return ahora - new Date(perfil.plan_bajado_a_gratis_en).getTime() < TREINTA_DIAS_MS;
}

function formatoArs(monto) {
  return monto.toLocaleString('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });
}

// Color "oferta" real de la app (theme.ts) — el mismo amarillo de cartel de oferta que usa
// para marcar ahorro en la UI, no un color inventado para el mail.
const AMARILLO_OFERTA = '#FFD400';

function armarHtml({ nombre, nombreMes, monto, cantidad }) {
  const saludo = nombre ? `Hola ${nombre},` : 'Hola,';
  return `
    <p>${saludo}</p>
    <p>Esto ahorraste en <strong>${nombreMes}</strong> con Super App:</p>
    <p>
      <span style="display: inline-block; background: ${AMARILLO_OFERTA}; color: #1B2420; padding: 6px 14px; border-radius: 6px; font-size: 1.4em; font-weight: bold;">${formatoArs(monto)}</span>
    </p>
    <p>ahorrados en ${cantidad} comparaci${cantidad === 1 ? 'ón' : 'ones'} de precios.</p>
    <p>Seguí usando Super App para seguir ahorrando!</p>
  `;
}

async function resumenMensualAhorro() {
  const inicio = new Date();
  console.log(`\n💰 Resumen mensual de ahorro — ${inicio.toLocaleString('es-AR')}`);

  const errores = [];
  let enviados = 0;
  let omitidos = 0;

  const cliente = clienteSupabaseAdmin();
  if (!cliente) {
    errores.push('Falta SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY — no se pudo correr el resumen');
    console.error(`   ❌ ${errores[0]}`);
  } else {
    const inicioMesActual = new Date(Date.UTC(inicio.getUTCFullYear(), inicio.getUTCMonth(), 1));
    const inicioMesAnterior = new Date(Date.UTC(inicio.getUTCFullYear(), inicio.getUTCMonth() - 1, 1));
    // "agosto 2026", sin el "de" que agrega el formato largo de Intl por default.
    const nombreMes = `${inicioMesAnterior.toLocaleString('es-AR', { month: 'long', timeZone: 'UTC' })} ${inicioMesAnterior.getUTCFullYear()}`;

    const [{ data: perfiles, error: errorPerfiles }, { data: eventos, error: errorEventos }, usuarios] =
      await Promise.all([
        cliente.from('perfil_usuario').select('id, nombre, plan, plan_bajado_a_gratis_en'),
        cliente
          .from('ahorro_registro')
          .select('usuario_id, monto')
          .gte('fecha', inicioMesAnterior.toISOString())
          .lt('fecha', inicioMesActual.toISOString()),
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
          omitidos++;
          continue;
        }
        const email = emailPorId.get(perfil.id);
        if (!email) {
          errores.push(`Usuario ${perfil.id} sin mail en auth.users — omitido`);
          continue;
        }
        const { monto, cantidad } = agregadoPorUsuario.get(perfil.id) ?? { monto: 0, cantidad: 0 };
        const resultado = await enviarMail({
          destinatarioEmail: email,
          destinatarioNombre: perfil.nombre,
          asunto: `Esto ahorraste en ${nombreMes} con Super App`,
          html: armarHtml({ nombre: perfil.nombre, nombreMes, monto, cantidad }),
        });
        if (resultado.ok) enviados++;
        else errores.push(`Falló el mail a ${email}: ${resultado.error}`);
      }
    }
  }

  const reporte = { inicio: inicio.toISOString(), fin: new Date().toISOString(), enviados, omitidos, errores };

  fs.mkdirSync(rutaLogs, { recursive: true });
  fs.writeFileSync(path.join(rutaLogs, 'ultimo-resumen-mensual-ahorro.json'), JSON.stringify(reporte, null, 2));

  console.log(`   ✅ ${enviados} enviados, ${omitidos} omitidos (plan gratis hace +30 días), ${errores.length} con error`);

  return reporte;
}

if (require.main === module) {
  resumenMensualAhorro()
    .then(r => process.exit(r.errores.length ? 1 : 0))
    .catch(err => {
      console.error('❌ Error fatal en el resumen mensual de ahorro:', err);
      process.exit(1);
    });
}

module.exports = { resumenMensualAhorro, esElegible };
