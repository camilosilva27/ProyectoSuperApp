/**
 * POST /api/comparar — el endpoint central: dado un carrito de EANs + cantidades, devuelve
 * precios y promos EN VIVO de los 3 supers, qué conviene comprar dónde, y cuánto se ahorra
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
const {
  calcularOpciones, calcularSugerenciaCantidad, calcularMejoresPorSuper, calcularResumenFinal,
} = require('../../../AllPromos/core/comparador');
const { calcularCosto } = require('../../../AllPromos/promo-engine');
const { esEANvalido } = require('../../../AllPromos/core/catalogo');
const catalogoUnificado = require('../catalogoUnificado');

const router = express.Router();

// Único teaser de "tarjeta propia" implementado hoy en core/fetchers.js (Tarjeta Carrefour,
// ver interpretarTeaserTarjetaPropia en promo-engine.js). Cencopay (Vea) está investigado en
// PLAN_TARJETAS_Y_BANCOS.md pero todavía no tiene el fetcher de cluster implementado — cuando
// se agregue, entra en esta lista para que también se detecte sin necesidad de seleccionarla.
const TARJETAS_QUE_AFECTAN_PRODUCTO = ['Mi Carrefour'];

const MAX_ITEMS = 60;
// Los 3 supers rate-limitean (429 en Carrefour, 429 y 502 intermitentes en Chango Más).
// Cada ítem dispara 3 requests en paralelo, así que se procesan de a pocos ítems para no
// abrir 180 conexiones de golpe con un carrito grande.
const ITEMS_EN_PARALELO = 4;

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
        ...(await buscarPorEAN(ean, { tarjetas: TARJETAS_QUE_AFECTAN_PRODUCTO, skuIdVea: delCatalogo?.skuIdVea ?? null })),
      };

      const opciones = calcularOpciones(grupo, cantidad, SUPERMERCADOS, tarjetasSeleccionadas);
      const mejores = calcularMejoresPorSuper([grupo], cantidad, SUPERMERCADOS, tarjetasSeleccionadas);

      return {
        ean,
        nombre,
        imagen,
        cantidad,
        enCatalogoLocal: !!delCatalogo,
        opciones: opciones.map(o => serializarOpcion(o, cantidad, tarjetasSeleccionadas)),
        mejor: opciones.length ? serializarOpcion(opciones[0], cantidad, tarjetasSeleccionadas) : null,
        // Dato, no pregunta: qué cantidades activarían una promo que hoy no se activa.
        sugerenciaCantidad: calcularSugerenciaCantidad([grupo], cantidad, SUPERMERCADOS, tarjetasSeleccionadas),
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
  const resumen = calcularResumenFinal(paraResumen, SUPERMERCADOS);

  const items = procesados.map(({ _mejores, ...publico }) => publico);

  res.json({
    generado: new Date().toISOString(),
    supermercados: SUPERMERCADOS,
    items,
    resumen: {
      totalOptimo: resumen.totalOptimo,
      totalesPorSuper: resumen.totalesPorSuper,
      subtotalAsignadoPorSuper: resumen.subtotalAsignadoPorSuper,
      comprasPorSuper: resumen.comprasPorSuper,
      requiereOnlinePorSuper: resumen.requiereOnlinePorSuper,
      noEncontrados: resumen.noEncontrados,
    },
    advertencias,
  });
});

module.exports = router;
