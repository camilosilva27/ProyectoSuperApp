/**
 * Motor de interpretación y cálculo de promociones.
 * interpretarPromoPorTexto() parsea nombre de promo + descuento efectivo (formato de Vea,
 * también usado por Carrefour para su descuento directo). interpretarPromoCarrefour()
 * parsea los teasers propios de Carrefour (códigos Reg-N-M).
 * El resultado siempre es una estructura común que calcularCosto() puede procesar.
 */

/**
 * Resultado común de parseo:
 * {
 *   tipo: 'pct_directo' | 'ndo_al_pct' | 'nxm' | 'oferta_precio_fijo'
 *   descripcion: string   // texto legible para el usuario
 *   cantidadMinima: number // unidades mínimas para activar la promo
 *   // según tipo:
 *   descuentoPct?: number  // 0-1, para pct_directo
 *   nUnidades?: number     // para ndo_al_pct y nxm
 *   descuentoSegunda?: number // 0-1, para ndo_al_pct ("2do al 70%" → 0.70)
 *   pagaM?: number         // para nxm ("3x2" → pagaM=2)
 * }
 */

// Vea nombra sus promos online con "| Ofertas Trafico" o "| Ecommerce"
const ONLINE_RE = /trafico|ecommerce|online|web/i;

function interpretarPromoPorTexto(nombrePromo, effectiveDiscount) {
  const nombre = nombrePromo || '';
  const esOnline = ONLINE_RE.test(nombre);

  // --- NxM: 2x1, 3x2, 4x2, 6x4, 6x5 ---
  const nxm = nombre.match(/^(\d+)x(\d+)/i);
  if (nxm) {
    const n = parseInt(nxm[1]);
    const m = parseInt(nxm[2]);
    return {
      tipo: 'nxm',
      descripcion: `${n}x${m} (llevás ${n}, pagás ${m})`,
      cantidadMinima: n,
      nUnidades: n,
      pagaM: m,
      esOnline,
    };
  }

  // --- 2do al X% (o Ndo al X%) ---
  const ndo = nombre.match(/(\d+)do al (\d+)%/i);
  if (ndo) {
    const nUnidades = parseInt(ndo[1]);
    const descPct = parseInt(ndo[2]) / 100;
    return {
      tipo: 'ndo_al_pct',
      descripcion: `${nUnidades}° al ${ndo[2]}% de descuento`,
      cantidadMinima: nUnidades,
      nUnidades,
      descuentoSegunda: descPct,
      esOnline,
    };
  }

  // --- X% directo ---
  const pct = nombre.match(/^(\d+)%/);
  if (pct || effectiveDiscount !== undefined) {
    const desc = effectiveDiscount !== undefined
      ? parseFloat(effectiveDiscount)
      : parseInt(pct[1]) / 100;
    return {
      tipo: 'pct_directo',
      descripcion: `${Math.round(desc * 100)}% de descuento`,
      cantidadMinima: 1,
      descuentoPct: desc,
      esOnline,
    };
  }

  // --- OFERTA genérica ---
  if (effectiveDiscount !== undefined) {
    const desc = parseFloat(effectiveDiscount);
    return {
      tipo: 'pct_directo',
      descripcion: `${Math.round(desc * 100)}% de descuento (oferta)`,
      cantidadMinima: 1,
      descuentoPct: desc,
      esOnline,
    };
  }

  return null;
}

