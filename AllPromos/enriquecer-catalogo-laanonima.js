/**
 * Enriquecimiento de catalogo-laanonima.json: intenta asignar el EAN real de otro super a
 * cada SKU de La Anónima, dado que su HTML no expone EAN en ningún lado (ver cabecera de
 * scraper-promos-laanonima.js). Sin esto, La Anónima nunca podría cruzarse con el resto del
 * proyecto, que asume EAN como clave de identidad en todo el stack (core/catalogo.js,
 * precioCache.js, unificarCatalogo.js).
 *
 * Criterio CONSERVADOR (decisión explícita del usuario, 2026-08-18): solo se asigna un EAN
 * si hay un único candidato inequívoco en los otros 5 catálogos, comparando por firma de
 * nombre normalizada (marca + palabras significativas + tamaño/peso). Ante cualquier
 * ambigüedad (0 candidatos o candidatos con EANs distintos) NO se asigna EAN — mismo criterio
 * de "ante ambigüedad, no adivinar" que ya usa el proyecto en otros lados. Los productos marca
 * propia de La Anónima (sin equivalente en otro super) quedan sin EAN a propósito: no es un
 * bug, es que no existen en los otros catálogos.
 *
 * SIN TAMAÑO DETECTABLE (agregado 2026-08-19): productos de fiambrería/carnicería vendidos
 * "(Kg)" sin peso fijo no tienen ningún tamaño que extraer del nombre — antes se descartaban
 * de entrada. Ahora `codigoTamano === null` es un valor de tamaño más ("SIN_TAMANO"), así que
 * estos SKUs matchean entre sí por firma exacta con el mismo criterio de siempre. Nunca pueden
 * matchear contra un producto con tamaño fijo (firma distinta por construcción), así que esto
 * no mezcla variable con fijo.
 *
 * INVARIANTE (decisión explícita del usuario, 2026-08-18): este script es de solo lectura
 * sobre los otros 5 catálogos — nunca los modifica, y su prioridad más baja en
 * unificarCatalogo.js/precioCache.js hace que un match malo de La Anónima nunca pueda
 * degradar ni pisar el nombre/precio/disponibilidad de otro super. Si un match sale mal, el
 * único dato incorrecto que se muestra es el precio de La Anónima — nunca el de Coto ni de
 * ningún otro. Cualquier ajuste al criterio de matching tiene que preservar esto: el riesgo
 * de una mejora en el matching cae siempre del lado de La Anónima, jamás del de los demás.
 *
 * Fallback por similitud (Jaccard) CON marca obligatoria (agregado 2026-08-18, ver
 * laanonima-integracion en memoria): cuando la mayoría de las palabras de un nombre son
 * genéricas ("aceite", "oliva", "extra", "virgen"), dos productos de MARCAS DISTINTAS pueden
 * superar 0.8 de similitud por casualidad (caso real encontrado: "Aceite ... Lata Zuelo"
 * matcheaba con "Aceite ... Cañuelas Intenso Lata" por las 6 palabras genéricas compartidas,
 * ignorando que "Zuelo" y "Cañuelas" son marcas distintas). Por eso el fallback exige que la
 * marca de La Anónima (`sku.marca`, normalizada) aparezca literalmente entre las palabras del
 * candidato — la similitud por Jaccard sola nunca alcanza, tiene que haber coincidencia de
 * marca primero.
 *
 * PALABRAS_ENVASE: "Botella"/"Pet"/"Lata"/"Vidrio" etc. son ruido que un lado del matching
 * menciona y el otro no (ej. La Anónima dice "Aceite Cañuelas x 900cc", Coto dice "Aceite
 * Cañuelas Botella 900ml" — mismo producto, "Botella" no debería contar ni a favor ni en
 * contra). Se descartan antes de calcular la firma/Jaccard, igual que las STOPWORDS.
 *
 * PRIORIDAD SOBRE EL EAN REAL (agregado 2026-08-18, ver aplicar-ean-flix-laanonima.js): el EAN
 * real de Flix Media (`sku.eanFuente === 'flix'`) es la fuente de verdad y nunca se pisa ni se
 * recalcula acá — ese proceso, aparte y mucho más caro (pide una página por producto), hoy
 * está incompleto/pausado por un bloqueo del sitio (227/8197 al momento de escribir esto). Este
 * script solo rellena con matching por nombre los SKUs que Flix todavía no resolvió.
 *
 * Salida:
 *   catalogo-laanonima.json          — reescrito con ean + eanInferido:true donde matcheó
 *   laanonima-reporte-matching.json  — resumen + TODOS los productos sin match, para revisión manual
 */

