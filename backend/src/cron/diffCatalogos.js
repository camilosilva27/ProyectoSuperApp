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

module.exports = { leerJSON, diffProductos, diffPromosSuper, registrarDiff };
