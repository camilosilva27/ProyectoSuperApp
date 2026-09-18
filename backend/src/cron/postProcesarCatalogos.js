/**
 * Post-procesamiento después de que GitHub Actions sube los catalogo-*(.json|-extras.json)
 * frescos (ver refrescarCatalogosGHA.js + .github/workflows/scrapers.yml). Corre EN LA VM,
 * disparado por SSH desde ese mismo workflow, porque necesita:
 *   - Las ~65.000 fotos ya en disco (~430MB) — no tiene sentido bajarlas al runner cada 2hs
 *     para que descargarImagenes.js compare qué falta; acá ya están.
 *   - Las credenciales de mail/push para avisoProductosSeguidos.js, que a propósito nunca
 *     salen de la VM (ver CONTEXTO_TECNICO.md § "VM: limpieza de RAM/CPU y migración de crons
 *     a GitHub Actions").
 *
 * Asume que los catalogo-*.json ya están frescos en disco (subidos por el workflow) — no corre
 * ningún scraper.
 *
 * Uso: node src/cron/postProcesarCatalogos.js   (cwd: backend/)
 */

const fs = require('fs');
const path = require('path');
const { rutaLogs } = require('../config');
const { unificar } = require('./unificarCatalogo');
const { leerJSON, diffPromosSuper, registrarDiff, estadoPromoPorEan } = require('./diffCatalogos');
const { refrescarPromosBancarias, SCRAPERS, DIR_ALLPROMOS } = require('./refrescarCatalogos');
const { avisarProductosSeguidos } = require('../avisoProductosSeguidos');

async function postProcesar() {
  // CORRIDA_EN lo pasa subir-catalogos.sh (leído del archivo que escribe
  // refrescarCatalogosGHA.js) para que el diff de promos_bancarias de acá quede bajo el MISMO
  // corrida_en que el de tipo='productos' que ya se registró en GitHub Actions — sin esto,
  // cada script pone su propio `new Date()` y las dos mitades de una misma corrida quedan con
  // timestamps distintos en scraper_diffs. Si se corre este script suelto (sin la variable,
  // ej. a mano en la VM) cae en `new Date()` como antes.
  const inicio = process.env.CORRIDA_EN ? new Date(process.env.CORRIDA_EN) : new Date();
  console.log(`\n🔧 Post-proceso de catálogos — ${inicio.toISOString()}`);

  const errores = [];

  // Mismo criterio que refrescar() en refrescarCatalogos.js: estado ACTUAL de promo por EAN
  // (no un diff), para que un usuario que sigue un producto que YA tenía promo activa también
  // reciba el aviso — ver el comentario largo en refrescarCatalogos.js si hace falta el detalle.
  const estadoActualPromoPorEan = new Map();
  for (const scraper of SCRAPERS) {
    const catalogo = leerJSON(path.join(DIR_ALLPROMOS, scraper.archivoCatalogo));
    for (const [ean, estado] of estadoPromoPorEan(catalogo, scraper.nombre)) {
      if (!estadoActualPromoPorEan.has(ean)) estadoActualPromoPorEan.set(ean, estado);
    }
  }

  let unificado = null;
  try {
    unificado = await unificar({ silencioso: true });
    console.log(`   ✅ catálogo unificado: ${unificado.total} productos`);
    console.log(`   📷 fotos: ${unificado.fotos.yaExistian} ya en disco, ${unificado.fotos.descargadas} nuevas, ${unificado.fotos.fallidas} fallidas`);
  } catch (err) {
    errores.push(`No se pudo regenerar el catálogo unificado: ${err.message}`);
    console.error(`   ❌ catálogo unificado: ${err.message}`);
  }

  console.log(`   ▶ Promos bancarias...`);
  const rutaPromosBancarias = path.join(rutaLogs, 'promos-bancarias.json');
  const promosBancariasAntes = leerJSON(rutaPromosBancarias)?.datosPorSuper ?? {};
  const sonda = await refrescarPromosBancarias();
  errores.push(...sonda.errores);
  console.log(`   ${sonda.ok ? '✅' : '⚠️ '} promos bancarias: ${sonda.ok ? 'OK' : sonda.errores.join(' | ')}`);

  const promosBancariasDespues = leerJSON(rutaPromosBancarias)?.datosPorSuper ?? {};
  for (const clave of new Set([...Object.keys(promosBancariasAntes), ...Object.keys(promosBancariasDespues)])) {
    await registrarDiff({
      super: clave,
      tipo: 'promos_bancarias',
      corrida_en: inicio.toISOString(),
      ...diffPromosSuper(promosBancariasAntes[clave]?.promos, promosBancariasDespues[clave]?.promos),
    });
  }

  console.log(`   ▶ Avisos de productos seguidos (${estadoActualPromoPorEan.size} EAN con promo activa)...`);
  const avisoSeguidos = await avisarProductosSeguidos(estadoActualPromoPorEan);
  errores.push(...avisoSeguidos.errores);
  console.log(`   ${avisoSeguidos.errores.length ? '⚠️ ' : '✅'} avisos de productos seguidos: ${avisoSeguidos.avisados} usuario(s) avisado(s)`);

  const reporte = {
    inicio: inicio.toISOString(),
    fin: new Date().toISOString(),
    duracionSeg: Math.round((Date.now() - inicio.getTime()) / 1000),
    totalProductosUnificados: unificado?.total ?? null,
    avisosProductosSeguidos: { eanConPromoActiva: estadoActualPromoPorEan.size, usuariosAvisados: avisoSeguidos.avisados },
    errores,
  };

  // Lo lee GET /api/health, igual que antes.
  fs.mkdirSync(rutaLogs, { recursive: true });
  fs.writeFileSync(path.join(rutaLogs, 'ultimo-refresco.json'), JSON.stringify(reporte, null, 2));

  console.log(errores.length
    ? `\n⚠️  Post-proceso terminado con ${errores.length} problema(s) — ver /api/health`
    : `\n✅ Post-proceso completo sin problemas (${reporte.duracionSeg}s)`);

  return reporte;
}

if (require.main === module) {
  postProcesar()
    .then(r => process.exit(r.errores.length ? 1 : 0))
    .catch(err => {
      console.error('❌ Error fatal en el post-proceso:', err);
      process.exit(1);
    });
}

module.exports = { postProcesar };