const fs = require('fs');
const path = require('path');
const { normalize, skusDe } = require('./core/catalogo');

const ARCHIVO_CATALOGO = path.join(__dirname, 'catalogo-laanonima.json');
const ARCHIVO_REPORTE = path.join(__dirname, 'laanonima-reporte-matching.json');

const OTROS_CATALOGOS = ['catalogo-vea.json', 'catalogo-carrefour.json', 'catalogo-changomas.json', 'catalogo-dia.json', 'catalogo-coto.json'];

const UNIDAD_RE = /(\d+(?:[.,]\d+)?)\s*(kgs?|grs?|g|mls?|cc|cm3|lts?|l|unidades|unid|un|u)\b/i;
const STOPWORDS = new Set(['x', 'de', 'del', 'la', 'el', 'los', 'las', 'un', 'una', 'con', 'sin', 'c', 's', 'y', 'en']);
// Tipo de envase/empaque: un lado del matching lo menciona y el otro no, sin que eso signifique
// un producto distinto (ver nota en la cabecera del archivo).
const PALABRAS_ENVASE = new Set([
  'botella', 'pet', 'lata', 'vidrio', 'sachet', 'doypack', 'doy', 'pouch', 'bidon', 'frasco',
  'envase', 'tetra', 'brik', 'pomo', 'tarro', 'display', 'blister', 'pack', 'bot',
]);
// Abreviaturas que solo se expanden cuando no hay ambigüedad real (ej. "Ext" siempre es
// "Extra" en este dominio — no hay otra palabra de aceites/cosmética que se abrevie igual).
const ABREVIATURAS = { ext: 'extra' };

/** Convierte cantidad+unidad a un código canónico comparable (gramos, mililitros o unidades). */
function unidadCanonica(match) {
  const valor = parseFloat(match[1].replace(',', '.'));
  const unidad = match[2].toLowerCase();
  if (/^kgs?$/.test(unidad)) return `PESO:${Math.round(valor * 1000)}`;
  if (/^grs?$|^g$/.test(unidad)) return `PESO:${Math.round(valor)}`;
  if (/^lts?$|^l$/.test(unidad)) return `VOL:${Math.round(valor * 1000)}`;
  if (/^mls?$|^cc$|^cm3$/.test(unidad)) return `VOL:${Math.round(valor)}`;
  return `UNID:${Math.round(valor)}`;
}

/**
 * Firma normalizada: código de tamaño + palabras significativas ordenadas (agnóstico de orden).
 *
 * OJO — bug real encontrado y corregido (2026-08-18): `productName`+`skuName` de los catálogos
 * VTEX a veces vienen duplicados literalmente (mismo texto dos veces, cuando no hay variante
 * real que distinga al SKU). Con un `.replace()` sin `/g` solo se borraba la PRIMERA mención
 * del tamaño, dejando un "ml"/"g" suelto de la segunda mención como palabra — eso rompía la
 * firma exacta contra La Anónima en casos que deberían haber matcheado (ej. "Aceite ... Nucete
 * 500 Ml" con la mención duplicada). El replace ahora es global.
 */
function firmaDeNombre(nombreCrudo) {
  // "&amp;" (entidad HTML sin decodificar, encontrada en nombres reales) y "&" sueltos
  // equivalen a "y" — se normalizan a eso para que STOPWORDS los termine descartando, en vez
  // de quedar como palabras literales "&amp;"/"&" que nunca van a matchear nada.
  const conEntidades = nombreCrudo.replace(/&amp;|&/gi, ' y ');
  // El guion se trata como separador, no como parte de la palabra: "Girasol-" (pegado al
  // guion) nunca matcheaba con "Girasol" limpio de otro catálogo.
  const texto = normalize(conEntidades).replace(/[.,;:()/-]/g, ' ');
  const matchUnidad = texto.match(UNIDAD_RE);
  const codigoTamano = matchUnidad ? unidadCanonica(matchUnidad) : null;
  const sinUnidad = matchUnidad ? texto.replace(new RegExp(UNIDAD_RE.source, 'gi'), ' ') : texto;

  const palabras = sinUnidad
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => ABREVIATURAS[p] || p)
    .filter((p) => !STOPWORDS.has(p))
    .filter((p) => !PALABRAS_ENVASE.has(p))
    .filter((p) => !/^\d+$/.test(p)); // números sueltos ya cubiertos por el código de tamaño

  const palabrasUnicas = [...new Set(palabras)].sort();
  return { codigoTamano, palabrasUnicas, firma: `${codigoTamano || 'SIN_TAMANO'}|${palabrasUnicas.join(' ')}` };
}

