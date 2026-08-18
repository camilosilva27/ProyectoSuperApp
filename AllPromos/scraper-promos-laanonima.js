/**
 * Scraper de La Anónima — catálogo con precios y promociones.
 *
 * La Anónima NO es VTEX ni ninguna API de terceros (a diferencia de los otros 5 supers). Es
 * plataforma propia: las categorías se sirven como HTML server-renderizado, con cada producto
 * como un `<div id-codigo-producto="...">` cuyo `<a>` interno trae todos los datos como
 * atributos `data-*` (precio, nombre, categoría). No hay una API de catálogo/búsqueda en JSON
 * (el endpoint `/catalogo/buscador/{term}` devolvió 403 de CloudFront — no confirmado si es
 * bloqueo real o transitorio, no se usa).
 *
 * HALLAZGOS DEL SPIKE (2026-08-17, confirmados en vivo):
 *
 * 1. **El precio NO depende de zona/CP.** El HTML de una página de categoría es byte a byte
 *    idéntico sin importar qué CP/zona se le pase (probado con query params `?cp=`, `?zona=`,
 *    etc. — ninguno cambia el HTML; `api.laanonima.com.ar/sucursal/{cp}` tampoco setea cookie).
 *    El campo `haySucursalSuper` de esa API es solo un gate de "¿hay venta de super en esta
 *    zona?" (relevante en `core/laanonima-zona.js` para el CP del usuario), no un selector de
 *    precio — por eso este scraper no necesita ningún CP de referencia ni manejo de sesión.
 * 2. **No hay EAN en ningún lado del HTML** (ni en la card de categoría ni en la página de
 *    producto individual `/slug/art_NNNNN/` — esta última tampoco trae precio server-rendered,
 *    se carga por JS aparte, así que ni sirve como fuente de precio en vivo). La única identidad
 *    estable es `data-codigo` (id interno de La Anónima), guardado como `idInterno`. El campo
 *    `ean` queda `null` acá — el join best-effort contra el EAN de otros supers (si se hace) es
 *    responsabilidad de la integración del catálogo, no de este scraper.
 * 3. Los 403 observados son por **User-Agent** (el WAF de CloudFront bloquea UAs tipo curl
 *    pelado), no rate-limit puro — con un UA de navegador real y espaciado no volvieron a
 *    aparecer en las pruebas del spike.
 * 4. Sin paginación detectada en las categorías probadas (ninguna trajo "ver más"/`?page=`).
 *
 * CATEGORIAS: lista fija de 134 categorías-hoja (mismo criterio que `scraper-promos-coto.js`),
 * obtenida de `sitemap-listados.xml` filtrando a los rubros de supermercado (Almacén, Bebidas,
 * Bebidas Alcohólicas, Lácteos y Frescos, Congelados, Frutas y Verduras, Carnicería, Limpieza,
 * Perfumería, Belleza y Cuidado Personal, Mascotas) y excluyendo Electro/TV/Indumentaria/
 * Hogar/Construcción/Celulares — La Anónima vende de todo, pero el comparador es de supermercado.
 *
 * Salida:
 *   catalogo-laanonima.json  — todos los SKUs con idInterno, nombre, precio y promo
 *   promos-laanonima.json    — solo los SKUs con descuento directo
 */

const fs = require('fs');

const BASE_URL = 'https://www.laanonima.com.ar';

