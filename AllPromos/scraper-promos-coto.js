/**
 * Scraper de Coto — catálogo con precios y promociones.
 *
 * Coto NO es VTEX (a diferencia de Vea/Carrefour/Chango Más/Día). El backend legacy es IBM
 * WebSphere Commerce, pero el catálogo/búsqueda que efectivamente se usa lo sirve un SaaS de
 * terceros, Constructor.io, vía una API key pública de solo lectura (sin auth adicional,
 * confirmado en vivo 2026-08-10):
 *
 *   GET https://api.coto.com.ar/api/v1/ms-digital-sitio-bff-web/api/v1/products/categories/{categoryId}
 *       ?key=key_r6xzz4IAoTWcipni&num_results_per_page=200&page=N
 *
 * No existe un `_from`/`_to` como en VTEX — se pagina por categoría con `page` (confirmado que
 * `page` avanza de verdad: página 1 y página 2 de la misma categoría no comparten ni un solo
 * producto). El máximo de `num_results_per_page` es 200 (con 500 la API devuelve HTTP 500).
 * `total_num_results` corta en 10.000 para las categorías más grandes (Almacén, Textil, Hogar)
 * — no está claro si es el tamaño real o un tope del plan de Constructor.io, pero paginar hasta
 * que una página devuelva 0 resultados confirma en vivo dónde termina de verdad (probado:
 * Almacén con 200/página da resultados hasta la página 50 y 0 en la 51, exactamente 10.000).
 *
 * CATEGORIAS: se iteran los 10 categoryId de nivel superior "de producto" (obtenidos de
 * `GET https://www.coto.com.ar/rest/model/atg/actors/cBackOfficeActor/constructorCategories
 *      ?pushSite=CotoDigital`, hardcodeados abajo para no depender de una llamada extra en cada
 * corrida — si Coto agrega una categoría nueva, este scraper no la va a ver hasta que se
 * actualice la lista a mano, mismo trade-off que el resto de los scrapers con sus constantes
 * fijas). Se excluye "Ofertas" a propósito: no tiene un categoryId `catv...` real (su nav es
 * `productos/ofertas`, una vidriera que cruza productos de las otras categorías), así que
 * iterarla solo generaría duplicados ya cubiertos por las demás.
 *
 * HALLAZGO IMPORTANTE — precio por sucursal (ver detalle completo y la decisión en
 * `CONTEXTO_TECNICO.md`, sección "API de Coto"): a diferencia de los otros 4 supers (precio
 * único a nivel país), Coto devuelve un array `price[]` con un precio por sucursal física, y en
 * ~98% de una muestra de 50 productos de consumo común hubo variación real entre sucursales
 * (mediana 22%, máximo 47.7%), con 1-4 sucursales puntuales (Flores y Once en CABA, siempre las
 * mismas) sistemáticamente más baratas que el resto. Decisión del usuario (2026-08-10, explícita
 * y revisable): usar el **valor dominante (moda)** de `price[].listPrice` como `precioBase` para
 * todos los productos — es una aproximación válida para ~90-98% de las sucursales reales, no el
 * precio exacto de ninguna sucursal en particular. Se calcula acá con `precioDominante()`, no se
 * confía en el campo `product_list_price` de la respuesta (coincide con la moda en las pruebas
 * hechas, pero no hay garantía documentada de que sea siempre así — mejor calcularlo).
 *
 * Promos: `discounts[]` trae ofertas sin tarjeta (confirmado: solo dos formatos vistos en una
 * muestra de ~300 productos, "X%Dto" y "NxM" tipo "2x1"/"3x2" — cualquier otro formato se
 * captura crudo en `promosInternas` sin interpretar, igual que el "2x$X" de Día).
 * `discounts_payment_methods[]` trae planes de cuotas/medios de pago — es el análogo más
 * cercano a "promo bancaria" que expone esta API, se guarda crudo en `promosBancarias` (no se
 * infiere qué tarjeta puntual la activa, la API no lo dice). Igual que en los otros scrapers,
 * ninguno de estos dos campos se usa para mostrar un precio en vivo al usuario — son solo para
 * `catalogo-coto.json`/`promos-coto.json` (inspección + resolución nombre→EAN).
 *
 * CAPADO A PROPÓSITO A ~5.000 SKUs (2026-08-19, antes capturaba el catálogo real completo,
 * ~57.789 SKUs): decisión explícita del usuario, por dos motivos. Primero, un producto que
 * existe SOLO en Coto no le sirve al fin de la app (comparar entre supers) — no hay nada con
 * qué compararlo, así que tenerlo en el catálogo local solo agrega ruido, no valor. Segundo,
 * Coto era el responsable de que el catálogo unificado (`catalogo-unificado.json`, lo que
 * carga entero en memoria `backend/src/catalogoUnificado.js` en cada búsqueda de la app) fuera
 * ~5x más grande que la suma de los otros 4 supers juntos — con margen justo de RAM en la VM
 * de producción (e2-micro, 958MB, ver CONTEXTO_TECNICO.md § "Alcance y limitaciones" para la
 * medición completa que probó que ampliar esto en vez de recortarlo directamente crashea el
 * proceso por out-of-memory). Sin pasar `sort_by`, Constructor.io ya devuelve "lo más
 * relevante" primero (`sort_options[].status === "selected"` para `relevance` por default,
 * confirmado en vivo) — no es exactamente "más vendidos" como el `OrderByTopSaleDESC` de VTEX
 * (Constructor.io no expone un sort de ventas), pero es la mejor aproximación disponible a
 * "lo que más le importa a la mayoría", y es gratis: no hay que cambiar ningún parámetro.
 * `repartirPresupuesto()` reparte el objetivo de ~5.000 entre las 10 categorías proporcional al
 * tamaño real de cada una (`total_num_results`, con un pedido liviano de 1 solo resultado por
 * categoría antes de scrapear en serio) — así una categoría grande como Almacén no queda
 * subrepresentada frente a una chica como Aire Libre.
 *
 * SKUs FANTASMA (encontrado 2026-08-20): Constructor.io mantiene indexados SKUs discontinuados
 * (packaging viejo, ya no se vende en ninguna sucursal) con un `price[]` congelado de la última
 * vez que tuvieron stock — a veces muy desactualizado (confirmado un caso real: "Puré de Tomate
 * Arcor" con 2 variantes discontinuadas a $650 y $110 conviviendo con la vigente a $1110, mismo
 * producto). El sitio web de Coto los oculta filtrando por disponibilidad de sucursal; esta API
 * no lo hace sola. `store_availability` (array de sucursales con stock) es la señal — si viene
 * vacío, el SKU no se vende en ningún lado hoy. Se descarta explícitamente en `scrapearCategoria`
 * antes de sumarlo a `allSkus`, no se guarda ni con un flag: un producto sin disponibilidad no le
 * sirve al fin de la app (comparar precios reales), mismo criterio que llevó a capar a ~5.000.
 *
 * Salida:
 *   catalogo-coto.json  — ~5.000 SKUs más relevantes por categoría (no el catálogo completo),
 *                         ya excluidos los SKUs fantasma sin disponibilidad
 *   promos-coto.json    — solo los SKUs con algún tipo de descuento, dentro de esos ~5.000
 */

