/**
 * Guardrail antes de pisar un catalogo-*.json: si el scraper trajo muchos menos SKUs que la
 * corrida anterior, es más probable que haya sido un corte de paginación a mitad de camino
 * (429/502/timeout no reintentado — los scrapers tratan cualquier error de página como "fin
 * del catálogo" y siguen con lo que ya tenían, ver CONTEXTO_TECNICO.md § "Glitches de scraper")
 * que un vaciamiento real del catálogo de un super de un día para el otro.
 *
 * En ese caso NO se pisa el archivo (se conserva la corrida anterior tal cual estaba) y se
 * lanza un error — así el scraper termina con exit code 1 y refrescarCatalogos.js lo loguea
 * como falla real (❌, visible en cron.log y en /api/health), en vez de guardar en silencio un
 * catálogo truncado con exit code 0 como pasó el 16 y 17/09/2026 con Vea, Jumbo y Carrefour.
 */
const fs = require('fs');
const { escribirAtomico } = require('./escrituraAtomica');

const RATIO_MINIMO = 0.7;

function guardarCatalogoConGuardrail(ruta, datos) {
  const nuevoTotal = datos.total_skus;
  if (fs.existsSync(ruta)) {
    let anterior;
    try {
      anterior = JSON.parse(fs.readFileSync(ruta, 'utf8'));
    } catch {
      anterior = null;
    }
    const totalAnterior = anterior?.total_skus;
    if (typeof totalAnterior === 'number' && totalAnterior > 0 && nuevoTotal < totalAnterior * RATIO_MINIMO) {
      throw new Error(
        `Catálogo sospechosamente chico: ${nuevoTotal} SKUs nuevos vs. ${totalAnterior} en la corrida anterior ` +
        `(< ${Math.round(RATIO_MINIMO * 100)}%). No se pisa ${ruta} — probable corte de paginación a mitad de camino, no un vaciamiento real.`
      );
    }
  }
  escribirAtomico(ruta, JSON.stringify(datos, null, 2));
}

module.exports = { guardarCatalogoConGuardrail, RATIO_MINIMO };
