/**
 * Calcula cuánto cambió cada corrida de scraper respecto de la corrida anterior y lo guarda en
 * `scraper_diffs` (Supabase). No es un proceso aparte: se llama desde refrescarCatalogos.js,
 * comparando el catálogo/promos-bancarias en memoria (leído ANTES de que el scraper lo pise)
 * contra el resultado de esta corrida. Objetivo: acumular suficientes corridas para poder
 * responder "¿qué día/hora suele cambiar el precio o las promos de cada super?" — ver
 * migración 0014_scraper_diffs.sql.
 */
const fs = require('fs');
const { clienteSupabaseAdmin } = require('../clienteSupabaseAdmin');

function leerJSON(ruta) {
  try {
    return JSON.parse(fs.readFileSync(ruta, 'utf8'));
  } catch {
    return null;
  }
}

// Huella de la promo de un SKU: Vea/Jumbo/Disco guardan el teaser crudo de VTEX en
// `promocion`; Día/Carrefour/ChangoMás migraron a los campos estructurados
// `descuentoDirecto`/`promosInternas`/`promosBancarias` y no tienen `promocion` (queda
// undefined siempre) — comparar solo ese campo dejaba a estos 3 supers con
// promocion_modificados clavado en 0 para siempre, aunque sí tuvieran cambios reales.
function huellaPromoSku(sku) {
  if (sku.promocion !== undefined) return JSON.stringify(sku.promocion);
  return JSON.stringify({
    descuentoDirecto: sku.descuentoDirecto,
    promosInternas: sku.promosInternas,
    promosBancarias: sku.promosBancarias,
  });
}

// Si un SKU tiene promo de PRODUCTO activa ahora mismo — a propósito NO cuenta
// `promosBancarias` (promo de tarjeta/banco, no del producto en sí; ver
// aviso-promo-sin-aplicar-solo-si-gana en la memoria del proyecto, es un mecanismo aparte) para
// no generar avisos de "promo nueva" por algo que no es una oferta puntual de ese producto.
//
// El teaser crudo de VTEX (`promocion`, Vea/Jumbo/Disco) puede venir con un % real de 0 (ej.
// "OFERTA ROSAMONTE BA" con descuentoPct: "0%", mismo precioFinal que precioBase) — es una
// campaña de marketing sin recorte de precio real, no una oferta. Bug real encontrado en
// producción (2026-09-11): se avisaba "promo nueva" por esto aunque no hubiera nada que
// mostrar (el chip de % quedaba vacío, 0 es falsy). Un `descuentoPct` presente pero no
// numérico o <= 0 no cuenta como promo.
function tienePromoDeProducto(sku) {
  if (sku.promocion !== undefined) {
    if (!sku.promocion) return false;
    const pct = typeof sku.promocion.descuentoPct === 'string'
      ? parseFloat(sku.promocion.descuentoPct)
      : sku.promocion.descuentoPct;
    return Number.isFinite(pct) ? pct > 0 : true;
  }
  return !!sku.descuentoDirecto || !!(sku.promosInternas && sku.promosInternas.length);
}

// Mejor esfuerzo para mostrar "35% off, $4.290" en el push/mail (ver diseño 20e). Solo cubre
// los dos tipos que traen un % y un precio final directos en el propio SKU: el teaser crudo de
// VTEX (`promocion`, Vea/Jumbo/Disco) y `descuentoDirecto` (Día/Carrefour/ChangoMás/Coto). Si
// la única promo activa es un `promosInternas` (NxM, 2do al X%) no hay un % único que mostrar
// sin calcular para una cantidad puntual — se deja null, el mail/push cae a un texto genérico.
function descuentoDeProducto(sku) {
  const promo = sku.promocion ?? sku.descuentoDirecto;
  if (!promo) return { descuentoPct: null, precioFinal: null };
  const pct = typeof promo.descuentoPct === 'string' ? parseFloat(promo.descuentoPct) : promo.descuentoPct;
  return {
    descuentoPct: Number.isFinite(pct) ? pct : null,
    precioFinal: typeof promo.precioFinal === 'number' ? promo.precioFinal : null,
  };
}

