/**
 * Reintento de pagos pendientes de confirmar (ver .claude/docs/Plan_Usuarios_y_cobros.md §
 * "Bug real: MP puede demorar días en avisar un pago ya aprobado"). Red de seguridad para
 * quien pagó pero no volvió a abrir la app (así que `POST /api/pagos/verificar`, disparado por
 * `ajustes.tsx` al volver del checkout, nunca corrió para ese pago) y cuyo webhook de MP todavía
 * no llegó — se observó en vivo un caso real con 18 días de demora.
 *
 * Reusa la misma función que la verificación activa (`verificarYAplicarPago`,
 * `procesarPagoMercadoPago.js`), así que es igual de idempotente: correr esto de más, o que se
 * pise con el webhook o con la verificación activa de la propia app, no genera doble recibo.
 *
 * Ventana de 30 días (no 24-48hs): el caso real detectado tardó 18 — un margen más chico
 * hubiera dejado de reintentar antes de que ese pago se resolviera solo.
 *
 * Uso: node src/cron/reintentarPagosPendientes.js   (o npm run reintentar-pagos-pendientes)
 * Crontab sugerido en la VM (cada 2hs en el minuto 0, mismo horario que refrescarCatalogos.js —
 * no hay conflicto, son procesos independientes):
 *   0 0,2,4,6,8,10,12,14,16,18,20,22 * * * cd /ruta/ProyectoSuperApp/backend && /usr/bin/node src/cron/reintentarPagosPendientes.js >> logs/cron-reintentar-pagos-pendientes.log 2>&1
 * Este archivo de crontab vive en la VM, no en el repo — mismo criterio que los demás crons.
 */

const fs = require('fs');
const path = require('path');
const { rutaLogs } = require('../config');
const { clienteSupabaseAdmin } = require('../clienteSupabaseAdmin');
const { verificarYAplicarPago } = require('../procesarPagoMercadoPago');

const DIAS_VENTANA = 30;

async function reintentarPagosPendientes() {
  const inicio = new Date();
  console.log(`\n⏳ Reintento de pagos pendientes — ${inicio.toLocaleString('es-AR')}`);

  const errores = [];
  let revisados = 0;
  let confirmados = 0;

  const cliente = clienteSupabaseAdmin();
  if (!cliente) {
    errores.push('Falta SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY — no se pudo correr el reintento');
    console.error(`   ❌ ${errores[0]}`);
  } else {
    const limiteVentana = new Date(inicio.getTime() - DIAS_VENTANA * 24 * 60 * 60 * 1000);

    const { data: candidatos, error } = await cliente
      .from('perfil_usuario')
      .select('id, plan')
      .neq('plan', 'premium')
      .eq('premium_manual', false)
      .not('intento_pago_en', 'is', null)
      .gte('intento_pago_en', limiteVentana.toISOString());

    if (error) {
      errores.push(`No se pudo leer perfil_usuario: ${error.message}`);
    } else {
      for (const perfil of candidatos ?? []) {
        revisados++;
        try {
          // eslint-disable-next-line no-await-in-loop -- secuencial a propósito, son pocos
          // candidatos y así no se satura la API de MP con ráfagas en paralelo.
          const planNuevo = await verificarYAplicarPago(perfil.id, cliente);
          if (planNuevo === 'premium' && perfil.plan !== 'premium') confirmados++;
        } catch (err) {
          errores.push(`Usuario ${perfil.id}: ${err.message}`);
        }
      }
    }
  }

  const reporte = {
    inicio: inicio.toISOString(), fin: new Date().toISOString(), revisados, confirmados, errores,
  };

  fs.mkdirSync(rutaLogs, { recursive: true });
  fs.writeFileSync(path.join(rutaLogs, 'ultimo-reintento-pagos-pendientes.json'), JSON.stringify(reporte, null, 2));

  console.log(`   ✅ ${revisados} revisados, ${confirmados} confirmados, ${errores.length} con error`);

  return reporte;
}

if (require.main === module) {
  reintentarPagosPendientes()
    .then((r) => process.exit(r.errores.length ? 1 : 0))
    .catch((err) => {
      console.error('❌ Error fatal en el reintento de pagos pendientes:', err);
      process.exit(1);
    });
}

module.exports = { reintentarPagosPendientes };
