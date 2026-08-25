/**
 * Scraper de Coto — reemplaza al recorte por categoría (scraper-promos-coto.js, probado en
 * paralelo el 2026-08-25 con una corrida real de 6.506 EAN sin un solo 502, y borrado tras
 * confirmar que este andaba bien: si hace falta volver a ver cómo era, está en el historial
 * de git).
 *
 * EN VEZ DE paginar categorías esperando que "lo más relevante" incluya lo que a la app le
 * importa, consulta a Coto puntualmente por cada EAN que YA sabemos que existe en Vea,
 * Carrefour, Chango Más, Día, Jumbo o Disco (los catalogo-*.json de esos 6, generados por sus
 * propios scrapers). Motivo (mismo criterio que ya justificaba el cap de ~5.000 en el scraper
 * viejo, ver ese archivo): un producto que existe SOLO en Coto no le sirve al fin de la app —
 * comparar precios — porque no hay nada con qué compararlo. Este scraper directamente no trae
 * esos productos exclusivos de Coto, y no hace falta: la app nunca los va a usar para comparar.
 *
 * HALLAZGO (2026-08-25, verificado en vivo con 2 requests contra coto.com.ar en el navegador):
 * la búsqueda de Coto usa Constructor.io Autocomplete (`ac.cnstrc.com/autocomplete/{término}`,
 * mismo `key` público que ya usaba el scraper de categorías) y, a diferencia del endpoint de
 * categorías (que nunca publicó ningún límite y terminó devolviendo 502 sostenidos en una
 * prueba de scraping completo el mismo día), este SÍ publica un rate limit real en los headers
 * de respuesta: `x-ratelimit-limit: 201`, con ventana de reset de ~3 segundos (confirmado dos
 * veces, ambas ~3s después del request). PACE_MS de abajo se calculó con margen generoso contra
 * ese número documentado, no a ciegas.
 *
 * Buscar por EAN exacto funciona: `autocomplete/7790787960668` devolvió `total_num_results_per_
 * section.Products: 1`, el producto correcto (Manteca Ilolay 200g), con la MISMA forma de datos
 * que ya devolvía el endpoint de categorías (`price[]`, `discounts`, `discounts_payment_methods`,
 * `store_availability`, `groups`, `product_main_ean`) — por eso este scraper reusa exactamente
 * las mismas funciones de parseo que scraper-promos-coto.js (parsearProducto, interpretarDescuentos,
 * parsearPromosBancarias, precioDominante, categoriaMasEspecifica), sin cambiar su lógica.
 *
 * Salida: MISMO formato que el scraper viejo — catalogo-coto.json + promos-coto.json — así
 * unificarCatalogo.js/precioCache.js no necesitan ningún cambio.
 */

const fs = require('fs');
const path = require('path');
const { leerCatalogo } = require('./core/catalogo');

const KEY = 'key_r6xzz4IAoTWcipni';
const AUTOCOMPLETE_URL = 'https://ac.cnstrc.com/autocomplete';
const CLIENT = 'cio-ui-autocomplete-1.29.3';

// Medido en vivo: límite real de 201 requests por ventana de ~3s (ver nota arriba). 12/s deja
// ~3x de margen contra ese número documentado — no es una estimación a ciegas como el scraper
// de categorías (que nunca tuvo un límite publicado y terminó en 502 sostenidos).
const PACE_MS = 85; // ~12 req/s

const FUENTES_NO_COTO = [
  'catalogo-vea.json',
  'catalogo-carrefour.json',
  'catalogo-changomas.json',
  'catalogo-dia.json',
  'catalogo-jumbo.json',
  'catalogo-disco.json',
];

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
  'Accept': 'application/json',
  'Referer': 'https://www.coto.com.ar/',
  'Origin': 'https://www.coto.com.ar',
};

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ─── Parseo — copiado sin cambios de scraper-promos-coto.js: la forma de los datos que
// devuelve Constructor.io es la misma en autocomplete que en categorías (confirmado en vivo).

function parsearMonto(texto) {
  if (!texto) return null;
  const limpio = String(texto).replace(/[^\d.]/g, '');
  if (!limpio) return null;
  const n = parseFloat(limpio);
  return Number.isFinite(n) ? n : null;
}

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
    if (matchPct) percentuales.push(d); else otros.push(d);
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

// ─── Búsqueda por EAN ───────────────────────────────────────────────────────────

