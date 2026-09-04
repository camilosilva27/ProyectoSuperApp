/**
 * POST /api/comparar — el endpoint central: dado un carrito de EANs + cantidades, devuelve
 * precios y promos EN VIVO de los supers activos, qué conviene comprar dónde, y cuánto se
 * ahorra mezclando versus comprar todo en un solo lugar.
 *
 * Todo el cálculo se delega a AllPromos/core/comparador.js y promo-engine.js — los mismos
 * módulos que usa el CLI. Acá solo se orquesta la consulta y se serializa a JSON, así el
 * CLI y la app nunca pueden dar números distintos para la misma compra.
 *
 * Diferencia clave con el CLI: donde el CLI *pregunta* si conviene cambiar la cantidad para
 * activar una promo, acá eso viaja como dato (`sugerenciaCantidad`) sin bloquear la
 * respuesta. La UI lo muestra como un banner con un botón; el usuario decide después.
 *
 * Segunda diferencia, agregada después de la primera prueba real de la app: no hace falta
 * seleccionar tarjetas para comparar. Este endpoint siempre pide TAMBIÉN las promos de
 * tarjeta propia (Tarjeta Carrefour Crédito por ahora — ver TARJETAS_QUE_AFECTAN_PRODUCTO
 * abajo), independientemente de qué tarjetas haya elegido el usuario; esas promos viajan
 * igual en `promo`, marcadas con `tarjetaActiva: false` cuando la tarjeta no está en
 * `tarjetas` del body. El *total* que se muestra como "el precio" (`opciones[].total`,
 * `resumen.*`) nunca las cuenta salvo que estén activas — sirven para avisar "hay un 15% con
 * Tarjeta Carrefour Crédito", no para inflar el ahorro con una tarjeta que el usuario no tiene.
 */

const express = require('express');
const { buscarPorEAN } = require('../../../AllPromos/core/fetchers');
const { SUPERMERCADOS } = require('../../../AllPromos/core/fetchers');
const { armarUrlCarrito } = require('../../../AllPromos/core/fetchers');
const {
  calcularOpciones, calcularSugerenciaCantidad, calcularMejoresPorSuper, calcularResumenFinal,
  elegirSupersConTope, filtrarOpcionesPorSupers, filtrarSugerenciaPorSupers,
  itemsReoptimizarDesdeFinal, comprasPorSuperDesdeAsignacion, redondear,
} = require('../../../AllPromos/core/comparador');
const { calcularCosto } = require('../../../AllPromos/promo-engine');
const { esEANvalido } = require('../../../AllPromos/core/catalogo');
const {
  filtrarPromosBancariasPorTarjetas, promosAplicablesHoy, reoptimizarAsignacion,
} = require('../../../AllPromos/promos-bancarias');
const catalogoUnificado = require('../catalogoUnificado');
const precioCache = require('../precioCache');
const { requiereSesion, requierePlanActivo } = require('../middleware/requiereSesion');
const { crearLimitador } = require('../limitadorGlobal');
const { leerPromosBancariasCache } = require('../promosBancariasCache');

const router = express.Router();

const KEYS_SUPERMERCADOS = new Set(SUPERMERCADOS.map(s => s.key));

/** Valida `supers` (array de keys) contra el catálogo de supers conocido. Devuelve un mensaje
 *  de error, o null si está bien. `undefined`/ausente es válido: significa "sin filtro". */
function validarSupers(supers) {
  if (supers === undefined) return null;
  if (!Array.isArray(supers) || supers.length === 0) {
    return 'supers tiene que ser un array no vacio de keys de supermercado';
  }
  for (const s of supers) {
    if (!KEYS_SUPERMERCADOS.has(s)) return `super invalido: ${s}`;
  }
  return null;
}

/** SUPERMERCADOS filtrado según lo que el cliente eligió comparar (ver useFiltrosSupers en la
 *  app) — sin filtro, se sigue comparando contra los de siempre. */
function filtrarSupermercados(supers) {
  return Array.isArray(supers) && supers.length
    ? SUPERMERCADOS.filter(s => supers.includes(s.key))
    : SUPERMERCADOS;
}