const CATEGORIAS = [
  '/accesorios-para-maquillaje/n3_265/', '/aceite/n3_604/', '/acondicionador/n3_677/',
  '/aderezos/n3_847/', '/afeitado-y-depilacion/n3_675/', '/aguas-con-gas/n3_855/',
  '/aguas-saborizadas-y-jugos/n3_853/', '/aguas-sin-gas/n3_854/', '/alfajores/n3_603/',
  '/alimentacion-bebes/n2_530/', '/aromatizantes-y-desinfectantes/n2_570/', '/arroz/n3_608/',
  '/atun-y-pescado/n3_616/', '/azucar-y-endulzantes/n3_840/', '/batata-y-membrillo/n3_733/',
  '/blancas-y-whiskies/n2_545/', '/blancos-y-rosados/n3_850/', '/blancos/n3_225/',
  '/bolsas-de-residuos/n3_782/', '/budines-y-madalenas/n3_841/', '/cacao-en-polvo/n3_838/',
  '/caldos-sopas-y-pure/n2_525/', '/carbon-y-lena/n2_590/', '/carne-vacuna/n2_586/',
  '/carne/n3_618/', '/cepillos-y-accesorios/n3_860/', '/cerdo/n2_588/', '/cereales/n3_842/',
  '/cervezas/n2_221/', '/cervezas/n2_540/', '/chocolates/n3_844/', '/colonias-y-lociones/n3_682/',
  '/coloracion/n3_862/', '/cremas-corporales/n3_678/', '/cremas-dentales/n3_859/',
  '/cremas-faciales/n3_299/', '/cremas-faciales/n3_679/', '/cremas-para-peinar-y-tratamientos/n3_863/',
  '/cremas/n3_870/', '/desodorante/n3_674/', '/detergentes-y-antigrasas/n3_865/',
  '/detergentes-y-jabones/n3_701/', '/dieteticas/n3_848/', '/dulce-de-leche/n3_796/',
  '/dulces-y-mermeladas/n3_843/', '/embutidos/n2_589/', '/empanadas-pizzas-y-tartas/n2_773/',
  '/encurtidos/n3_620/', '/enjuagues/n3_861/', '/escobas-palas-y-baldes/n3_710/',
  '/esmaltes-y-maquillajes/n3_681/', '/espirituosas/n2_223/', '/esponjas-y-guantes/n3_708/',
  '/espumantes/n3_227/', '/espumantes/n3_851/', '/farmacia/n2_554/', '/fernet-y-aperitivos/n2_544/',
  '/fiambres/n3_732/', '/fideos-y-pastas/n3_609/', '/fruta/n3_619/', '/frutas-congeladas/n3_873/',
  '/frutas-frescas/n3_872/', '/frutos-secos-y-semillas/n3_874/', '/galletitas-dulces/n3_598/',
  '/galletitas-saladas-y-tostadas/n3_599/', '/gel-y-fijador/n3_864/', '/golosinas/n3_845/',
  '/hamburguesas/n2_768/', '/harina-de-trigo/n3_621/', '/harinas-especiales/n3_622/',
  '/helados-y-postres/n2_771/', '/higiene-femenina/n3_857/', '/higiene-y-cuidado/n3_790/',
  '/huevos/n2_578/', '/incontinencia/n3_217/', '/incontinencia/n3_858/', '/infusiones/n3_600/',
  '/insecticidas/n2_569/', '/isotonicas-y-energizantes/n2_546/', '/jabon/n3_673/',
  '/jugo-en-polvo/n3_856/', '/labios/n3_262/', '/lavandina/n3_866/', '/leche-en-polvo/n3_839/',
  '/leches/n3_722/', '/legumbres/n3_610/', '/limpiadores-bano/n3_868/', '/manteca-y-margarina/n3_725/',
  '/mascotas/n1_877/', '/medallones-y-hamburguesas-vegetarianas/n2_772/', '/milanesas-y-rebozados/n2_770/',
  '/muebles-y-pisos-de-madera/n2_567/', '/ojos/n3_263/', '/pan-lactal/n3_601/', '/pan-rallado/n3_623/',
  '/panales/n3_789/', '/panes-y-tortillas/n2_581/', '/panos-y-trapos/n3_709/', '/papas-y-vegetales/n2_769/',
  '/papel-higienico/n3_699/', '/para-hombre/n3_216/', '/para-mujer/n3_215/', '/pescados-y-mariscos/n2_774/',
  '/pisos-y-superficies/n3_867/', '/pollo/n2_587/', '/pomadas-y-otros/n3_704/', '/postres/n3_871/',
  '/prelavados-y-quitamanchas/n3_703/', '/protectores-y-post-solares/n3_680/', '/queso-untable/n3_723/',
  '/quesos/n3_731/', '/regulares/n3_849/', '/reposteria/n2_529/', '/rollo-de-cocina-y-servilletas/n3_700/',
  '/rosados/n3_224/', '/rostro/n3_264/', '/sal-y-especias/n3_606/', '/salchichas/n3_734/',
  '/shampoo/n3_676/', '/sidras/n3_852/', '/sin-tacc/n2_531/', '/snacks/n2_522/',
  '/suavizantes/n3_702/', '/tapas-y-levaduras/n2_580/', '/tintos/n3_226/', '/tintos/n3_661/',
  '/tomates-y-salsas/n3_615/', '/turrones-y-obleas/n3_846/', '/verdura/n3_617/',
  '/verduras-congeladas/n3_744/', '/verduras-frescas/n3_875/', '/vidrios-y-multiusos/n3_869/',
  '/vinagre-y-limon/n3_605/', '/yogures/n3_724/',
];

const DELAY_MS = 1500;
const RETRY_ESPERA_MS = 10000;

