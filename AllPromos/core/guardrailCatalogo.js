/**
 * Guardrail antes de pisar un catalogo-*.json: si el scraper trajo muchos menos SKUs que lo
 * normal, es más probable que haya sido un corte de paginación a mitad de camino (throttle de
 * VTEX, página corta no confirmada) que un vaciamiento real del catálogo de un super de un día
 * para el otro.
 *
 * En ese caso NO se pisa el archivo (se conserva la corrida anterior tal cual estaba) y se
 * lanza un error — así el scraper termina con exit code 1 y refrescarCatalogos.js lo loguea
 * como falla real (❌, visible en cron.log y en /api/health), en vez de guardar en silencio un
 * catálogo truncado con exit code 0 como pasó el 16 y 17/09/2026 con Vea, Jumbo y Carrefour.
 *
 * Referencia que no se erosiona (2026-09-24, auditoría): antes se comparaba solo contra la
 * corrida INMEDIATA anterior con un umbral del 70%, así que un catálogo parcial de hasta ~70%
 * pisaba al bueno y, como la vara se movía con cada corrida aceptada, podía bajar escalonado
 * (2550 → 1800 → 1270) sin que el guardrail saltara nunca. Ahora la vara es el MÁXIMO de las
 * corridas aceptadas en los últimos `VENTANA_DIAS` días, y el umbral sube a 85% (el ruido
 * normal día a día de los 7 supers es <5%, ver CONTEXTO_TECNICO.md).
 *
 * El historial vive DENTRO del mismo catalogo-*.json (campo `guardrail.historial`), no en un
 * archivo de estado aparte: los scrapers corren en GitHub Actions y lo único que viaja entre
 * corridas (VM → runner → VM, ver .github/scripts/{bajar,subir}-catalogos.sh) son los
 * catalogo-*.json. Un archivo aparte se perdería en cada corrida.
 *
 * Salida de emergencia ante una baja REAL del catálogo: las corridas bloqueadas no se suman al
 * historial, así que si la baja es legítima y se sostiene, a los `VENTANA_DIAS` días ya no
 * queda ninguna entrada dentro de la ventana y la siguiente corrida se acepta sola (mientras
 * tanto, falla ruidosamente cada 2hs en /api/health — nadie se entera "tarde").
 */
const fs = require('fs');
const { escribirAtomico } = require('./escrituraAtomica');

const RATIO_MINIMO = 0.85;
const VENTANA_DIAS = 7;
const MAX_ENTRADAS_HISTORIAL = 200; // ~7 días a 12 corridas/día = 84, con margen

/**
 * Historial de corridas aceptadas del catálogo anterior (dentro de la ventana). Un catálogo
 * escrito antes de este cambio no trae `guardrail.historial`: se siembra con su propio
 * {fecha, total_skus}, que es exactamente la vara que se usaba antes.
 */
function historialVigente(anterior, ahora) {
  if (!anterior) return [];
  let historial = Array.isArray(anterior.guardrail?.historial) ? anterior.guardrail.historial : [];
  if (!historial.length && typeof anterior.total_skus === 'number') {
    historial = [{ fecha: anterior.fecha || new Date(ahora).toISOString(), total_skus: anterior.total_skus }];
  }
  const limite = ahora - VENTANA_DIAS * 86400000;
  return historial.filter(h =>
    typeof h?.total_skus === 'number' && h.total_skus > 0 && Date.parse(h.fecha) >= limite
  );
}

/**
 * Decide sin tocar disco (testeable). Devuelve { ok, referencia, historial } — `historial` es
 * el que hay que guardar si ok (incluye la corrida nueva).
 */
function evaluarGuardrail(anterior, nuevoTotal, ahora = Date.now()) {
  const vigente = historialVigente(anterior, ahora);
  const referencia = vigente.length ? Math.max(...vigente.map(h => h.total_skus)) : null;
  const ok = referencia == null || nuevoTotal >= referencia * RATIO_MINIMO;
  const historial = [...vigente, { fecha: new Date(ahora).toISOString(), total_skus: nuevoTotal }]
    .slice(-MAX_ENTRADAS_HISTORIAL);
  return { ok, referencia, historial };
}

function guardarCatalogoConGuardrail(ruta, datos, { ahora = Date.now() } = {}) {
  const nuevoTotal = datos.total_skus;
  let anterior = null;
  if (fs.existsSync(ruta)) {
    try {
      anterior = JSON.parse(fs.readFileSync(ruta, 'utf8'));
    } catch {
      anterior = null;
    }
  }
  const { ok, referencia, historial } = evaluarGuardrail(anterior, nuevoTotal, ahora);
  if (!ok) {
    throw new Error(
      `Catálogo sospechosamente chico: ${nuevoTotal} SKUs nuevos vs. ${referencia} (máximo de las corridas ` +
      `aceptadas en los últimos ${VENTANA_DIAS} días, < ${Math.round(RATIO_MINIMO * 100)}%). No se pisa ${ruta} — ` +
      `probable corte de paginación a mitad de camino, no un vaciamiento real.`
    );
  }
  escribirAtomico(ruta, JSON.stringify({ ...datos, guardrail: { historial } }, null, 2));
}

module.exports = { guardarCatalogoConGuardrail, evaluarGuardrail, RATIO_MINIMO, VENTANA_DIAS };