// Único teaser de "tarjeta propia" implementado hoy en core/fetchers.js (Tarjeta Carrefour,
// ver interpretarTeaserTarjetaPropia en promo-engine.js). Cencopay (Vea) se investigó y se
// descartó — ver "Cerrado, no implementar" en CONTEXTO_TECNICO.md: la fuente de datos está
// abandonada por Vea (0 ofertas vigentes, la última hace 9 meses).
const TARJETAS_QUE_AFECTAN_PRODUCTO = ['Tarjeta Carrefour Crédito'];

const MAX_ITEMS = 60;
// Carrefour y Chango Más rate-limitean (429 en Carrefour, 429 y 502 intermitentes en Chango
// Más). Cada ítem dispara 5 requests en paralelo (uno por super), así que se procesan de a
// pocos ítems para no abrir 300 conexiones de golpe con un carrito grande.
const ITEMS_EN_PARALELO = 4;

// Camino común: leer de precioCache (derivado de catalogo-*.json, refrescado por el cron cada
// 1-2 hs). Cubre el recorte de ~2550 SKUs por super que ya capturan los scrapers — la enorme
// mayoría de lo que se compara habitualmente. Ver backend/README.md para el detalle de por qué
// se dejó de pedir en vivo en el camino común.
//
// Fallback angosto: solo para EANs que precioCache no tiene (fuera de ese recorte, o producto
// nuevo que el scraper todavía no capturó). Va SIEMPRE detrás de limitadorFallback — un
// semáforo GLOBAL (no por IP, ver limitadorGlobal.js) que acota cuántas búsquedas en vivo
// corren a la vez sin importar cuántos usuarios distintas las disparen. El TTL corto de
// cacheEnVivo evita, además, que dos requests casi simultáneos para el mismo EAN no cacheado
// disparen dos fetches en vez de compartir uno.
const CACHE_TTL_MS = 3 * 60 * 1000;
const cacheEnVivo = new Map(); // ean → { expira, promise }

// Mismo ritmo que ya usan los scrapers contra estas APIs sin romper nada (ver
// scraper-promos-carrefour.js/changomas.js: 500-800ms entre requests, nunca en paralelo) — acá
// se traduce a "como mucho 2 búsquedas del fallback en vuelo a la vez", en vez de un delay fijo,
// porque el volumen esperado en este camino es mucho más bajo (solo EANs no cacheados).
const MAX_FALLBACK_CONCURRENTE = 2;
const limitadorFallback = crearLimitador(MAX_FALLBACK_CONCURRENTE);

function buscarPorEANFallback(ean, opciones) {
  const ahora = Date.now();
  const entrada = cacheEnVivo.get(ean);
  if (entrada && entrada.expira > ahora) return entrada.promise;

  const promise = limitadorFallback(() => buscarPorEAN(ean, opciones));
  cacheEnVivo.set(ean, { expira: ahora + CACHE_TTL_MS, promise });
  // Si falla, no dejar la promesa rota cacheada — la próxima consulta reintenta en vivo.
  promise.catch(() => cacheEnVivo.delete(ean));
  return promise;
}

async function buscarPorEANCacheado(ean, opciones) {
  const cacheado = precioCache.precioPorEAN(ean);
  if (cacheado) return cacheado;
  return buscarPorEANFallback(ean, opciones);
}

async function mapConLimite(lista, limite, fn) {
  const resultados = new Array(lista.length);
  let indice = 0;
  const trabajadores = Array.from({ length: Math.min(limite, lista.length) }, async () => {
    while (true) {
      const i = indice++;
      if (i >= lista.length) return;
      resultados[i] = await fn(lista[i], i);
    }
  });
  await Promise.all(trabajadores);
  return resultados;
}