const fs = require('fs');

const KEY = 'key_r6xzz4IAoTWcipni';
const BASE_URL = 'https://api.coto.com.ar/api/v1/ms-digital-sitio-bff-web/api/v1/products/categories';
const PAGE_SIZE = 200;
const MAX_PAGINAS = 60; // red de seguridad absoluta — el presupuesto por categoría (más abajo) corta mucho antes
const TOTAL_OBJETIVO_SKUS = 5000; // ver nota arriba — antes no existía este tope, se traía todo

const CATEGORIAS = [
  { id: 'catv00001254', nombre: 'Almacén' },
  { id: 'catv00001256', nombre: 'Bebidas' },
  { id: 'catv00001255', nombre: 'Frescos' },
  { id: 'catv00001296', nombre: 'Congelados' },
  { id: 'catv00001258', nombre: 'Limpieza' },
  { id: 'catv00001257', nombre: 'Perfumería' },
  { id: 'catv00001990', nombre: 'Electro' },
  { id: 'catv00001259', nombre: 'Textil' },
  { id: 'catv00001260', nombre: 'Hogar' },
  { id: 'catv00001261', nombre: 'Aire Libre' },
];

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
  'Accept': 'application/json',
};

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/** Extrae el primer número (con decimales tipo "1234.56") de un texto tipo "$1.234,56" o "Precio Contado: $949". */
function parsearMonto(texto) {
  if (!texto) return null;
  const limpio = String(texto).replace(/[^\d.]/g, '');
  if (!limpio) return null;
  const n = parseFloat(limpio);
  return Number.isFinite(n) ? n : null;
}

/** Moda de una lista de precios por sucursal. Empate: se queda con el valor más bajo (a favor del usuario). */
function precioDominante(precios) {
  if (!precios.length) return null;
  const conteo = new Map();
  for (const p of precios) conteo.set(p, (conteo.get(p) || 0) + 1);
  let mejor = null;
  for (const [precio, veces] of conteo) {
    if (!mejor || veces > mejor.veces || (veces === mejor.veces && precio < mejor.precio)) {
      mejor = { precio, veces };
    }
  }
  return mejor.precio;
}