function interpretarPromoCarrefour(teaser) {
  const nombre = teaser?.nombre || '';
  const esOnline = ONLINE_RE.test(nombre);

  // Extraer código interno: Reg-N-M donde N=unidades, M=% de descuento en la Nésima
  // Ej: Reg-2-80 = 2da unidad con 80% off; Reg-3-100 = 3ra gratis (3x2)
  const reg = nombre.match(/Reg-(\d+)-(\d+)/i);

  // También parsear el texto para la descripción legible
  const nxm = nombre.match(/(\d+)x(\d+)/i);
  const ndo = nombre.match(/(\d+)do al (\d+)%/i);

  if (nxm) {
    const n = parseInt(nxm[1]);
    const m = parseInt(nxm[2]);
    return {
      tipo: 'nxm',
      descripcion: `${n}x${m} (llevás ${n}, pagás ${m})`,
      cantidadMinima: n,
      nUnidades: n,
      pagaM: m,
      esOnline,
    };
  }

  if (ndo && reg) {
    const nUnidades = parseInt(reg[1]);
    const descPct = parseInt(reg[2]) / 100;

    if (descPct === 1) {
      return {
        tipo: 'nxm',
        descripcion: `${nUnidades}x${nUnidades - 1} (llevás ${nUnidades}, pagás ${nUnidades - 1})`,
        cantidadMinima: nUnidades,
        nUnidades,
        pagaM: nUnidades - 1,
        esOnline,
      };
    }

    return {
      tipo: 'ndo_al_pct',
      descripcion: `${nUnidades}° al ${Math.round(descPct * 100)}% de descuento`,
      cantidadMinima: nUnidades,
      nUnidades,
      descuentoSegunda: descPct,
      esOnline,
    };
  }

  if (ndo) {
    const nUnidades = parseInt(ndo[1]);
    const descPct = parseInt(ndo[2]) / 100;
    return {
      tipo: 'ndo_al_pct',
      descripcion: `${nUnidades}° al ${ndo[2]}% de descuento`,
      cantidadMinima: nUnidades,
      nUnidades,
      descuentoSegunda: descPct,
      esOnline,
    };
  }

  return null;
}

/**
 * Promo por producto condicionada a tarjeta propia: el teaser "Tarjeta Carrefour X%" de
 * Carrefour, identificado por el campo estructurado RestrictionsBins (no por texto —
 * confirmado en vivo que el % real viene del campo `PercentualDiscount` de `<Effects>`,
 * no de parsear el nombre). Nunca
 * aparecieron bancos de terceros en este campo en la investigación — es siempre Mi Carrefour.
 * El caller decide si mostrar esta promo según si el usuario tiene "Mi Carrefour" en
 * mis-tarjetas.json; esta función solo interpreta el teaser, no filtra por tarjeta.
 */
function interpretarTeaserTarjetaPropia(teaser, nombreTarjeta) {
  const params = teaser?.['<Effects>k__BackingField']?.['<Parameters>k__BackingField'] || [];
  const pctParam = params.find(p => p['<Name>k__BackingField'] === 'PercentualDiscount');
  if (!pctParam) return null;
  const descuentoPct = parseFloat(pctParam['<Value>k__BackingField']) / 100;
  if (!(descuentoPct > 0)) return null;
  return {
    tipo: 'pct_directo',
    descripcion: `${Math.round(descuentoPct * 100)}% con ${nombreTarjeta}`,
    cantidadMinima: 1,
    descuentoPct,
    esOnline: false,
    requiereTarjeta: nombreTarjeta,
  };
}

/**
 * Calcula cuánto pagás en total y genera el reporte de texto.
 *
 * @param {object} promo - resultado de interpretarPromo*
 * @param {number} precioUnitario - precio sin descuento de 1 unidad
 * @param {number} cantidadDeseada - cuántas unidades quiere el usuario
 * @returns {{ totalSinPromo, totalConPromo, ahorro, reporte: string, convieneMas: boolean }}
 */