function validarBody(body) {
  if (!body || typeof body !== 'object') return 'El body tiene que ser un objeto JSON';
  if (!Array.isArray(body.items) || body.items.length === 0) {
    return 'Falta items: [{ ean, cantidad }]';
  }
  if (body.items.length > MAX_ITEMS) {
    return `Demasiados items (maximo ${MAX_ITEMS})`;
  }
  if (body.tarjetas !== undefined && !Array.isArray(body.tarjetas)) {
    return 'tarjetas tiene que ser un array de strings';
  }
  const errorSupers = validarSupers(body.supers);
  if (errorSupers) return errorSupers;
  if (body.tope !== undefined && (!Number.isInteger(body.tope) || body.tope < 1)) {
    return 'tope tiene que ser un entero >= 1 (cantidad máxima de supers a visitar)';
  }
  for (const item of body.items) {
    if (!item || !esEANvalido(String(item.ean ?? ''))) {
      return `EAN invalido: ${JSON.stringify(item?.ean)}`;
    }
    const cantidad = Number(item.cantidad ?? 1);
    if (!Number.isInteger(cantidad) || cantidad < 1 || cantidad > 99) {
      return `Cantidad invalida para el EAN ${item.ean} (tiene que ser un entero entre 1 y 99)`;
    }
  }
  return null;
}

/**
 * Da forma pública a una opción de super: precios en vivo, sin estructuras internas.
 * @param {number} precioLista precio de lista SIN NINGUNA promo para este super — puede ser
 *   más alto que `o.mejor.precioBase` cuando hay promos apiladas (ej. Carrefour: 30% de
 *   descuento directo ya aplicado sobre `precioBase`, más 15% de Tarjeta Carrefour Crédito
 *   encima de eso).
 *   Ver cálculo en el caller (máximo precioBase entre todas las opciones del super).
 */
function serializarOpcion(o, cantidad, tarjetasSeleccionadas, precioLista) {
  const promo = o.mejor.promo;
  const tarjetaActiva = !promo?.requiereTarjeta || tarjetasSeleccionadas.includes(promo.requiereTarjeta);

  return {
    key: o.key,
    super: o.nombre,
    tag: o.tag,
    total: o.total,
    // Lo que pagarías sin ninguna promo (ni la de esta opción, ni ninguna otra apilada antes)
    // — el precio de lista real, no solo "antes de la última promo que ganó".
    totalSinPromo: Math.round(precioLista * cantidad * 100) / 100,
    precioUnitario: o.mejor.precioBase,
    productoNombre: o.mejor.productName,
    variante: o.mejor.skuName && o.mejor.skuName !== o.mejor.productName ? o.mejor.skuName : null,
    promo: promo
      ? {
          tipo: promo.tipo,
          descripcion: promo.descripcion,
          cantidadMinima: promo.cantidadMinima,
          esOnline: !!promo.esOnline,
          requiereTarjeta: promo.requiereTarjeta ?? null,
          // true si la promo existe pero no se activa con esta cantidad
          activa: cantidad >= promo.cantidadMinima,
          // true si no requiere tarjeta, o si la tarjeta que pide está seleccionada. Cuando
          // es false, `total` NO incluye este descuento — es solo un aviso.
          tarjetaActiva,
        }
      : null,
    // Lo que pagarías en ESTE super si activaras la tarjeta que pide la promo. Solo viaja
    // cuando hay algo que activar (evita mandar un número idéntico a `total` sin motivo).
    totalConTarjeta: promo?.requiereTarjeta && !tarjetaActiva
      ? Math.round(calcularCosto(promo, o.mejor.precioBase, cantidad).totalConPromo * 100) / 100
      : null,
  };
}

/**
 * Promos bancarias "por ticket" (Cencopay, Mi Carrefour, MasClub, bancos/billeteras) vigentes
 * HOY para las tarjetas que el usuario tiene marcadas — se calcula una sola vez por request y
 * se reusa para la reoptimización de todo el carrito (aplicarPromosBancarias), para no leer y
 * filtrar el cache de promos bancarias dos veces.
 *
 * Solo promos vigentes HOY (no el rango de 7 días que evalúa por default
 * reoptimizarAsignacion/mejorOportunidadTicket): las promos de PRODUCTO de los supers cambian
 * día a día, así que combinar "producto de hoy" con "banco de otro día" daría una
 * recomendación inconsistente.
 */
