/**
 * Resumen mensual de ahorro (ver .claude/docs/mails_y_notificaciones.md, tipo #3). Manda, el
 * primer día de cada mes, cuánto ahorró cada usuario durante el mes anterior según
 * `ahorro_registro` (Fase B, historial de ahorro).
 *
 * Igual que el resumen semanal: solo se manda si el ahorro del mes fue > $0 (decidido el
 * 2026-09-08, cambio respecto de la versión original de este cron, que lo mandaba siempre).
 *
 * Elegibilidad: se excluye a quien está en plan 'gratis' desde hace más de 30 días (decisión
 * tomada en la conversación de diseño: alguien que cayó del trial hace 2 días todavía tiene
 * sentido que reciba el resumen de lo que ahorró mientras tuvo acceso; alguien bloqueado hace
 * meses, no). Ver la columna `plan_bajado_a_gratis_en` (migración 0013) y su trigger.
 *
 * Idempotente por (usuario, mes) vía la tabla `envio_mail_periodico` (migración 0026,
 * auditoría 2026-09-24): antes, re-correr el cron duplicaba mails y push. Ver
 * `reclamarEnvio`/`liberarEnvio` abajo (los reusa también el resumen semanal). Las lecturas de
 * perfil_usuario y ahorro_registro van paginadas (PostgREST corta en 1000 filas sin avisar).
 * Mail NO transaccional: lleva header List-Unsubscribe + pie de baja; no se manda mail a quien se
 * dio de baja (`mails_no_transaccionales = false`, migración 0027), el push sí.
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
const { listarTodosLosUsuarios, leerTodasLasFilas } = require('../usuariosAuth');
const { enviarMail } = require('../clienteBrevo');
const { armarMailBase, escaparHtml, COLOR_ACENTO, COLOR_ACENTO_SUAVE, COLOR_TEXTO, URL_APP } = require('../plantillaMail');
const { obtenerSuscripcionesPorUsuario, enviarPush } = require('../clientePush');

const TREINTA_DIAS_MS = 30 * 24 * 60 * 60 * 1000;

// Separado para poder testear la elegibilidad sin pegarle a la red.
function esElegible(perfil, ahora) {
  if (perfil.plan !== 'gratis') return true;
  if (!perfil.plan_bajado_a_gratis_en) return false; // desconocido: se trata como bloqueado hace rato
  return ahora - new Date(perfil.plan_bajado_a_gratis_en).getTime() < TREINTA_DIAS_MS;
}

/**
 * "Reclama" el envío de (usuario, tipo, periodo) insertando en envio_mail_periodico ANTES de
 * mandar. Si la fila ya existía (23505 = unique_violation), otro run ya lo mandó → false.
 * @returns {Promise<{reclamado: boolean, error?: string}>}
 */
async function reclamarEnvio(cliente, usuarioId, tipo, periodo) {
  const { error } = await cliente.from('envio_mail_periodico').insert({ usuario_id: usuarioId, tipo, periodo });
  if (!error) return { reclamado: true };
  if (error.code === '23505') return { reclamado: false };
  return { reclamado: false, error: error.message };
}

// Si el resumen no llegó por NINGÚN canal (mail falló y 0 push entregados), se suelta el reclamo
// para que una re-corrida lo reintente; si llegó por alguno, queda marcado (no se duplica).
async function liberarEnvio(cliente, usuarioId, tipo, periodo) {
  const { error } = await cliente
    .from('envio_mail_periodico')
    .delete()
    .eq('usuario_id', usuarioId)
    .eq('tipo', tipo)
    .eq('periodo', periodo);
  return error ? error.message : null;
}

