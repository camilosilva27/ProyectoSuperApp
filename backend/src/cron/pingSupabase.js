/**
 * Ping semanal a Supabase — el free tier pausa el proyecto tras 7 días sin actividad, y no se
 * reactiva solo con el tráfico normal de la app (confirmado contra la documentación oficial,
 * ver Plan_Usuarios_y_cobros.md § "Riesgo: pausa por inactividad del free tier de Supabase").
 * Este script hace una lectura mínima con la service role key para contar como actividad real.
 *
 * Uso: node src/cron/pingSupabase.js   (o npm run ping-supabase)
 * Crontab sugerido en la VM (semanal, con margen sobre el límite de 7 días):
 *   0 3 * * 1 cd /ruta/ProyectoSuperApp/backend && /usr/bin/node src/cron/pingSupabase.js >> logs/cron-ping-supabase.log 2>&1
 * Este archivo de crontab vive en la VM, no en el repo — mismo criterio que refrescarCatalogos.js.
 */

const fs = require('fs');
const path = require('path');
const { rutaLogs } = require('../config');
const { clienteSupabaseAdmin } = require('../clienteSupabaseAdmin');

async function ping() {
  const inicio = new Date();
  console.log(`\n🏓 Ping a Supabase — ${inicio.toLocaleString('es-AR')}`);

  const cliente = clienteSupabaseAdmin();
  const errores = [];

  if (!cliente) {
    errores.push('Falta SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY — no se pudo pingear');
    console.error(`   ❌ ${errores[0]}`);
  } else {
    // La tabla en sí no importa: cualquier lectura autenticada cuenta como actividad del
    // proyecto. `head: true` evita traer filas — solo se necesita el conteo/status de la
    // respuesta, no los datos.
    const { error } = await cliente.from('perfil_usuario').select('id', { count: 'exact', head: true });
    if (error) {
      errores.push(`Ping a Supabase falló: ${error.message}`);
      console.error(`   ❌ ${errores[0]}`);
    } else {
      console.log('   ✅ Supabase respondió OK');
    }
  }

  const reporte = {
    inicio: inicio.toISOString(),
    fin: new Date().toISOString(),
    errores,
  };

  // Lo lee GET /api/health, mismo criterio que logs/ultimo-refresco.json.
  fs.mkdirSync(rutaLogs, { recursive: true });
  fs.writeFileSync(path.join(rutaLogs, 'ultimo-ping-supabase.json'), JSON.stringify(reporte, null, 2));

  console.log(errores.length ? '\n⚠️  Ping terminado con problemas — ver /api/health' : '\n✅ Ping OK');

  return reporte;
}

if (require.main === module) {
  ping()
    .then(r => process.exit(r.errores.length ? 1 : 0))
    .catch(err => {
      console.error('❌ Error fatal en el ping a Supabase:', err);
      process.exit(1);
    });
}

module.exports = { ping };