// Estado ACTUAL (no un diff) de la promo de cada SKU con promo de producto en este catálogo,
// por EAN — es la base de "avisar a quien sigue este producto" (ver avisoProductosSeguidos.js).
// Se compara por EAN, no por skuId: es lo que el usuario sigue (producto_seguido.ean) y lo que
// identifica al mismo producto real entre supers.
//
// A propósito NO es un diff contra la corrida anterior (a diferencia de `diffProductos`): un
// diff global de "sin promo a con promo" se pierde el caso de alguien que empieza a seguir un
// producto que YA tenía promo activa — esa transición ya pasó antes de que existiera el
// seguimiento, así que nunca volvería a dispararse y el usuario se quedaría sin avisar para
// siempre. En cambio, acá se expone el estado actual con su `huella` (mismo formato que
// `huellaPromoSku`) y es `avisoProductosSeguidos.js` quien decide, por CADA fila de
// `producto_seguido`, si la huella actual difiere de la última que se le avisó a ese usuario —
// eso cubre tanto "la promo recién se prendió" como "recién empecé a seguir algo que ya tenía
// promo" con la misma comparación.
function estadoPromoPorEan(catalogo, superNombre) {
  const mapa = new Map();
  for (const sku of catalogo?.skus ?? []) {
    if (!sku.ean || !tienePromoDeProducto(sku)) continue;
    mapa.set(sku.ean, {
      ean: sku.ean,
      nombre: sku.productName || sku.skuName || '(sin nombre)',
      categoria: sku.categoria || null,
      super: superNombre,
      huella: huellaPromoSku(sku),
      ...descuentoDeProducto(sku),
    });
  }
  return mapa;
}

// Identidad de un SKU: por skuId (estable dentro de un mismo super/seller entre corridas).
function diffProductos(antes, despues) {
  const skusAntes = antes?.skus ?? [];
  const skusDespues = despues?.skus ?? [];
  const mapaAntes = new Map(skusAntes.map(s => [s.skuId, s]));
  const mapaDespues = new Map(skusDespues.map(s => [s.skuId, s]));

  let agregados = 0;
  let eliminados = 0;
  let precioModificados = 0;
  let promocionModificados = 0;

  for (const [skuId, skuDespues] of mapaDespues) {
    const skuAntes = mapaAntes.get(skuId);
    if (!skuAntes) {
      agregados++;
      continue;
    }
    if (skuAntes.precioBase !== skuDespues.precioBase) precioModificados++;
    if (huellaPromoSku(skuAntes) !== huellaPromoSku(skuDespues)) promocionModificados++;
  }
  for (const skuId of mapaAntes.keys()) {
    if (!mapaDespues.has(skuId)) eliminados++;
  }

  return {
    total_antes: skusAntes.length,
    total_despues: skusDespues.length,
    agregados,
    eliminados,
    precio_modificados: precioModificados,
    promocion_modificados: promocionModificados,
  };
}

// Identidad de una promo bancaria: banco(s) + días de vigencia semanal. Es lo que un super rota
// muy poco (una promo del Comafi los lunes sigue siendo "esa promo" aunque le cambien el % o el
// tope) — así separamos "modificó una condición" de "agregó/sacó una promo distinta".
function identidadPromo(promo) {
  const bancos = (promo.canonicosPosibles ?? []).slice().sort().join('+');
  const dias = (promo.dias ?? []).slice().sort().join('+');
  return `${bancos}|${dias}`;
}

function huellaCondicion(promo) {
  return JSON.stringify({
    descuentoPct: promo.descuentoPct,
    tope: promo.tope,
    montoMinimo: promo.montoMinimo,
    vigenciaDesde: promo.vigenciaDesde,
    vigenciaHasta: promo.vigenciaHasta,
    canales: promo.canales,
  });
}

function diffPromosSuper(promosAntes, promosDespues) {
  const mapaAntes = new Map((promosAntes ?? []).map(p => [identidadPromo(p), p]));
  const mapaDespues = new Map((promosDespues ?? []).map(p => [identidadPromo(p), p]));

  let agregados = 0;
  let eliminados = 0;
  let modificados = 0;

  for (const [id, promoDespues] of mapaDespues) {
    const promoAntes = mapaAntes.get(id);
    if (!promoAntes) {
      agregados++;
      continue;
    }
    if (huellaCondicion(promoAntes) !== huellaCondicion(promoDespues)) modificados++;
  }
  for (const id of mapaAntes.keys()) {
    if (!mapaDespues.has(id)) eliminados++;
  }

  return {
    total_antes: promosAntes?.length ?? 0,
    total_despues: promosDespues?.length ?? 0,
    agregados,
    eliminados,
    modificados,
  };
}

async function registrarDiff(fila) {
  const supabaseAdmin = clienteSupabaseAdmin();
  if (!supabaseAdmin) return; // sin credenciales configuradas (ej. entorno local sin .env completo)
  const { error } = await supabaseAdmin.from('scraper_diffs').insert(fila);
  if (error) console.error(`   ⚠️  No se pudo registrar el diff de ${fila.super} (${fila.tipo}): ${error.message}`);
}

module.exports = { leerJSON, diffProductos, diffPromosSuper, registrarDiff, estadoPromoPorEan };
