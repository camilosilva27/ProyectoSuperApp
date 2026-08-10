/**
 * CLI de AllPromos: busca productos en Vea, Carrefour y Chango Más con precios SIEMPRE
 * en vivo. El catálogo local solo se usa para resolver nombre → EAN + skuId (no precios).
 *
 * Este archivo es la capa de presentación e interacción por terminal: `readline` para
 * preguntar y `console.log` para mostrar. Todo el cálculo vive en core/ y en
 * promo-engine.js / promos-bancarias.js, compartido con el backend (backend/) para que
 * ambos no puedan dar números distintos para la misma compra.
 *
 * Es interactivo: si la búsqueda por nombre es ambigua (varios productos posibles) o no
 * encuentra nada (posible error de tipeo), pregunta antes de seguir. También pregunta si
 * hay una promo que no llega a activarse con la cantidad pedida, ofreciendo ajustarla.
 *
 * Uso:
 *   node buscar-promos.js "yerba playadito 1 kg" [cantidad]
 *   node buscar-promos.js 7790387015324 [cantidad]
 *   node buscar-promos.js --lista compras.txt
 *
 * Formato compras.txt (una línea por ítem):
 *   yerba playadito 1 kg, 2
 *   caldo knorr verdura, 1
 *   7792798014019, 4          ← también acepta EAN directo
 *   # comentarios con #
 */

const fs       = require('fs');
const path     = require('path');
const readline = require('node:readline/promises');
const { calcularCosto } = require('./promo-engine');
const {
  obtenerPromosBancarias, imprimirSeccionBancaria, imprimirMejorDiaPorSuper,
  calcularPlanFinal, imprimirPlanFinalIndividual,
  reoptimizarAsignacion, imprimirPlanFinalReoptimizado, leerMisTarjetas,
} = require('./promos-bancarias');
const { escribirReporteHTML } = require('./reporte-html');
const {
  esEANvalido, palabrasDeBusqueda, estadoCatalogos, resolverEANporNombre, skuIdVeaPorEAN,
} = require('./core/catalogo');
const { SUPERMERCADOS, buscarPorEAN, buscarPorNombreEnVivo } = require('./core/fetchers');
const {
  calcularOpciones, calcularSugerenciaCantidad, calcularMejoresPorSuper,
  calcularResumenFinal, itemsParaReoptimizar,
} = require('./core/comparador');

let rl; // se crea en main(), se cierra al final
async function ask(pregunta) {
  // Si stdin llega a EOF (ej. se acabó el input piped), readline se cierra solo y
  // la siguiente pregunta tira ERR_USE_AFTER_CLOSE. Tratamos eso como "sin respuesta".
  try {
    return (await rl.question(pregunta)).trim();
  } catch {
    return '';
  }
}

// Leída una sola vez al arrancar. Se usa para decidir si mostrar el teaser "Tarjeta
// Carrefour X%" (promo por producto, tipo 1, Fase 3 de PLAN_TARJETAS_Y_BANCOS.md) — si el
// usuario no tiene Mi Carrefour, ni se pide. El backend recibe esta lista por request en
// vez de leer el archivo; por eso core/fetchers.js la toma como parámetro.
const MIS_TARJETAS = leerMisTarjetas();

