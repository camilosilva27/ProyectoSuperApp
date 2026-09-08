/**
 * Mail de re-engagement por inactividad (ver .claude/docs/mails_y_notificaciones.md, tipo #6).
 * Manda un mail a quien no inició sesión en los últimos 14 días (decidido en la conversación de
 * diseño: "actividad" = login, tomado de `auth.users.last_sign_in_at` vía la Admin API — no hay
 * columna propia para esto, ver usuariosAuth.js).
 *
 * Idempotente vía `aviso_inactividad_enviado_en` (migración 0013, timestamp en vez de boolean
 * a propósito): si el usuario volvió a loguearse después del último aviso, es elegible para
 * recibir uno nuevo la próxima vez que vuelva a estar inactivo — comparar contra el boolean no
 * alcanzaría para distinguir "todavía no volvió" de "volvió y se fue de nuevo".
 *
 * Uso: node src/cron/avisoInactividad.js   (o npm run aviso-inactividad)
 * Crontab sugerido en la VM (diario, 14:00 UTC = 11:00 Argentina):
 *   0 14 * * * cd /ruta/ProyectoSuperApp/backend && /usr/bin/node src/cron/avisoInactividad.js >> logs/cron-aviso-inactividad.log 2>&1
 * Este archivo de crontab vive en la VM, no en el repo — mismo criterio que los demás crons.
 */

const fs = require('fs');
const path = require('path');
const { rutaLogs } = require('../config');
const { clienteSupabaseAdmin } = require('../clienteSupabaseAdmin');
const { listarTodosLosUsuarios } = require('../usuariosAuth');
const { enviarMail } = require('../clienteBrevo');

const DIAS_DE_INACTIVIDAD = 14;

// Separado para poder testear la elegibilidad sin pegarle a la red.
function esElegible(usuario, ahora) {
  if (!usuario.ultimoLogin) return false; // nunca hizo login real (no debería pasar, pero no hay de qué avisar)
  const diasSinLogin = (ahora - new Date(usuario.ultimoLogin).getTime()) / (24 * 60 * 60 * 1000);
  if (diasSinLogin < DIAS_DE_INACTIVIDAD) return false;
  if (!usuario.avisoInactividadEnviadoEn) return true;
  // Ya se avisó, pero si el aviso es anterior al último login, el usuario volvió y se fue de
  // nuevo — corresponde un aviso nuevo.
  return new Date(usuario.avisoInactividadEnviadoEn).getTime() < new Date(usuario.ultimoLogin).getTime();
}

function armarHtml({ nombre }) {
  const saludo = nombre ? `Hola ${nombre},` : 'Hola,';
  return `
    <p>${saludo}</p>
    <p>Hace un tiempo que no comparás precios con Super App.</p>
    <p>Los precios en los supermercados cambian todo el tiempo — puede que esta semana haya
    alguna promo que te convenga. Date una vuelta cuando quieras.</p>
  `;
}

async function avisoInactividad() {
  const inicio = new Date();
  console.log(`\n😴 Aviso de inactividad — ${inicio.toLocaleString('es-AR')}`);

  const errores = [];
  let enviados = 0;

  const cliente = clienteSupabaseAdmin();
  if (!cliente) {
    errores.push('Falta SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY — no se pudo correr el aviso');
    console.error(`   ❌ ${errores[0]}`);
  } else {
    const [usuarios, { data: perfiles, error: errorPerfiles }] = await Promise.all([
      listarTodosLosUsuarios(cliente).catch(err => {
        errores.push(`No se pudo listar usuarios: ${err.message}`);
        return [];
      }),
      cliente.from('perfil_usuario').select('id, nombre, aviso_inactividad_enviado_en'),
    ]);

    if (errorPerfiles) {
      errores.push(`No se pudo leer perfil_usuario: ${errorPerfiles.message}`);
    } else {
      const perfilPorId = new Map((perfiles ?? []).map(p => [p.id, p]));

      for (const usuario of usuarios) {
        const perfil = perfilPorId.get(usuario.id);
        if (!perfil) continue; // no debería pasar (trigger crea el perfil al registrarse)

        const elegible = esElegible(
          { ...usuario, avisoInactividadEnviadoEn: perfil.aviso_inactividad_enviado_en },
          inicio.getTime()
        );
        if (!elegible) continue;
        if (!usuario.email) {
          errores.push(`Usuario ${usuario.id} sin mail en auth.users — omitido`);
          continue;
        }

        const resultado = await enviarMail({
          destinatarioEmail: usuario.email,
          destinatarioNombre: perfil.nombre,
          asunto: 'Te extrañamos en Super App',
          html: armarHtml({ nombre: perfil.nombre }),
        });
        if (resultado.ok) {
          enviados++;
          const { error: errorUpdate } = await cliente
            .from('perfil_usuario')
            .update({ aviso_inactividad_enviado_en: inicio.toISOString() })
            .eq('id', usuario.id);
          if (errorUpdate) errores.push(`Mail a ${usuario.email} enviado pero no se pudo marcar: ${errorUpdate.message}`);
        } else {
          errores.push(`Falló el mail a ${usuario.email}: ${resultado.error}`);
        }
      }
    }
  }

  const reporte = { inicio: inicio.toISOString(), fin: new Date().toISOString(), enviados, errores };

  fs.mkdirSync(rutaLogs, { recursive: true });
  fs.writeFileSync(path.join(rutaLogs, 'ultimo-aviso-inactividad.json'), JSON.stringify(reporte, null, 2));

  console.log(`   ✅ ${enviados} enviados, ${errores.length} con error`);

  return reporte;
}

if (require.main === module) {
  avisoInactividad()
    .then(r => process.exit(r.errores.length ? 1 : 0))
    .catch(err => {
      console.error('❌ Error fatal en el aviso de inactividad:', err);
      process.exit(1);
    });
}

module.exports = { avisoInactividad, esElegible };
