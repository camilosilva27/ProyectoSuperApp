/**
 * Genera un .html a partir de las mismas líneas que ya se imprimen en la terminal
 * (buscar-promos.js las captura interceptando console.log). No reimplementa el
 * formato de cada sección — evita que la versión HTML se desincronice de la terminal.
 * Solo agrupa en "tarjetas" separando por las líneas divisorias que el código ya usa
 * (=, ─, ═ repetidos) y destaca la tarjeta del Plan Final llevándola arriba de todo.
 *
 * Única excepción: el bloque "RESUMEN FINAL DE COMPRA" (formato fijo, un producto
 * por grupo de líneas con un precio por súper) se parsea para mostrarlo como tabla
 * — es la sección donde comparar visualmente entre súper importa más. Si el formato
 * de esa sección cambia en buscar-promos.js y el parseo deja de encajar, se cae en
 * silencio al <pre> de siempre en vez de romper o mostrar una tabla vacía.
 */

const fs = require('fs');

function escapeHTML(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function agruparEnBloques(lineas) {
  const esDivisor = l => /^[=─═]{10,}$/.test(l.trim());
  const bloques = [];
  let actual = [];
  for (const linea of lineas) {
    if (esDivisor(linea)) {
      if (actual.some(l => l.trim())) bloques.push(actual);
      actual = [];
    } else {
      actual.push(linea);
    }
  }
  if (actual.some(l => l.trim())) bloques.push(actual);
  return bloques;
}

const PRODUCTO_RE = /^ {2}(\S+) (.+) ×(\d+)\s*$/;
const STORE_RE = /^\s+(.+?):\s+\$([\d.,]+)\s+(?:"(.+?)"\s+)?\(([^)]*)\)\s*$/;
const MEJOR_RE = /^\s*→\s*mejor en\s+(.+?):\s+\$([\d.,]+)\s*$/;

// Intenta leer el bloque "RESUMEN FINAL DE COMPRA" como filas producto→precio por
// súper. Devuelve null si no matchea (formato cambió, o no es ese bloque), nunca
// tira excepción — el llamador cae al <pre> de siempre ante cualquier duda.
function parsearResumenFinal(bloque) {
  if (!bloque.some(l => l.includes('RESUMEN FINAL DE COMPRA'))) return null;

  const filas = [];
  const storesVistos = [];
  let actual = null;
  for (const linea of bloque) {
    const mProducto = linea.match(PRODUCTO_RE);
    if (mProducto) {
      if (actual) filas.push(actual);
      actual = { tag: mProducto[1], nombre: mProducto[2], cantidad: mProducto[3], precios: {}, mejor: null };
      continue;
    }
    if (!actual) continue;
    const mMejor = linea.match(MEJOR_RE);
    if (mMejor) {
      actual.mejor = mMejor[1].trim();
      continue;
    }
    const mStore = linea.match(STORE_RE);
    if (mStore) {
      const nombreStore = mStore[1].trim();
      if (!storesVistos.includes(nombreStore)) storesVistos.push(nombreStore);
      actual.precios[nombreStore] = { total: mStore[2], productoNombre: mStore[3] || null, oferta: mStore[4] };
    }
  }
  if (actual) filas.push(actual);

  if (!filas.length || !storesVistos.length) return null;
  return { filas, stores: storesVistos };
}

function generarTablaResumenFinal({ filas, stores }) {
  const columnas = stores.map(s => `<th>${escapeHTML(s)}</th>`).join('');
  const filasHTML = filas.map(fila => {
    const celdas = stores.map(store => {
      const p = fila.precios[store];
      if (!p) return '<td class="sin-dato">—</td>';
      const esMejor = fila.mejor === store;
      const detalle = p.productoNombre ? `<div class="producto-detalle">${escapeHTML(p.productoNombre)}</div>` : '';
      return `<td class="${esMejor ? 'mejor' : ''}">$${escapeHTML(p.total)}${detalle}<div class="oferta">${escapeHTML(p.oferta)}</div></td>`;
    }).join('');
    return `        <tr><td class="producto">${escapeHTML(fila.tag)} ${escapeHTML(fila.nombre)}</td><td class="cantidad">×${fila.cantidad}</td>${celdas}</tr>`;
  }).join('\n');

  return `<table class="tabla-resumen">
      <thead><tr><th>Producto</th><th>Cant.</th>${columnas}</tr></thead>
      <tbody>
${filasHTML}
      </tbody>
    </table>`;
}

