/**
 * Promo por producto de Vea/Jumbo/Disco (misma cuenta VTEX de Cencosud, endpoint
 * `/_v/search-promotions`). Un solo lugar para: (a) armar el objeto `promocion` que guardan los
 * scrapers/completadores/refrescadores en catalogo-{vea,jumbo,disco}[-extras].json, y (b)
 * traducirlo a la promo que entiende calcularCosto() (precioCache.js y el fallback en vivo de
 * fetchers.js).
 *
 * Bug real (2026-09-24): para `categoryType: "fixed_price"` ("OFERTA TRAVIATA | Ofertas
 * Trafico", code "Oferta") el precio real de la oferta es `value` (precio unitario en $), y
 * `effectiveDiscount` es un número de la promo ENTERA (el mismo para todos los SKUs de la
 * campaña, redondeado a 2 decimales). Se usaba solo `effectiveDiscount` como % directo:
 * Traviata con precio fijo $790 salía Vea $769,50 / Disco $810 / Jumbo $850,50; pelador Krea
 * (skuId 412145) $2.383 en vez de $1.490. Ahora fixed_price usa `value`.
 *
 * categoryType vistos en datos reales (2026-09-24): "percentual", "nxm", "segundo_al"
 * (effectiveDiscount correcto + nombre "3x2 …"/"2do al X% …", ya los interpreta
 * interpretarPromoPorTexto), "fixed_price" (usa `value`) y "Llevando n x" (value 0, sin
 * effectiveDiscount, solo code "Llevando 6": no dice % ni precio → se descarta, no se adivina).
 */

const { interpretarPromoPorTexto } = require('../promo-engine');

const PRECIO_FIJO = 'fixed_price';

function fmtPesos(n) {
  return Number(n).toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

/** Precio de oferta usable de una promo fixed_price, o null si falta o no baja el precio. */
function precioFijoValido(value, precioBase) {
  const v = Number(value);
  return Number.isFinite(v) && v > 0 && Number(precioBase) > 0 && v < Number(precioBase) ? v : null;
}

/**
 * Objeto `promocion` del catálogo a partir de la promo cruda de search-promotions (o null).
 * - fixed_price: `precioFinal = value`, `descuento`/`descuentoPct` = % REAL sobre precioBase
 *   (no el effectiveDiscount de la campaña; así un lector viejo que solo mira `descuento`
 *   también llega al precio correcto). Si `value` falta o es >= precioBase → null (sin promo).
 * - resto: igual que antes (effectiveDiscount numérico > 0 o sin promo), + `categoryType`.
 */
function promocionCatalogoCencosud(promo, precioBase) {
  if (!promo) return null;
  const vigencia = { vigenciaDesde: promo.start || null, vigenciaHasta: promo.end || null };

  if (promo.categoryType === PRECIO_FIJO) {
    const valor = precioFijoValido(promo.value, precioBase);
    if (valor === null) return null;
    const pct = 1 - valor / precioBase;
    return {
      nombre: promo.name,
      codigo: promo.code,
      categoryType: PRECIO_FIJO,
      value: valor,
      descuento: pct.toFixed(4),
      descuentoPct: (pct * 100).toFixed(0) + '%',
      precioFinal: valor,
      ...vigencia,
    };
  }

  const descuento = parseFloat(promo.effectiveDiscount);
  if (!(Number.isFinite(descuento) && descuento > 0)) return null;
  return {
    nombre: promo.name,
    codigo: promo.code,
    categoryType: promo.categoryType ?? null,
    descuento: promo.effectiveDiscount,
    descuentoPct: (descuento * 100).toFixed(0) + '%',
    precioFinal: Math.round(precioBase * (1 - descuento) * 100) / 100,
    ...vigencia,
  };
}

/**
 * Promo del motor (forma de interpretarPromoPorTexto) a partir del `promocion` del catálogo.
 * Catálogos viejos sin `categoryType` → mismo resultado que antes.
 */
function promoMotorCencosud(promocion, precioBase) {
  if (!promocion) return null;
  if (promocion.categoryType === PRECIO_FIJO) {
    const valor = precioFijoValido(promocion.value, precioBase);
    if (valor === null) return null;
    // esOnline con el mismo criterio que el resto de las promos de Vea ("| Ofertas Trafico",
    // "| Ecommerce"…): se lo pide al motor con un descuento neutro para no duplicar la regex.
    const esOnline = interpretarPromoPorTexto(promocion.nombre, 0)?.esOnline ?? false;
    return {
      tipo: 'oferta_precio_fijo',
      descripcion: `Precio oferta $${fmtPesos(valor)}`,
      cantidadMinima: 1,
      nUnidades: 1,
      precioFijoTotal: valor,
      esOnline,
    };
  }
  return interpretarPromoPorTexto(promocion.nombre, promocion.descuento);
}

/** Atajo para el fallback en vivo: promo cruda de search-promotions → promo del motor. */
function promoMotorDesdeCrudaCencosud(promoCruda, precioBase) {
  return promoMotorCencosud(promocionCatalogoCencosud(promoCruda, precioBase), precioBase);
}

module.exports = { promocionCatalogoCencosud, promoMotorCencosud, promoMotorDesdeCrudaCencosud };
