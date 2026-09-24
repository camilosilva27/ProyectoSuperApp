/**
 * Promos por cantidad de Chango Más (2x1, "2da al X%", "2x$precio") vía la simulación de checkout.
 *
 * Por qué existe (2026-09-24): Chango Más NUNCA expone estas promos en el catálogo
 * (`commertialOffer.Teasers`/`PromotionTeasers`/`DiscountHighLight` vienen siempre vacíos, ver
 * CONTEXTO_TECNICO.md § "API de Chango Más"). Solo aparecen al simular un carrito:
 *
 *   POST {BASE}/api/checkout/pub/orderForms/simulation?sc=1
 *   { items: [{ id: skuId, quantity: 2, seller: '1' }, ...], country: 'ARG' }
 *
 * Cómo se asocia un beneficio con un SKU (visto en vivo, no supuesto):
 *   - `ratesAndBenefitsData.rateAndBenefitsIdentifiers[]` es la lista de beneficios que se
 *     aplicaron en TODO el carrito simulado: `{ id, name, matchedParameters, ... }`. El `name` es
 *     el texto que interpreta `interpretarPromoCarrefour` ("PromoVolumen - LLEVANDO 2 - 2da al
 *     70% - Reg-2-70 - SURTIDO ...", "LLEVANDO 2 - 2x1 - Reg-2-100", "2x$2499 ALFAJOR ...").
 *   - Cada `items[i].priceTags[]` trae el descuento que le tocó a ESE ítem, con
 *     `name: "discount@price-{idDelBeneficio}#{idDeLaAcción}"` y `value` negativo en centavos.
 *   Se usa el cruce priceTag → beneficio por id (no `matchedParameters`, que no está en todos los
 *   beneficios — ej. "Promo Banana $1699" viene con `{}`), así nunca se le asigna a un SKU la promo
 *   de otro SKU del mismo lote. `discount@price-` además deja afuera los descuentos de envío
 *   (`discount@shipping-...`).
 *
 * Detalles verificados en vivo 2026-09-24:
 *   - Un skuId inexistente en el lote NO rompe el lote: viene un `messages[]` ORD027 y el resto de
 *     los ítems se simula normal. Un SKU sin stock viene con `availability: "withoutPriceFulfillment"`
 *     y sin priceTags.
 *   - Con cantidad 3, VTEX parte el ítem en varias líneas (2 con promo + 1 sin) — por eso se
 *     acumula por `id`, no por línea.
 *   - ~1 s por POST de 50 ítems. No se vio ningún 429 con 1 s de espera entre POST.
 *   - Hacen falta DOS pasadas, cantidad 2 y cantidad 3, y unir: con 2 no aparecen los "LLEVANDO 3
 *     - 3x2" / "3X$3999" (38 SKUs extra sobre 2548 el 24/09), y con 3 VTEX elige la mejor promo
 *     para esas 3 unidades, así que un "2da al 50%" puede quedar tapado por un 3x2 del mismo SKU
 *     (pasó con 1 SKU). ~115 s por pasada sobre el catálogo base (51 lotes).
 *   - Además de las promos por cantidad aparecen beneficios UNITARIOS de checkout ("Promo Banana
 *     $1699 23/09", "Ahorrás 35%- Exclusivo online- Carne Picada $10.349"). No se guardan: no son
 *     "por cantidad", el motor no los interpreta, y a veces el catálogo ya refleja parte de ese
 *     descuento (riesgo de doble descuento si algún día se interpretaran). Ver CONTEXTO_TECNICO.md.
 *
 * Sin console.log (regla de core/): devuelve estadísticas y el script las imprime.
 */
const { esTeaserBancario } = require('../promo-engine');
const { fetchConReintentoHTTP } = require('./reintentoVTEX');

const TAMANO_LOTE = 50;
const CANTIDADES_SIMULADAS = [2, 3]; // ver cabecera: con una sola cantidad se pierden promos
const ESPERA_ENTRE_LOTES_MS = 1000;
const TIMEOUT_POST_MS = 30000;
// Si fallan N lotes seguidos (tras los reintentos de fetchConReintentoHTTP), se corta la pasada:
// probablemente es un bloqueo/caída de masonline y seguir solo quema minutos del cron.
const MAX_LOTES_FALLIDOS_SEGUIDOS = 3;
const TIEMPO_MAXIMO_MS = 7 * 60 * 1000; // 2 pasadas × ~115 s normales sobre el catálogo base (cron: 15 min)

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Formatos de promo por cantidad vistos en la simulación: "LLEVANDO N", código "Reg-N-M",
// "NxM"/"Nx$precio" y "Nda al X%".
const PROMO_POR_CANTIDAD_RE = /llevando\s+\d|reg-\d+-\d+|(?:^|[\s-])\d+\s*x\s*\$?\s*\d|\d+\s*d[oa]\s+al\s+\d+\s*%/i;

