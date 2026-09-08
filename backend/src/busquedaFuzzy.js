/**
 * Fuzzy matching para la búsqueda de productos de la app (prototipo).
 *
 * A propósito NO se usa en la CLI de AllPromos: ahí "0 matches" pregunta al usuario porque
 * puede ser un typo (ver AllPromos/CLAUDE.md, "no autocorregir nunca, preguntar"). En la app
 * no hay ese flujo interactivo, así que acá sí tiene sentido tolerar variaciones.
 *
 * Estrategia: fallback, no reemplazo. matchesPalabra (substring exacto, catalogo.js) se prueba
 * primero porque es gratis; recién si falla se intenta stem (singular/plural) y por último
 * distancia de edición acotada. La tolerancia de edición crece con el largo de la palabra para
 * no generar falsos positivos entre palabras cortas (ej. "sal"/"sol" a distancia 1).
 */

function stem(palabra) {
  if (palabra.length <= 4) return palabra;
  if (/[aeiou]ces$/.test(palabra)) return palabra.slice(0, -3) + 'z'; // luces → luz
  if (/[aeiou]s$/.test(palabra)) return palabra.slice(0, -1);         // casas → casa
  if (/[^aeiou]es$/.test(palabra)) return palabra.slice(0, -2);       // papeles → papel
  return palabra;
}

function tolerancia(largo) {
  if (largo < 5) return 0;
  if (largo < 8) return 1;
  return 2;
}

/**
 * Levenshtein acotado: corta apenas se supera `max`, para no pagar el costo completo en pares
 * de palabras obviamente distintos (la mayoría, en una búsqueda real).
 */
function levenshteinAcotado(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  if (a === b) return 0;

  let filaAnterior = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) filaAnterior[j] = j;

  for (let i = 1; i <= a.length; i++) {
    const filaActual = new Array(b.length + 1);
    filaActual[0] = i;
    let minFila = i;
    for (let j = 1; j <= b.length; j++) {
      const costo = a[i - 1] === b[j - 1] ? 0 : 1;
      const valor = Math.min(
        filaAnterior[j] + 1,
        filaActual[j - 1] + 1,
        filaAnterior[j - 1] + costo,
      );
      filaActual[j] = valor;
      if (valor < minFila) minFila = valor;
    }
    if (minFila > max) return max + 1; // toda la fila superó la tolerancia, no puede mejorar
    filaAnterior = filaActual;
  }
  return filaAnterior[b.length];
}

/** ¿"palabra" matchea alguna palabra del producto por stem o por distancia de edición? */
function matchesPalabraFuzzy(palabra, haystackWords, haystackStems) {
  const pStem = stem(palabra);
  if (haystackWords.includes(pStem) || haystackStems.includes(pStem)) return true;

  const tol = tolerancia(palabra.length);
  if (tol === 0) return false;
  return haystackWords.some(hw => levenshteinAcotado(palabra, hw, tol) <= tol);
}

module.exports = { stem, tolerancia, levenshteinAcotado, matchesPalabraFuzzy };