/** Palabras significativas de la marca de La Anónima (normalizadas), para exigir que
 *  aparezcan en el candidato antes de aceptar un match por similitud (ver cabecera). */
function palabrasDeMarca(marcaCruda) {
  if (!marcaCruda) return [];
  return normalize(marcaCruda)
    .replace(/[.,;:()/-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .filter((p) => !STOPWORDS.has(p));
}

function jaccard(a, b) {
  const setA = new Set(a);
  const setB = new Set(b);
  const interseccion = [...setA].filter((x) => setB.has(x)).length;
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 0 : interseccion / union;
}

function main() {
  console.log('=== Enriquecimiento de catalogo-laanonima.json (matching por nombre) ===\n');

  const catalogo = JSON.parse(fs.readFileSync(ARCHIVO_CATALOGO, 'utf8'));
  // Reset para que el script sea idempotente (una corrida anterior pudo haber dejado un ean
  // asignado que esta corrida ahora considera ambiguo — sin este reset quedaría "pegado").
  // Los SKUs con EAN real de Flix (`eanFuente === 'flix'`) NUNCA se resetean ni se re-derivan
  // acá — ver aplicar-ean-flix-laanonima.js, que corre antes y es la fuente de verdad.
  let conEanReal = 0;
  for (const s of catalogo.skus) {
    if (s.eanFuente === 'flix') { conEanReal++; continue; }
    s.ean = null;
    delete s.eanInferido;
  }
  if (conEanReal) console.log(`SKUs con EAN real de Flix (no se tocan): ${conEanReal}\n`);

  // Índice de candidatos de los otros 5 supers: firma exacta -> Set de EANs distintos.
  const indicePorFirma = new Map(); // firma -> Set<ean>
  const candidatosPorFirma = new Map(); // firma -> [{ean, nombre, palabrasUnicas, codigoTamano}]

  let totalCandidatosOtros = 0;
  for (const archivo of OTROS_CATALOGOS) {
    for (const s of skusDe(archivo)) {
      if (!s.ean) continue;
      // Coto usa `nombre` (un solo campo); Vea/Carrefour/Changomás/Día usan `productName`+`skuName`.
      const nombreCompleto = (s.productName || s.skuName)
        ? `${s.productName || ''} ${s.skuName || ''}`.trim()
        : (s.nombre || '').trim();
      if (!nombreCompleto) continue;
      const { firma, palabrasUnicas, codigoTamano } = firmaDeNombre(nombreCompleto);
      if (palabrasUnicas.length < 2) continue; // firma demasiado genérica, no sirve como candidato
      totalCandidatosOtros++;
      if (!indicePorFirma.has(firma)) {
        indicePorFirma.set(firma, new Set());
        candidatosPorFirma.set(firma, []);
      }
      indicePorFirma.get(firma).add(s.ean);
      candidatosPorFirma.get(firma).push({ ean: s.ean, nombre: nombreCompleto, palabrasUnicas, codigoTamano });
    }
  }
  console.log(`Candidatos indexados de los otros 5 supers: ${totalCandidatosOtros}`);
  console.log(`Firmas distintas: ${indicePorFirma.size}\n`);

  // Bucket por tamaño para que el fallback por similitud no tenga que escanear TODAS las firmas.
  const firmasPorTamano = new Map(); // codigoTamano -> [firma, ...]
  for (const [firma, candidatos] of candidatosPorFirma) {
    const { codigoTamano } = candidatos[0];
    if (!firmasPorTamano.has(codigoTamano)) firmasPorTamano.set(codigoTamano, []);
    firmasPorTamano.get(codigoTamano).push(firma);
  }

  const matcheados = [];
  const ambiguos = [];
  const sinCandidato = [];

  for (const sku of catalogo.skus) {
    if (sku.eanFuente === 'flix') continue; // ya resuelto con la fuente real, no matchear por nombre

    // codigoTamano === null (p.ej. fiambrería/carnicería vendida "(Kg)", sin peso fijo) es un
    // valor de tamaño más: no se descarta, se matchea contra otros SIN_TAMANO por firma exacta
    // con el mismo criterio conservador — nunca contra un candidato con tamaño fijo (distinta
    // firma por construcción), así que no hay riesgo de mezclar variable con fijo.
    const { firma, palabrasUnicas, codigoTamano } = firmaDeNombre(sku.nombre);

    if (palabrasUnicas.length < 2) {
      sinCandidato.push(sku);
      continue;
    }

    const eansExactos = indicePorFirma.get(firma);
    if (eansExactos && eansExactos.size === 1) {
      const [ean] = eansExactos;
      sku.ean = ean;
      sku.eanInferido = true;
      matcheados.push({ ...sku, matchContra: candidatosPorFirma.get(firma)[0].nombre });
      continue;
    }
    if (eansExactos && eansExactos.size > 1) {
      ambiguos.push({ sku, candidatos: candidatosPorFirma.get(firma) });
      continue;
    }

    // Sin firma exacta: buscar por similitud (Jaccard) solo entre firmas del mismo código de
    // tamaño (bucket precalculado). Exige además que la marca de La Anónima aparezca en el
    // candidato — sin esto, dos productos de marcas distintas con nombres genéricos (aceite,
    // oliva, extra, virgen...) pueden superar el umbral por casualidad (ver cabecera).
    const marcaPalabras = palabrasDeMarca(sku.marca);
    let mejor = null;
    if (marcaPalabras.length) {
      for (const firmaOtro of firmasPorTamano.get(codigoTamano) || []) {
        const candidatos = candidatosPorFirma.get(firmaOtro);
        const primero = candidatos[0];
        const tieneMarca = marcaPalabras.every((p) => primero.palabrasUnicas.includes(p));
        if (!tieneMarca) continue;
        const sim = jaccard(palabrasUnicas, primero.palabrasUnicas);
        if (sim >= 0.8) {
          const eansDeEstaFirma = indicePorFirma.get(firmaOtro);
          if (eansDeEstaFirma.size > 1) continue; // esa firma ya es ambigua en sí misma
          if (!mejor || sim > mejor.sim) mejor = { sim, ean: [...eansDeEstaFirma][0], nombre: primero.nombre };
        }
      }
    }

    if (mejor) {
      sku.ean = mejor.ean;
      sku.eanInferido = true;
      matcheados.push({ ...sku, matchContra: mejor.nombre, similitud: mejor.sim.toFixed(2) });
    } else {
      sinCandidato.push(sku);
    }
  }

  fs.writeFileSync(ARCHIVO_CATALOGO, JSON.stringify(catalogo, null, 2));

  const totalSinMatch = sinCandidato.length + ambiguos.length;
  console.log('=== RESULTADO ===');
  console.log(`  Total SKUs La Anónima:        ${catalogo.skus.length}`);
  console.log(`  Matcheados (ean asignado):    ${matcheados.length}`);
  console.log(`  Ambiguos (varios EAN, no se asignó): ${ambiguos.length}`);
  console.log(`  Sin candidato:                ${sinCandidato.length}`);
  console.log(`  TOTAL sin match:              ${totalSinMatch}\n`);

  console.log('Muestra de matcheados:');
  matcheados.slice(0, 15).forEach((m) => {
    console.log(`  - "${m.nombre}" (La Anónima) <-> "${m.matchContra}" — EAN ${m.ean}${m.similitud ? ` (similitud ${m.similitud})` : ' (firma exacta)'}`);
  });

  console.log('\nMuestra de ambiguos (no se asignó EAN):');
  ambiguos.slice(0, 10).forEach(({ sku, candidatos }) => {
    console.log(`  - "${sku.nombre}" -> ${candidatos.length} candidatos con EAN distinto: ${[...new Set(candidatos.map((c) => c.ean))].join(', ')}`);
  });

  fs.writeFileSync(ARCHIVO_REPORTE, JSON.stringify({
    fecha: new Date().toISOString(),
    resumen: {
      totalSkus: catalogo.skus.length,
      matcheados: matcheados.length,
      ambiguos: ambiguos.length,
      sinCandidato: sinCandidato.length,
      totalSinMatch,
    },
    ambiguos: ambiguos.map(({ sku, candidatos }) => ({
      idInterno: sku.idInterno,
      nombre: sku.nombre,
      categoria: sku.categoria,
      precioBase: sku.precioBase,
      candidatosConEanDistinto: [...new Set(candidatos.map((c) => c.ean))],
    })),
    sinCandidato: sinCandidato.map((s) => ({ idInterno: s.idInterno, nombre: s.nombre, categoria: s.categoria, precioBase: s.precioBase })),
  }, null, 2));

  console.log(`\nReporte completo (todos los sin-match, para revisión manual) guardado en: ${path.basename(ARCHIVO_REPORTE)}`);
}

main();