// UA de navegador real: el WAF de CloudFront bloquea UAs tipo curl pelado (403), pero no éste.
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
  'Accept': 'text/html',
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Extrae los productos de una página de categoría por atributos data-* (sin dependencias/DOM parser). */
function parsearProductosDeCategoria(html, urlCategoria) {
  const productos = [];
  const anchorRe = /id-codigo-producto="(\d+)"/g;
  const anchors = [];
  let m;
  while ((m = anchorRe.exec(html))) anchors.push({ idInterno: m[1], index: m.index });

  for (let i = 0; i < anchors.length; i++) {
    const { idInterno, index } = anchors[i];
    const fin = i + 1 < anchors.length ? anchors[i + 1].index : Math.min(html.length, index + 6000);
    const bloque = html.slice(index, fin);

    const nombre = bloque.match(/data-nombre\s*=\s*"([^"]*)"/)?.[1] || null;
    const marca = bloque.match(/data-marca\s*=\s*"([^"]*)"/)?.[1] || null;
    const rutaCategorias = bloque.match(/data-rutacategorias\s*=\s*"([^"]*)"/)?.[1] || null;
    const precioOfertaTxt = bloque.match(/data-precio_oferta\s*=\s*"([^"]*)"/)?.[1] || '';
    const precioAnteriorTxt = bloque.match(/data-precio_anterior\s*=\s*"([^"]*)"/)?.[1] || '';
    const hrefMatch = bloque.match(/href="(\/[^"]+\/art_\d+\/)"/);

    const precioOferta = parseFloat(precioOfertaTxt) || null;
    const precioAnterior = parseFloat(precioAnteriorTxt) || null;
    if (!nombre || !precioOferta) continue; // sin datos mínimos, se descarta (ej. producto sin stock/precio)

    const hayDescuento = precioAnterior && precioAnterior > precioOferta;
    const descuentoDirecto = hayDescuento
      ? {
          tipo: 'descuento_directo',
          precioBase: precioAnterior,
          precioFinal: precioOferta,
          descuentoPct: ((1 - precioOferta / precioAnterior) * 100).toFixed(0) + '%',
          descuento: (1 - precioOferta / precioAnterior).toFixed(4),
        }
      : null;

    productos.push({
      idInterno,
      ean: null, // La Anónima no expone EAN — ver nota en la cabecera del archivo
      nombre,
      marca,
      categoria: rutaCategorias ? rutaCategorias.replace(/\s+/g, ' ').replace(/\s*>\s*/g, ' > ').trim() : null,
      // La página de producto individual (urlProducto) NO trae precio server-rendered (se
      // carga por JS aparte, confirmado en el spike) — el fetch en vivo (core/fetchers.js)
      // tiene que re-pedir SIEMPRE urlCategoria, nunca urlProducto, para obtener el precio.
      urlProducto: hrefMatch ? `${BASE_URL}${hrefMatch[1]}` : null,
      urlCategoria: `${BASE_URL}${urlCategoria}`,
      precioBase: hayDescuento ? precioAnterior : precioOferta,
      descuentoDirecto,
    });
  }
  return productos;
}

async function getCategoria(urlCategoria, retries = 3) {
  const res = await fetch(`${BASE_URL}${urlCategoria}`, { headers: HEADERS });
  if ((res.status === 403 || res.status === 429 || res.status >= 500) && retries > 0) {
    process.stdout.write(` [${res.status}, esperando 10s]`);
    await sleep(RETRY_ESPERA_MS);
    return getCategoria(urlCategoria, retries - 1);
  }
  if (!res.ok) throw new Error(`Categoría ${urlCategoria} falló: ${res.status} ${res.statusText}`);
  return res.text();
}

async function main() {
  console.log('=== Scraper La Anónima — Catálogo + Promociones ===\n');
  console.log(`📦 Recorriendo ${CATEGORIAS.length} categorías...`);

  const vistos = new Set();
  const allSkus = [];

  for (const urlCategoria of CATEGORIAS) {
    let html;
    try {
      html = await getCategoria(urlCategoria);
    } catch (err) {
      console.log(`\n  ⚠️  ${urlCategoria}: se saltea (${err.message})`);
      await sleep(DELAY_MS);
      continue;
    }

    const productos = parsearProductosDeCategoria(html, urlCategoria);
    let nuevos = 0;
    for (const p of productos) {
      if (vistos.has(p.idInterno)) continue;
      vistos.add(p.idInterno);
      allSkus.push(p);
      nuevos++;
    }
    process.stdout.write(`\r  ${urlCategoria}: ${productos.length} productos, ${nuevos} nuevos (${allSkus.length} acumulados)...`);
    await sleep(DELAY_MS);
  }

  console.log(`\n\n✅ Total SKUs: ${allSkus.length}\n`);

  const conPromo = allSkus.filter((s) => s.descuentoDirecto);
  conPromo.sort((a, b) => parseFloat(b.descuentoDirecto?.descuento || 0) - parseFloat(a.descuentoDirecto?.descuento || 0));

  const meta = {
    fecha: new Date().toISOString(),
    supermercado: 'La Anónima',
  };

  fs.writeFileSync('./catalogo-laanonima.json', JSON.stringify({
    ...meta,
    total_skus: allSkus.length,
    skus: allSkus,
  }, null, 2));

  fs.writeFileSync('./promos-laanonima.json', JSON.stringify({
    ...meta,
    total_skus_analizados: allSkus.length,
    total_con_promo: conPromo.length,
    productos: conPromo,
  }, null, 2));

  console.log(`=== RESULTADO ===`);
  console.log(`  SKUs totales:          ${allSkus.length}`);
  console.log(`  Con descuento directo: ${allSkus.filter((p) => p.descuentoDirecto).length}`);
  console.log(`  Guardado en:           catalogo-laanonima.json + promos-laanonima.json`);

  console.log('\nTop 10 descuentos directos:');
  conPromo.slice(0, 10).forEach((p, i) => {
    console.log(`  ${i + 1}. ${p.nombre} — ${p.descuentoDirecto.descuentoPct} ($${p.descuentoDirecto.precioBase} → $${p.descuentoDirecto.precioFinal})`);
  });
}

main().catch((err) => {
  console.error('Error fatal:', err);
  process.exit(1);
});
