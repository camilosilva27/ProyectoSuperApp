/**
 * Refresco diario de los catálogos locales + regeneración del catálogo unificado.
 *
 * Corre los 5 scrapers existentes como SUBPROCESOS, sin refactorizarlos. Es deliberado:
 * tienen lógica de retry/backoff frente a 429 (Carrefour) y 502 intermitentes (Chango Más)
 * que AllPromos/CLAUDE.md pide explícitamente no tocar. Invocarlos como proceso separado es
 * el cambio de menor riesgo y además aísla un crash de un scraper del resto del refresco.
 *
 * OJO: los scrapers escriben con rutas relativas al cwd (`./catalogo-vea.json`), no a su
 * __dirname. Por eso se los lanza con cwd = AllPromos/ — si se los corriera desde backend/
 * escribirían los catálogos en el lugar equivocado y el server seguiría leyendo los viejos.
 *
 * Se corren en serie, no en paralelo: son 5 procesos pegándole a APIs de producción de
 * terceros y correrlos juntos multiplicaría x5 el ritmo de requests justo contra los
 * endpoints que ya rate-limitean.
 *
 * Uso: node src/cron/refrescarCatalogos.js   (o npm run refrescar)
 * Crontab sugerido en el VPS (5:30 AM):
 *   30 5 * * * cd /ruta/ProyectoSuperApp/backend && /usr/bin/node src/cron/refrescarCatalogos.js >> logs/cron.log 2>&1
 */

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { rutaLogs } = require('../config');
const { unificar } = require('./unificarCatalogo');

const DIR_ALLPROMOS = path.join(__dirname, '..', '..', '..', 'AllPromos');

const SCRAPERS = [
  { nombre: 'Vea',        archivo: 'scraper-promos-vea.js',        timeoutMs: 15 * 60 * 1000 },
  { nombre: 'Carrefour',  archivo: 'scraper-promos-carrefour.js',  timeoutMs: 25 * 60 * 1000 },
  { nombre: 'Chango Más', archivo: 'scraper-promos-changomas.js',  timeoutMs: 15 * 60 * 1000 },
  { nombre: 'Día',        archivo: 'scraper-promos-dia.js',        timeoutMs: 15 * 60 * 1000 },
  { nombre: 'Coto',       archivo: 'scraper-promos-coto.js',       timeoutMs: 20 * 60 * 1000 },
];

function correrScraper({ nombre, archivo, timeoutMs }) {
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
          // Solo la cola: los scrapers loguean progreso página por página y no queremos
          // guardar megas de log por corrida.
          salida: (stdout || '').split('\n').slice(-5).join('\n').trim(),
          error: error ? (stderr || error.message).split('\n').slice(-5).join('\n').trim() : null,
        });
      }
    );
  });
}

/**
 * Sonda de salud de las promos bancarias. No refresca nada: solo detecta los dos modos de
 * falla silenciosa que si no se reportan se ven igual que "hoy no hay promos" —
 * `hash_roto` (el sha256Hash de la persisted query de GraphQL cambió porque el super
 * actualizó su app) y errores de red/cookie.
 */
async function probarPromosBancarias() {
  try {
    const { obtenerPromosBancarias } = require(path.join(DIR_ALLPROMOS, 'promos-bancarias.js'));
    const datos = await obtenerPromosBancarias();
    const errores = [];
    for (const [key, valor] of Object.entries(datos)) {
      if (valor.error === 'hash_roto') {
        errores.push(`Promos bancarias de ${key}: hash de GraphQL desactualizado — hay que recapturarlo con el navegador`);
      } else if (valor.error) {
        errores.push(`Promos bancarias de ${key}: no se pudo consultar (${valor.error})`);
      }
    }
    return { ok: errores.length === 0, errores };
  } catch (err) {
    return { ok: false, errores: [`No se pudo probar promos bancarias: ${err.message}`] };
  }
}

async function refrescar() {
  const inicio = new Date();
  console.log(`\n🔄 Refresco de catálogos — ${inicio.toLocaleString('es-AR')}`);

  const resultados = [];
  for (const scraper of SCRAPERS) {
    console.log(`   ▶ ${scraper.nombre}...`);
    const resultado = await correrScraper(scraper);
    console.log(`   ${resultado.ok ? '✅' : '❌'} ${scraper.nombre} (${resultado.duracionSeg}s)`);
    if (!resultado.ok) console.error(`      ${resultado.error}`);
    resultados.push(resultado);
  }

  const errores = resultados
    .filter(r => !r.ok)
    .map(r => `El scraper de ${r.nombre} falló (código ${r.codigo}) — catálogo sin actualizar`);

  // El unificado se regenera aunque algún scraper haya fallado: es mejor tener el índice
  // consistente con los catálogos que efectivamente hay en disco que dejarlo desactualizado.
  let unificado = null;
  try {
    unificado = await unificar({ silencioso: true });
    console.log(`   ✅ catálogo unificado: ${unificado.total} productos`);
    console.log(`   📷 fotos: ${unificado.fotos.yaExistian} ya en disco, ${unificado.fotos.descargadas} nuevas, ${unificado.fotos.fallidas} fallidas`);
  } catch (err) {
    errores.push(`No se pudo regenerar el catálogo unificado: ${err.message}`);
    console.error(`   ❌ catálogo unificado: ${err.message}`);
  }

  const sonda = await probarPromosBancarias();
  errores.push(...sonda.errores);
  console.log(`   ${sonda.ok ? '✅' : '⚠️ '} promos bancarias: ${sonda.ok ? 'OK' : sonda.errores.join(' | ')}`);

  const reporte = {
    inicio: inicio.toISOString(),
    fin: new Date().toISOString(),
    duracionSeg: Math.round((Date.now() - inicio.getTime()) / 1000),
    scrapers: resultados,
    totalProductosUnificados: unificado?.total ?? null,
    errores,
  };

  // Lo lee GET /api/health: es la forma de enterarse de que algo se rompió sin mirar logs.
  fs.mkdirSync(rutaLogs, { recursive: true });
  fs.writeFileSync(path.join(rutaLogs, 'ultimo-refresco.json'), JSON.stringify(reporte, null, 2));

  console.log(errores.length
    ? `\n⚠️  Refresco terminado con ${errores.length} problema(s) — ver /api/health`
    : `\n✅ Refresco completo sin problemas (${reporte.duracionSeg}s)`);

  return reporte;
}

if (require.main === module) {
  refrescar()
    .then(r => process.exit(r.errores.length ? 1 : 0))
    .catch(err => {
      console.error('❌ Error fatal en el refresco:', err);
      process.exit(1);
    });
}

module.exports = { refrescar, probarPromosBancarias };
