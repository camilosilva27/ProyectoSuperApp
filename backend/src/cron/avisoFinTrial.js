/**
 * Aviso de fin de trial (ver .claude/docs/mails_y_notificaciones.md, tipo #5). Manda un mail
 * a quien le quedan 3 días o menos de trial y todavía no pagó, para que no lo agarre de
 * sorpresa el paywall (PaywallFinTrial.tsx). Alcance acotado a propósito (decidido en la
 * conversación de diseño): solo fin de trial, no renovación de una suscripción activa — ese es
 * un caso menos urgente que se puede sumar después sin tocar este archivo.
 *
 * Idempotente vía `aviso_fin_trial_enviado` (migración 0013): el trial se fija una sola vez
 * por usuario, así que un boolean simple alcanza — no hace falta lógica de "volver a mandar".
 *
 * Uso: node src/cron/avisoFinTrial.js   (o npm run aviso-fin-trial)
 * Crontab sugerido en la VM (diario, 12:00 UTC = 9:00 Argentina — antes del downgrade de las
 * 3:00 UTC de bajar_planes_vencidos, sin pisarlo):
 *   0 12 * * * cd /ruta/ProyectoSuperApp/backend && /usr/bin/node src/cron/avisoFinTrial.js >> logs/cron-aviso-fin-trial.log 2>&1
 * Este archivo de crontab vive en la VM, no en el repo — mismo criterio que los demás crons.
 */

const fs = require('fs');
const path = require('path');
const { rutaLogs } = require('../config');
const { clienteSupabaseAdmin } = require('../clienteSupabaseAdmin');
const { listarTodosLosUsuarios } = require('../usuariosAuth');
const { enviarMail } = require('../clienteBrevo');

const DIAS_DE_AVISO = 3;

function armarHtml({ nombre, diasRestantes }) {
  const saludo = nombre ? `Hola ${nombre},` : 'Hola,';
  const cuando = diasRestantes <= 0 ? 'hoy' : `en ${diasRestantes} día${diasRestantes === 1 ? '' : 's'}`;
  return `
    <p>${saludo}</p>
    <p>Tu prueba gratis de Super App termina <strong>${cuando}</strong>.</p>
    <p>Si querés seguir comparando precios y viendo cuánto ahorrás, suscribite antes de que
    termine — podés hacerlo desde Ajustes en la app.</p>
  `;
}

async function avisoFinTrial() {
  const inicio = new Date();
  console.log(`\n⏳ Aviso de fin de trial — ${inicio.toLocaleString('es-AR')}`);

  const errores = [];
  let enviados = 0;

  const cliente = clienteSupabaseAdmin();
  if (!cliente) {
    errores.push('Falta SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY — no se pudo correr el aviso');
    console.error(`   ❌ ${errores[0]}`);
  } else {
    const limiteAviso = new Date(inicio.getTime() + DIAS_DE_AVISO * 24 * 60 * 60 * 1000);

    const [{ data: candidatos, error }, usuarios] = await Promise.all([
      cliente
        .from('perfil_usuario')
        .select('id, nombre, trial_termina_en')
        .eq('plan', 'trial')
        .eq('aviso_fin_trial_enviado', false)
        .lte('trial_termina_en', limiteAviso.toISOString()),
      listarTodosLosUsuarios(cliente).catch(err => {
        errores.push(`No se pudo listar usuarios: ${err.message}`);
        return [];
      }),
    ]);

    if (error) {
      errores.push(`No se pudo leer perfil_usuario: ${error.message}`);
    } else {
      const emailPorId = new Map(usuarios.map(u => [u.id, u.email]));

      for (const perfil of candidatos ?? []) {
        const email = emailPorId.get(perfil.id);
        if (!email) {
          errores.push(`Usuario ${perfil.id} sin mail en auth.users — omitido`);
          continue;
        }
        const diasRestantes = Math.ceil(
          (new Date(perfil.trial_termina_en).getTime() - inicio.getTime()) / (24 * 60 * 60 * 1000)
        );
        const resultado = await enviarMail({
          destinatarioEmail: email,
          destinatarioNombre: perfil.nombre,
          asunto: 'Tu prueba de Super App está por terminar',
          html: armarHtml({ nombre: perfil.nombre, diasRestantes }),
        });
        if (resultado.ok) {
          enviados++;
          const { error: errorUpdate } = await cliente
            .from('perfil_usuario')
            .update({ aviso_fin_trial_enviado: true })
            .eq('id', perfil.id);
          if (errorUpdate) errores.push(`Mail a ${email} enviado pero no se pudo marcar como avisado: ${errorUpdate.message}`);
        } else {
          errores.push(`Falló el mail a ${email}: ${resultado.error}`);
        }
      }
    }
  }

  const reporte = { inicio: inicio.toISOString(), fin: new Date().toISOString(), enviados, errores };

  fs.mkdirSync(rutaLogs, { recursive: true });
  fs.writeFileSync(path.join(rutaLogs, 'ultimo-aviso-fin-trial.json'), JSON.stringify(reporte, null, 2));

  console.log(`   ✅ ${enviados} enviados, ${errores.length} con error`);

  return reporte;
}

if (require.main === module) {
  avisoFinTrial()
    .then(r => process.exit(r.errores.length ? 1 : 0))
    .catch(err => {
      console.error('❌ Error fatal en el aviso de fin de trial:', err);
      process.exit(1);
    });
}

module.exports = { avisoFinTrial };