/** Arma "Almacén > Salsas y Puré de Tomate > Puré de Tomate" a partir del group más específico (path_list más largo). */
function categoriaMasEspecifica(groups = []) {
  if (!groups.length) return null;
  const masEspecifico = groups.reduce((a, b) =>
    (b.path_list?.length || 0) > (a.path_list?.length || 0) ? b : a
  );
  const ancestros = (masEspecifico.path_list || []).slice(1).map(p => p.display_name);
  return [...ancestros, masEspecifico.display_name].join(' > ');
}

function interpretarDescuentos(discounts = [], precioBase) {
  const percentuales = [];
  const otros = [];

  for (const d of discounts) {
    const texto = d.discountText || '';
    const matchPct = texto.match(/^(\d+(?:\.\d+)?)\s*%\s*Dto/i);
    if (matchPct) {
      percentuales.push(d);
    } else {
      otros.push(d);
    }
  }

  let descuentoDirecto = null;
  if (percentuales.length && precioBase > 0) {
    const precioFinal = parsearMonto(percentuales[0].discountPrice);
    if (precioFinal != null) {
      descuentoDirecto = {
        tipo: 'descuento_directo',
        precioBase,
        precioFinal,
        descuentoPct: ((1 - precioFinal / precioBase) * 100).toFixed(0) + '%',
        descuento: (1 - precioFinal / precioBase).toFixed(4),
      };
    }
  }

  const promosInternas = otros.length
    ? otros.map(d => ({ nombre: d.discountText || '', comentarios: d.comments || null }))
    : null;

  return { descuentoDirecto, promosInternas };
}

function parsearPromosBancarias(discountsPaymentMethods = []) {
  if (!discountsPaymentMethods.length) return null;
  return discountsPaymentMethods.map(d => ({
    comentarios: d.comentarios || null,
    precioCuota: parsearMonto(d.precioCuota),
    cantidadCuotas: d.cantidadCuotas ? parseInt(d.cantidadCuotas, 10) : null,
  }));
}

async function getCategoryPage(categoryId, page, retries = 3) {
  const url = `${BASE_URL}/${categoryId}?key=${KEY}&num_results_per_page=${PAGE_SIZE}&page=${page}`;
  const res = await fetch(url, { headers: HEADERS });
  if ((res.status === 429 || res.status === 500) && retries > 0) {
    process.stdout.write(` [${res.status}, esperando 10s]`);
    await sleep(10000);
    return getCategoryPage(categoryId, page, retries - 1);
  }
  if (!res.ok) throw new Error(`Categoría ${categoryId} página ${page} falló: ${res.status} ${res.statusText}`);

  const data = await res.json();
  return data.response?.results || [];
}

/** Pedido liviano (1 solo resultado) solo para conocer el tamaño real de la categoría antes de
 *  decidir cuántas páginas scrapear en serio — ver repartirPresupuesto(). */
async function contarCategoria(categoryId) {
  const url = `${BASE_URL}/${categoryId}?key=${KEY}&num_results_per_page=1&page=1`;
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`Conteo de categoría ${categoryId} falló: ${res.status} ${res.statusText}`);
  const data = await res.json();
  return data.response?.total_num_results || 0;
}

/** Reparte TOTAL_OBJETIVO_SKUS entre las categorías, proporcional a su tamaño real, para que
 *  una categoría grande (Almacén) no quede tan subrepresentada como una chica (Aire Libre)
 *  frente a un reparto parejo. Devuelve páginas por categoría (mínimo 1, para no dejar
 *  ninguna categoría en cero). */
function repartirPresupuesto(totalesPorCategoria) {
  const sumaTotal = totalesPorCategoria.reduce((acc, t) => acc + t, 0);
  if (!sumaTotal) return totalesPorCategoria.map(() => 1);
  return totalesPorCategoria.map(total => {
    const skusObjetivo = (TOTAL_OBJETIVO_SKUS * total) / sumaTotal;
    return Math.max(1, Math.round(skusObjetivo / PAGE_SIZE));
  });
}

function parsearProducto(item) {
  const d = item.data;
  const precios = (d.price || [])
    .map(p => p.listPrice)
    .filter(p => typeof p === 'number');
  const precioBase = precioDominante(precios);

  const { descuentoDirecto, promosInternas } = interpretarDescuentos(d.discounts, precioBase);
  const promosBancarias = parsearPromosBancarias(d.discounts_payment_methods);

  return {
    productoId: d.id || null,
    skuId: d.sku_id || null,
    ean: d.product_main_ean ? String(d.product_main_ean) : null,
    nombre: d.sku_display_name || d.sku_description || null,
    categoria: categoriaMasEspecifica(d.groups),
    precioBase,
    sucursalesConPrecio: precios.length,
    descuentoDirecto,
    promosInternas,
    promosBancarias,
    imagenUrl: d.product_medium_image_url || d.image_url || null,
  };
}

