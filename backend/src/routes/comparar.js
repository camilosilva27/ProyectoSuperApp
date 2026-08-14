/**
 * POST /api/comparar — el endpoint central: dado un carrito de EANs + cantidades, devuelve
 * precios y promos EN VIVO de los 5 supers, qué conviene comprar dónde, y cuánto se ahorra
 * mezclando versus comprar todo en un solo lugar.
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
 * tarjeta propia (Mi Carrefour por ahora — ver TARJETAS_QUE_AFECTAN_PRODUCTO abajo),
 * independientemente de qué tarjetas haya elegido el usuario; esas promos viajan igual en
 * `promo`, marcadas con `tarjetaActiva: false` cuando la tarjeta no está en `tarjetas` del
 * body. El *total* que se muestra como "el precio" (`opciones[].total`, `resumen.*`) nunca
 * las cuenta salvo que estén activas — sirven para avisar "hay un 15% con Mi Carrefour",
 * no para inflar el ahorro con una tarjeta que el usuario no tiene.
 */

const express = require('express');
const { buscarPorEAN } = require('../../../AllPromos/core/fetchers');
const { SUPERMERCADOS } = require('../../../AllPromos/core/fetchers');
const { armarUrlCarrito } = require('../../../AllPromos/core/fetchers');
const {
  calcularOpciones, calcularSugerenciaCantidad, calcularMejoresPorSuper, calcularResumenFinal,
} = require('../../../AllPromos/core/comparador');
const { calcularCosto } = require('../../../AllPromos/promo-engine');
const { esEANvalido } = require('../../../AllPromos/core/catalogo');
const catalogoUnificado = require('../catalogoUnificado');
const precioCache = require('../precioCache');
const { crearLimitador } = require('../limitadorGlobal');

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
 *  app) — sin filtro, se sigue comparando contra los 5 de siempre. */
function filtrarSupermercados(supers) {
  return Array.isArray(supers) && supers.length
    ? SUPERMERCADOS.filter(s => supers.includes(s.key))
    : SUPERMERCADOS;
}

// Único teaser de "tarjeta propia" implementado hoy en core/fetchers.js (Tarjeta Carrefour,
// ver interpretarTeaserTarjetaPropia en promo-engine.js). Cencopay (Vea) está investigado en
// PLAN_TARJETAS_Y_BANCOS.md pero todavía no tiene el fetcher de cluster implementado — cuando
// se agregue, entra en esta lista para que también se detecte sin necesidad de seleccionarla.
const TARJETAS_QUE_AFECTAN_PRODUCTO = ['Mi Carrefour'];

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

/** Da forma pública a una opción de super: precios en vivo, sin estructuras internas. */
function serializarOpcion(o, cantidad, tarjetasSeleccionadas) {
  const promo = o.mejor.promo;
  const tarjetaActiva = !promo?.requiereTarjeta || tarjetasSeleccionadas.includes(promo.requiereTarjeta);

  return {
    key: o.key,
    super: o.nombre,
    tag: o.tag,
    total: o.total,
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

router.post('/comparar', async (req, res) => {
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
        ...(await buscarPorEANCacheado(ean, { tarjetas: TARJETAS_QUE_AFECTAN_PRODUCTO, skuIdVea: delCatalogo?.skuIdVea ?? null })),
      };

      const opciones = calcularOpciones(grupo, cantidad, supermercados, tarjetasSeleccionadas);
      const mejores = calcularMejoresPorSuper([grupo], cantidad, supermercados, tarjetasSeleccionadas);

      return {
        ean,
        nombre,
        imagen,
        cantidad,
        enCatalogoLocal: !!delCatalogo,
        opciones: opciones.map(o => serializarOpcion(o, cantidad, tarjetasSeleccionadas)),
        mejor: opciones.length ? serializarOpcion(opciones[0], cantidad, tarjetasSeleccionadas) : null,
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
  const resumen = calcularResumenFinal(paraResumen, supermercados);

  const items = procesados.map(({ _mejores, ...publico }) => publico);

  // Link de "agregar al carrito" en el sitio real de cada super (null si no es VTEX, ej.
  // Coto, o si no hay nada asignado a ese super) — ver armarUrlCarrito en fetchers.js.
  const linksCarrito = Object.fromEntries(
    supermercados.map(s => [s.key, armarUrlCarrito(s.key, resumen.comprasPorSuper[s.key])])
  );
  // El público no necesita ean/skuId/sellerId sueltos (solo la URL ya armada arriba) — se
  // despojan acá para no crecer la superficie de la API con datos que el cliente no usa.
  const comprasPorSuper = Object.fromEntries(
    Object.entries(resumen.comprasPorSuper).map(([key, compras]) => [
      key,
      compras.map(({ input, esOnlineExclusivo }) => ({ input, esOnlineExclusivo })),
    ])
  );

  res.json({
    generado: new Date().toISOString(),
    supermercados,
    items,
    resumen: {
      totalOptimo: resumen.totalOptimo,
      totalesPorSuper: resumen.totalesPorSuper,
      subtotalAsignadoPorSuper: resumen.subtotalAsignadoPorSuper,
      comprasPorSuper,
      requiereOnlinePorSuper: resumen.requiereOnlinePorSuper,
      noEncontrados: resumen.noEncontrados,
      linksCarrito,
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
router.post('/precios', async (req, res) => {
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
