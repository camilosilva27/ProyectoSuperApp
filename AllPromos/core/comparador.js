/**
 * Comparación entre supermercados: elegir la mejor opción por super, detectar cantidades
 * que activarían una promo, y consolidar el resumen final de una lista de compra.
 *
 * Todo acá es cálculo puro: recibe los resultados en vivo (core/fetchers.js) y devuelve
 * datos. No imprime ni pregunta nada — el CLI se encarga de mostrarlo por consola y el
 * backend de serializarlo a JSON. Es lo que evita que CLI y API puedan dar números
 * distintos para la misma compra.
 */

const { calcularCosto } = require('../promo-engine');
const { SUPERMERCADOS } = require('./fetchers');

/** Los totales se redondean a centavos antes de compararlos o mostrarlos. */
function redondear(n) {
  return Math.round(n * 100) / 100;
}

/**
 * Texto de la oferta tal como se muestra al usuario, con los mismos marcadores que el CLI:
 * 🌐 = descuento exclusivo online, 💳 = requiere pagar con una tarjeta puntual.
 */
function describirOferta(promo) {
  if (!promo) return 'sin promoción';
  return promo.descripcion
    + (promo.esOnline ? ' 🌐' : '')
    + (promo.requiereTarjeta ? ' 💳' : '');
}

/**
 * Decide si una promo cuenta para el total "oficial" que se le muestra al usuario.
 *
 * Si no se pasa `tarjetasSeleccionadas` (queda `undefined`), se confía en que quien armó
 * `resultados` ya filtró por tarjeta antes de llegar acá — es el comportamiento de siempre,
 * el que usa el CLI (`core/fetchers.js` solo genera la promo de tarjeta propia si el usuario
 * la tiene en `mis-tarjetas.json`). El backend, en cambio, pide TODAS las promos de tarjeta
 * que existan para el producto (para poder mostrarlas como aviso aunque no estén activadas)
 * y pasa acá la lista de tarjetas que el usuario efectivamente seleccionó — una promo que
 * pide una tarjeta fuera de esa lista no cuenta para el total, aunque el objeto `promo`
 * siga intacto para que la UI pueda mostrarla como "activá esta tarjeta para pagar esto".
 */
function promoParaRanking(promo, tarjetasSeleccionadas) {
  if (!promo) return null;
  if (tarjetasSeleccionadas === undefined) return promo;
  if (promo.requiereTarjeta && !tarjetasSeleccionadas.includes(promo.requiereTarjeta)) return null;
  return promo;
}

function costoRanking(p, cantidad, tarjetasSeleccionadas) {
  return calcularCosto(promoParaRanking(p.promo, tarjetasSeleccionadas), p.precioBase, cantidad).totalConPromo;
}

/** De todas las variantes que devolvió un super, la más barata para esa cantidad. */
function mejorOpcion(resultados, cantidad, tarjetasSeleccionadas) {
  if (!resultados || !resultados.length) return null;
  return resultados.reduce((m, p) => {
    const ct = costoRanking(p, cantidad, tarjetasSeleccionadas);
    const mt = m ? costoRanking(m, cantidad, tarjetasSeleccionadas) : Infinity;
    return ct < mt ? p : m;
  }, null);
}

/** Mejor opción de un super entre TODOS los grupos combinados, no solo uno. */
function mejorOpcionCombinada(grupos, key, cantidad, tarjetasSeleccionadas) {
  return mejorOpcion(grupos.flatMap(g => g[key] || []), cantidad, tarjetasSeleccionadas);
}

/**
 * Comparativo de un grupo (un EAN) entre los supers que lo tienen, del más barato al más caro.
 * @returns [{ key, nombre, tag, mejor, total }]
 */
function calcularOpciones(grupo, cantidad, supermercados = SUPERMERCADOS, tarjetasSeleccionadas) {
  return supermercados
    .map(s => ({ ...s, mejor: mejorOpcion(grupo[s.key], cantidad, tarjetasSeleccionadas) }))
    .filter(o => o.mejor)
    .map(o => ({
      ...o,
      total: redondear(calcularCosto(promoParaRanking(o.mejor.promo, tarjetasSeleccionadas), o.mejor.precioBase, cantidad).totalConPromo),
    }))
    .sort((a, b) => a.total - b.total);
}

/**
 * Cantidades mínimas de promos que existen en algún super pero no se activan con
 * `cantidadActual` (cualquier diferencia, no solo "falta 1 unidad").
 * @returns [cantidadMinima, ...] ordenado ascendente, sin repetidos
 */
function detectarCantidadesCandidatas(grupos, cantidadActual, supermercados = SUPERMERCADOS) {
  const cantidades = new Set();
  for (const grupo of grupos) {
    for (const s of supermercados) {
      for (const r of grupo[s.key] || []) {
        if (r.promo && r.promo.cantidadMinima > cantidadActual) cantidades.add(r.promo.cantidadMinima);
      }
    }
  }
  return [...cantidades].sort((a, b) => a - b);
}