function fmt(n) {
  return Number(n).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function avisarCatalogosVencidos() {
  for (const c of estadoCatalogos()) {
    if (c.disponible && c.vencido) {
      console.warn(`⚠️  ${c.archivo} tiene ${c.dias} días. Regeneralo con: node ${c.scraper}\n`);
    }
  }
}

// ─── Resolución interactiva de nombre → candidatos ────────────────────────────

/**
 * Resuelve un texto de búsqueda a uno o más candidatos del catálogo local, preguntando
 * al usuario cuando hace falta:
 *   - 0 candidatos → puede ser un error de tipeo. Pregunta: reintentar / buscar en vivo igual / saltear.
 *   - 1 candidato  → sin ambigüedad, sigue directo.
 *   - 2+ candidatos → pregunta cuál es, con la opción de comparar todos como antes.
 *
 * A propósito NO autocorrige: el riesgo de "adivinar mal" y comparar el producto equivocado
 * sin que el usuario se entere es peor que preguntar.
 */
async function resolverCandidatoInteractivo(inputOriginal) {
  let input = inputOriginal;
  while (true) {
    const candidatos = resolverEANporNombre(palabrasDeBusqueda(input));

    if (candidatos.length === 0) {
      const resp = (await ask(
        `\n  ❓ No encontré "${input}" en el catálogo local (¿posible error de tipeo?).\n` +
        `     (r) reintentar con otro texto  /  (v) buscar en vivo igual  /  (s) saltear este ítem: `
      )).toLowerCase();
      if (resp.startsWith('r')) {
        input = await ask('     Escribí de nuevo: ');
        continue;
      }
      if (resp.startsWith('s')) return { skip: true };
      return { live: true, input };
    }

    if (candidatos.length === 1) {
      return { candidatos };
    }

    console.log(`\n  ❓ Encontré ${candidatos.length} productos distintos para "${input}":`);
    candidatos.forEach((c, i) => {
      const variante = c.skuName && c.skuName !== c.productName ? ` — ${c.skuName}` : '';
      console.log(`     ${i + 1}) ${c.productName}${variante}`);
    });
    console.log(`     0) usar los ${candidatos.length} (comparar todos)`);
    const resp = await ask('     Elegí un número: ');
    const idx = parseInt(resp, 10);
    if (idx >= 1 && idx <= candidatos.length) return { candidatos: [candidatos[idx - 1]] };
    return { candidatos }; // 0, vacío o algo no reconocido → usar todos
  }
}

/**
 * Resuelve texto → EAN(s) desde catálogo local (con confirmación interactiva ante
 * ambigüedad o cero resultados), luego trae precios en vivo. Si el usuario pide
 * buscar en vivo igual, cae a búsqueda por nombre directo en las APIs.
 * @returns [{ ean, productName, vea: [], carr: [], changomas: [] }]
 */
async function buscarPorNombre(input) {
  const resolucion = await resolverCandidatoInteractivo(input);
  if (resolucion.skip) return [];

  if (resolucion.live) {
    process.stdout.write('  (buscando en vivo...)\n');
    const resultado = await buscarPorNombreEnVivo(resolucion.input, { tarjetas: MIS_TARJETAS });
    return [{ ean: null, productName: resolucion.input, ...resultado }];
  }

  const candidatos = resolucion.candidatos;
  // Si el EAN vino del catálogo de Carrefour o Chango Más (skuIdVea=null), intentamos
  // igualmente encontrarlo en el catálogo de Vea por EAN — aunque el nombre no haya hecho match.
  for (const c of candidatos) {
    if (!c.skuIdVea) c.skuIdVea = skuIdVeaPorEAN(c.ean);
  }

  return Promise.all(
    candidatos.map(async ({ ean, productName, skuIdVea }) => {
      const resultado = await buscarPorEAN(ean, { tarjetas: MIS_TARJETAS, skuIdVea });
      return { ean, productName, ...resultado };
    })
  );
}

// ─── Display ──────────────────────────────────────────────────────────────────

function mostrarSuper(nombre, resultados, cantidad) {
  console.log(`\n🏪 ${nombre} (${resultados.length} resultado${resultados.length !== 1 ? 's' : ''}):\n`);
  if (!resultados.length) { console.log('  (sin resultados)'); return; }
  for (const p of resultados) {
    const c = calcularCosto(p.promo, p.precioBase, cantidad);
    console.log(`  📦 ${p.productName}`);
    if (p.skuName && p.skuName !== p.productName) console.log(`     Variante: ${p.skuName}`);
    if (p.promo?.esOnline) console.log(`     🌐 Descuento exclusivo online`);
    if (p.promo?.requiereTarjeta) console.log(`     💳 Requiere pagar con ${p.promo.requiereTarjeta}`);
    c.reporte.split('\n').forEach(l => console.log(`     ${l}`));
    console.log();
  }
}

/** grupo = { vea: [], carr: [], changomas: [] } */
function mostrarComparativo(grupo, cantidad) {
  const opciones = calcularOpciones(grupo, cantidad, SUPERMERCADOS);
  if (opciones.length < 2) return opciones;

  const medallas = ['🥇', '🥈', '🥉'];
  console.log('='.repeat(60));
  console.log('📊 MEJOR PRECIO:\n');
  opciones.forEach((o, i) => {
    const online = o.mejor.promo?.esOnline ? ' 🌐' : '';
    const tarjeta = o.mejor.promo?.requiereTarjeta ? ' 💳' : '';
    console.log(`  ${medallas[i] || '  '} ${o.nombre}: $${fmt(o.total)}${online}${tarjeta}`);
  });

  const [mejor, ...resto] = opciones;
  const comparativa = resto.map(r => `$${fmt(r.total - mejor.total)} vs ${r.nombre}`).join(' y ');
  console.log(`\n  Comprando en ${mejor.nombre} ahorrás ${comparativa}\n`);
  return opciones;
}

function mostrarGruposDetalle(grupos, cantidad, { compacto = false } = {}) {
  for (const grupo of grupos) {
    if (grupos.length > 1) {
      if (compacto) {
        console.log(`\n  ↳ ${grupo.productName || grupo.ean}`);
      } else {
        console.log(`\n${'─'.repeat(60)}`);
        console.log(`  ${grupo.productName || grupo.ean}  (EAN: ${grupo.ean})`);
      }
    }
    for (const s of SUPERMERCADOS) mostrarSuper(s.nombre, grupo[s.key], cantidad);
  }
}

/**
 * Pregunta si conviene cambiar la cantidad para aprovechar una promo. Muestra una vista
 * previa completa (todos los supers) para CADA cantidad candidata en la misma pregunta —
 * necesario porque distintos supers pueden requerir distintas cantidades para activar
 * promos distintas (ej. Carrefour 2x1 vs. Vea 3x2): mostrar solo una cantidad ocultaría
 * la otra alternativa. El recálculo es gratis, no vuelve a consultar las APIs.
 * Devuelve la cantidad final.
 */
async function preguntarCambioDeCantidad(grupos, cantidadActual) {
  const sugerencia = calcularSugerenciaCantidad(grupos, cantidadActual, SUPERMERCADOS);
  if (!sugerencia) return cantidadActual;

  console.log(`\n  💡 Con ${cantidadActual} unidad${cantidadActual !== 1 ? 'es' : ''} no aprovechás algunas promos. Vista previa:`);
  for (const { cantidad, opciones } of sugerencia.vistaPrevia) {
    console.log(`\n     Comprando ${cantidad}:`);
    for (const o of opciones) {
      console.log(`       ${o.nombre}: $${fmt(o.total)} (${o.oferta})`);
    }
  }

  const opcionesTexto = sugerencia.cantidadesCandidatas.join(' / ');
  const resp = await ask(`\n  ¿Cambiar la cantidad a alguna de estas (${opcionesTexto}) o mantener ${cantidadActual}? Escribí el número, Enter para mantener: `);
  const nueva = parseInt(resp, 10);
  return (!isNaN(nueva) && nueva > 0) ? nueva : cantidadActual;
}

function imprimirResumenFinal(datos) {
  console.log('\n' + '═'.repeat(60));
  console.log('🛒 RESUMEN FINAL DE COMPRA\n');

  const anchoNombre = Math.max(...SUPERMERCADOS.map(s => s.nombre.length)) + 1; // +1 por ":"

  for (const { input, cantidad, ambiguo, disponibles, optimo } of datos.items) {
    console.log(`  ${optimo.tag} ${input} ×${cantidad}`);
    for (const o of disponibles) {
      const det = ambiguo ? `"${o.productoNombre}"  ` : '';
      console.log(`       ${(o.nombre + ':').padEnd(anchoNombre)} $${fmt(o.total)}  ${det}(${o.oferta})`);
    }
    console.log(`       → mejor en ${optimo.nombre}: $${fmt(optimo.total)}`);
    console.log();
  }

  console.log('─'.repeat(60));
  console.log(`  🏆 Compra óptima (mezclando): $${fmt(datos.totalOptimo)}`);
  for (const s of SUPERMERCADOS) {
    const t = datos.totalesPorSuper[s.key];
    console.log(`  ${s.tag} Todo en ${(s.nombre + ':').padEnd(anchoNombre)} $${fmt(t)}   (+$${fmt(t - datos.totalOptimo)} vs óptimo)`);
  }

  const conCompras = SUPERMERCADOS.filter(s => datos.comprasPorSuper[s.key].length);
  if (conCompras.length) {
    console.log('\n  Plan de compra:');
    for (const s of conCompras) {
      console.log(`    ${s.tag} ${(s.nombre + ':').padEnd(anchoNombre)} ${datos.comprasPorSuper[s.key].map(c => c.input).join(' | ')}`);
    }
  }
  if (datos.noEncontrados.length) {
    console.log(`\n  ❌ No encontrados: ${datos.noEncontrados.join(', ')}`);
  }
  console.log();
}

// ─── Modo individual ──────────────────────────────────────────────────────────

async function buscarIndividual(input, cantidadInicial, promosBancariasPromise) {
  const esEAN = esEANvalido(input);
  console.log('\n' + '='.repeat(60));
  console.log(`Búsqueda: "${input}"  |  Cantidad: ${cantidadInicial}  |  Modo: ${esEAN ? 'EAN directo' : 'nombre → EAN → vivo'}`);
  console.log('='.repeat(60));

  let grupos;
  if (esEAN) {
    const ean = input.trim();
    const resultado = await buscarPorEAN(ean, { tarjetas: MIS_TARJETAS });
    grupos = [{ ean, productName: null, ...resultado }];
  } else {
    grupos = await buscarPorNombre(input);
  }

  if (!grupos.length) { console.log('\n  (sin resultados)'); return; }

  let cantidad = cantidadInicial;
  let opcionesPorGrupo = [];
  const mostrarTodo = () => {
    mostrarGruposDetalle(grupos, cantidad);
    opcionesPorGrupo = grupos.map(grupo => mostrarComparativo(grupo, cantidad));
  };
  mostrarTodo();

  const nuevaCantidad = await preguntarCambioDeCantidad(grupos, cantidad);
  if (nuevaCantidad !== cantidad) {
    cantidad = nuevaCantidad;
    console.log(`\n🔁 Recalculando con ${cantidad} unidad${cantidad !== 1 ? 'es' : ''}:`);
    mostrarTodo();
  }

  const promosBancarias = await promosBancariasPromise;
  for (const opciones of opcionesPorGrupo) {
    if (opciones && opciones.length) {
      const subtotales = Object.fromEntries(opciones.map(o => [o.key, o.total]));
      const canalForzadoPorSuper = Object.fromEntries(
        opciones.map(o => [o.key, o.mejor.promo?.esOnline ? 'online' : null])
      );
      imprimirSeccionBancaria(SUPERMERCADOS, promosBancarias, subtotales);
      imprimirMejorDiaPorSuper(SUPERMERCADOS, promosBancarias, subtotales, new Date(), canalForzadoPorSuper);
      imprimirPlanFinalIndividual(calcularPlanFinal(SUPERMERCADOS, promosBancarias, subtotales, canalForzadoPorSuper));
    }
  }
}

// ─── Modo lista ───────────────────────────────────────────────────────────────

async function procesarLista(archivoLista, promosBancariasPromise) {
  const items = fs.readFileSync(archivoLista, 'utf8')
    .split('\n')
    .map(l => l.replace(/#.*$/, '').trim())
    .filter(Boolean)
    .map(l => {
      const [inputRaw, cantRaw] = l.split(',');
      return { input: inputRaw.trim(), cantidad: parseInt(cantRaw) || 1 };
    });

  console.log(`\n🛒 Lista de ${items.length} ítem${items.length !== 1 ? 's' : ''}\n`);

  const resumen = [];

  for (const { input, cantidad: cantidadInicial } of items) {
    console.log('\n' + '='.repeat(60));
    console.log(`📦 "${input}"  ×${cantidadInicial}`);
    console.log('='.repeat(60));

    const grupos = esEANvalido(input)
      ? [{ ean: input.trim(), productName: null, ...await buscarPorEAN(input.trim(), { tarjetas: MIS_TARJETAS }) }]
      : await buscarPorNombre(input);

    if (!grupos.length) {
      console.log('\n  (sin resultados)');
      resumen.push({ input, cantidad: cantidadInicial, mejores: {}, ambiguo: false });
      continue;
    }

    let cantidad = cantidadInicial;
    mostrarGruposDetalle(grupos, cantidad, { compacto: true });

    const nuevaCantidad = await preguntarCambioDeCantidad(grupos, cantidad);
    if (nuevaCantidad !== cantidad) {
      cantidad = nuevaCantidad;
      console.log(`\n🔁 Recalculando con ${cantidad} unidad${cantidad !== 1 ? 'es' : ''}:`);
      mostrarGruposDetalle(grupos, cantidad, { compacto: true });
    }

    const mejores = calcularMejoresPorSuper(grupos, cantidad, SUPERMERCADOS);
    resumen.push({ input, cantidad, mejores, ambiguo: grupos.length > 1 });
  }

  const datos = calcularResumenFinal(resumen, SUPERMERCADOS);
  imprimirResumenFinal(datos);

  const { subtotalAsignadoPorSuper, requiereOnlinePorSuper, totalOptimo } = datos;
  const canalForzadoPorSuper = Object.fromEntries(
    SUPERMERCADOS.map(s => [s.key, requiereOnlinePorSuper[s.key] ? 'online' : null])
  );
  const promosBancarias = await promosBancariasPromise;
  imprimirSeccionBancaria(SUPERMERCADOS, promosBancarias, subtotalAsignadoPorSuper);
  imprimirMejorDiaPorSuper(SUPERMERCADOS, promosBancarias, subtotalAsignadoPorSuper, new Date(), canalForzadoPorSuper);

  // Plan Final: re-optimiza qué producto va a qué super (puede diferir del "Plan de
  // compra" de arriba) para aprovechar mejor la promo bancaria de cada super — ver
  // PLAN_TARJETAS_Y_BANCOS.md Fase 4. Usa los precios por super que ya están en
  // `resumen` (no requiere volver a consultar ninguna API).
  const itemsReopt = itemsParaReoptimizar(resumen, SUPERMERCADOS);
  const resultadoReoptimizado = reoptimizarAsignacion(itemsReopt, promosBancarias, SUPERMERCADOS);
  imprimirPlanFinalReoptimizado(SUPERMERCADOS, itemsReopt, resultadoReoptimizado, totalOptimo);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  avisarCatalogosVencidos();

  const args = process.argv.slice(2);
  if (!args.length) {
    console.error('Uso:');
    console.error('  node buscar-promos.js "producto" [cantidad]');
    console.error('  node buscar-promos.js 7790387015324 [cantidad]');
    console.error('  node buscar-promos.js --lista compras.txt');
    process.exit(1);
  }

  // Se dispara ahora, en paralelo con todo lo demás, para no agregar latencia — es
  // independiente de qué producto(s) se busquen (promos "por ticket", no por producto).
  const promosBancariasPromise = obtenerPromosBancarias();

  // Captura todo lo que ya se imprime por consola para volcarlo también a un .html —
  // no duplica el formateo de cada sección, solo espeja lo que ya se ve en pantalla.
  const lineasCapturadas = [];
  const logOriginal = console.log.bind(console);
  console.log = (...partes) => {
    logOriginal(...partes);
    lineasCapturadas.push(partes.map(p => (p === undefined ? '' : String(p))).join(' '));
  };

  rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    if (args[0] === '--lista') {
      if (!args[1]) { console.error('Falta el archivo. Uso: --lista compras.txt'); process.exit(1); }
      await procesarLista(args[1], promosBancariasPromise);
    } else {
      await buscarIndividual(args[0], parseInt(args[1]) || 1, promosBancariasPromise);
    }
  } finally {
    rl.close();
    console.log = logOriginal;
    const rutaHTML = path.join(__dirname, 'resultado.html');
    escribirReporteHTML(rutaHTML, lineasCapturadas, {
      titulo: 'AllPromos — resultado',
      subtitulo: `Generado ${new Date().toLocaleString('es-AR')} — ${args[0] === '--lista' ? `lista: ${args[1]}` : `búsqueda: "${args[0]}"`}`,
    });
    console.log(`\n📄 Reporte visual: ${rutaHTML}`);
  }
}

main().catch(console.error);
