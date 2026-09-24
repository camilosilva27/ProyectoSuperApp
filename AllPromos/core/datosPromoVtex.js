/**
 * Datos extra de promo que expone la API de catálogo VTEX y que los scrapers de Carrefour y
 * Día guardan en el catálogo (auditoría de promos 2026-09-24). Ver CONTEXTO_TECNICO.md,
 * "Motor de promos".
 *
 * - `precioSinDescuento` (PriceWithoutDiscount): distingue si el descuento directo es una
 *   PROMO de VTEX (PriceWithoutDiscount == ListPrice) o un precio de tabla (== Price). Si es
 *   promo, el súper aplica UNA sola promo sobre el precio de lista: el teaser (2do al 50%,
 *   3x2, tarjeta propia) se calcula sobre ListPrice y NO se acumula con el descuento directo.
 * - `nombre` (DiscountHighLight): nombre del descuento directo; trae "Exclusivo online".
 * - `exclusivoOnline` (clusterHighlights del producto): el badge "Exclusivo Online" de Día.
 */

function nombreDescuentoDirecto(offer) {
  const nombres = (offer?.DiscountHighLight || [])
    .map(d => d?.['<Name>k__BackingField'] ?? d?.Name ?? d?.name ?? '')
    .filter(Boolean);
  return nombres.length ? nombres.join(' | ') : null;
}

function extrasDescuentoDirecto(offer) {
  const psd = Number(offer?.PriceWithoutDiscount);
  return {
    precioSinDescuento: Number.isFinite(psd) && psd > 0 ? psd : null,
    nombre: nombreDescuentoDirecto(offer),
  };
}

function esExclusivoOnline(product) {
  return Object.values(product?.clusterHighlights || {})
    .some(n => /exclusivo\s+online/i.test(String(n)));
}

/**
 * Precio sobre el que se calculan los teasers de un SKU del catálogo: el de lista si el
 * descuento directo es una promo (no acumulable), si no el precio actual. Catálogos viejos
 * sin `precioSinDescuento` → precio actual (comportamiento anterior).
 */
function precioBaseTeasers(sku) {
  const psd = sku?.descuentoDirecto?.precioSinDescuento;
  if (psd && sku.precioActual && psd > sku.precioActual + 0.01) return psd;
  return sku?.precioActual;
}

/** Mismo criterio para una commertialOffer en vivo. */
function precioBaseTeasersOffer(offer) {
  const price = offer?.Price || 0;
  const psd = Number(offer?.PriceWithoutDiscount);
  return Number.isFinite(psd) && psd > price + 0.01 ? psd : price;
}

module.exports = {
  extrasDescuentoDirecto, esExclusivoOnline, precioBaseTeasers, precioBaseTeasersOffer,
};