function datosBancariosDeHoy(tarjetasSeleccionadas, advertencias) {
  if (!tarjetasSeleccionadas.length) return null;

  const datosCrudos = leerPromosBancariasCache();
  if (!datosCrudos) {
    advertencias.push('El cache de promos bancarias todavía no está listo — probá de nuevo en unos minutos');
    return null;
  }

  const hoy = new Date();
  const datosFiltrados = filtrarPromosBancariasPorTarjetas(datosCrudos, tarjetasSeleccionadas);
  return Object.fromEntries(
    Object.entries(datosFiltrados).map(([key, resultado]) => [
      key,
      resultado.error ? resultado : { ...resultado, promos: promosAplicablesHoy(resultado.promos, { fecha: hoy }) },
    ])
  );
}

function aplicarPromosBancarias(resumen, supermercados, tarjetasSeleccionadas, datosDeHoy, advertencias) {
  if (!datosDeHoy) return null;

  const itemsReopt = itemsReoptimizarDesdeFinal(resumen.items, supermercados);
  const resultado = reoptimizarAsignacion(itemsReopt, datosDeHoy, supermercados, { hoy: new Date() });

  const hayAlgoAplicable = Object.values(resultado.oportunidades).some(o => o?.mejor);
  if (!hayAlgoAplicable) return null;

  resumen.comprasPorSuper = comprasPorSuperDesdeAsignacion(resumen.items, resultado.asignacion, supermercados);
  resumen.subtotalAsignadoPorSuper = resultado.subtotales;
  resumen.requiereOnlinePorSuper = Object.fromEntries(
    supermercados.map(s => [s.key, !!resultado.canalForzado[s.key]])
  );
  resumen.totalOptimo = resultado.total;

  const porSuper = {};
  let ahorroTotal = 0;
  for (const s of supermercados) {
    const oportunidad = resultado.oportunidades[s.key];
    if (!oportunidad?.mejor) { porSuper[s.key] = null; continue; }
    const { promo, descuento } = oportunidad.mejor;
    porSuper[s.key] = {
      tarjeta: promo.bancoCanonico,
      descuentoPct: promo.descuentoPct,
      tope: promo.tope,
      topeDetectado: promo.tope != null,
      descuento: Math.round(descuento * 100) / 100,
      subtotalFinal: Math.round((resultado.subtotales[s.key] - descuento) * 100) / 100,
    };
    ahorroTotal += descuento;
  }
  for (const s of supermercados) {
    if (resultado.erroresPorSuper[s.key]) {
      advertencias.push(`No se pudieron consultar las promos bancarias de ${s.nombre}`);
    }
  }

  return {
    tarjetasConsideradas: tarjetasSeleccionadas,
    ahorroTotal: Math.round(ahorroTotal * 100) / 100,
    porSuper,
  };
}

/**
 * Reparte el descuento bancario "por ticket" de cada super (ya calculado por
 * aplicarPromosBancarias sobre el subtotal real de la asignación final, considerando el
 * carrito completo y el tope) entre las filas de producto de ese super, proporcional al
 * precio de cada una.
 *
 * Antes esto se aproximaba producto por producto (una promo de ticket se restaba del total
 * de cada ítem por separado, tratándolo como si fuera el ticket completo, ANTES de saber la
 * asignación final) — eso hacía que la suma de las filas de un super no coincidiera con el
 * total de la cabecera de ese mismo super, calculado por un camino distinto
 * (`aplicarPromosBancarias`/`reoptimizarAsignacion`, que sí ve el carrito completo). Repartir
 * acá, una sola vez, sobre la asignación ya fija, hace que ambos números salgan de la misma
 * fuente por construcción. Muta `item.opciones` en el lugar; el último ítem de cada super se
 * ajusta con el resto para no perder centavos por redondeo en el camino.
 *
 * Al final vuelve a ordenar `item.opciones` de cada ítem tocado y recalcula `item.mejor` —
 * `calcularOpciones` (`core/comparador.js`) entrega `opciones` ya ordenadas ascendente por
 * `total`, y bajar el total de la opción asignada acá puede dejarla más barata que otra que
 * estaba antes en el array, rompiendo ese orden. `item.mejor`/`item.opciones[0]` es una
 * invariante de la que dependen otras partes de la UI (ej. `BarraDiferencia.tsx`, que usa
 * `opciones[0]` como "la más barata" sin volver a ordenar) — sin este paso, un producto
 * reasignado a un super más caro EN LISTA pero más barato con el descuento de ticket quedaba
 * mostrado como "más barato en Vea" en un lugar y "asignado a Carrefour" en otro, con el
 * mismo array `opciones` de por medio.
 */