/**
 * Vista previa completa (todos los supers) para cada cantidad candidata.
 *
 * Se calcula para TODAS las candidatas juntas a propósito: distintos supers pueden requerir
 * distintas cantidades para activar promos distintas (ej. Carrefour 2x1 necesita 2, Vea 3x2
 * necesita 3), y mostrar solo una ocultaría la otra alternativa. No vuelve a consultar las
 * APIs — `precioBase` y `promo` ya están en memoria y no dependen de la cantidad.
 *
 * @returns [{ cantidad, opciones: [{ key, nombre, tag, total, promo, oferta }] }]
 */
function calcularVistaPreviaCantidades(grupos, candidatas, supermercados = SUPERMERCADOS, tarjetasSeleccionadas) {
  return candidatas.map(cantidad => ({
    cantidad,
    opciones: supermercados
      .map(s => {
        const mejor = mejorOpcionCombinada(grupos, s.key, cantidad, tarjetasSeleccionadas);
        if (!mejor) return null;
        const promoRank = promoParaRanking(mejor.promo, tarjetasSeleccionadas);
        return {
          key: s.key,
          nombre: s.nombre,
          tag: s.tag,
          total: redondear(calcularCosto(promoRank, mejor.precioBase, cantidad).totalConPromo),
          promo: mejor.promo,
          oferta: describirOferta(promoRank),
        };
      })
      .filter(Boolean),
  }));
}

/**
 * Sugerencia no bloqueante de cambio de cantidad: qué cantidades activarían una promo que
 * hoy no se activa, y cuánto costaría en cada super con cada una.
 *
 * En el CLI esto se convierte en una pregunta por consola; en la API viaja como dato dentro
 * de la respuesta para que la UI lo muestre como un banner con un botón, sin bloquear.
 * @returns { cantidadesCandidatas, vistaPrevia } | null
 */
function calcularSugerenciaCantidad(grupos, cantidadActual, supermercados = SUPERMERCADOS, tarjetasSeleccionadas) {
  const candidatasCrudas = detectarCantidadesCandidatas(grupos, cantidadActual, supermercados);
  if (!candidatasCrudas.length) return null;

  // Vara para decidir si vale la pena: precio por unidad de lo que YA es mejor hoy, escalado
  // a la cantidad candidata. Si ni el super que gatilló la promo (ni ningún otro) le gana a
  // simplemente comprar más de lo que ya es mejor hoy, la promo es una trampa (ej. un 2x1 con
  // precio de lista inflado que termina siendo más caro que el % fijo de otro super — caso
  // real encontrado 2026-08-14) y sugerir el cambio de cantidad sería mala data, no una ayuda.
  const vistaPreviaHoy = calcularVistaPreviaCantidades(grupos, [cantidadActual], supermercados, tarjetasSeleccionadas)[0];
  const mejorHoyPorUnidad = vistaPreviaHoy && vistaPreviaHoy.opciones.length
    ? Math.min(...vistaPreviaHoy.opciones.map(o => o.total)) / cantidadActual
    : Infinity;

  const vistaPrevia = calcularVistaPreviaCantidades(grupos, candidatasCrudas, supermercados, tarjetasSeleccionadas)
    .filter(previa => Math.min(...previa.opciones.map(o => o.total)) < mejorHoyPorUnidad * previa.cantidad);

  if (!vistaPrevia.length) return null;

  return {
    cantidadesCandidatas: vistaPrevia.map(v => v.cantidad),
    vistaPrevia,
  };
}

/**
 * Mejor precio de cada super para un ítem, considerando todos los EANs encontrados para él.
 * @returns { [key]: { total, productoNombre, oferta, promo, esOnlineExclusivo, ean, skuId, sellerId } }
 */
function calcularMejoresPorSuper(grupos, cantidad, supermercados = SUPERMERCADOS, tarjetasSeleccionadas) {
  const mejores = {};
  for (const grupo of grupos) {
    for (const s of supermercados) {
      const m = mejorOpcion(grupo[s.key], cantidad, tarjetasSeleccionadas);
      if (!m) continue;
      const promoRank = promoParaRanking(m.promo, tarjetasSeleccionadas);
      const t = redondear(calcularCosto(promoRank, m.precioBase, cantidad).totalConPromo);
      if (!mejores[s.key] || t < mejores[s.key].total) {
        mejores[s.key] = {
          total: t,
          // OJO: no se llama "nombre" a propósito — más abajo se combina con la entrada
          // de SUPERMERCADOS via {...s, ...mejores[s.key]}, y s.nombre es el nombre del
          // súper (ej. "Vea"). Si esto se llamara "nombre" lo pisaría (bug que hubo antes).
          productoNombre: m.productName,
          oferta: describirOferta(promoRank),
          // Crudo (no filtrado por tarjeta): permite mostrar "con Mi Carrefour pagarías
          // menos" aunque esa tarjeta no cuente para `total`.
          promo: m.promo,
          esOnlineExclusivo: !!promoRank?.esOnline,
          // ean/skuId/sellerId: identidad del producto en la API del super, para armar el
          // link de "agregar al carrito" (ver armarUrlCarrito en fetchers.js). skuId/sellerId
          // son null en Coto, que no es VTEX.
          ean: m.ean,
          skuId: m.skuId ?? null,
          sellerId: m.sellerId ?? null,
        };
      }
    }
  }
  return mejores;
}