async function buscarPorEAN(ean, retries = 3) {
  const url = `${AUTOCOMPLETE_URL}/${encodeURIComponent(ean)}`
    + `?c=${CLIENT}&key=${KEY}`
    + `&num_results_Products=3&num_results_Search+Suggestions=0&num_results_Brands=0&num_results_Categories=0`;
  const res = await fetch(url, { headers: HEADERS });

  if ((res.status === 429 || res.status === 500 || res.status === 502 || res.status === 503) && retries > 0) {
    process.stdout.write(` [${res.status}, esperando 10s]`);
    await sleep(10000);
    return buscarPorEAN(ean, retries - 1);
  }
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);

  const data = await res.json();
  const productos = data.sections?.Products || [];
  // Match exacto: autocomplete puede traer resultados relacionados además del EAN pedido.
  return productos.find(p => String(p.data?.product_main_ean) === String(ean)) || null;
}

function unionDeEANsNoConto() {
  const vistos = new Map(); // ean -> { nombre, fuentes: [] } (solo para el resumen final)
  for (const archivo of FUENTES_NO_COTO) {
    const data = leerCatalogo(archivo);
    const skus = Array.isArray(data?.skus) ? data.skus : [];
    for (const s of skus) {
      if (!s.ean) continue;
      const ean = String(s.ean);
      if (!vistos.has(ean)) vistos.set(ean, { nombre: s.productName || s.skuName || s.nombre || null, fuentes: [] });
      vistos.get(ean).fuentes.push(archivo);
    }
  }
  return vistos;
}

async function main() {
  console.log('=== Scraper Coto por EAN (reemplaza el recorte por categoría) ===\n');

  const union = unionDeEANsNoConto();
  let eans = [...union.keys()];

  // --limit=N: para probar el scraper contra pocos EAN antes de una corrida completa. El cron
  // (refrescarCatalogos.js) nunca pasa este flag, así que en producción no tiene efecto.
  const argLimit = process.argv.find(a => a.startsWith('--limit='));
  if (argLimit) {
    const n = parseInt(argLimit.split('=')[1], 10);
    if (Number.isFinite(n) && n > 0) eans = eans.slice(0, n);
  }

  console.log(`EAN únicos a consultar (de Vea/Carrefour/Chango Más/Día/Jumbo/Disco): ${eans.length}${argLimit ? ' (recortado por --limit)' : ''}\n`);

  const encontrados = [];
  let sinResultado = 0;
  let sinDisponibilidad = 0;

  for (let i = 0; i < eans.length; i++) {
    const ean = eans[i];
    let item;
    try {
      item = await buscarPorEAN(ean);
    } catch (err) {
      console.log(`\n  EAN ${ean}: error (${err.message}), se saltea`);
      item = null;
    }

    if (item) {
      const disponible = (item.data.store_availability || []).length > 0;
      if (disponible) {
        encontrados.push(parsearProducto(item));
      } else {
        sinDisponibilidad++; // SKU fantasma — mismo criterio que el scraper viejo, se descarta
      }
    } else {
      sinResultado++;
    }

    if ((i + 1) % 100 === 0 || i === eans.length - 1) {
      process.stdout.write(`\r  ${i + 1}/${eans.length} consultados — ${encontrados.length} encontrados en Coto, ${sinDisponibilidad} sin stock, ${sinResultado} no están`);
    }
    await sleep(PACE_MS);
  }

  console.log(`\n\n✅ Total encontrados en Coto (con stock real): ${encontrados.length}`);
  console.log(`   Sin disponibilidad (descartados, SKU fantasma): ${sinDisponibilidad}`);
  console.log(`   No existen en Coto: ${sinResultado}`);

  const conPromo = encontrados.filter(s => s.descuentoDirecto || s.promosInternas);
  conPromo.sort((a, b) => {
    const pctA = parseFloat(a.descuentoDirecto?.descuento || 0);
    const pctB = parseFloat(b.descuentoDirecto?.descuento || 0);
    return pctB - pctA;
  });

  const meta = { fecha: new Date().toISOString(), supermercado: 'Coto' };

  fs.writeFileSync('./catalogo-coto.json', JSON.stringify({
    ...meta,
    total_skus: encontrados.length,
    skus: encontrados,
  }, null, 2));

  fs.writeFileSync('./promos-coto.json', JSON.stringify({
    ...meta,
    total_skus_analizados: encontrados.length,
    total_con_promo: conPromo.length,
    productos: conPromo,
  }, null, 2));

  console.log(`\n=== RESULTADO ===`);
  console.log(`  SKUs totales:          ${encontrados.length}`);
  console.log(`  Con descuento directo: ${encontrados.filter(p => p.descuentoDirecto).length}`);
  console.log(`  Con promos internas:   ${encontrados.filter(p => p.promosInternas).length}`);
  console.log(`  Con promos bancarias:  ${encontrados.filter(p => p.promosBancarias).length}`);
  console.log(`  Guardado en:           catalogo-coto.json + promos-coto.json`);
}

main().catch(err => {
  console.error('Error fatal:', err);
  process.exit(1);
});