function repartirDescuentoBancarioEntreFilas(items, resumen, bancario, supermercados) {
  if (!bancario) return;
  const itemPorEan = new Map(items.map(it => [it.ean, it]));
  const itemsTocados = new Set();

  for (const s of supermercados) {
    const ahorro = bancario.porSuper[s.key];
    if (!ahorro || ahorro.descuento <= 0) continue;

    const entradas = (resumen.comprasPorSuper[s.key] || [])
      .map(c => ({ ean: c.ean, opcion: itemPorEan.get(c.ean)?.opciones.find(o => o.key === s.key) }))
      .filter(e => e.opcion);
    // Suma de las filas de este super ANTES del descuento de ticket — es la misma base que
    // usó aplicarPromosBancarias para calcular `ahorro.descuento`, así que reparte exacto.
    const subtotalBase = resumen.subtotalAsignadoPorSuper[s.key];
    if (!(subtotalBase > 0)) continue;

    const pctEfectivo = Math.round((ahorro.descuento / subtotalBase) * 100);
    const descripcionTicket = `${pctEfectivo}% con ${ahorro.tarjeta} por ticket`;

    let repartido = 0;
    entradas.forEach(({ ean, opcion }, i) => {
      itemsTocados.add(ean);
      const esUltimo = i === entradas.length - 1;
      const parte = esUltimo
        ? redondear(ahorro.descuento - repartido)
        : redondear(ahorro.descuento * (opcion.total / subtotalBase));
      repartido = redondear(repartido + parte);

      opcion.total = redondear(opcion.total - parte);
      opcion.promo = opcion.promo && opcion.promo.tarjetaActiva
        ? { ...opcion.promo, descripcion: `${opcion.promo.descripcion} + ${descripcionTicket}` }
        : {
            tipo: 'pct_ticket',
            descripcion: descripcionTicket,
            cantidadMinima: 1,
            esOnline: !!resumen.requiereOnlinePorSuper[s.key],
            requiereTarjeta: ahorro.tarjeta,
            activa: true,
            tarjetaActiva: true,
          };
      opcion.totalConTarjeta = null;
    });

    // Mismo valor que ya tenía calculado aplicarPromosBancarias — se reasigna acá para
    // dejar explícito que, de ahora en más, es exactamente la suma de las filas de arriba.
    resumen.subtotalAsignadoPorSuper[s.key] = ahorro.subtotalFinal;
  }

  // Segundo paso, sobre ítems (no supers): un producto puede haber sido tocado por el reparto
  // de un solo super (el suyo), así que alcanza con reordenar una vez por ítem al final, en vez
  // de hacerlo a medio camino dentro del loop de arriba.
  for (const ean of itemsTocados) {
    const item = itemPorEan.get(ean);
    item.opciones.sort((a, b) => a.total - b.total);
    item.mejor = item.opciones[0] ?? null;
  }
}

