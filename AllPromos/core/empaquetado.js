/**
 * Detecta EAN mal asignados por el super a dos tamaños de empaquetado distintos (encontrado
 * 2026-08-21 comparando cervezas: Vea vendía "Cerveza x 6 Un 473cc Stella Artois" a $22.990
 * bajo el MISMO EAN que Día usaba para "Cerveza Vintage Stella Artois 473ml" (lata suelta) a
 * $3.150 — no es una promo ni un bug de scraping, es un error de catalogación del super que
 * comparte el EAN del pack de 6 con el de la unidad).
 *
 * Comparar esos precios como si fueran el mismo producto es engañoso — no hay 7x de ahorro
 * real, hay 6 unidades contra 1. No hay forma confiable de saber, solo con el nombre, cuál de
 * los dos lados lee bien el empaquetado real, así que ante esta señal se descarta la
 * comparación completa para ese EAN (no solo el lado sospechoso) en vez de arriesgar mostrar
 * un ahorro inventado.
 *
 * IMPORTANTE — el nombre solo no alcanza como señal: cada super abrevia "unidades" distinto
 * ("Un", "U", "Ud", "Unid", o directamente sin la palabra: "x5 108 g", "Pack 5u"), así que un
 * mismo producto real (ej. "Galletitas Traviata x5") puede leer multiplicador 5 en un super y
 * "no especificado" en otro sin que haya ningún error real. Confirmado en vivo: mirar solo el
 * nombre marcaba 195 de 2.289 EAN comparables (8,5%) como "inconsistentes", casi todos falsos
 * positivos de este tipo (galletitas, papel higiénico, rollos de cocina). Por eso se exige
 * ADEMÁS que el precio entre supers difiera mucho (`UMBRAL_RATIO_PRECIO`) — si de verdad es el
 * mismo pack solo descripto distinto, el precio de venta real es parecido en todos los supers;
 * si un lado vende 6 unidades y el otro 1 bajo el mismo EAN, el precio va a diferir varias
 * veces, no un 20-30% de variación normal entre supers. Con ambas señales juntas, el mismo
 * catálogo completo solo marca los 2 casos reales de Stella Artois — cero falsos positivos.
 */

// "x 6 Un", "X 12 Unid.", "x6 Unidades" — exige el sufijo "un/unid/unidad(es)" para no
// confundir con cantidades que no son de empaquetado (ej. "x kg", medidas, gramajes). Se
// matchea sobre el nombre sin puntos (ver abajo) para no tener que lidiar con el límite de
// palabra justo después de una abreviatura con punto ("Unid.").
const REGEX_MULTIPLICADOR = /\bx\s*(\d{1,3})\s*(?:un|unid|unidad|unidades)\b/i;

// Por debajo de esto, una diferencia de precio entre supers es variación normal (Coto vs. el
// resto, ofertas puntuales, etc.) — no alcanza sola para sospechar de un problema de
// empaquetado. Ver nota arriba: las dos señales (nombre + precio) tienen que darse juntas.
const UMBRAL_RATIO_PRECIO = 2.5;

function multiplicadorDeEmpaquetado(nombre) {
  const limpio = (nombre || '').replace(/\./g, '');
  const m = limpio.match(REGEX_MULTIPLICADOR);
  return m ? parseInt(m[1], 10) : null;
}

/** true si el nombre sugiere empaquetado distinto ENTRE supers Y el precio real también
 *  difiere mucho — ambas señales juntas, ver nota del módulo sobre por qué el nombre solo
 *  da demasiados falsos positivos. */
function grupoTieneEmpaquetadoInconsistente(grupo) {
  const entradas = Object.values(grupo).flat().filter(Boolean);
  if (entradas.length < 2) return false;

  const multiplicadores = new Set(
    entradas.map(e => multiplicadorDeEmpaquetado(e.productName || e.skuName) ?? 1)
  );
  if (multiplicadores.size <= 1) return false;

  const precios = entradas.map(e => e.precioBase).filter(p => typeof p === 'number' && p > 0);
  if (precios.length < 2) return false;
  const ratio = Math.max(...precios) / Math.min(...precios);
  return ratio > UMBRAL_RATIO_PRECIO;
}

/** Vacía todas las listas del grupo si se detecta empaquetado inconsistente entre supers —
 *  mismo shape de entrada/salida ({ vea: [], carr: [], ... }), así el llamador no necesita
 *  saber por qué un EAN no tiene resultados esta vez. */
function sanearPorEmpaquetado(grupo) {
  if (!grupoTieneEmpaquetadoInconsistente(grupo)) return grupo;
  return Object.fromEntries(Object.keys(grupo).map(key => [key, []]));
}

module.exports = { multiplicadorDeEmpaquetado, grupoTieneEmpaquetadoInconsistente, sanearPorEmpaquetado };
