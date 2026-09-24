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
 *   nUnidades?: number     // para ndo_al_pct, nxm y oferta_precio_fijo
 *   descuentoSegunda?: number // 0-1, para ndo_al_pct ("2do al 70%" → 0.70)
 *   pagaM?: number         // para nxm ("3x2" → pagaM=2)
 *   precioFijoTotal?: number // para oferta_precio_fijo ("2x$1900" → nUnidades=2, precioFijoTotal=1900)
 * }
 */

// Vea nombra sus promos online con "| Ofertas Trafico" o "| Ecommerce"
const ONLINE_RE = /trafico|ecommerce|online|web/i;

function interpretarPromoPorTexto(nombrePromo, effectiveDiscount) {
  // trim: Vea/Jumbo/Disco tienen promos con espacio adelante (" 2x1 Legumbres | Ofertas
  // Internas") y las regex de abajo están ancladas con ^. Sin esto un 2x1 caía a pct_directo
  // con el 50% de effectiveDiscount aplicado a CADA unidad — mostraba $1.345 para una sola
  // lata de $2.690 (auditoría 2026-09-24).
  const nombre = (nombrePromo || '').trim();
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
  // "2do" o "2da" (Chango Más escribe "2da al 70%").
  const ndo = nombre.match(/(\d+)d[oa] al (\d+)%/i);
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

  // --- Coto: "X% Nda/Ndo" (descuento solo en la Nésima unidad, ej. "70% 2da") ---
  const cotoNda = nombre.match(/^(\d+(?:\.\d+)?)\s*%\s*(\d+)(?:er|era|do|da|to|ta|ro|ra)\b/i);
  if (cotoNda) {
    const descPct = parseFloat(cotoNda[1]) / 100;
    const nUnidades = parseInt(cotoNda[2]);
    return {
      tipo: 'ndo_al_pct',
      descripcion: `${nUnidades}° al ${cotoNda[1]}% de descuento`,
      cantidadMinima: nUnidades,
      nUnidades,
      descuentoSegunda: descPct,
      esOnline,
    };
  }

  // --- X% directo ---
  const pct = nombre.match(/^(\d+)%/);
  if (pct || effectiveDiscount !== undefined) {
    // effectiveDiscount no numérico (null, "", texto): antes daba descuentoPct NaN → total NaN
    // y el súper desaparecía del ranking. Ahora cae al % del nombre si lo hay, y si no, "sin
    // promo detectable" (null) — mismo criterio de no adivinar (auditoría 2026-09-24).
    const descCampo = effectiveDiscount !== undefined ? parseFloat(effectiveDiscount) : NaN;
    const desc = Number.isFinite(descCampo) ? descCampo : (pct ? parseInt(pct[1]) / 100 : NaN);
    if (!Number.isFinite(desc)) return null;
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

/**
 * % directo de Coto ("X%Dto"), con la cantidad mínima de "Llevando N" si la hay.
 * `descuento` es la fracción (0.35). Devuelve null si no es un número válido.
 */
function promoDescuentoCoto(descuento, cantidadMinima = 1) {
  const promo = interpretarPromoPorTexto('', descuento);
  if (!promo || !(cantidadMinima > 1)) return promo;
  return {
    ...promo,
    descripcion: `${Math.round(promo.descuentoPct * 100)}% llevando ${cantidadMinima}`,
    cantidadMinima,
  };
}

/**
 * Textos de promo de producto de Coto que NO deben interpretarse como descuento para todos:
 * "15%" suelto, "+5%", "1 Pago 10%" son de Comunidad Coto / medio de pago (auditoría de promos
 * 2026-09-24: el "15%" suelto se aplicaba a cualquier usuario).
 */
function esPromoCotoCondicionada(texto) {
  const t = String(texto || '').trim();
  return /^\d+(?:[.,]\d+)?\s*%$/.test(t) || /^\+\s*\d/.test(t) || /^\d+\s*pago/i.test(t);
}

function interpretarPromoCarrefour(teaser) {
  const nombre = (teaser?.nombre || '').trim();
  const esOnline = ONLINE_RE.test(nombre);

  // Extraer código interno: Reg-N-M donde N=unidades, M=% de descuento en la Nésima
  // Ej: Reg-2-80 = 2da unidad con 80% off; Reg-3-100 = 3ra gratis (3x2)
  const reg = nombre.match(/Reg-(\d+)-(\d+)/i);

  // También parsear el texto para la descripción legible
  const nxm = nombre.match(/(\d+)x(\d+)/i);
  const ndo = nombre.match(/(\d+)d[oa] al (\d+)%/i);
  // --- Nx$M: precio fijo total por N unidades, no un % (visto en Día, ej. "2x$1900") ---
  // Sin ancla final: Chango Más agrega la descripción después ("2x$2499 ALFAJOR TRIPLE ...").
  const precioFijo = nombre.match(/^(\d+)x\$\s?(\d[\d.,]*)(?![\d])/i);
  // --- "Llevando 2 a $950 c/u": precio fijo POR UNIDAD al llevar N (visto en Día, 2026-09-24).
  // Equivale a Nx$(N×X). Antes no matcheaba ningún patrón y la promo se perdía.
  const llevandoAPrecio = nombre.match(/^llevando\s+(\d+)\s+a\s+\$\s?([\d.,]+)\s*c\/u/i);
  // Tope de unidades con promo: "PROMO-2do al 50% Max 8 unidades Combinable ..." (Carrefour).
  // Antes se ignoraba y la promo se aplicaba a cualquier cantidad (auditoría 2026-09-24).
  const maxMatch = nombre.match(/\bmax\.?\s*(\d+)\s*u(?:nidades|nid|n)?\b/i);
  const maxUnidades = maxMatch ? parseInt(maxMatch[1]) : null;
  const conTope = (promo) => (maxUnidades ? { ...promo, maxUnidades } : promo);

  if (llevandoAPrecio) {
    const n = parseInt(llevandoAPrecio[1]);
    const unitario = parsearMontoAR(llevandoAPrecio[2]);
    if (n >= 2 && unitario > 0) {
      const total = Math.round(n * unitario * 100) / 100;
      return conTope({
        tipo: 'oferta_precio_fijo',
        descripcion: `Llevando ${n}, $${fmt(unitario)} c/u`,
        cantidadMinima: n,
        nUnidades: n,
        precioFijoTotal: total,
        esOnline,
      });
    }
  }

  if (precioFijo) {
    const n = parseInt(precioFijo[1]);
    const total = parsearMontoAR(precioFijo[2]);
    if (!(total > 0)) return null;
    return conTope({
      tipo: 'oferta_precio_fijo',
      descripcion: `${n}x$${fmt(total)} (precio fijo cada ${n})`,
      cantidadMinima: n,
      nUnidades: n,
      precioFijoTotal: total,
      esOnline,
    });
  }

  if (nxm) {
    const n = parseInt(nxm[1]);
    const m = parseInt(nxm[2]);
    return conTope({
      tipo: 'nxm',
      descripcion: `${n}x${m} (llevás ${n}, pagás ${m})`,
      cantidadMinima: n,
      nUnidades: n,
      pagaM: m,
      esOnline,
    });
  }

  // El código Reg-N-M alcanza solo (Chango Más: "PromoVolumen - LLEVANDO 2 - 2da al 70% - Reg-2-70").
  if (reg) {
    const nUnidades = parseInt(reg[1]);
    const descPct = parseInt(reg[2]) / 100;

    if (descPct === 1) {
      return conTope({
        tipo: 'nxm',
        descripcion: `${nUnidades}x${nUnidades - 1} (llevás ${nUnidades}, pagás ${nUnidades - 1})`,
        cantidadMinima: nUnidades,
        nUnidades,
        pagaM: nUnidades - 1,
        esOnline,
      });
    }

    return conTope({
      tipo: 'ndo_al_pct',
      descripcion: `${nUnidades}° al ${Math.round(descPct * 100)}% de descuento`,
      cantidadMinima: nUnidades,
      nUnidades,
      descuentoSegunda: descPct,
      esOnline,
    });
  }

  if (ndo) {
    const nUnidades = parseInt(ndo[1]);
    const descPct = parseInt(ndo[2]) / 100;
    return conTope({
      tipo: 'ndo_al_pct',
      descripcion: `${nUnidades}° al ${ndo[2]}% de descuento`,
      cantidadMinima: nUnidades,
      nUnidades,
      descuentoSegunda: descPct,
      esOnline,
    });
  }

  return null;
}

/**
 * ¿El teaser de un súper VTEX (Carrefour/Chango Más/Día) es una promo bancaria (Tarjeta,
 * Cuenta Digital, Banco, BIN) y por lo tanto queda fuera de las promos por producto generales?
 * Único criterio compartido por los scrapers, los completadores/refrescadores de extras, el
 * fallback en vivo (core/fetchers.js) y precioCache.js.
 *
 * "bin" va con límite de palabra: antes cada scraper hacía `includes('bin')` y "Com*bin*able"
 * (presente en casi todos los teasers "PROMO-2do al 50% Max 8 unidades Combinable ...") lo
 * matcheaba — ~560 SKUs de Carrefour perdían su 2do al X%/NxM en el camino cacheado mientras
 * el fallback en vivo (que no miraba "bin") sí lo aplicaba (auditoría 2026-09-24).
 * Los teasers "Mi Crf" (exigen Mi Carrefour) NO son bancarios acá: el fallback en vivo nunca
 * los trató distinto de una promo general.
 */
const TEASER_BANCARIO_RE = /tarjeta|cuenta digital|banco|\bbin\b/i;

function esTeaserBancario(nombre) {
  return TEASER_BANCARIO_RE.test(nombre || '');
}

/**
 * Promo por producto condicionada a tarjeta propia: el teaser "Tarjeta Carrefour X%" de
 * Carrefour, identificado por el campo estructurado RestrictionsBins (no por texto —
 * confirmado en vivo que el % real viene del campo `PercentualDiscount` de `<Effects>`,
 * no de parsear el nombre). Nunca aparecieron bancos de terceros en este campo en la
 * investigación — es siempre una tarjeta propia de Carrefour, pero específicamente la de
 * CRÉDITO Mi Carrefour (confirmado en vivo el 2026-09-04: el RestrictionsBins implica una
 * tarjeta real con número, no el nivel Clásico de solo DNI), por eso el caller le pasa
 * "Tarjeta Carrefour Crédito" como nombreTarjeta — ver core/fetchers.js y precioCache.js.
 * El caller decide si mostrar esta promo según si el usuario tiene esa tarjeta marcada en
 * mis-tarjetas.json/carrito.tarjetas; esta función solo interpreta el teaser, no filtra por
 * tarjeta.
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
 * Tarjetas propias de Carrefour con las que vale el teaser "Tarjeta Carrefour X%": siempre la de
 * Crédito; también Cuenta Digital si el nombre lo dice ("35% Off Tarjeta Carrefour o Cuenta
 * digital", confirmado con la simulación de checkout el 2026-09-24).
 */
function tarjetasDelTeaserPropio(nombreTeaser) {
  const tarjetas = ['Tarjeta Carrefour Crédito'];
  if (/cuenta\s+digital/i.test(nombreTeaser || '')) tarjetas.push('Cuenta Digital Carrefour');
  return tarjetas;
}

/**
 * Grupos de la promo que efectivamente se activan y unidades que quedan a precio lleno,
 * respetando `maxUnidades` si la promo lo trae (ej. "Max 8 unidades" de Carrefour: con un
 * 2do al 50% y 10 unidades, se activan 4 grupos y 2 van a precio lleno).
 */
function gruposConTope(promo, cantidadDeseada) {
  const { nUnidades } = promo;
  const unidadesConPromo = promo.maxUnidades ? Math.min(cantidadDeseada, promo.maxUnidades) : cantidadDeseada;
  const gruposCompletos = Math.floor(unidadesConPromo / nUnidades);
  return { gruposCompletos, resto: cantidadDeseada - gruposCompletos * nUnidades };
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
      if (promo.cantidadMinima > 1) {
        // Coto "Llevando N": el % vale por cada grupo de N; lo que sobra va a precio lleno.
        const n = promo.cantidadMinima;
        const conDesc = Math.floor(cantidadDeseada / n) * n;
        const resto = cantidadDeseada - conDesc;
        totalConPromo = precioConDesc * conDesc + precioUnitario * resto;
        detalle = conDesc
          ? `${conDesc} × $${fmt(precioConDesc)}${resto ? ` + ${resto} × $${fmt(precioUnitario)}` : ''} = $${fmt(totalConPromo)}`
          : `${cantidadDeseada} × $${fmt(precioUnitario)} = $${fmt(totalConPromo)} (necesitás ${n} para activar la promo)`;
        break;
      }
      totalConPromo = precioConDesc * cantidadDeseada;
      detalle = `${cantidadDeseada} × $${fmt(precioConDesc)} = $${fmt(totalConPromo)}`;
      break;
    }

    case 'ndo_al_pct': {
      // Ej: "2do al 80%" → 1ra al precio lleno, 2da al 20% del precio
      // Para N unidades: grupos completos + resto
      const { nUnidades, descuentoSegunda } = promo;
      const precioNdo = precioUnitario * (1 - descuentoSegunda);
      const { gruposCompletos, resto } = gruposConTope(promo, cantidadDeseada);

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
      const { gruposCompletos, resto } = gruposConTope(promo, cantidadDeseada);

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

    case 'oferta_precio_fijo': {
      // Ej: "2x$1900" → cada N unidades, precio TOTAL fijo (no una fracción del unitario)
      const { nUnidades, precioFijoTotal } = promo;
      const { gruposCompletos, resto } = gruposConTope(promo, cantidadDeseada);

      if (gruposCompletos === 0) {
        totalConPromo = totalSinPromo;
        detalle = `${cantidadDeseada} × $${fmt(precioUnitario)} = $${fmt(totalConPromo)} (necesitás ${nUnidades} para activar la promo)`;
      } else {
        const costoGrupos = precioFijoTotal * gruposCompletos;
        const costoResto = precioUnitario * resto;
        totalConPromo = costoGrupos + costoResto;

        const partes = [];
        partes.push(`${gruposCompletos} × ${nUnidades} unidades a $${fmt(precioFijoTotal)} fijo: $${fmt(costoGrupos)}`);
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

// Monto en formato argentino: "1.250" = 1250, "950,50" = 950.5, "1.250,5" = 1250.5.
function parsearMontoAR(texto) {
  const limpio = String(texto).trim().replace(/[.,]$/, '');
  const m = limpio.match(/^(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?$/);
  if (!m) return NaN;
  return parseFloat(m[1].replace(/\./g, '') + (m[2] ? '.' + m[2] : ''));
}

function fmt(n) {
  return Number(n).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

module.exports = {
  promoDescuentoCoto, esPromoCotoCondicionada, tarjetasDelTeaserPropio,
  interpretarPromoPorTexto, interpretarPromoCarrefour, interpretarTeaserTarjetaPropia, calcularCosto,
  esTeaserBancario,
};