function generarReporteHTML(lineas, { titulo = 'AllPromos — resultado', subtitulo = '' } = {}) {
  const bloques = agruparEnBloques(lineas);
  const idxPlanFinal = bloques.findIndex(b => b.some(l => l.includes('PLAN FINAL')));
  const ordenados = idxPlanFinal > 0
    ? [bloques[idxPlanFinal], ...bloques.slice(0, idxPlanFinal), ...bloques.slice(idxPlanFinal + 1)]
    : bloques;

  const cardsHTML = ordenados.map(bloque => {
    const destacado = idxPlanFinal >= 0 && bloque === bloques[idxPlanFinal];

    const resumen = parsearResumenFinal(bloque);
    if (resumen) {
      return `      <section class="card card-tabla"><h2>🛒 Resumen final de compra</h2>${generarTablaResumenFinal(resumen)}</section>`;
    }

    const texto = escapeHTML(bloque.join('\n').trim());
    return `      <section class="card${destacado ? ' destacado' : ''}"><pre>${texto}</pre></section>`;
  }).join('\n');

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>${escapeHTML(titulo)}</title>
<style>
  :root { color-scheme: light; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    background: #f4f5f7; color: #1c1e21; margin: 0; padding: 32px 16px;
  }
  header { max-width: 900px; margin: 0 auto 20px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .subtitulo { color: #666; font-size: 13px; }
  .contenedor { max-width: 900px; margin: 0 auto; display: flex; flex-direction: column; gap: 16px; }
  .card {
    background: #fff; border: 1px solid #e1e4e8; border-radius: 10px;
    padding: 16px 22px; box-shadow: 0 1px 2px rgba(0,0,0,0.05);
  }
  .card.destacado { border: 2px solid #2e7d32; background: #f4fbf4; }
  pre {
    margin: 0; white-space: pre-wrap; word-break: break-word;
    font-family: "SF Mono", Menlo, Consolas, monospace; font-size: 13px; line-height: 1.55;
  }
  .card-tabla { padding: 16px; overflow-x: auto; }
  .card-tabla h2 { font-size: 15px; margin: 0 0 12px 6px; }
  .tabla-resumen { width: 100%; border-collapse: collapse; font-size: 13px; }
  .tabla-resumen th {
    text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: 0.03em;
    color: #666; padding: 6px 10px; border-bottom: 2px solid #e1e4e8;
  }
  .tabla-resumen td { padding: 8px 10px; border-bottom: 1px solid #eef0f2; vertical-align: top; }
  .tabla-resumen tr:last-child td { border-bottom: none; }
  .tabla-resumen tr:hover td { background: #fafbfc; }
  .tabla-resumen td.producto { font-weight: 500; white-space: nowrap; }
  .tabla-resumen td.cantidad { color: #666; white-space: nowrap; }
  .tabla-resumen td.sin-dato { color: #bbb; text-align: center; }
  .tabla-resumen td.mejor { background: #eaf7ec; font-weight: 600; border-radius: 6px; }
  .tabla-resumen .producto-detalle { font-weight: 400; color: #555; font-size: 12px; margin-top: 2px; }
  .tabla-resumen .oferta { font-weight: 400; color: #777; font-size: 12px; margin-top: 2px; }
  .tabla-resumen td.mejor .oferta { color: #2e7d32; }
  @media print {
    body { background: #fff; padding: 0; }
    .card { box-shadow: none; break-inside: avoid; }
  }
</style>
</head>
<body>
  <header>
    <h1>${escapeHTML(titulo)}</h1>
    ${subtitulo ? `<div class="subtitulo">${escapeHTML(subtitulo)}</div>` : ''}
  </header>
  <div class="contenedor">
${cardsHTML}
  </div>
</body>
</html>
`;
}

function escribirReporteHTML(rutaArchivo, lineas, meta) {
  fs.writeFileSync(rutaArchivo, generarReporteHTML(lineas, meta), 'utf8');
  return rutaArchivo;
}

module.exports = { generarReporteHTML, escribirReporteHTML };