/**
 * Beneficio que corresponde guardar: promo POR CANTIDAD de producto. Fuera bancarias, medios de
 * pago, MasClub, envío, y los beneficios unitarios de checkout (ver cabecera).
 */
function esBeneficioDeProducto(nombre) {
  if (!nombre || typeof nombre !== 'string') return false;
  if (esTeaserBancario(nombre)) return false;
  if (/env[ií]o|shipping|flete|mas\s?club|\bmodo\b|mercado\s?pago|cuotas/i.test(nombre)) return false;
  return PROMO_POR_CANTIDAD_RE.test(nombre);
}

/**
 * Parseo puro de UNA respuesta de simulación. Devuelve Map<skuId, string[]> (nombres únicos).
 * Lanza si el formato no es el esperado (sin `items` array) — el llamador lo cuenta como lote fallido.
 */
function extraerPromosDeSimulacion(respuesta) {
  if (!respuesta || !Array.isArray(respuesta.items)) {
    throw new Error('respuesta de simulación sin items[] (formato inesperado)');
  }
  const beneficios = respuesta.ratesAndBenefitsData?.rateAndBenefitsIdentifiers;
  const nombrePorId = new Map();
  for (const b of Array.isArray(beneficios) ? beneficios : []) {
    if (b?.id && esBeneficioDeProducto(b.name)) nombrePorId.set(String(b.id), b.name.trim());
  }

  const porSku = new Map();
  for (const item of respuesta.items) {
    if (!item?.id) continue;
    for (const tag of Array.isArray(item.priceTags) ? item.priceTags : []) {
      const m = /^discount@price-([^#]+)/i.exec(tag?.name || '');
      if (!m || !(Number(tag.value) < 0)) continue;
      const nombre = nombrePorId.get(m[1]);
      if (!nombre) continue;
      const id = String(item.id);
      if (!porSku.has(id)) porSku.set(id, []);
      if (!porSku.get(id).includes(nombre)) porSku.get(id).push(nombre);
    }
  }
  return porSku;
}

/**
 * Simula por lotes y junta las promos por skuId. NUNCA lanza: cualquier falla de un lote
 * (red, 429/5xx tras reintentos, JSON roto, formato distinto) se cuenta y se sigue; si fallan
 * varios lotes seguidos o se pasa del tiempo máximo, corta y devuelve lo que juntó.
 *
 * @returns {Promise<{ promosPorSku: Map<string,string[]>, lotesTotales, lotesOk, lotesFallidos,
 *   errores: string[], cortado: string|null, duracionMs }>}
 */
async function simularPromosPorSku(skuIds, {
  baseUrl, sc = 1, seller = '1', cantidad = 2, tamanoLote = TAMANO_LOTE,
  esperaEntreLotesMs = ESPERA_ENTRE_LOTES_MS, tiempoMaximoMs = TIEMPO_MAXIMO_MS,
  headers = {}, onReintento = () => {}, onLote = () => {}, esperar = sleep,
  fetchConReintento = fetchConReintentoHTTP,
} = {}) {
  const inicio = Date.now();
  const ids = [...new Set((skuIds || []).filter(Boolean).map(String))];
  const lotes = [];
  for (let i = 0; i < ids.length; i += tamanoLote) lotes.push(ids.slice(i, i + tamanoLote));

  const resultado = {
    promosPorSku: new Map(), lotesTotales: lotes.length, lotesOk: 0, lotesFallidos: 0,
    errores: [], cortado: null, duracionMs: 0,
  };
  const url = `${baseUrl}/api/checkout/pub/orderForms/simulation?sc=${sc}`;
  let fallidosSeguidos = 0;

  for (let i = 0; i < lotes.length; i++) {
    if (Date.now() - inicio > tiempoMaximoMs) {
      resultado.cortado = `tiempo máximo (${Math.round(tiempoMaximoMs / 1000)}s) superado en el lote ${i + 1}/${lotes.length}`;
      break;
    }
    if (i > 0) await esperar(esperaEntreLotesMs);
    try {
      const res = await fetchConReintento(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...headers },
        body: JSON.stringify({
          items: lotes[i].map(id => ({ id, quantity: cantidad, seller })),
          country: 'ARG',
        }),
      }, { timeoutMs: TIMEOUT_POST_MS, onReintento });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const porSku = extraerPromosDeSimulacion(await res.json());
      for (const [id, nombres] of porSku) {
        const previos = resultado.promosPorSku.get(id) || [];
        resultado.promosPorSku.set(id, [...new Set([...previos, ...nombres])]);
      }
      resultado.lotesOk++;
      fallidosSeguidos = 0;
    } catch (err) {
      resultado.lotesFallidos++;
      fallidosSeguidos++;
      if (resultado.errores.length < 10) resultado.errores.push(`lote ${i + 1}: ${err.message}`);
      if (fallidosSeguidos >= MAX_LOTES_FALLIDOS_SEGUIDOS) {
        resultado.cortado = `${fallidosSeguidos} lotes seguidos fallidos (último: ${err.message})`;
        break;
      }
    }
    onLote(i + 1, lotes.length, resultado);
  }
  resultado.duracionMs = Date.now() - inicio;
  return resultado;
}

