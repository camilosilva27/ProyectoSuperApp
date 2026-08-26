/**
 * Descubrimiento mensual de productos nuevos por EAN (ver completador_catalogos.md § 6/§ 10).
 *
 * Corre los 6 `completar-*-por-ean.js` (candidatos nuevos, uno por super — CARO: ~2h42min
 * medido en vivo 2026-08-26 para los 6 juntos) y al final regenera el catálogo unificado, para
 * que lo que se encontró entre a la búsqueda de la app sin esperar al próximo refresco de 2hs.
 *
 * A propósito SEPARADO de `refrescarCatalogos.js` (que corre cada 2hs): esto es la parte lenta
 * de mantener `-extras.json` — buscar candidatos nuevos entre TODO lo que no se sabe si un
 * super vende. La parte barata (refrescar precio de lo ya conocido) SÍ vive en el cron de 2hs,
 * ver `refrescarCatalogos.js` § REFRESCADORES_EXTRAS.
 *
 * Mismo patrón que refrescarCatalogos.js: subprocesos con cwd = AllPromos/, en serie (pegan a
 * APIs de producción de terceros, no correr en paralelo — ver AllPromos/CLAUDE.md).
 *
 * Uso: node src/cron/descubrirCandidatosExtras.js   (o npm run descubrir)
 * Crontab sugerido en la VM (mensual, 00:00 del día 1 — decisión del usuario 2026-08-26, un
 * producto nuevo en otro super no es urgente de reflejar al instante):
 *   0 0 1 * * cd /ruta/ProyectoSuperApp/backend && /usr/bin/node src/cron/descubrirCandidatosExtras.js >> logs/cron-descubrimiento.log 2>&1
 * Este archivo de crontab vive en la VM, no en el repo — mismo criterio que refrescarCatalogos.js.
 */

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { rutaLogs } = require('../config');
const { unificar } = require('./unificarCatalogo');

const DIR_ALLPROMOS = path.join(__dirname, '..', '..', '..', 'AllPromos');

const DESCUBRIDORES = [
  { nombre: 'Vea',        archivo: 'completar-vea-por-ean.js',        timeoutMs: 60 * 60 * 1000 },
  { nombre: 'Carrefour',  archivo: 'completar-carrefour-por-ean.js',  timeoutMs: 60 * 60 * 1000 },
  { nombre: 'Chango Más', archivo: 'completar-changomas-por-ean.js',  timeoutMs: 60 * 60 * 1000 },
  { nombre: 'Día',        archivo: 'completar-dia-por-ean.js',        timeoutMs: 60 * 60 * 1000 },
  { nombre: 'Jumbo',      archivo: 'completar-jumbo-por-ean.js',      timeoutMs: 60 * 60 * 1000 },
  { nombre: 'Disco',      archivo: 'completar-disco-por-ean.js',      timeoutMs: 60 * 60 * 1000 },
];

function correrScript({ nombre, archivo, timeoutMs }) {
  return new Promise(resolve => {
    const inicio = Date.now();
    execFile(
      process.execPath,
      [archivo],
      { cwd: DIR_ALLPROMOS, timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024 },
      (error, stdout, stderr) => {
        resolve({
          nombre,
          archivo,
          ok: !error,
          codigo: error?.code ?? 0,
          duracionSeg: Math.round((Date.now() - inicio) / 1000),
          // Solo la cola: estos scripts loguean progreso EAN por EAN y no queremos guardar
          // megas de log por corrida — el resumen "=== RESULTADO ===" ya queda en esas líneas.
          salida: (stdout || '').split('\n').slice(-10).join('\n').trim(),
          error: error ? (stderr || error.message).split('\n').slice(-5).join('\n').trim() : null,
        });
      }
    );
  });
}

async function descubrir() {
  const inicio = new Date();
  console.log(`\n🔎 Descubrimiento mensual de candidatos por EAN — ${inicio.toLocaleString('es-AR')}`);

  const resultados = [];
  for (const descubridor of DESCUBRIDORES) {
    console.log(`   ▶ ${descubridor.nombre}...`);
    const resultado = await correrScript(descubridor);
    console.log(`   ${resultado.ok ? '✅' : '❌'} ${descubridor.nombre} (${resultado.duracionSeg}s)`);
    if (!resultado.ok) console.error(`      ${resultado.error}`);
    resultados.push(resultado);
  }

  const errores = resultados
    .filter(r => !r.ok)
    .map(r => `El descubrimiento de ${r.nombre} falló (código ${r.codigo}) — extras sin candidatos nuevos esta corrida`);

  let unificado = null;
  try {
    unificado = await unificar({ silencioso: true });
    console.log(`   ✅ catálogo unificado: ${unificado.total} productos`);
  } catch (err) {
    errores.push(`No se pudo regenerar el catálogo unificado: ${err.message}`);
    console.error(`   ❌ catálogo unificado: ${err.message}`);
  }

  const reporte = {
    inicio: inicio.toISOString(),
    fin: new Date().toISOString(),
    duracionSeg: Math.round((Date.now() - inicio.getTime()) / 1000),
    descubridores: resultados,
    totalProductosUnificados: unificado?.total ?? null,
    errores,
  };

  // Lo lee GET /api/health, mismo criterio que logs/ultimo-refresco.json.
  fs.mkdirSync(rutaLogs, { recursive: true });
  fs.writeFileSync(path.join(rutaLogs, 'ultimo-descubrimiento.json'), JSON.stringify(reporte, null, 2));

  console.log(errores.length
    ? `\n⚠️  Descubrimiento terminado con ${errores.length} problema(s) — ver /api/health`
    : `\n✅ Descubrimiento completo sin problemas (${reporte.duracionSeg}s)`);

  return reporte;
}

if (require.main === module) {
  descubrir()
    .then(r => process.exit(r.errores.length ? 1 : 0))
    .catch(err => {
      console.error('❌ Error fatal en el descubrimiento:', err);
      process.exit(1);
    });
}

module.exports = { descubrir };
