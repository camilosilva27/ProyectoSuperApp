/**
 * Mail de re-engagement por inactividad (ver .claude/docs/mails_y_notificaciones.md, tipo #6).
 * Manda un mail a quien no inició sesión en los últimos 14 días (decidido en la conversación de
 * diseño: "actividad" = login, tomado de `auth.users.last_sign_in_at` vía la Admin API — no hay
 * columna propia para esto, ver usuariosAuth.js).
 *
 * RECURRENTE mientras dure la inactividad (decidido el 2026-09-08, cambio respecto de la
 * versión original: antes mandaba un solo aviso hasta que el usuario volviera a loguearse).
 * Ahora se re-arma cada `DIAS_DE_INACTIVIDAD` tomando como referencia el más reciente entre el
 * último login y el último aviso mandado — si el usuario nunca vuelve, le sigue llegando un
 * mail cada 14 días; si vuelve a loguearse, el reloj arranca de nuevo desde ese login.
 *
 * Solo a usuarios con plan activo (premium o trial vigente, `tienePlanActivo`) — decidido en la
 * auditoría 2026-09-24. Antes no filtraba por plan: a quien estaba en 'gratis' / trial vencido le
 * llegaba "Te extrañamos, date una vuelta" cada 14 días PARA SIEMPRE, invitándolo a una app que
 * al abrirla lo frena en el paywall (no hay plan gratis). Convencer a un ex-usuario de pagar es
 * otro mensaje (tipo "volvé a suscribirte"), no este; si se quiere, es un mail aparte.
 *
 * La marca `aviso_inactividad_enviado_en` se guarda si el aviso llegó por AL MENOS un canal (mail
 * ok o algún push entregado). Antes solo se marcaba si el mail salía bien: con Brevo fallando, el
 * push salía igual todos los días (la referencia de 14 días nunca se movía).
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
const { listarTodosLosUsuarios, tienePlanActivo, leerTodasLasFilas } = require('../usuariosAuth');
const { enviarMail } = require('../clienteBrevo');
const { armarMailBase, escaparHtml, URL_APP } = require('../plantillaMail');
const { obtenerSuscripcionesPorUsuario, enviarPush } = require('../clientePush');

const DIAS_DE_INACTIVIDAD = 14;

// Separado para poder testear la elegibilidad sin pegarle a la red.
// `usuario.perfil` (opcional) es la fila de perfil_usuario: sin plan activo no es elegible.
function esElegible(usuario, ahora) {
  if (usuario.perfil !== undefined && !tienePlanActivo(usuario.perfil, ahora)) return false;
  if (!usuario.ultimoLogin) return false; // nunca hizo login real (no debería pasar, pero no hay de qué avisar)
  const ultimoLoginMs = new Date(usuario.ultimoLogin).getTime();
  const ultimoAvisoMs = usuario.avisoInactividadEnviadoEn ? new Date(usuario.avisoInactividadEnviadoEn).getTime() : null;
  // Referencia = lo más reciente entre "volvió a loguearse" y "ya le mandamos un aviso" — así
  // el aviso se re-arma solo cada DIAS_DE_INACTIVIDAD mientras el usuario siga sin volver.
  const referenciaMs = ultimoAvisoMs && ultimoAvisoMs > ultimoLoginMs ? ultimoAvisoMs : ultimoLoginMs;
  const diasDesdeReferencia = (ahora - referenciaMs) / (24 * 60 * 60 * 1000);
  return diasDesdeReferencia >= DIAS_DE_INACTIVIDAD;
}

function armarHtml({ nombre }) {
  const saludo = nombre ? `Hola ${escaparHtml(nombre)},` : 'Hola,';
  const cuerpo = `
    <p style="margin:0 0 16px 0;">${saludo}</p>
    <p style="margin:0 0 16px 0;">Hace un tiempo que no comparás precios con SuperAhorro.</p>
    <p style="margin:0;">Los precios en los supermercados cambian todo el tiempo. Puede que esta semana haya
    alguna promo que te convenga. Date una vuelta cuando quieras.</p>
  `;
  return armarMailBase({
    preheader: 'Hace un tiempo que no comparás precios con SuperAhorro.',
    titulo: 'Te extrañamos',
    cuerpoHtml: cuerpo,
    cta: { texto: 'Abrir SuperAhorro', url: URL_APP },
    noTransaccional: true,
  });
}

async function avisoInactividad() {
  const inicio = new Date();
  console.log(`\n😴 Aviso de inactividad — ${inicio.toLocaleString('es-AR')}`);

  const errores = [];
  let enviados = 0;
  let enviadosPush = 0;

  const cliente = clienteSupabaseAdmin();
  if (!cliente) {
    errores.push('Falta SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY — no se pudo correr el aviso');
    console.error(`   ❌ ${errores[0]}`);
  } else {
    const [usuarios, { data: perfiles, error: errorPerfiles }, suscripcionesPush] = await Promise.all([
      listarTodosLosUsuarios(cliente).catch(err => {
        errores.push(`No se pudo listar usuarios: ${err.message}`);
        return [];
      }),
      leerTodasLasFilas(() =>
        cliente.from('perfil_usuario').select('id, nombre, plan, trial_termina_en, aviso_inactividad_enviado_en').order('id')
      ),
      obtenerSuscripcionesPorUsuario(cliente).catch(err => {
        errores.push(`No se pudo leer push_suscripcion: ${err.message}`);
        return new Map();
      }),
    ]);

    if (errorPerfiles) {
      errores.push(`No se pudo leer perfil_usuario: ${errorPerfiles.message}`);
    } else {
      const perfilPorId = new Map((perfiles ?? []).map(p => [p.id, p]));

      for (const usuario of usuarios) {
        const perfil = perfilPorId.get(usuario.id);
        if (!perfil) continue; // no debería pasar (trigger crea el perfil al registrarse)

        const elegible = esElegible(
          { ...usuario, perfil, avisoInactividadEnviadoEn: perfil.aviso_inactividad_enviado_en },
          inicio.getTime()
        );
        if (!elegible) continue;
        if (!usuario.emailConfirmado) continue;
        if (!usuario.email) {
          errores.push(`Usuario ${usuario.id} sin mail en auth.users — omitido`);
          continue;
        }

        const resultado = await enviarMail({
          destinatarioEmail: usuario.email,
          destinatarioNombre: perfil.nombre,
          asunto: 'Te extrañamos en SuperAhorro',
          html: armarHtml({ nombre: perfil.nombre }),
          noTransaccional: true,
        });
        if (resultado.ok) enviados++;
        else errores.push(`Falló el mail al usuario ${usuario.id}: ${resultado.error}`);

        const resultadoPush = await enviarPush(cliente, suscripcionesPush.get(usuario.id) ?? [], {
          title: 'SuperAhorro',
          body: 'Hace un tiempo que no comparás precios. Puede que esta semana haya alguna promo que te convenga.',
          url: URL_APP,
        });

        // Marca si llegó por algún canal — ver comentario de cabecera (evita push diario si Brevo falla).
        if (resultado.ok || resultadoPush.enviados > 0) {
          const { error: errorUpdate } = await cliente
            .from('perfil_usuario')
            .update({ aviso_inactividad_enviado_en: inicio.toISOString() })
            .eq('id', usuario.id);
          if (errorUpdate) errores.push(`Aviso al usuario ${usuario.id} enviado pero no se pudo marcar: ${errorUpdate.message}`);
        }
        enviadosPush += resultadoPush.enviados;
        errores.push(...resultadoPush.errores);
      }
    }
  }

  const reporte = { inicio: inicio.toISOString(), fin: new Date().toISOString(), enviados, enviadosPush, errores };

  fs.mkdirSync(rutaLogs, { recursive: true });
  fs.writeFileSync(path.join(rutaLogs, 'ultimo-aviso-inactividad.json'), JSON.stringify(reporte, null, 2));

  console.log(`   ✅ ${enviados} mails, ${enviadosPush} push, ${errores.length} con error`);

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

module.exports = { avisoInactividad, esElegible, armarHtml };