/**
 * Agrega a cada SKU (mutándolo) las promos simuladas como `promosInternas: [{ nombre, esBancaria }]`
 * — mismo formato que los teasers de Carrefour/Día, así precioCache.js → entradasVtexConTeasers →
 * interpretarPromoCarrefour lo aplica sin cambios. Deduplica contra lo que ya traía el catálogo.
 * Devuelve cuántos SKUs recibieron al menos una promo nueva.
 */
function aplicarPromosSimuladas(skus, promosPorSku) {
  let conPromo = 0;
  for (const sku of skus) {
    const nombres = promosPorSku.get(String(sku.skuId));
    if (!nombres?.length) continue;
    const actuales = Array.isArray(sku.promosInternas) ? sku.promosInternas : [];
    const vistos = new Set(actuales.map(t => t.nombre));
    const nuevas = nombres.filter(n => !vistos.has(n)).map(nombre => ({ nombre, esBancaria: false }));
    if (!nuevas.length) continue;
    sku.promosInternas = [...actuales, ...nuevas];
    conPromo++;
  }
  return conPromo;
}

/**
 * Pasada completa para los scripts de Chango Más: simula con cada cantidad de `cantidades`
 * (presupuesto de tiempo `tiempoMaximoMs` COMPARTIDO entre pasadas), une, aplica y devuelve el
 * resumen en texto (el script lo imprime). Nunca lanza.
 */
async function completarPromosPorSimulacion(skus, {
  cantidades = CANTIDADES_SIMULADAS, tiempoMaximoMs = TIEMPO_MAXIMO_MS, ...opciones
} = {}) {
  const inicio = Date.now();
  const promosPorSku = new Map();
  const lineas = [];
  for (const cantidad of cantidades) {
    const restante = tiempoMaximoMs - (Date.now() - inicio);
    if (restante <= 0) {
      lineas.push(`⚠️  Pasada cantidad ${cantidad} salteada: sin tiempo (tope ${Math.round(tiempoMaximoMs / 1000)}s)`);
      continue;
    }
    let r;
    try {
      r = await simularPromosPorSku(skus.map(s => s.skuId), { ...opciones, cantidad, tiempoMaximoMs: restante });
    } catch (err) {
      // Defensa extra: simularPromosPorSku ya atrapa todo por lote.
      lineas.push(`⚠️  Pasada cantidad ${cantidad} falló por completo (${err.message})`);
      continue;
    }
    for (const [id, nombres] of r.promosPorSku) {
      promosPorSku.set(id, [...new Set([...(promosPorSku.get(id) || []), ...nombres])]);
    }
    let linea = `  cantidad ${cantidad}: ${r.promosPorSku.size} SKUs con promo — ${r.lotesOk}/${r.lotesTotales} lotes OK en ${(r.duracionMs / 1000).toFixed(1)}s`;
    if (r.lotesFallidos) linea += `\n  ⚠️  ${r.lotesFallidos} lotes fallidos (esos SKUs quedan sin promo por cantidad esta corrida): ${r.errores.join(' | ')}`;
    if (r.cortado) linea += `\n  ⚠️  Pasada cortada: ${r.cortado}`;
    lineas.push(linea);
  }
  const skusConPromo = aplicarPromosSimuladas(skus, promosPorSku);
  const duracionMs = Date.now() - inicio;
  const resumen = [
    `Simulación de promos por cantidad: ${skusConPromo} SKUs con promo en ${(duracionMs / 1000).toFixed(1)}s (si falló, el catálogo se guarda igual sin esas promos)`,
    ...lineas,
  ].join('\n');
  return { skusConPromo, resumen, promosPorSku, duracionMs };
}

module.exports = {
  extraerPromosDeSimulacion, simularPromosPorSku, aplicarPromosSimuladas, completarPromosPorSimulacion,
  esBeneficioDeProducto, TAMANO_LOTE, CANTIDADES_SIMULADAS,
};