function formatoArs(monto) {
  return monto.toLocaleString('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 });
}

function armarHtml({ nombre, nombreMes, monto, cantidad, usuarioId }) {
  const saludo = nombre ? `Hola ${escaparHtml(nombre)},` : 'Hola,';
  const cuerpo = `
    <p style="margin:0 0 16px 0;">${saludo}</p>
    <p style="margin:0 0 16px 0;">Esto ahorraste en <strong>${escaparHtml(nombreMes)}</strong> con SuperAhorro:</p>
    <p style="margin:0 0 16px 0; text-align:center;">
      <span style="display:inline-block; background:${COLOR_ACENTO_SUAVE}; border:2px solid ${COLOR_ACENTO}; color:${COLOR_TEXTO}; padding:6px 16px; border-radius:8px; font-size:1.5em; font-weight:700;">${formatoArs(monto)}</span>
    </p>
    <p style="margin:0 0 16px 0;">ahorrados en ${escaparHtml(cantidad)} comparaci${cantidad === 1 ? 'ón' : 'ones'} de precios.</p>
    <p style="margin:0;">Seguí usando SuperAhorro para seguir ahorrando!</p>
  `;
  return armarMailBase({
    preheader: `Esto ahorraste en ${nombreMes} con SuperAhorro.`,
    titulo: 'Tu resumen del mes',
    cuerpoHtml: cuerpo,
    cta: { texto: 'Ver mi historial de ahorro', url: `${URL_APP}/mis-ahorros` },
    noTransaccional: true,
    usuarioId,
  });
}

async function resumenMensualAhorro() {
  const inicio = new Date();
  console.log(`\n💰 Resumen mensual de ahorro — ${inicio.toLocaleString('es-AR')}`);

  const errores = [];
  let enviados = 0;
  let enviadosPush = 0;
  let omitidos = 0;
  let omitidosYaEnviado = 0;
  let omitidosBaja = 0;

  const cliente = clienteSupabaseAdmin();
  if (!cliente) {
    errores.push('Falta SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY — no se pudo correr el resumen');
    console.error(`   ❌ ${errores[0]}`);
  } else {
    // "El mes" tiene que cortar en el mismo lugar que la pantalla Ahorros (historialAhorro.tsx,
    // calcularResumenAhorro), que agrupa con new Date(evento.fecha).getMonth() en el reloj del
    // DISPOSITIVO (Argentina) — no en UTC. Bug real encontrado el 2026-09-08: con límites en UTC
    // puro, el corte de mes queda corrido hasta 3hs respecto de lo que el usuario ve en la app.
    // Argentina no tiene horario de verano, así que un offset fijo de -3 es seguro (no hace
    // falta una librería de timezones para esto).
    const OFFSET_ARGENTINA_HORAS = 3;
    const ahoraEnArgentina = new Date(inicio.getTime() - OFFSET_ARGENTINA_HORAS * 60 * 60 * 1000);
    const inicioDeMesArgentina = (anio, mesIdx) =>
      new Date(Date.UTC(anio, mesIdx, 1, OFFSET_ARGENTINA_HORAS, 0, 0));

    const inicioMesActual = inicioDeMesArgentina(ahoraEnArgentina.getUTCFullYear(), ahoraEnArgentina.getUTCMonth());
    const inicioMesAnterior = inicioDeMesArgentina(ahoraEnArgentina.getUTCFullYear(), ahoraEnArgentina.getUTCMonth() - 1);
    // "agosto 2026", sin el "de" que agrega el formato largo de Intl por default.
    // Clave de idempotencia: el mes RESUMIDO ('2026-08'), no el de la corrida.
    const periodo = `${inicioMesAnterior.getUTCFullYear()}-${String(inicioMesAnterior.getUTCMonth() + 1).padStart(2, '0')}`;
    const nombreMes = `${inicioMesAnterior.toLocaleString('es-AR', { month: 'long', timeZone: 'America/Argentina/Buenos_Aires' })} ${inicioMesAnterior.getUTCFullYear()}`;

    const [{ data: perfiles, error: errorPerfiles }, { data: eventos, error: errorEventos }, usuarios, suscripcionesPush] =
      await Promise.all([
        leerTodasLasFilas(() =>
          cliente.from('perfil_usuario').select('id, nombre, plan, plan_bajado_a_gratis_en, mails_no_transaccionales').order('id')
        ),
        leerTodasLasFilas(() =>
          cliente
            .from('ahorro_registro')
            .select('usuario_id, monto')
            .gte('fecha', inicioMesAnterior.toISOString())
            .lt('fecha', inicioMesActual.toISOString())
            .order('id')
        ),
        listarTodosLosUsuarios(cliente).catch(err => {
          errores.push(`No se pudo listar usuarios: ${err.message}`);
          return [];
        }),
        obtenerSuscripcionesPorUsuario(cliente).catch(err => {
          errores.push(`No se pudo leer push_suscripcion: ${err.message}`);
          return new Map();
        }),
      ]);

    if (errorPerfiles) errores.push(`No se pudo leer perfil_usuario: ${errorPerfiles.message}`);
    if (errorEventos) errores.push(`No se pudo leer ahorro_registro: ${errorEventos.message}`);

    if (!errorPerfiles && !errorEventos) {
      const emailPorId = new Map(usuarios.map(u => [u.id, u.email]));
      const confirmadoPorId = new Map(usuarios.map(u => [u.id, u.emailConfirmado]));
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
        if (!confirmadoPorId.get(perfil.id)) {
          omitidos++;
          continue;
        }
        const { monto, cantidad } = agregadoPorUsuario.get(perfil.id) ?? { monto: 0, cantidad: 0 };
        if (monto <= 0) {
          omitidos++;
          continue;
        }
        // Dado de baja de mails no transaccionales (routes/bajaMails.js): no se le manda el mail,
        // pero el push sigue (se maneja aparte). Sin push suscripto no hay nada que mandarle.
        const quiereMail = perfil.mails_no_transaccionales !== false;
        const suscripciones = suscripcionesPush.get(perfil.id) ?? [];
        if (!quiereMail && suscripciones.length === 0) {
          omitidosBaja++;
          continue;
        }
        const email = emailPorId.get(perfil.id);
        if (quiereMail && !email) {
          errores.push(`Usuario ${perfil.id} sin mail en auth.users — omitido`);
          continue;
        }
        const reclamo = await reclamarEnvio(cliente, perfil.id, 'resumen_mensual', periodo);
        if (reclamo.error) {
          errores.push(`No se pudo marcar el resumen del usuario ${perfil.id}: ${reclamo.error} — omitido`);
          continue;
        }
        if (!reclamo.reclamado) {
          omitidosYaEnviado++;
          continue;
        }
        const resultado = quiereMail
          ? await enviarMail({
            destinatarioEmail: email,
            destinatarioNombre: perfil.nombre,
            asunto: `Esto ahorraste en ${nombreMes} con SuperAhorro`,
            html: armarHtml({ nombre: perfil.nombre, nombreMes, monto, cantidad, usuarioId: perfil.id }),
            noTransaccional: true,
            usuarioId: perfil.id,
          })
          : { ok: false, omitidoPorBaja: true };
        if (resultado.ok) enviados++;
        else if (resultado.omitidoPorBaja) omitidosBaja++;
        else errores.push(`Falló el mail al usuario ${perfil.id}: ${resultado.error}`);

        const resultadoPush = await enviarPush(cliente, suscripciones, {
          title: 'SuperAhorro',
          body: `Esto ahorraste en ${nombreMes}: ${formatoArs(monto)}`,
          url: `${URL_APP}/mis-ahorros`,
        });
        if (!resultado.ok && resultadoPush.enviados === 0) {
          const errorLiberar = await liberarEnvio(cliente, perfil.id, 'resumen_mensual', periodo);
          if (errorLiberar) errores.push(`No se pudo liberar el reclamo del usuario ${perfil.id}: ${errorLiberar}`);
        }
        enviadosPush += resultadoPush.enviados;
        errores.push(...resultadoPush.errores);
      }
    }
  }

  const reporte = { inicio: inicio.toISOString(), fin: new Date().toISOString(), enviados, enviadosPush, omitidos, omitidosYaEnviado, omitidosBaja, errores };

  fs.mkdirSync(rutaLogs, { recursive: true });
  fs.writeFileSync(path.join(rutaLogs, 'ultimo-resumen-mensual-ahorro.json'), JSON.stringify(reporte, null, 2));

  console.log(`   ✅ ${enviados} mails, ${enviadosPush} push, ${omitidos} omitidos (plan gratis hace +30 días, mail sin confirmar o sin ahorro), ${omitidosYaEnviado} ya enviados este período, ${omitidosBaja} mails omitidos (dados de baja), ${errores.length} con error`);

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

module.exports = { resumenMensualAhorro, esElegible, armarHtml, reclamarEnvio, liberarEnvio };
