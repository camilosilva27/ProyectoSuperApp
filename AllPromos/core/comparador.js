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
  const cantidadesCandidatas = detectarCantidadesCandidatas(grupos, cantidadActual, supermercados);
  if (!cantidadesCandidatas.length) return null;
  return {
    cantidadesCandidatas,
    vistaPrevia: calcularVistaPreviaCantidades(grupos, cantidadesCandidatas, supermercados, tarjetasSeleccionadas),
  };
}

/**
 * Mejor precio de cada super para un ítem, considerando todos los EANs encontrados para él.
 * @returns { [key]: { total, productoNombre, oferta, promo, esOnlineExclusivo } }
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

    comprasPorSuper[optimo.key].push({ input, esOnlineExclusivo: !!optimo.esOnlineExclusivo });
    subtotalAsignadoPorSuper[optimo.key] += optimo.total;
    if (optimo.esOnlineExclusivo) requiereOnlinePorSuper[optimo.key] = true;

    // Si un super no tiene el producto, no lo penalizamos: sumamos el precio óptimo
    // (mismo criterio que antes de agregar el 3er super, para no distorsionar "todo en X").
    for (const s of supermercados) {
      const o = disponibles.find(d => d.key === s.key);
      totalesPorSuper[s.key] += o ? o.total : optimo.total;
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
};
