/**
 * Entry point para GitHub Actions (.github/workflows/scrapers.yml): corre SOLO los scrapers y
 * sus "extras" — la parte que más CPU pide del refresco (ver CONTEXTO_TECNICO.md § "VM:
 * limpieza de RAM/CPU y migración de crons a GitHub Actions" para la medición real que lo
 * confirmó). El workflow es responsable de:
 *   1. Bajar por SCP los catalogo-*.json y catalogo-*-extras.json vigentes de la VM ANTES de
 *      correr esto (si no existen, el guardrail de guardrailCatalogo.js y el diff arrancan
 *      desde cero — no rompe nada, pero pierden la comparación contra la corrida anterior).
 *   2. Subir por SCP los catalogo-*(.json|-extras.json) resultantes DE VUELTA a la VM.
 *   3. Disparar por SSH postProcesarCatalogos.js en la VM (unificar, fotos, promos bancarias,
 *      avisos) — este script NO lo hace.
 *
 * A propósito NO corre: unificar catálogo (necesita los 7 catálogos ya subidos), descargar
 * imágenes (hay ~430MB ya en la VM, no tiene sentido bajarlos al runner en cada corrida), ni
 * avisos de productos seguidos (mail/push — esas credenciales no salen de la VM).
 *
 * Necesita SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY en el entorno (secrets del workflow) para
 * registrar los diffs — son los únicos secrets nuevos que agrega esta migración, copia de los
 * que ya están en backend/.env.
 *
 * Uso: node src/cron/refrescarCatalogosGHA.js   (cwd: backend/)
 */

const path = require('path');
const { SCRAPERS, REFRESCADORES_EXTRAS, correrScraper, DIR_ALLPROMOS } = require('./refrescarCatalogos');
const { leerJSON, diffProductos, registrarDiff } = require('./diffCatalogos');

async function correr() {
  const inicio = new Date();
  console.log(`\n🔄 Scraping (GitHub Actions) — ${inicio.toISOString()}`);

  const resultados = [];
  for (const scraper of SCRAPERS) {
    const rutaCatalogo = path.join(DIR_ALLPROMOS, scraper.archivoCatalogo);
    const catalogoAntes = leerJSON(rutaCatalogo);

    console.log(`   ▶ ${scraper.nombre}...`);
    const resultado = await correrScraper(scraper);
    console.log(`   ${resultado.ok ? '✅' : '❌'} ${scraper.nombre} (${resultado.duracionSeg}s)`);
    if (!resultado.ok) console.error(`      ${resultado.error}`);
    resultados.push(resultado);

    if (resultado.ok) {
      const catalogoDespues = leerJSON(rutaCatalogo);
      await registrarDiff({
        super: scraper.clave,
        tipo: 'productos',
        corrida_en: inicio.toISOString(),
        ...diffProductos(catalogoAntes, catalogoDespues),
      });
    }
  }

  const resultadosExtras = [];
  for (const refrescador of REFRESCADORES_EXTRAS) {
    console.log(`   ▶ ${refrescador.nombre}...`);
    const resultado = await correrScraper(refrescador);
    console.log(`   ${resultado.ok ? '✅' : '❌'} ${refrescador.nombre} (${resultado.duracionSeg}s)`);
    if (!resultado.ok) console.error(`      ${resultado.error}`);
    resultadosExtras.push(resultado);
  }

  const fallos = resultados.filter(r => !r.ok).length + resultadosExtras.filter(r => !r.ok).length;
  console.log(fallos
    ? `\n⚠️  Scraping terminado con ${fallos} fallo(s)`
    : '\n✅ Scraping completo sin problemas');
  return fallos === 0;
}

if (require.main === module) {
  correr()
    .then(ok => process.exit(ok ? 0 : 1))
    .catch(err => {
      console.error('❌ Error fatal en el scraping:', err);
      process.exit(1);
    });
}

module.exports = { correr };