/**
 * Consolida la lista completa: qué conviene comprar en cada super, cuánto sale mezclando
 * versus comprar todo en un solo lugar, y qué no se encontró.
 *
 * @param resumen [{ input, cantidad, mejores, ambiguo }]
 * @returns {
 *   items: [{ input, cantidad, ambiguo, disponibles, optimo }],
 *   noEncontrados: string[],
 *   totalesPorSuper, subtotalAsignadoPorSuper, comprasPorSuper, totalOptimo, requiereOnlinePorSuper
 * }
 */
function calcularResumenFinal(resumen, supermercados = SUPERMERCADOS) {
  let totalOptimo = 0;
  // Hipotético "si comprara TODO en ese super".
  const totalesPorSuper = Object.fromEntries(supermercados.map(s => [s.key, 0]));
  // A diferencia de totalesPorSuper, esto es lo que realmente vas a pagar en CADA super
  // según el plan mixto — es lo que hay que usar como base para la promo bancaria de ese
  // super (lo que vas a pasar por caja ahí), no el total hipotético. Antes de esto, la
  // sección bancaria usaba por error totalesPorSuper, sobreestimando el ahorro en cualquier
  // compra mixta.
  const subtotalAsignadoPorSuper = Object.fromEntries(supermercados.map(s => [s.key, 0]));
  // true si ALGÚN ítem asignado a ese super tiene una promo de producto exclusiva online
  // (🌐) — en ese caso, la promo bancaria de ese super no puede evaluarse "en el local"
  // como alternativa real: iría al local, perdería el descuento de producto (casi siempre
  // mayor que el bancario) para ganar uno bancario menor. Ver 4.4 y el plan final.
  const requiereOnlinePorSuper = Object.fromEntries(supermercados.map(s => [s.key, false]));
  const comprasPorSuper = Object.fromEntries(supermercados.map(s => [s.key, []]));
  const noEncontrados = [];
  const items = [];

  for (const { input, cantidad, mejores, ambiguo } of resumen) {
    const disponibles = supermercados
      .map(s => mejores[s.key] ? { ...s, ...mejores[s.key] } : null)
      .filter(Boolean);

    if (!disponibles.length) {
      noEncontrados.push(input);
      continue;
    }

    const optimo = disponibles.reduce((min, o) => o.total < min.total ? o : min);
    totalOptimo += optimo.total;

    items.push({ input, cantidad, ambiguo, disponibles, optimo });

    comprasPorSuper[optimo.key].push({
      input, cantidad, esOnlineExclusivo: !!optimo.esOnlineExclusivo,
      ean: optimo.ean, skuId: optimo.skuId, sellerId: optimo.sellerId,
    });
    subtotalAsignadoPorSuper[optimo.key] += optimo.total;
    if (optimo.esOnlineExclusivo) requiereOnlinePorSuper[optimo.key] = true;

    for (const s of supermercados) {
      const o = disponibles.find(d => d.key === s.key);
      if (!o) {
        // Este super no vende este producto: "todo en X" no es una compra real que se pueda
        // hacer ahí — se descarta la comparación entera para ese super (null), en vez de
        // completar el hueco con el precio óptimo de otro lado. Antes se sumaba el óptimo acá
        // ("para no penalizar" al super) pero eso hace que, con carritos sin solapamiento entre
        // supers (común: marcas propias, productos de nicho), TODOS los "todo en X" terminen
        // dando exactamente igual a lo repartido — mostrando "ahorro cero" en un caso donde en
        // realidad ningún super por sí solo puede cubrir el carrito completo. `null` no se
        // revierte: aunque un ítem posterior sí esté en ese super, ya quedó descalificado (si
        // sumara acá, `null + o.total` da `o.total` en JS — resucitaría el total a un número).
        totalesPorSuper[s.key] = null;
      } else if (totalesPorSuper[s.key] !== null) {
        totalesPorSuper[s.key] += o.total;
      }
    }
  }

  return {
    items,
    noEncontrados,
    totalesPorSuper,
    subtotalAsignadoPorSuper,
    comprasPorSuper,
    totalOptimo,
    requiereOnlinePorSuper,
  };
}