router.post('/comparar', requiereSesion, requierePlanActivo, async (req, res) => {
  const error = validarBody(req.body);
  if (error) return res.status(400).json({ error });

  // Tarjetas que el usuario efectivamente seleccionó — determina qué promos cuentan para
  // el total. No se usa para decidir qué pedirle a las APIs (ver TARJETAS_QUE_AFECTAN_PRODUCTO).
  const tarjetasSeleccionadas = req.body.tarjetas ?? [];
  const supermercados = filtrarSupermercados(req.body.supers);
  const pedidos = req.body.items.map(i => ({
    ean: String(i.ean).trim(),
    cantidad: Number(i.cantidad ?? 1),
  }));

  const advertencias = [];
  // Una sola lectura/filtro del cache de promos bancarias por request — se reusa para la
  // reoptimización de todo el carrito (aplicarPromosBancarias) más abajo.
  const datosDeHoy = datosBancariosDeHoy(tarjetasSeleccionadas, advertencias);

  const procesados = await mapConLimite(pedidos, ITEMS_EN_PARALELO, async ({ ean, cantidad }) => {
    const delCatalogo = catalogoUnificado.porEAN(ean);
    // Si el EAN no está en el catálogo local igual se consulta en vivo: puede ser un
    // producto nuevo que el scraper todavía no capturó (los catálogos son un recorte
    // parcial, ver CONTEXTO_TECNICO.md). Solo perdemos el skuId de Vea, que hace la
    // consulta a Vea menos fiable — no impide la comparación.
    const nombre = delCatalogo?.nombre ?? null;
    const imagen = delCatalogo?.imagen ?? null;

    try {
      const grupo = {
        ean,
        productName: nombre,
        // Siempre se pide la promo de tarjeta propia si existe, independientemente de si el
        // usuario la seleccionó — así se puede avisar sin obligar a elegir nada antes.
        ...(await buscarPorEANCacheado(ean, {
          tarjetas: TARJETAS_QUE_AFECTAN_PRODUCTO,
          skuIdVea: delCatalogo?.skuIdVea ?? null,
        })),
      };

      const opciones = calcularOpciones(grupo, cantidad, supermercados, tarjetasSeleccionadas);
      const mejores = calcularMejoresPorSuper([grupo], cantidad, supermercados, tarjetasSeleccionadas);

      // Precio de lista por super = el precioBase más alto entre TODAS las variantes de promo
      // que devolvió ese super para este producto (no solo la que terminó ganando). Con una
      // sola promo (el caso normal) coincide con o.mejor.precioBase; con promos apiladas
      // (Carrefour: % directo + tarjeta propia encima) es más alto, porque la entrada de
      // tarjeta propia usa como precioBase el precio YA con el % directo aplicado.
      const precioListaPorKey = Object.fromEntries(
        supermercados.map(s => [s.key, Math.max(0, ...(grupo[s.key] || []).map(e => e.precioBase))])
      );

      // No se aplica acá ninguna promo bancaria "por ticket" (Cencopay, MODO, etc.): a
      // diferencia de la promo de producto (Tarjeta Carrefour Crédito), la de ticket depende del carrito
      // completo y de la asignación final (tope, qué otros productos ya pasaron por ese
      // super) — se calcula una sola vez más abajo, después de fijar esa asignación, y se
      // reparte entre las filas (ver repartirDescuentoBancarioEntreFilas).
      const opcionesPublicas = opciones.map(o => serializarOpcion(o, cantidad, tarjetasSeleccionadas, precioListaPorKey[o.key]));

      return {
        ean,
        nombre,
        imagen,
        cantidad,
        enCatalogoLocal: !!delCatalogo,
        opciones: opcionesPublicas,
        mejor: opcionesPublicas[0] ?? null,
        // Dato, no pregunta: qué cantidades activarían una promo que hoy no se activa.
        sugerenciaCantidad: calcularSugerenciaCantidad([grupo], cantidad, supermercados, tarjetasSeleccionadas),
        error: null,
        _mejores: mejores,
      };
    } catch (err) {
      advertencias.push(`No se pudo consultar el EAN ${ean}: ${err.message}`);
      return {
        ean, nombre, imagen, cantidad,
        enCatalogoLocal: !!delCatalogo,
        opciones: [], mejor: null, sugerenciaCantidad: null,
        error: err.message,
        _mejores: {},
      };
    }
  });

  // El resumen consolidado reusa exactamente la misma función que imprime el CLI.
  const paraResumen = procesados.map(p => ({
    input: p.nombre || p.ean,
    cantidad: p.cantidad,
    mejores: p._mejores,
    ambiguo: false, // la app manda un EAN exacto: no hay ambigüedad de nombre que resolver
  }));

  // Tope de supers (hoja "Qué supers comparar"): si viene y restringe algo, el plan final usa
  // solo el mejor subconjunto de ese tamaño entre `supermercados` — no todos los elegidos.
  const tope = req.body.tope;
  const capado = Number.isInteger(tope) && tope >= 1 && tope < supermercados.length;
  const supermercadosUsados = elegirSupersConTope(paraResumen, supermercados, tope);

  const resumen = calcularResumenFinal(paraResumen, supermercadosUsados);

  // Reasigna comprasPorSuper/subtotalAsignadoPorSuper/requiereOnlinePorSuper/totalOptimo (en
  // el lugar, dentro de `resumen`) considerando el ahorro bancario de las tarjetas
  // seleccionadas, si hay alguna. Ver cabecera de aplicarPromosBancarias().
  const bancario = aplicarPromosBancarias(resumen, supermercadosUsados, tarjetasSeleccionadas, datosDeHoy, advertencias);

  // Baseline sin tope, para que la hoja pueda mostrar cuánto "cuesta" el tope — misma
  // metodología (incluida la reoptimización bancaria) para que ambos números estén en pie de
  // igualdad. Las advertencias de este cálculo auxiliar se descartan: no es user-facing, solo
  // alimenta una resta.
  let totalOptimoSinTope = null;
  if (capado) {
    const resumenSinTope = calcularResumenFinal(paraResumen, supermercados);
    aplicarPromosBancarias(resumenSinTope, supermercados, tarjetasSeleccionadas, datosDeHoy, []);
    totalOptimoSinTope = resumenSinTope.totalOptimo;
  }

  // `opciones`/`mejor`/`sugerenciaCantidad` de cada ítem se calcularon sobre TODOS los supers
  // elegidos (antes de saber `supermercadosUsados` — hace falta el precio de cada uno para
  // poder elegir el subconjunto). Si el tope restringió algo, hay que recortarlos acá: sin
  // esto, `item.mejor` podría señalar un super fuera del plan capado.
  const items = procesados.map(({ _mejores, opciones, mejor, sugerenciaCantidad, ...publico }) => {
    if (!capado) return { ...publico, opciones, mejor, sugerenciaCantidad };
    const { opciones: opcionesCapadas, mejor: mejorCapado } = filtrarOpcionesPorSupers(opciones, supermercadosUsados);
    return {
      ...publico,
      opciones: opcionesCapadas,
      mejor: mejorCapado,
      sugerenciaCantidad: filtrarSugerenciaPorSupers(sugerenciaCantidad, supermercadosUsados),
    };
  });

  // Reparte el descuento bancario "por ticket" de cada super (ya fijado arriba en `resumen`
  // por aplicarPromosBancarias) entre las filas de producto de ese super — tiene que ir
  // después de recortar `items` por el tope, para repartir sobre los mismos supers que
  // terminan viéndose. Deja `resumen.subtotalAsignadoPorSuper` como la suma exacta de las
  // filas resultantes (ver cabecera de la función).
  repartirDescuentoBancarioEntreFilas(items, resumen, bancario, supermercadosUsados);

  // Mismo plan óptimo (mismo producto en el mismo super que efectivamente quedó asignado)
  // pero sin aplicar ninguna promo — para mostrar "esto es lo que te ahorran las promos" en
  // el total general. Usa la asignación FINAL real (resumen.comprasPorSuper), no
  // `item.mejor` (la opción globalmente más barata por producto): si una promo bancaria
  // movió un producto a otro super, el precio de lista de la opción más barata global puede
  // no coincidir con el del super donde el producto realmente terminó — eso desalineaba este
  // total contra la suma de los "sin descuento" tachados que se muestran en cada bloque de
  // super (bug real, corregido acá).
  const itemPorEan = new Map(items.map(it => [it.ean, it]));
  let totalSinPromoAcumulado = 0;
  for (const s of supermercadosUsados) {
    for (const compra of resumen.comprasPorSuper[s.key] || []) {
      const opcion = itemPorEan.get(compra.ean)?.opciones.find(o => o.key === s.key);
      if (opcion) totalSinPromoAcumulado += opcion.totalSinPromo;
    }
  }
  const totalSinPromo = redondear(totalSinPromoAcumulado);

  // Link de "agregar al carrito" en el sitio real de cada super (null si no es VTEX, ej.
  // Coto, o si no tiene nada asignado, o si quedó afuera del plan capado) — ver
  // armarUrlCarrito en fetchers.js.
  const linksCarrito = Object.fromEntries(
    supermercadosUsados.map(s => [s.key, armarUrlCarrito(s.key, resumen.comprasPorSuper[s.key])])
  );
  // El público no necesita skuId/sellerId sueltos (solo la URL ya armada arriba) — se
  // despojan acá para no crecer la superficie de la API con datos que el cliente no usa. `ean`
  // sí viaja: la app lo necesita para cruzar cada compra contra `items` de forma confiable
  // (`input` es el texto de búsqueda, no una clave única).
  const comprasPorSuper = Object.fromEntries(
    Object.entries(resumen.comprasPorSuper).map(([key, compras]) => [
      key,
      compras.map(({ input, ean, esOnlineExclusivo }) => ({ input, ean, esOnlineExclusivo })),
    ])
  );

  res.json({
    generado: new Date().toISOString(),
    supermercados: supermercadosUsados,
    items,
    resumen: {
      totalOptimo: resumen.totalOptimo,
      totalOptimoSinTope,
      totalSinPromo,
      totalesPorSuper: resumen.totalesPorSuper,
      subtotalAsignadoPorSuper: resumen.subtotalAsignadoPorSuper,
      comprasPorSuper,
      requiereOnlinePorSuper: resumen.requiereOnlinePorSuper,
      noEncontrados: resumen.noEncontrados,
      linksCarrito,
      bancario,
    },
    advertencias,
  });
});

