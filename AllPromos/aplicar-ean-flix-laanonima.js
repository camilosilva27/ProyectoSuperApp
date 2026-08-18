/**
 * Aplica sobre catalogo-laanonima.json los EAN REALES ya resueltos en laanonima-ean-flix.json
 * (ver resolver-ean-laanonima-flix.js) — el widget de Flix Media en la página de producto
 * individual, fuente de verdad, no una aproximación por nombre.
 *
 * Corre SIEMPRE entre el scraper de categoría (que arranca cada SKU con `ean: null`) y
 * enriquecer-catalogo-laanonima.js (matching por nombre, que respeta `eanFuente: 'flix'` y
 * nunca lo pisa ni lo re-deriva — ver su cabecera). Este paso es barato: solo lee dos JSON
 * locales, sin red, así que corre en cada refresco aunque la resolución de EAN real (proceso
 * caro, una página por producto) esté incompleta.
 *
 * Estado 2026-08-18: resolver-ean-laanonima-flix.js está pausado por un bloqueo del sitio
 * (WAF, ver laanonima-integracion en memoria) — 227/8197 SKUs resueltos hasta ahora. Este
 * script aplica lo que haya en cada momento; a medida que se complete la resolución a mano
 * en el futuro (retomando ese script), automáticamente se aplica más en cada corrida.
 *
 * Uso: node aplicar-ean-flix-laanonima.js
 */

const fs = require('fs');
const path = require('path');

const ARCHIVO_CATALOGO = path.join(__dirname, 'catalogo-laanonima.json');
const ARCHIVO_MAPA = path.join(__dirname, 'laanonima-ean-flix.json');

function main() {
  let mapa;
  try {
    mapa = JSON.parse(fs.readFileSync(ARCHIVO_MAPA, 'utf8'));
  } catch {
    console.log(`Sin ${path.basename(ARCHIVO_MAPA)} todavía — nada que aplicar.`);
    return;
  }

  const catalogo = JSON.parse(fs.readFileSync(ARCHIVO_CATALOGO, 'utf8'));

  let aplicados = 0;
  for (const sku of catalogo.skus) {
    const entrada = mapa[sku.idInterno];
    if (!entrada || !entrada.ean) continue;
    sku.ean = entrada.ean;
    sku.eanInferido = false;
    sku.eanFuente = 'flix';
    aplicados++;
  }

  fs.writeFileSync(ARCHIVO_CATALOGO, JSON.stringify(catalogo, null, 2));

  const totalResueltos = Object.values(mapa).filter((v) => v.ean).length;
  console.log(`EAN reales (Flix) aplicados a catalogo-laanonima.json: ${aplicados} / ${catalogo.skus.length} SKUs`);
  console.log(`Total resuelto en ${path.basename(ARCHIVO_MAPA)}: ${totalResueltos} / ${Object.keys(mapa).length} procesados hasta ahora`);
}

main();
