/**
 * Mail "¿Por qué no seguiste?" (mailFeedbackTrial.js; ver .claude/docs/mails_y_notificaciones.md):
 * a quien se le venció la prueba gratis sin pagar, DIAS_DESPUES días después de caer a 'gratis'.
 *
 * Elegibilidad (decidida con el usuario 2026-11-04):
 * - plan 'gratis' viniendo de 'trial' (`plan_anterior_a_gratis`, migración 0034) — no a quien
 *   pagó y canceló.
 * - cayó a gratis hace entre DIAS_DESPUES y DIAS_MAXIMO días. El tope evita que, el día que se
 *   activa el cron, les llegue a todos los vencidos de hace meses; el margen (no un día exacto)
 *   cubre días en que el cron no corrió.
 * - mail confirmado y nunca se le mandó (`mail_feedback_trial_enviado_en`). NO mira la baja de
 *   mails no transaccionales: decisión explícita del usuario (2026-11-04), le llega igual.
 *
 * `--sin-tope`: ignora la ventana de días (incluye a quien venció hace meses, e incluso antes de
 * que existiera `plan_bajado_a_gratis_en`). Para la corrida única del lanzamiento (2026-11-04,
 * decisión del usuario: "al menos por esta vez, ya que nunca les llegó"); el crontab diario va SIN
 * este flag. Igual se manda una sola vez por persona.
 * - Solo mail, sin push: el push equivalente quedó "a definir".
 *
 * No hace falta excluir a estas personas del aviso de inactividad: ese cron ya saltea a quien no
 * tiene plan activo (`tienePlanActivo` en usuariosAuth.js), y alguien con la prueba vencida no lo tiene.
 *
 * Sin BAJA_MAILS_SECRET no se manda (los botones necesitan el token): queda en el reporte.
 *
 * Uso: node src/cron/feedbackTrialVencido.js   (o npm run feedback-trial-vencido)
 * Crontab sugerido en la VM (diario, 12:30 UTC = 9:30 Argentina, después del aviso de fin de trial):
 *   30 12 * * * cd /ruta/ProyectoSuperApp/backend && /usr/bin/node src/cron/feedbackTrialVencido.js >> logs/cron-feedback-trial-vencido.log 2>&1
 */

const fs = require('fs');
const path = require('path');
const config = require('../config');
const { clienteSupabaseAdmin } = require('../clienteSupabaseAdmin');
const { listarTodosLosUsuarios, leerTodasLasFilas } = require('../usuariosAuth');
const { enviarMail } = require('../clienteBrevo');
const { MAIL_CONTACTO } = require('../plantillaMail');
const { armarHtml, ASUNTO } = require('../mailFeedbackTrial');

const DIA_MS = 24 * 60 * 60 * 1000;
const DIAS_DESPUES = 3;
const DIAS_MAXIMO = 10;

// Separado para testear sin red.
function esElegible(perfil, ahora, { sinTope = false } = {}) {
  if (perfil.plan !== 'gratis' || perfil.plan_anterior_a_gratis !== 'trial') return false;
  if (perfil.mail_feedback_trial_enviado_en) return false;
  if (sinTope) return true;
  if (!perfil.plan_bajado_a_gratis_en) return false;
  const dias = (ahora - new Date(perfil.plan_bajado_a_gratis_en).getTime()) / DIA_MS;
  return dias >= DIAS_DESPUES && dias <= DIAS_MAXIMO;
}

async function feedbackTrialVencido({ sinTope = false } = {}) {
  const inicio = new Date();
  console.log(`\n💬 Mail "¿Por qué no seguiste?" — ${inicio.toLocaleString('es-AR')}${sinTope ? ' (sin tope de días)' : ''}`);

  const errores = [];
  let enviados = 0;

  const cliente = clienteSupabaseAdmin();
  if (!cliente) {
    errores.push('Falta SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY — no se pudo correr');
  } else if (!config.bajaMailsSecret) {
    errores.push('Falta BAJA_MAILS_SECRET — los botones del mail necesitan el token, no se manda nada');
  } else {
    const [{ data: perfiles, error: errorPerfiles }, usuarios] = await Promise.all([
      leerTodasLasFilas(() =>
        cliente
          .from('perfil_usuario')
          .select('id, nombre, plan, plan_anterior_a_gratis, plan_bajado_a_gratis_en, mail_feedback_trial_enviado_en')
          .eq('plan', 'gratis')
          .order('id')
      ),
      listarTodosLosUsuarios(cliente).catch(err => {
        errores.push(`No se pudo listar usuarios: ${err.message}`);
        return [];
      }),
    ]);

    if (errorPerfiles) {
      errores.push(`No se pudo leer perfil_usuario: ${errorPerfiles.message}`);
    } else {
      const usuarioPorId = new Map(usuarios.map(u => [u.id, u]));

      for (const perfil of (perfiles ?? []).filter(p => esElegible(p, inicio.getTime(), { sinTope }))) {
        const usuario = usuarioPorId.get(perfil.id);
        if (!usuario?.emailConfirmado) continue;
        if (!usuario.email) {
          errores.push(`Usuario ${perfil.id} sin mail en auth.users — omitido`);
          continue;
        }

        // Ahorro total: todo su historial es de la prueba (nunca pagó).
        const { data: eventos, error: errorAhorro } = await leerTodasLasFilas(() =>
          cliente.from('ahorro_registro').select('monto').eq('usuario_id', perfil.id).order('id')
        );
        if (errorAhorro) errores.push(`No se pudo leer el ahorro de ${perfil.id} (se manda sin esa línea): ${errorAhorro.message}`);
        const ahorroTotal = (eventos ?? []).reduce((s, e) => s + (Number(e.monto) || 0), 0);

        const resultado = await enviarMail({
          destinatarioEmail: usuario.email,
          destinatarioNombre: perfil.nombre,
          asunto: ASUNTO,
          html: armarHtml({ nombre: perfil.nombre, usuarioId: perfil.id, ahorroTotal }),
          responderA: MAIL_CONTACTO,
        });
        if (!resultado.ok) {
          errores.push(`Falló el mail al usuario ${perfil.id}: ${resultado.error}`);
          continue; // sin marcar: se reintenta mañana (dentro de la ventana de DIAS_MAXIMO)
        }
        enviados++;
        const { error: errorUpdate } = await cliente
          .from('perfil_usuario')
          .update({ mail_feedback_trial_enviado_en: new Date().toISOString() })
          .eq('id', perfil.id);
        if (errorUpdate) errores.push(`Mail a ${perfil.id} enviado pero no se pudo marcar: ${errorUpdate.message}`);
      }
    }
  }

  errores.forEach(e => console.error(`   ❌ ${e}`));
  const reporte = { inicio: inicio.toISOString(), fin: new Date().toISOString(), enviados, errores };
  fs.mkdirSync(config.rutaLogs, { recursive: true });
  fs.writeFileSync(path.join(config.rutaLogs, 'ultimo-feedback-trial-vencido.json'), JSON.stringify(reporte, null, 2));
  console.log(`   ✅ ${enviados} mails, ${errores.length} con error`);
  return reporte;
}

if (require.main === module) {
  feedbackTrialVencido({ sinTope: process.argv.includes('--sin-tope') })
    .then(r => process.exit(r.errores.length ? 1 : 0))
    .catch(err => {
      console.error('❌ Error fatal en el mail de feedback de trial vencido:', err);
      process.exit(1);
    });
}

module.exports = { feedbackTrialVencido, esElegible, DIAS_DESPUES, DIAS_MAXIMO };