function calcularCosto(promo, precioUnitario, cantidadDeseada) {
  const totalSinPromo = precioUnitario * cantidadDeseada;

  if (!promo) {
    return {
      totalSinPromo,
      totalConPromo: totalSinPromo,
      ahorro: 0,
      reporte: `Sin promoción. Total: $${fmt(totalSinPromo)}`,
      convieneMas: false,
    };
  }

  let totalConPromo;
  let detalle;
  // ¿La promo aplica para la cantidad deseada?
  const promoAplica = cantidadDeseada >= promo.cantidadMinima;
  // ¿Comprar más activaría una promo mejor?
  const convieneMas = !promoAplica;

  switch (promo.tipo) {
    case 'pct_directo': {
      const precioConDesc = precioUnitario * (1 - promo.descuentoPct);
      totalConPromo = precioConDesc * cantidadDeseada;
      detalle = `${cantidadDeseada} × $${fmt(precioConDesc)} = $${fmt(totalConPromo)}`;
      break;
    }

    case 'ndo_al_pct': {
      // Ej: "2do al 80%" → 1ra al precio lleno, 2da al 20% del precio
      // Para N unidades: grupos completos + resto
      const { nUnidades, descuentoSegunda } = promo;
      const precioNdo = precioUnitario * (1 - descuentoSegunda);
      const gruposCompletos = Math.floor(cantidadDeseada / nUnidades);
      const resto = cantidadDeseada % nUnidades;

      if (gruposCompletos === 0) {
        // No alcanza para activar la promo
        totalConPromo = totalSinPromo;
        detalle = `${cantidadDeseada} × $${fmt(precioUnitario)} = $${fmt(totalConPromo)} (necesitás ${nUnidades} para activar la promo)`;
      } else {
        // Precio por grupo completo: (nUnidades-1) al precio lleno + 1 al precio con descuento
        const costoPorGrupo = precioUnitario * (nUnidades - 1) + precioNdo;
        const costoGrupos = costoPorGrupo * gruposCompletos;
        const costoResto = precioUnitario * resto;
        totalConPromo = costoGrupos + costoResto;

        const partes = [];
        if (gruposCompletos > 0) {
          partes.push(`${gruposCompletos} grupo${gruposCompletos > 1 ? 's' : ''} de ${nUnidades}: ${gruposCompletos} × ($${fmt(precioUnitario * (nUnidades - 1))} + $${fmt(precioNdo)}) = $${fmt(costoGrupos)}`);
        }
        if (resto > 0) {
          partes.push(`${resto} unidad${resto > 1 ? 'es' : ''} al precio lleno: $${fmt(costoResto)}`);
        }
        detalle = partes.join(' + ');
      }
      break;
    }

    case 'nxm': {
      // Ej: "3x2" → cada 3 unidades pagás 2
      const { nUnidades, pagaM } = promo;
      const gruposCompletos = Math.floor(cantidadDeseada / nUnidades);
      const resto = cantidadDeseada % nUnidades;

      if (gruposCompletos === 0) {
        totalConPromo = totalSinPromo;
        detalle = `${cantidadDeseada} × $${fmt(precioUnitario)} = $${fmt(totalConPromo)} (necesitás ${nUnidades} para activar la promo)`;
      } else {
        const costoPorGrupo = precioUnitario * pagaM;
        const costoGrupos = costoPorGrupo * gruposCompletos;
        const costoResto = precioUnitario * resto;
        totalConPromo = costoGrupos + costoResto;

        const partes = [];
        if (gruposCompletos > 0) {
          partes.push(`${gruposCompletos} × ${nUnidades} unidades pagando ${pagaM}: $${fmt(costoGrupos)}`);
        }
        if (resto > 0) {
          partes.push(`${resto} al precio lleno: $${fmt(costoResto)}`);
        }
        detalle = partes.join(' + ');
      }
      break;
    }

    default:
      totalConPromo = totalSinPromo;
      detalle = `$${fmt(totalSinPromo)}`;
  }

  const ahorro = totalSinPromo - totalConPromo;

  const reporte = [
    `Precio unitario: $${fmt(precioUnitario)}`,
    `Promo: ${promo.descripcion}`,
    `Detalle: ${detalle}`,
    `Total con promo: $${fmt(totalConPromo)}`,
    ahorro > 0 ? `Ahorrás: $${fmt(ahorro)} (${Math.round(ahorro / totalSinPromo * 100)}% vs sin promo)` : '',
    convieneMas ? `⚠️  Comprando ${promo.cantidadMinima} activarías la promo` : '',
  ].filter(Boolean).join('\n');

  return { totalSinPromo, totalConPromo, ahorro, reporte, convieneMas };
}

function fmt(n) {
  return Number(n).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

module.exports = { interpretarPromoPorTexto, interpretarPromoCarrefour, interpretarTeaserTarjetaPropia, calcularCosto };
