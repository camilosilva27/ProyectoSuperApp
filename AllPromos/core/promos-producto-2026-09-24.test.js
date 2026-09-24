// Auditoría de promos por súper (2026-09-24): casos reales de Carrefour, Día y Coto.
const test = require('node:test');
const assert = require('node:assert');
const { interpretarPromoCarrefour, calcularCosto, promoDescuentoCoto, esPromoCotoCondicionada } = require('../promo-engine');
const { precioBaseTeasers, precioBaseTeasersOffer, esExclusivoOnline } = require('./datosPromoVtex');
const { mejorOpcion } = require('./comparador');
const fetchers = require('./fetchers');

function productoVtex(ean, offer, extra = {}) {
  return [{ productName: 'P', ...extra, items: [{ itemId: '1', ean, name: 'P', sellers: [{ sellerId: '1', commertialOffer: { IsAvailable: true, ...offer } }] }] }];
}
const teaser = (nombre) => ({ '<Name>k__BackingField': nombre });

test('Carrefour: descuento directo promo + 2do al 50% no se acumulan (Coca Zero 2,25 L x2 = $8.850)', () => {
  const offer = {
    Price: 4425, ListPrice: 5900, PriceWithoutDiscount: 5900,
    DiscountHighLight: [teaser('PROMO-25% Off Mi Crf -Reg-1-25-Gigante23 al 1.10')],
    Teasers: [teaser('PROMO-2do al 50% Max 48 unidades Combinable COCA COLA-Reg-2-50-Gigante23 al 1.10')],
  };
  const entradas = fetchers.parsearProductosCarrefour(productoVtex('7790895067570', offer));
  const mejor = mejorOpcion(entradas, 2, []);
  assert.strictEqual(Math.round(calcularCosto(mejor.promo, mejor.precioBase, 2).totalConPromo), 8850);
});

test('Carrefour: precio de tabla (PriceWithoutDiscount == Price) sí acumula el teaser', () => {
  assert.strictEqual(precioBaseTeasersOffer({ Price: 800, ListPrice: 1000, PriceWithoutDiscount: 800 }), 800);
  assert.strictEqual(precioBaseTeasers({ precioActual: 800, descuentoDirecto: { precioSinDescuento: 800 } }), 800);
  assert.strictEqual(precioBaseTeasers({ precioActual: 800, descuentoDirecto: { precioSinDescuento: 1000 } }), 1000);
  assert.strictEqual(precioBaseTeasers({ precioActual: 800, descuentoDirecto: { precioBase: 1000 } }), 800); // catálogo viejo
});

test('Carrefour: "35% Off Tarjeta Carrefour o Cuenta digital" vale con Cuenta Digital, sobre ListPrice', () => {
  const offer = {
    Price: 1190, ListPrice: 1586.67, PriceWithoutDiscount: 1586.67,
    Teasers: [{
      '<Name>k__BackingField': '35% Off Tarjeta Carrefour o Cuenta digital Max 8  23 al 1.10',
      '<Effects>k__BackingField': { '<Parameters>k__BackingField': [{ '<Name>k__BackingField': 'PercentualDiscount', '<Value>k__BackingField': '35' }] },
    }],
  };
  const entradas = fetchers.parsearProductosCarrefour(productoVtex('7794000008052', offer), { tarjetas: ['Cuenta Digital Carrefour'] });
  const mejor = mejorOpcion(entradas, 2, ['Cuenta Digital Carrefour']);
  assert.strictEqual(Math.round(calcularCosto(mejor.promo, mejor.precioBase, 2).totalConPromo * 100) / 100, 2062.67);
});

test('Carrefour: descuento "Exclusivo online" queda marcado online', () => {
  const offer = { Price: 1290, ListPrice: 2150, PriceWithoutDiscount: 2150, DiscountHighLight: [teaser('PROMO-Exclusivo online 40% Off -Reg-1-40-Quilmes23/9 al 1/10')] };
  const [e] = fetchers.parsearProductosCarrefour(productoVtex('7792798009107', offer));
  assert.strictEqual(e.promo.esOnline, true);
});

test('Día: badge "Exclusivo Online" (clusterHighlights)', () => {
  assert.strictEqual(esExclusivoOnline({ clusterHighlights: { 632: 'Exclusivo Online', 11351: 'Aniversario DIA 2026' } }), true);
  assert.strictEqual(esExclusivoOnline({ clusterHighlights: { 11351: 'Aniversario DIA 2026' } }), false);
});

test('Día: "Llevando 2 a $950 c/u" = 2 por $1.900', () => {
  const p = interpretarPromoCarrefour({ nombre: 'Llevando 2 a $950 c/u ' });
  assert.strictEqual(calcularCosto(p, 1900, 2).totalConPromo, 1900);
  assert.strictEqual(calcularCosto(p, 1900, 1).totalConPromo, 1900);
});

test('Día: teaser que no se interpreta no hace desaparecer al súper en vivo', () => {
  const entradas = fetchers.parsearProductosDia(productoVtex('1', { Price: 100, ListPrice: 100, Teasers: [teaser('Promo rara sin formato')] }));
  assert.strictEqual(entradas.length, 1);
  assert.strictEqual(entradas[0].promo, null);
});

test('Chango Más: formatos de la simulación de checkout', () => {
  assert.strictEqual(Math.round(calcularCosto(interpretarPromoCarrefour({ nombre: 'PromoVolumen - LLEVANDO 2 - 2da al 70% - Reg-2-70' }), 3639, 2).totalConPromo * 100) / 100, 4730.7);
  assert.strictEqual(calcularCosto(interpretarPromoCarrefour({ nombre: 'LLEVANDO 2 - 2x1 - Reg-2-100' }), 2879, 2).totalConPromo, 2879);
  assert.strictEqual(calcularCosto(interpretarPromoCarrefour({ nombre: '2x$1599 ALFAJOR TRIPLE' }), 1409, 2).totalConPromo, 1599);
});

test('Coto: "Llevando 2" 35%Dto solo vale de a 2 (leche: 1 u. a precio lleno)', () => {
  const p = promoDescuentoCoto('0.3556', 2);
  assert.strictEqual(calcularCosto(p, 4499, 1).totalConPromo, 4499);
  assert.strictEqual(Math.round(calcularCosto(p, 4499, 2).totalConPromo), Math.round(4499 * 0.6444 * 2));
  assert.strictEqual(Math.round(calcularCosto(p, 4499, 3).totalConPromo), Math.round(4499 * 0.6444 * 2 + 4499));
  assert.strictEqual(promoDescuentoCoto('0.20').cantidadMinima, 1);
});

test('Coto: "15%" suelto, "+5%" y "1 Pago 10%" son de Comunidad/medio de pago', () => {
  for (const t of ['15%', '+5%', '+ 10%', '1 Pago 10%']) assert.strictEqual(esPromoCotoCondicionada(t), true, t);
  for (const t of ['2x1', '70% 2da', '3x2']) assert.strictEqual(esPromoCotoCondicionada(t), false, t);
});
