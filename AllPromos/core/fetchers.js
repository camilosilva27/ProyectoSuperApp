/**
 * Consultas en vivo a las APIs VTEX de Vea, Carrefour y Chango Más.
 * Precio y promo SIEMPRE salen de acá, nunca del catálogo local (ver ../CLAUDE.md).
 *
 * Extraído de buscar-promos.js sin cambiar comportamiento, con un único cambio de firma:
 * `tarjetas` (qué tarjetas tiene el usuario) ahora se pasa por parámetro en vez de leerse
 * de mis-tarjetas.json a nivel de módulo. Motivo: el backend recibe la lista en cada
 * request (cada teléfono de la familia puede tener tarjetas distintas), mientras el CLI
 * sigue leyendo el archivo y pasándolo explícitamente.
 */

const {
  interpretarPromoPorTexto,
  interpretarPromoCarrefour,
  interpretarTeaserTarjetaPropia,
} = require('../promo-engine');
const { skuIdVeaPorEAN, urlLaAnonimaPorEAN } = require('./catalogo');

const VEA_SELLER = 'jumboargentinav700cordoba700';

// Chango Más migró su web a masonline.com.ar (changomas.com.ar redirige ahí).
// A diferencia de Vea, no encontramos evidencia de precios específicos por sucursal:
// el mismo skuId devuelve el mismo precio para regiones distintas bajo sc=1/seller "1"
// (ver CONTEXTO_TECNICO.md). Se trata como catálogo nacional único, igual que Carrefour.
const CHANGOMAS_HOST   = 'https://www.masonline.com.ar';
const CHANGOMAS_SELLER = '1';

// Día corre sobre VTEX igual que Carrefour/Chango Más: mismo mecanismo de descuento directo
// (Price < ListPrice) y Teasers para promos condicionales (confirmado en vivo, ver
// scraper-promos-dia.js). Sin cookie ni sales channel especial: sc=1, seller "1".
const DIA_HOST   = 'https://diaonline.supermercadosdia.com.ar';
const DIA_SELLER = '1';

// Coto no es VTEX: el buscador lo sirve Constructor.io vía el gateway de Coto (misma API key
// pública de solo lectura que usa scraper-promos-coto.js). Se busca por término de texto
// (`products/search/{termino}`) — no hay un filtro exacto por EAN como en VTEX, así que
// cotoLive() busca por EAN como término y filtra el resultado que matchee ese EAN exacto.
//
// PRECIO: Coto expone un array `price[]` con un precio por sucursal física, a diferencia de
// los otros 4 (precio único nacional). Decisión del usuario (2026-08-11, explícita y
// revisable): usar SIEMPRE el precio dominante (moda entre sucursales, empate a favor del
// más bajo) como precioBase — nunca se pregunta ni se resuelve por sucursal puntual. OJO: en
// algunas zonas de CABA (Flores y Once, según lo confirmado en vivo en scraper-promos-coto.js)
// el precio real puede ser un poco MENOR al dominante — es una aproximación válida para la
// mayoría de las sucursales, no el precio exacto de ninguna en particular.
const COTO_KEY  = 'key_r6xzz4IAoTWcipni';
const COTO_HOST = 'https://api.coto.com.ar/api/v1/ms-digital-sitio-bff-web/api/v1/products/search';

// La Anónima no es VTEX ni un SaaS de terceros: HTML server-rendered propio (ver
// scraper-promos-laanonima.js). El precio NO depende de zona/CP (confirmado en el spike:
// el HTML de categoría es byte a byte idéntico para cualquier CP) — el CP del usuario es
// solo un gate binario de cobertura (ver core/laanonima-zona.js), nunca selecciona precio.
// Sin EAN propio: laAnonimaLiveEAN solo encuentra algo si enriquecer-catalogo-laanonima.js
// pudo emparejar ese EAN por nombre contra otro super (ver su cabecera).
const LAANONIMA_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
  'Accept': 'text/html',
};