/**
 * Reconstruye comprasPorSuper (mismo shape que ya arma calcularResumenFinal: input, cantidad,
 * esOnlineExclusivo, ean, skuId, sellerId) a partir de la asignación que eligió
 * reoptimizarAsignacion() de promos-bancarias.js, en vez de "el super más barato por
 * producto". No se modifica calcularResumenFinal — es una reconstrucción aparte para no
 * arriesgar el comportamiento que ya usan la CLI y la comparación base sin promos bancarias.
 *
 * IMPORTANTE: `items` tiene que ser `calcularResumenFinal(...).items` (ya filtrado a los
 * ítems encontrados y recortado a `supermercados`) y `asignacion` tiene que venir de llamar
 * reoptimizarAsignacion() con un array de ítems construido a partir de ESE MISMO `items`
 * (uno por índice, en el mismo orden) — nunca desde el `resumen` crudo previo a
 * calcularResumenFinal. Si se usa el crudo, un ítem puede tener `mejores` no vacío pero quedar
 * fuera de `items` (por no tener ningún `disponibles` bajo el subconjunto de `supermercados`
 * pedido), desalineando los índices entre `asignacion` y `items`.
 *
 * @param items      calcularResumenFinal(...).items
 * @param asignacion array paralelo a `items`: superKey elegido por índice, o null
 * @returns { [superKey]: [{input, cantidad, esOnlineExclusivo, ean, skuId, sellerId}] }
 */
function comprasPorSuperDesdeAsignacion(items, asignacion, supermercados = SUPERMERCADOS) {
  const comprasPorSuper = Object.fromEntries(supermercados.map(s => [s.key, []]));
  items.forEach((item, i) => {
    const key = asignacion[i];
    if (!key) return;
    const opcion = item.disponibles.find(d => d.key === key);
    if (!opcion) return; // no debería pasar si `asignacion` viene de un items[] construido desde este mismo `items`
    comprasPorSuper[key].push({
      input: item.input,
      cantidad: item.cantidad,
      esOnlineExclusivo: !!opcion.esOnlineExclusivo,
      ean: opcion.ean,
      skuId: opcion.skuId,
      sellerId: opcion.sellerId,
    });
  });
  return comprasPorSuper;
}

/**
 * Igual que itemsParaReoptimizar(), pero a partir de calcularResumenFinal(...).items (con
 * `disponibles` en vez de `mejores`) en lugar del `resumen` crudo. Usar esta variante — no
 * itemsParaReoptimizar() — cuando el resultado se vaya a cruzar después con
 * comprasPorSuperDesdeAsignacion(), para garantizar el mismo orden/índices que `items`: es un
 * `.map()` sin filtrar ningún elemento, así el índice i-ésimo del resultado corresponde
 * siempre al ítem i-ésimo de `items`.
 */
function itemsReoptimizarDesdeFinal(items, supermercados = SUPERMERCADOS) {
  return items.map(item => ({
    id: item.input,
    preciosPorSuper: Object.fromEntries(supermercados.map(s => {
      const d = item.disponibles.find(x => x.key === s.key);
      return [s.key, d ? d.total : null];
    })),
    esOnlineExclusivoPorSuper: Object.fromEntries(supermercados.map(s => {
      const d = item.disponibles.find(x => x.key === s.key);
      return [s.key, !!(d && d.esOnlineExclusivo)];
    })),
  }));
}

/**
 * Ítems en el formato que espera reoptimizarAsignacion() de promos-bancarias.js.
 * Usa los precios por super que ya están calculados — no vuelve a consultar ninguna API.
 */
function itemsParaReoptimizar(resumen, supermercados = SUPERMERCADOS) {
  return resumen
    .filter(r => Object.keys(r.mejores).length > 0)
    .map(r => ({
      id: r.input,
      preciosPorSuper: Object.fromEntries(supermercados.map(s => [s.key, r.mejores[s.key]?.total ?? null])),
      esOnlineExclusivoPorSuper: Object.fromEntries(supermercados.map(s => [s.key, !!r.mejores[s.key]?.esOnlineExclusivo])),
    }));
}

module.exports = {
  redondear,
  describirOferta,
  promoParaRanking,
  mejorOpcion,
  mejorOpcionCombinada,
  calcularOpciones,
  detectarCantidadesCandidatas,
  calcularVistaPreviaCantidades,
  calcularSugerenciaCantidad,
  calcularMejoresPorSuper,
  calcularResumenFinal,
  itemsParaReoptimizar,
  itemsReoptimizarDesdeFinal,
  comprasPorSuperDesdeAsignacion,
};
