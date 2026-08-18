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
 * ambigüedad (0 candidatos, candidatos con EANs distintos, o sin tamaño detectable en el
 * nombre de La Anónima) NO se asigna EAN — mismo criterio de "ante ambigüedad, no adivinar"
 * que ya usa el proyecto en otros lados. Los productos marca propia de La Anónima (sin
 * equivalente en otro super) quedan sin EAN a propósito: no es un bug, es que no existen en
 * los otros catálogos.
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

const UNIDAD_RE = /(\d+(?:[.,]\d+)?)\s*(kgs?|grs?|g|mls?|cc|lts?|l|un|u|unid)\b/i;
const STOPWORDS = new Set(['x', 'de', 'del', 'la', 'el', 'los', 'las', 'un', 'una', 'con', 'sin', 'c', 's', 'y', 'en']);

/** Convierte cantidad+unidad a un código canónico comparable (gramos, mililitros o unidades). */
function unidadCanonica(match) {
  const valor = parseFloat(match[1].replace(',', '.'));
  const unidad = match[2].toLowerCase();
  if (/^kgs?$/.test(unidad)) return `PESO:${Math.round(valor * 1000)}`;
  if (/^grs?$|^g$/.test(unidad)) return `PESO:${Math.round(valor)}`;
  if (/^lts?$|^l$/.test(unidad)) return `VOL:${Math.round(valor * 1000)}`;
  if (/^mls?$|^cc$/.test(unidad)) return `VOL:${Math.round(valor)}`;
  return `UNID:${Math.round(valor)}`;
}

/** Firma normalizada: código de tamaño + palabras significativas ordenadas (agnóstico de orden). */
function firmaDeNombre(nombreCrudo) {
  const texto = normalize(nombreCrudo).replace(/[.,;:()/]/g, ' ');
  const matchUnidad = texto.match(UNIDAD_RE);
  const codigoTamano = matchUnidad ? unidadCanonica(matchUnidad) : null;
  const sinUnidad = matchUnidad ? texto.replace(matchUnidad[0], ' ') : texto;

  const palabras = sinUnidad
    .split(/\s+/)
    .filter(Boolean)
    .filter((p) => !STOPWORDS.has(p))
    .filter((p) => !/^\d+$/.test(p)); // números sueltos ya cubiertos por el código de tamaño

  const palabrasUnicas = [...new Set(palabras)].sort();
  return { codigoTamano, palabrasUnicas, firma: `${codigoTamano || 'SIN_TAMANO'}|${palabrasUnicas.join(' ')}` };
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
  for (const s of catalogo.skus) {
    s.ean = null;
    delete s.eanInferido;
  }

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
  const sinTamano = [];
  const sinCandidato = [];

  for (const sku of catalogo.skus) {
    const { firma, palabrasUnicas, codigoTamano } = firmaDeNombre(sku.nombre);

    if (!codigoTamano) {
      sinTamano.push(sku);
      continue;
    }
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
    // tamaño (bucket precalculado), muy estricto.
    let mejor = null;
    for (const firmaOtro of firmasPorTamano.get(codigoTamano) || []) {
      const candidatos = candidatosPorFirma.get(firmaOtro);
      const primero = candidatos[0];
      const sim = jaccard(palabrasUnicas, primero.palabrasUnicas);
      if (sim >= 0.8) {
        const eansDeEstaFirma = indicePorFirma.get(firmaOtro);
        if (eansDeEstaFirma.size > 1) continue; // esa firma ya es ambigua en sí misma
        if (!mejor || sim > mejor.sim) mejor = { sim, ean: [...eansDeEstaFirma][0], nombre: primero.nombre };
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

  const totalSinMatch = sinTamano.length + sinCandidato.length + ambiguos.length;
  console.log('=== RESULTADO ===');
  console.log(`  Total SKUs La Anónima:        ${catalogo.skus.length}`);
  console.log(`  Matcheados (ean asignado):    ${matcheados.length}`);
  console.log(`  Ambiguos (varios EAN, no se asignó): ${ambiguos.length}`);
  console.log(`  Sin tamaño detectable:        ${sinTamano.length}`);
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
      sinTamano: sinTamano.length,
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
    sinTamanoDetectable: sinTamano.map((s) => ({ idInterno: s.idInterno, nombre: s.nombre, categoria: s.categoria, precioBase: s.precioBase })),
    sinCandidato: sinCandidato.map((s) => ({ idInterno: s.idInterno, nombre: s.nombre, categoria: s.categoria, precioBase: s.precioBase })),
  }, null, 2));

  console.log(`\nReporte completo (todos los sin-match, para revisión manual) guardado en: ${path.basename(ARCHIVO_REPORTE)}`);
}

main();