// MAX_EANS_PRECIOS coincide a propósito con el límite default de /api/catalogo/buscar (ver
// app/(tabs)/index.tsx): cubre tanto un lote visible en pantalla mientras se scrollea, como
// pedir precio de UNA búsqueda completa de una sola vez para "ordenar por precio" — nunca de
// más que eso (no es para traer precio de todo el catálogo). El mismo rate limit estricto que
// /comparar aplica acá (ver server.js) porque también dispara consultas reales a los 5 supers.
const MAX_EANS_PRECIOS = 40;

/**
 * POST /api/precios — versión liviana de /comparar para la pantalla de búsqueda: dado un
 * lote de EANs (los visibles en ese momento), devuelve solo el mejor precio y una descripción
 * corta de la oferta si hay, sin el desglose de los 5 supers ni sugerencia de cantidad. Usa
 * cantidad=1 siempre y no tiene en cuenta tarjetas seleccionadas (no hay ese contexto en la
 * pantalla de búsqueda) — para eso está /comparar, una vez que el producto ya está en el
 * carrito.
 */
router.post('/precios', requiereSesion, requierePlanActivo, async (req, res) => {
  const eans = Array.isArray(req.body?.eans)
    ? [...new Set(req.body.eans.map(e => String(e).trim()))]
    : null;
  if (!eans || !eans.length) return res.status(400).json({ error: 'Falta eans: string[]' });
  if (eans.length > MAX_EANS_PRECIOS) {
    return res.status(400).json({ error: `Demasiados eans (maximo ${MAX_EANS_PRECIOS})` });
  }
  for (const ean of eans) {
    if (!esEANvalido(ean)) return res.status(400).json({ error: `EAN invalido: ${ean}` });
  }
  const errorSupers = validarSupers(req.body?.supers);
  if (errorSupers) return res.status(400).json({ error: errorSupers });
  const supermercados = filtrarSupermercados(req.body?.supers);

  const resultados = await mapConLimite(eans, ITEMS_EN_PARALELO, async ean => {
    const delCatalogo = catalogoUnificado.porEAN(ean);
    try {
      const grupo = {
        ean,
        ...(await buscarPorEANCacheado(ean, {
          tarjetas: TARJETAS_QUE_AFECTAN_PRODUCTO,
          skuIdVea: delCatalogo?.skuIdVea ?? null,
        })),
      };
      const opciones = calcularOpciones(grupo, 1, supermercados, []);
      if (!opciones.length) return { ean, mejor: null, oferta: null };

      const o = opciones[0];
      return {
        ean,
        mejor: { key: o.key, super: o.nombre, tag: o.tag, total: o.total },
        oferta: o.mejor.promo?.descripcion ?? null,
        esOnline: !!o.mejor.promo?.esOnline,
      };
    } catch {
      return { ean, mejor: null, oferta: null };
    }
  });

  res.json({ generado: new Date().toISOString(), resultados });
});

module.exports = router;