const SUPERMERCADOS = [
  { key: 'vea',       nombre: 'Vea',        tag: '🟢' },
  { key: 'carr',      nombre: 'Carrefour',  tag: '🔵' },
  { key: 'changomas', nombre: 'Chango Más', tag: '🟣' },
  { key: 'dia',       nombre: 'Día',        tag: '🟡' },
  { key: 'coto',      nombre: 'Coto',       tag: '🔴' },
  { key: 'laanonima', nombre: 'La Anónima', tag: '⚪' },
];

// ─── Live: Carrefour ──────────────────────────────────────────────────────────

function parsearProductosCarrefour(products, { tarjetas = [] } = {}) {
  const resultados = [];
  for (const p of products) {
    for (const sku of p.items || []) {
      const offer = sku.sellers?.[0]?.commertialOffer;
      if (!offer) continue;
      const skuId    = sku.itemId;
      const sellerId = sku.sellers[0].sellerId;
      const price     = offer.Price     || 0;
      const listPrice = offer.ListPrice || 0;

      if (listPrice > 0 && price < listPrice) {
        resultados.push({
          super: 'Carrefour',
          skuId, sellerId,
          productName: p.productName, skuName: sku.name, ean: sku.ean,
          precioBase: listPrice,
          promo: interpretarPromoPorTexto('', (1 - price / listPrice).toFixed(4)),
        });
      }

      const teasersInternos = (offer.Teasers || []).filter(t => {
        const n = (t['<Name>k__BackingField'] || '').toLowerCase();
        return !n.includes('tarjeta') && !n.includes('cuenta digital') && !n.includes('banco');
      });

      for (const t of teasersInternos) {
        const promo = interpretarPromoCarrefour({ nombre: t['<Name>k__BackingField'] || '' });
        if (promo) {
          resultados.push({
            super: 'Carrefour',
            skuId, sellerId,
            productName: p.productName, skuName: sku.name, ean: sku.ean,
            precioBase: price, promo,
          });
        }
      }

      // Promo por producto condicionada a tarjeta propia (tipo 1, Fase 3): el teaser
      // "Tarjeta Carrefour X%" existe en casi todos los productos (confirmado en vivo,
      // ~mismo BIN/% en decenas de categorías). Solo se agrega como candidato si el
      // usuario tiene "Mi Carrefour" entre sus tarjetas — si no, ni se calcula (4.1).
      if (tarjetas.includes('Mi Carrefour')) {
        const teaserTarjetaPropia = (offer.Teasers || []).find(t =>
          (t['<Name>k__BackingField'] || '').toLowerCase().includes('tarjeta carrefour')
        );
        const promo = teaserTarjetaPropia && interpretarTeaserTarjetaPropia(teaserTarjetaPropia, 'Mi Carrefour');
        if (promo) {
          resultados.push({
            super: 'Carrefour',
            skuId, sellerId,
            productName: p.productName, skuName: sku.name, ean: sku.ean,
            precioBase: price, promo,
          });
        }
      }

      if (price > 0 && (!listPrice || price >= listPrice) && teasersInternos.length === 0) {
        resultados.push({
          super: 'Carrefour',
          skuId, sellerId,
          productName: p.productName, skuName: sku.name, ean: sku.ean,
          precioBase: price, promo: null,
        });
      }
    }
  }
  return resultados;
}