async function scrapearCategoria(categoria, vistos, allSkus, paginasPresupuestadas) {
  let page = 1;
  let nuevos = 0;
  const tope = Math.min(paginasPresupuestadas, MAX_PAGINAS);
  while (page <= tope) {
    let resultados;
    try {
      resultados = await getCategoryPage(categoria.id, page);
    } catch (err) {
      console.log(`\n  ${categoria.nombre}: fin en página ${page} (${err.message})`);
      break;
    }
    if (!resultados.length) break;

    for (const item of resultados) {
      const idProducto = item.data.id;
      if (!idProducto || vistos.has(idProducto)) continue;
      vistos.add(idProducto);
      if (!(item.data.store_availability || []).length) continue; // ver nota "SKUs fantasma" arriba
      allSkus.push(parsearProducto(item));
      nuevos++;
    }

    process.stdout.write(`\r  ${categoria.nombre}: página ${page}, ${allSkus.length} SKUs totales acumulados...`);
    if (resultados.length < PAGE_SIZE) break;
    page++;
    await sleep(400);
  }
  return nuevos;
}

async function main() {
  console.log('=== Scraper Coto — Catálogo + Promociones ===\n');
  console.log(`📏 Midiendo tamaño real de cada categoría (para repartir el objetivo de ~${TOTAL_OBJETIVO_SKUS} SKUs)...`);

  const totalesPorCategoria = [];
  for (const categoria of CATEGORIAS) {
    const total = await contarCategoria(categoria.id);
    totalesPorCategoria.push(total);
    console.log(`  ${categoria.nombre}: ${total} SKUs reales`);
    await sleep(300);
  }
  const paginasPorCategoria = repartirPresupuesto(totalesPorCategoria);
  console.log('\n📦 Paginando por categoría (recortado a lo más relevante de cada una)...');

  const vistos = new Set();
  const allSkus = [];

  for (let i = 0; i < CATEGORIAS.length; i++) {
    const categoria = CATEGORIAS[i];
    const nuevos = await scrapearCategoria(categoria, vistos, allSkus, paginasPorCategoria[i]);
    console.log(`\n  ✅ ${categoria.nombre}: ${nuevos} SKUs nuevos (${allSkus.length} acumulados)`);
  }

  console.log(`\n✅ Total SKUs: ${allSkus.length}\n`);

  const conPromo = allSkus.filter(s => s.descuentoDirecto || s.promosInternas);
  conPromo.sort((a, b) => {
    const pctA = parseFloat(a.descuentoDirecto?.descuento || 0);
    const pctB = parseFloat(b.descuentoDirecto?.descuento || 0);
    return pctB - pctA;
  });

  const meta = {
    fecha: new Date().toISOString(),
    supermercado: 'Coto',
  };

  fs.writeFileSync('./catalogo-coto.json', JSON.stringify({
    ...meta,
    total_skus: allSkus.length,
    skus: allSkus,
  }, null, 2));

  fs.writeFileSync('./promos-coto.json', JSON.stringify({
    ...meta,
    total_skus_analizados: allSkus.length,
    total_con_promo: conPromo.length,
    productos: conPromo,
  }, null, 2));

  console.log(`=== RESULTADO ===`);
  console.log(`  SKUs totales:          ${allSkus.length}`);
  console.log(`  Con EAN:               ${allSkus.filter(p => p.ean).length}`);
  console.log(`  Con imagen:            ${allSkus.filter(p => p.imagenUrl).length}`);
  console.log(`  Con descuento directo: ${allSkus.filter(p => p.descuentoDirecto).length}`);
  console.log(`  Con promos internas:   ${allSkus.filter(p => p.promosInternas).length}`);
  console.log(`  Con promos bancarias:  ${allSkus.filter(p => p.promosBancarias).length}`);
  console.log(`  Guardado en:           catalogo-coto.json + promos-coto.json`);

  console.log('\nTop 10 descuentos directos:');
  conPromo.filter(p => p.descuentoDirecto).slice(0, 10).forEach((p, i) => {
    console.log(`  ${i + 1}. ${p.nombre} — ${p.descuentoDirecto.descuentoPct} ($${p.descuentoDirecto.precioBase} → $${p.descuentoDirecto.precioFinal})`);
  });

  console.log('\nPromos internas (2x1, 3x2, etc.):');
  allSkus.filter(p => p.promosInternas).slice(0, 10).forEach(p => {
    console.log(`  - ${p.nombre}`);
    p.promosInternas.forEach(t => console.log(`    → ${t.nombre}`));
  });
}

main().catch(err => {
  console.error('Error fatal:', err);
  process.exit(1);
});