async function carrefourLiveEAN(ean, opciones = {}) {
  const res = await fetch(
    `https://www.carrefour.com.ar/api/catalog_system/pub/products/search?fq=alternateIds_Ean:${ean}&sc=1`,
    { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' } }
  );
  return res.ok ? parsearProductosCarrefour(await res.json(), opciones) : [];
}

async function carrefourLiveNombre(nombre, opciones = {}) {
  const res = await fetch(
    `https://www.carrefour.com.ar/api/catalog_system/pub/products/search?fq=productName:${encodeURIComponent(nombre)}&_from=0&_to=9&sc=1`,
    { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' } }
  );
  return res.ok ? parsearProductosCarrefour(await res.json(), opciones) : [];
}

// ─── Live: Chango Más ─────────────────────────────────────────────────────────
// Misma forma que Carrefour: descuento directo embebido (Price < ListPrice) confirmado
// en vivo. No se encontró ningún ejemplo real de Teasers/PromotionTeasers al escanear
// ~450 productos de categorías comunes — se deja el parseo por si aparece más adelante,
// pero no está verificado en producción (ver CONTEXTO_TECNICO.md).
function parsearProductosChangoMas(products) {
  const resultados = [];
  for (const p of products) {
    for (const sku of p.items || []) {
      const sellerInfo = sku.sellers?.find(s => s.sellerId === CHANGOMAS_SELLER) || sku.sellers?.[0];
      const offer = sellerInfo?.commertialOffer;
      if (!offer) continue;
      const skuId    = sku.itemId;
      const sellerId = sellerInfo.sellerId;
      const price     = offer.Price     || 0;
      const listPrice = offer.ListPrice || 0;

      if (listPrice > 0 && price < listPrice) {
        resultados.push({
          super: 'Chango Más',
          skuId, sellerId,
          productName: p.productName, skuName: sku.name, ean: sku.ean,
          precioBase: listPrice,
          promo: interpretarPromoPorTexto('', (1 - price / listPrice).toFixed(4)),
        });
      }

      const teasersInternos = [...(offer.Teasers || []), ...(offer.PromotionTeasers || [])]
        .map(t => ({ nombre: t['<Name>k__BackingField'] ?? t.Name ?? t.name ?? '' }))
        .filter(t => t.nombre && !/tarjeta|cuenta digital|banco/i.test(t.nombre));

      for (const t of teasersInternos) {
        const promo = interpretarPromoCarrefour(t);
        if (promo) {
          resultados.push({
            super: 'Chango Más',
            skuId, sellerId,
            productName: p.productName, skuName: sku.name, ean: sku.ean,
            precioBase: price, promo,
          });
        }
      }

      if (price > 0 && (!listPrice || price >= listPrice) && teasersInternos.length === 0) {
        resultados.push({
          super: 'Chango Más',
          skuId, sellerId,
          productName: p.productName, skuName: sku.name, ean: sku.ean,
          precioBase: price, promo: null,
        });
      }
    }
  }
  return resultados;
}

async function changoMasLiveEAN(ean) {
  const res = await fetch(
    `${CHANGOMAS_HOST}/api/catalog_system/pub/products/search?fq=alternateIds_Ean:${ean}&sc=1`,
    { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' } }
  );
  return res.ok ? parsearProductosChangoMas(await res.json()) : [];
}

async function changoMasLiveNombre(nombre) {
  const res = await fetch(
    `${CHANGOMAS_HOST}/api/catalog_system/pub/products/search?fq=productName:${encodeURIComponent(nombre)}&_from=0&_to=9&sc=1`,
    { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' } }
  );
  return res.ok ? parsearProductosChangoMas(await res.json()) : [];
}

// ─── Live: Vea ────────────────────────────────────────────────────────────────

// La API de Vea devuelve seller "1" en vez de VEA_SELLER sin importar el método de búsqueda
// (skuId, EAN o nombre — confirmado en vivo, no es solo un caso de skuId). Por eso preferimos
// VEA_SELLER cuando aparece, pero NUNCA lo exigimos como condición excluyente — antes esto
// rechazaba resultados válidos (ej. "Detergente En Polvo X 1 Kg Finish Classic", que existe en
// Vea pero se descartaba porque exigíamos el seller exacto) en el fallback en vivo por nombre
// y en la búsqueda por EAN sin catálogo local.
//
// sc=34 sigue siendo necesario (es el único canal activo que encontramos en vea.com.ar), pero
// las queries NO llevan cookie `vtex_segment` a propósito desde 2026-08-13: un cookie fijo
// (capturado una vez, con un regionId de una sucursal puntual — "Luján") venía devolviendo
// precios DESACTUALIZADOS para un subconjunto de productos (~20% en una muestra de 20),
// mientras que una sesión 100% anónima (sin cookie) y una sesión logueada daban, ambas, el
// mismo precio correcto/vigente — confirmado bypaseando el caché de CloudFront para descartar
// que fuera solo una respuesta cacheada. La hipótesis más probable es que ese regionId puntual
// esté atado a una foto de precios de esa sucursal que no se actualiza al mismo ritmo que el
// precio "default" de la web. La promo por SKU (`/_v/search-promotions`) tampoco depende de
// este cookie — depende del `seller` que se manda en el body, ya confirmado en vivo. No volver
// a agregar un `vtex_segment` fijo sin volver a confirmar que sigue devolviendo precio vigente.
async function parsearProductosVea(products) {
  const candidatos = [];
  for (const p of products) {
    for (const sku of p.items || []) {
      const sellerInfo = sku.sellers?.find(s => s.sellerId === VEA_SELLER) || sku.sellers?.[0];
      if (!sellerInfo) continue;
      candidatos.push({
        skuId: sku.itemId,
        sellerId: sellerInfo.sellerId,
        productName: p.productName, skuName: sku.name, ean: sku.ean,
        price: sellerInfo.commertialOffer?.Price || 0,
      });
    }
  }
  if (!candidatos.length) return [];

  const promoRes = await fetch('https://www.vea.com.ar/_v/search-promotions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ seller: VEA_SELLER, skus: candidatos.map(s => s.skuId) }),
  });
  const promos = promoRes.ok
    ? ((await promoRes.json()).promotions?.generic?.promotions || {})
    : {};

  return candidatos.filter(s => s.price > 0).map(s => {
    const promo = promos[s.skuId];
    return {
      super: 'Vea',
      skuId: s.skuId, sellerId: s.sellerId,
      productName: s.productName, skuName: s.skuName, ean: s.ean,
      precioBase: s.price,
      promo: promo ? interpretarPromoPorTexto(promo.name, promo.effectiveDiscount) : null,
    };
  });
}

/**
 * Consulta Vea en vivo.
 * Usa skuId (más fiable) si está disponible, si no cae a búsqueda por EAN.
 */
async function veaLive(ean, skuIdVea = null) {
  const query = skuIdVea ? `fq=skuId:${skuIdVea}` : `fq=alternateIds_Ean:${ean}`;
  const res = await fetch(
    `https://www.vea.com.ar/api/catalog_system/pub/products/search?${query}&sc=34`,
    { headers: { Accept: 'application/json' } }
  );
  return res.ok ? parsearProductosVea(await res.json()) : [];
}

async function veaLiveNombre(nombre) {
  const res = await fetch(
    `https://www.vea.com.ar/api/catalog_system/pub/products/search?fq=productName:${encodeURIComponent(nombre)}&_from=0&_to=9&sc=34`,
    { headers: { Accept: 'application/json' } }
  );
  return res.ok ? parsearProductosVea(await res.json()) : [];
}

// ─── Live: Día ────────────────────────────────────────────────────────────────
// Misma forma que Chango Más: descuento directo embebido + Teasers/PromotionTeasers
// filtrando promos bancarias. Existe además un formato "2x$X" (precio fijo, no %) que
// interpretarPromoCarrefour() todavía no interpreta — queda sin promo en vez de romper
// (mismo comportamiento que un teaser desconocido de cualquier otro super).
function parsearProductosDia(products) {
  const resultados = [];
  for (const p of products) {
    for (const sku of p.items || []) {
      const sellerInfo = sku.sellers?.find(s => s.sellerId === DIA_SELLER) || sku.sellers?.[0];
      const offer = sellerInfo?.commertialOffer;
      if (!offer) continue;
      const skuId    = sku.itemId;
      const sellerId = sellerInfo.sellerId;
      const price     = offer.Price     || 0;
      const listPrice = offer.ListPrice || 0;

      if (listPrice > 0 && price < listPrice) {
        resultados.push({
          super: 'Día',
          skuId, sellerId,
          productName: p.productName, skuName: sku.name, ean: sku.ean,
          precioBase: listPrice,
          promo: interpretarPromoPorTexto('', (1 - price / listPrice).toFixed(4)),
        });
      }

      const teasersInternos = [...(offer.Teasers || []), ...(offer.PromotionTeasers || [])]
        .map(t => ({ nombre: t['<Name>k__BackingField'] ?? t.Name ?? t.name ?? '' }))
        .filter(t => t.nombre && !/tarjeta|cuenta digital|banco/i.test(t.nombre));

      for (const t of teasersInternos) {
        const promo = interpretarPromoCarrefour(t);
        if (promo) {
          resultados.push({
            super: 'Día',
            skuId, sellerId,
            productName: p.productName, skuName: sku.name, ean: sku.ean,
            precioBase: price, promo,
          });
        }
      }

      if (price > 0 && (!listPrice || price >= listPrice) && teasersInternos.length === 0) {
        resultados.push({
          super: 'Día',
          skuId, sellerId,
          productName: p.productName, skuName: sku.name, ean: sku.ean,
          precioBase: price, promo: null,
        });
      }
    }
  }
  return resultados;
}

async function diaLiveEAN(ean) {
  const res = await fetch(
    `${DIA_HOST}/api/catalog_system/pub/products/search?fq=alternateIds_Ean:${ean}&sc=1`,
    { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' } }
  );
  return res.ok ? parsearProductosDia(await res.json()) : [];
}

async function diaLiveNombre(nombre) {
  const res = await fetch(
    `${DIA_HOST}/api/catalog_system/pub/products/search?fq=productName:${encodeURIComponent(nombre)}&_from=0&_to=9&sc=1`,
    { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' } }
  );
  return res.ok ? parsearProductosDia(await res.json()) : [];
}

// ─── Live: Coto ───────────────────────────────────────────────────────────────

/** Moda de una lista de precios por sucursal. Empate: se queda con el valor más bajo (a favor del usuario). */
function precioDominanteCoto(precios) {
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

function parsearProductosCoto(results) {
  const resultados = [];
  for (const item of results) {
    const d = item.data || {};
    const ean = d.product_main_ean ? String(d.product_main_ean) : null;
    const productName = d.sku_display_name || d.sku_description || null;
    const precios = (d.price || []).map(p => p.listPrice).filter(p => typeof p === 'number');
    const precioBase = precioDominanteCoto(precios);
    if (!precioBase) continue;

    // Mismos dos formatos que ve el scraper: "X%Dto" (descuento directo) y "NxM" tipo
    // "2x1"/"3x2" (interpretarPromoPorTexto reconoce ambos directo del texto crudo).
    const discounts = d.discounts || [];
    const percentual = discounts.find(disc => /^\d+(?:\.\d+)?\s*%\s*Dto/i.test(disc.discountText || ''));
    const otros = discounts.filter(disc => disc !== percentual);

    if (percentual) {
      const precioFinal = parseFloat(String(percentual.discountPrice || '').replace(/[^\d.]/g, ''));
      if (Number.isFinite(precioFinal) && precioFinal > 0 && precioFinal < precioBase) {
        resultados.push({
          super: 'Coto', productName, skuName: null, ean,
          precioBase,
          promo: interpretarPromoPorTexto('', (1 - precioFinal / precioBase).toFixed(4)),
        });
      }
    }

    for (const disc of otros) {
      const promo = interpretarPromoPorTexto(disc.discountText || '');
      if (promo) {
        resultados.push({ super: 'Coto', productName, skuName: null, ean, precioBase, promo });
      }
    }

    if (!percentual && !otros.length) {
      resultados.push({ super: 'Coto', productName, skuName: null, ean, precioBase, promo: null });
    }
  }
  return resultados;
}

async function cotoBuscar(termino) {
  const res = await fetch(
    `${COTO_HOST}/${encodeURIComponent(termino)}?key=${COTO_KEY}&num_results_per_page=5`,
    { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' } }
  );
  if (!res.ok) return [];
  const data = await res.json();
  return data.response?.results || [];
}

/** Búsqueda por EAN: Coto no tiene filtro exacto, así que se busca por texto y se filtra el match exacto. */
async function cotoLiveEAN(ean) {
  const results = await cotoBuscar(ean);
  const exactos = results.filter(item => String(item.data?.product_main_ean ?? '') === ean);
  return parsearProductosCoto(exactos);
}

async function cotoLiveNombre(nombre) {
  return parsearProductosCoto(await cotoBuscar(nombre));
}

// ─── Live: La Anónima ─────────────────────────────────────────────────────────

/**
 * Extrae UN producto puntual (por idInterno) del HTML de una página de categoría de La
 * Anónima. No comparte código con scraper-promos-laanonima.js a propósito — mismo criterio
 * que el resto de los supers (ver parsearProductosCarrefour más arriba): el scraper arma el
 * catálogo completo, acá solo interesa releer el precio fresco de un producto ya conocido.
 * La Anónima no tiene página de producto individual con precio server-rendered (confirmado
 * en el spike), por eso esto relee la página de CATEGORÍA que guardó el catálogo local.
 */
function parsearProductoLaAnonima(html, idInterno, ean) {
  const inicio = html.indexOf(`id-codigo-producto="${idInterno}"`);
  if (inicio === -1) return [];
  const siguienteInicio = html.indexOf('id-codigo-producto="', inicio + 1);
  const bloque = html.slice(inicio, siguienteInicio === -1 ? Math.min(html.length, inicio + 6000) : siguienteInicio);

  const nombre = bloque.match(/data-nombre\s*=\s*"([^"]*)"/)?.[1] || null;
  const precioOferta = parseFloat(bloque.match(/data-precio_oferta\s*=\s*"([^"]*)"/)?.[1] || '') || null;
  const precioAnterior = parseFloat(bloque.match(/data-precio_anterior\s*=\s*"([^"]*)"/)?.[1] || '') || null;
  if (!nombre || !precioOferta) return [];

  const hayDescuento = precioAnterior && precioAnterior > precioOferta;
  return [{
    super: 'La Anónima',
    skuId: null, sellerId: null,
    productName: nombre, skuName: null, ean,
    precioBase: hayDescuento ? precioAnterior : precioOferta,
    promo: hayDescuento ? interpretarPromoPorTexto('', (1 - precioOferta / precioAnterior).toFixed(4)) : null,
  }];
}

/**
 * `codigoPostal`/`coberturaConfirmada` los resuelve quien llama (CLI vía mi-codigo-postal.json,
 * backend vía el body de /comparar) — acá solo se usa el booleano ya resuelto, este módulo no
 * decide cobertura. Sin CP guardado o sin cobertura confirmada: `[]` sin tocar la red, igual
 * que cualquier super que el usuario no activó.
 */
async function laAnonimaLiveEAN(ean, { codigoPostal, coberturaConfirmada } = {}) {
  if (!codigoPostal || !coberturaConfirmada) return [];
  const entrada = urlLaAnonimaPorEAN(ean);
  if (!entrada) return [];
  const res = await fetch(entrada.urlCategoria, { headers: LAANONIMA_HEADERS });
  if (!res.ok) return [];
  return parsearProductoLaAnonima(await res.text(), entrada.idInterno, ean);
}

/** No hay endpoint de búsqueda por texto confiable en La Anónima (`/catalogo/buscador/{term}`
 *  dio 403 de CloudFront en el spike, no confirmado si es bloqueo real o transitorio) — el
 *  camino principal es buscarPorEAN; este fallback queda deshabilitado hasta confirmarlo. */
async function laAnonimaLiveNombre() {
  return [];
}

// ─── Link de "agregar al carrito" ─────────────────────────────────────────────
// Los 4 supers de acá arriba corren VTEX, que ofrece una URL pública pensada justamente
// para que un comparador de precios arme el carrito directo en el sitio del super
// (mismo mecanismo que usan Google Shopping y similares) — confirmado en vivo con curl
// contra Vea, Carrefour y Día: la respuesta trae Set-Cookie con checkout.vtex.com=__ofid=...,
// o sea arma el carrito de verdad. Coto no entra: no es VTEX (ver COTO_HOST arriba).
const VTEX_CARRITO = {
  vea:       { host: 'https://www.vea.com.ar',                     sc: 34 },
  carr:      { host: 'https://www.carrefour.com.ar',                sc: 1 },
  changomas: { host: CHANGOMAS_HOST,                                sc: 1 },
  dia:       { host: DIA_HOST,                                      sc: 1 },
};

/**
 * URL de "agregar al carrito" de VTEX para un super, o null si el super no es VTEX (Coto)
 * o no hay items. `items`: [{ skuId, sellerId, cantidad }].
 */
function armarUrlCarrito(key, items) {
  const cfg = VTEX_CARRITO[key];
  if (!cfg || !items?.length) return null;

  const params = new URLSearchParams();
  for (const { skuId, sellerId, cantidad } of items) {
    params.append('sku', skuId);
    params.append('qty', String(cantidad));
    params.append('seller', sellerId);
  }
  params.set('sc', String(cfg.sc));
  params.set('redirect', 'true');
  return `${cfg.host}/checkout/cart/add?${params.toString()}`;
}

// ─── Orquestación ─────────────────────────────────────────────────────────────

/**
 * Precios en vivo de un EAN en los 6 supers, en paralelo.
 * @param {string} ean
 * @param {object} opciones
 * @param {string[]} opciones.tarjetas   tarjetas del usuario (habilita promos de tarjeta propia)
 * @param {string|null} opciones.skuIdVea  si ya se conoce, evita releer el catálogo de Vea.
 *                                         Si se omite, se resuelve desde el catálogo local.
 * @param {string|null} opciones.codigoPostal        CP del usuario, solo relevante para La Anónima.
 * @param {boolean} opciones.coberturaConfirmada      si ese CP tiene venta de super online (gate,
 *                                                     no selector de precio — ver laanonima-zona.js).
 * @returns {{ vea: [], carr: [], changomas: [], dia: [], coto: [], laanonima: [] }}
 */
async function buscarPorEAN(ean, { tarjetas = [], skuIdVea, codigoPostal, coberturaConfirmada } = {}) {
  const sku = skuIdVea === undefined ? skuIdVeaPorEAN(ean) : skuIdVea;
  const [vea, carr, changomas, dia, coto, laanonima] = await Promise.all([
    veaLive(ean, sku),
    carrefourLiveEAN(ean, { tarjetas }),
    changoMasLiveEAN(ean),
    diaLiveEAN(ean),
    cotoLiveEAN(ean),
    laAnonimaLiveEAN(ean, { codigoPostal, coberturaConfirmada }),
  ]);
  return { vea, carr, changomas, dia, coto, laanonima };
}

/** Fallback: búsqueda por nombre directo en las APIs (menos confiable que por EAN). La Anónima
 *  no participa (ver laAnonimaLiveNombre) — siempre devuelve []. */
async function buscarPorNombreEnVivo(nombre, { tarjetas = [] } = {}) {
  const [vea, carr, changomas, dia, coto, laanonima] = await Promise.all([
    veaLiveNombre(nombre),
    carrefourLiveNombre(nombre, { tarjetas }),
    changoMasLiveNombre(nombre),
    diaLiveNombre(nombre),
    cotoLiveNombre(nombre),
    laAnonimaLiveNombre(),
  ]);
  return { vea, carr, changomas, dia, coto, laanonima };
}

module.exports = {
  VEA_SELLER,
  CHANGOMAS_HOST,
  CHANGOMAS_SELLER,
  DIA_HOST,
  DIA_SELLER,
  COTO_HOST,
  COTO_KEY,
  SUPERMERCADOS,
  parsearProductosCarrefour,
  parsearProductosChangoMas,
  parsearProductosVea,
  parsearProductosDia,
  parsearProductosCoto,
  carrefourLiveEAN,
  carrefourLiveNombre,
  changoMasLiveEAN,
  changoMasLiveNombre,
  veaLive,
  veaLiveNombre,
  diaLiveEAN,
  diaLiveNombre,
  cotoLiveEAN,
  cotoLiveNombre,
  laAnonimaLiveEAN,
  laAnonimaLiveNombre,
  armarUrlCarrito,
  buscarPorEAN,
  buscarPorNombreEnVivo,
};
