/**
 * Vocabulario propio de categorías para las promos bancarias "por ticket" limitadas a ciertos
 * rubros (decisión del usuario 2026-09-24): Cencopay 25% jueves "galletitas, golosinas, conservas
 * y cervezas" (Vea) / "galletitas, bebidas sin alcohol, perfumería y limpieza" (Jumbo/Disco),
 * Carrefour "Empleado público" "En Alimentos secos, Congelados, Lácteos, …", exclusiones tipo
 * "no incluye carnicería, huevos, leches" o marcas puntuales ("Quilmes", "H2OH", bodegas).
 *
 * Dos lados del mismo vocabulario:
 *  - `categoriasDeProducto(ruta)`: la `categoria` del catálogo de CADA súper (cada uno tiene su
 *    árbol: "Almacén > Desayuno y Merienda > Galletitas Dulces" en Vea, "Desayunos Y Meriendas >
 *    Galletitas Dulces" en Chango Más, 5 niveles en Coto) → lista de etiquetas, ya expandida con
 *    las etiquetas padre (cervezas ⊂ bebidas con alcohol ⊂ bebidas). Reglas sobre la ruta COMPLETA
 *    normalizada, con segmentos exactos para no confundir raíces compuestas ("Quesos y Fiambres",
 *    "Galletitas bizcochitos y tostadas" de Carrefour).
 *  - `TERMINOS_LISTA` / `TERMINOS_EXCLUSION` / `MARCAS`: cómo aparece cada etiqueta en el texto de
 *    la promo. La extracción del texto vive en promos-bancarias.js (restriccionesDeCategoria).
 *
 * Cálculo: `lineaCumplePromo(promo, linea)` — una fila del carrito entra en la base de la promo
 * si cumple categoría incluida / no excluida / marca no excluida y, con `soloSinOferta`, si no
 * tiene promo de producto. Sin categoría conocida (producto que no está en el catálogo de ningún
 * súper) NO entra en una promo con `categoriasIncluidas` (conservador) y SÍ en una con solo
 * exclusiones (como antes: la exclusión no se puede comprobar).
 *
 * Sin dependencias ni console.log (regla de core/, ver AllPromos/CLAUDE.md).
 */

function normalizar(str) {
  return (str || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
}

// Etiqueta → texto para mostrar ("solo en galletitas, golosinas …"). El orden de este objeto es
// el orden en que se listan.
const VOCABULARIO = {
  almacen: 'almacén',
  galletitas: 'galletitas',
  golosinas: 'golosinas',
  conservas: 'conservas',
  'conservas vegetales': 'conservas de frutas y verduras',
  cervezas: 'cervezas',
  vinos: 'vinos',
  espumantes: 'espumantes',
  'bebidas blancas': 'bebidas blancas',
  fernet: 'fernet',
  'bebidas con alcohol': 'bebidas con alcohol',
  'bebidas sin alcohol': 'bebidas sin alcohol',
  bebidas: 'bebidas',
  lacteos: 'lácteos',
  leches: 'leches',
  'leches infantiles': 'leches infantiles',
  yogures: 'yogures',
  quesos: 'quesos',
  fiambres: 'fiambres',
  embutidos: 'embutidos',
  salchichas: 'salchichas',
  'pastas frescas': 'pastas frescas',
  tapas: 'tapas de empanadas y tartas',
  congelados: 'congelados',
  carniceria: 'carnicería',
  huevos: 'huevos',
  'frutas y verduras': 'frutas y verduras',
  aceites: 'aceites',
  harinas: 'harinas',
  azucar: 'azúcar',
  yerbas: 'yerbas',
  fideos: 'fideos',
  perfumeria: 'perfumería',
  limpieza: 'limpieza',
  papeles: 'papeles',
  bebe: 'bebé',
  farmacia: 'farmacia',
  electro: 'electro',
  bazar: 'bazar',
  textil: 'textil',
  mascotas: 'mascotas',
};

// Hijo → padres (se expande de forma transitiva).
const PADRES = {
  galletitas: ['almacen'],
  golosinas: ['almacen'],
  'conservas vegetales': ['conservas'],
  conservas: ['almacen'],
  aceites: ['almacen'],
  harinas: ['almacen'],
  azucar: ['almacen'],
  yerbas: ['almacen'],
  fideos: ['almacen'],
  cervezas: ['bebidas'],
  vinos: ['bebidas con alcohol'],
  espumantes: ['bebidas con alcohol'],
  'bebidas blancas': ['bebidas con alcohol'],
  fernet: ['bebidas con alcohol'],
  'bebidas con alcohol': ['bebidas'],
  'bebidas sin alcohol': ['bebidas'],
  leches: ['lacteos'],
  yogures: ['lacteos'],
  quesos: ['lacteos'],
};

// ─── Producto: ruta de categoría del catálogo → etiquetas ────────────────────
// `S(x)` = x es un segmento COMPLETO de la ruta ("a > b > c"), no un pedazo de otro segmento.
const S = alternativas => new RegExp(`(?:^|> )(?:${alternativas})(?: >|$)`);

// Raíces de bebidas: "Bebidas" (todos menos Chango Más) y las raíces planas de Chango Más.
const RAIZ_BEBIDAS = /^(?:bebidas|a base de hierbas|aguas|bebidas blancas, licores y whiskys|bebidas isotonicas y energizantes|cervezas|fernet y aperitivos|gaseosas|jugos|vinos y espumantes)(?: >|$)/;

const REGLAS_PRODUCTO = [
  // Almacén / alimentos secos: la raíz Almacén de cada súper + Desayuno (Carrefour y Día lo tienen
  // como raíz aparte; Vea/Jumbo/Disco/Coto lo tienen DENTRO de Almacén) + las raíces planas de
  // Chango Más que en los otros árboles cuelgan de Almacén.
  ['almacen', /^(?:almacen|desayuno(?: y merienda)?|desayunos y meriendas|aceites, vinagres y aderezos|arroz, legumbres y pastas|caldos, sopas y pure|condimentos y especias|conservas y enlatados|harinas|kiosco|reposteria|snacks|panificados)(?: >|$)/],
  ['galletitas', S('galletitas|galletitas (?:dulces|saladas|de agua)|galletas de arroz')],
  ['golosinas', S('golosinas(?: y chocolates| y alfajores)?|kiosco|chocolates|alfajores|bombones(?: y bocaditos)?|caramelos[a-z ,]*|chicles[a-z ,]*|gomitas y gelatinas|turrones[a-z ,]*|confituras')],
  ['conservas', S('conservas(?: y enlatados)?|enlatados y conservas')],
  ['conservas vegetales', S('conservas (?:de )?(?:frutas|verduras? y legumbres|vegetal(?:es)?|legumbres y vegetales)')],
  ['cervezas', S('cervezas?')],
  ['vinos', S('vinos?(?: y espumantes)?|bodega|vino (?:tinto|blanco|rosado)')],
  ['espumantes', S('espumantes(?: y sidras)?|champagne y espumantes')],
  ['bebidas blancas', S('bebidas blancas(?:[a-z ,]*)?|whiskys?|vodka(?: ll)?|gin|ron|licores')],
  ['fernet', S('fernet')],
  ['bebidas con alcohol', S('bebidas con alcohol|aperitivos|fernet y aperitivos|americano')],
  ['bebidas sin alcohol', S('aguas?|agua (?:con|sin) gas|agua saborizada|sodas|gaseosas|jugos(?: e isotonicas)?|isotonicas|bebidas isotonicas(?: y energizantes)?|energizantes|bebidas energizantes|refrescos|bebidas sin alcohol')],
  ['bebidas', /^(?:bebidas|a base de hierbas)(?: >|$)/],
  ['leches', /(?:^|> )leches?\b/],
  ['leches infantiles', /leches?(?: y formulas)? infantiles|maternizad/],
  ['yogures', /yogur/],
  ['quesos', /(?:^|> )(?:quesos?|ricott?as?)\b(?! y fiambres)(?!.*> dulces\b)/],
  ['fiambres', S('fiambres|fiambreria|feteados|fiambres y embutidos > embutidos')],
  ['embutidos', S('embutidos|achuras y embutidos|embutidos y achuras')],
  ['salchichas', /salchichas/],
  ['pastas frescas', /pastas frescas|(?:^|> )pastas y tapas(?: >|$)/],
  ['tapas', S('tapas|pastas y tapas|tapas y pastas frescas|pastas frescas y tapas')],
  ['congelados', /congelad/],
  ['carniceria', S('carnes?(?: y pescados)?|carniceria|carne vacuna|carne de cerdo|pollos?|pollo y (?:granja|pavo)|aves|menudencias')],
  ['huevos', S('huevos')],
  ['frutas y verduras', S('frutas y verduras|frutas|verduras|frutas frescas|verduras frescas')],
  // Solo el aceite: no "Aceites y Vinagres > Vinagres" ni "Aceites, Vinagres Y Aderezos > Ketchup".
  ['aceites', /(?:^|> )aceites?\b[^>]*$|(?:^|> )aceites >/],
  ['harinas', S('harinas?|harina de [a-z]+')],
  ['azucar', /azucar/],
  ['yerbas', /yerba/],
  ['fideos', /pastas? secas?(?! y salsas > salsas)|fideos secos/],
  ['perfumeria', /^(?:perfumeria|cuidado de la piel|cuidado del cabello|cuidado oral|cuidado personal|proteccion femenina|maquillaje|cuidado del adulto)\b/],
  ['farmacia', /farmacia|botiquin/],
  ['limpieza', /^(?:limpieza|accesorios de limpieza|cocina|desodorante de ambientes|insecticidas|lavandinas|limpieza de bano|papeles, bolsas y films|pisos y muebles|ropa)(?: >|$)/],
  ['papeles', S('papeles|papeles higienicos|papel higienico|rollos de cocina(?: y servilletas)?|servilletas descartables|panuelos descartables|papeleria')],
  ['bebe', /bebe|lactancia|panales(?! para adultos)|toallitas humedas(?! limpieza)/],
  ['electro', /^(?:electro|climatizacion|heladeras|celulares|tv y video|cocinas, hornos|lavado de la ropa)\b/],
  ['bazar', /^(?:hogar|bazar)\b/],
  ['textil', /^textil\b/],
  ['mascotas', /^(?:mascotas|perros|gatos)\b|> mascotas\b/],
];

function expandirPadres(etiquetas) {
  const salida = new Set(etiquetas);
  let cambio = true;
  while (cambio) {
    cambio = false;
    for (const e of [...salida]) {
      for (const p of PADRES[e] || []) {
        if (!salida.has(p)) { salida.add(p); cambio = true; }
      }
    }
  }
  return Object.keys(VOCABULARIO).filter(k => salida.has(k));
}

const cacheProducto = new Map();

/**
 * Etiquetas del vocabulario para una ruta de categoría de catálogo. `[]` si no cae en ninguna
 * (ej. "Mascotas > …" sí; "Rotiseria > Entradas" no). `null` si no hay ruta.
 */
function categoriasDeProducto(ruta) {
  if (!ruta) return null;
  const p = normalizar(ruta).replace(/\s*>\s*/g, ' > ');
  if (cacheProducto.has(p)) return cacheProducto.get(p);
  const etiquetas = new Set();
  for (const [etiqueta, re] of REGLAS_PRODUCTO) if (re.test(p)) etiquetas.add(etiqueta);
  // Ajustes que una regla suelta no puede expresar:
  // - "Carnes > Carbón y Leña" (Vea) no es carnicería.
  if (/carbon/.test(p)) etiquetas.delete('carniceria');
  // - Congelados: la verdura/fruta/carne congelada no es "frutas y verduras"/carnicería fresca
  //   (salvo Carrefour "Carnes y pescados > Congelados", que sigue en su sección de carnicería).
  if (etiquetas.has('congelados')) etiquetas.delete('frutas y verduras');
  // - "Frutas y Verduras > Huevos" (Vea/Jumbo/Disco): el huevo no es verdura.
  if (etiquetas.has('huevos')) etiquetas.delete('frutas y verduras');
  // - Pastas frescas (Chango Más "Arroz, Legumbres Y Pastas > Pastas Frescas") no son almacén seco.
  if (etiquetas.has('pastas frescas') || etiquetas.has('tapas')) etiquetas.delete('almacen');
  // - Lácteos: leche, yogur, queso (vía PADRES) + crema, manteca, dulce de leche y los postres
  //   de la heladera (con "lacteo" arriba en la ruta). No hummus/levaduras/veganos de "Lácteos".
  if (S('cremas|cremas de leche|mantecas[a-z ,]*|dulces? de leche|alimento lacteo').test(p)
    || (/lacteo/.test(p) && /(?:^|> )postres/.test(p))) etiquetas.add('lacteos');
  // - Bebidas: solo bajo una raíz de bebidas (Coto "Galletitas Crackers > Agua" no es agua).
  if (!RAIZ_BEBIDAS.test(p)) {
    for (const e of ['cervezas', 'vinos', 'espumantes', 'bebidas blancas', 'fernet', 'bebidas con alcohol', 'bebidas sin alcohol']) etiquetas.delete(e);
  }
  // - Cerveza: bebida con alcohol, salvo "sin alcohol" en la hoja (Coto "Cerveza > … > Cervezas sin
  //   Alcohol", Chango Más "Cervezas > Sin Alcohol", Carrefour "Aperitivos sin alcohol").
  if (etiquetas.has('cervezas')) etiquetas.add('bebidas con alcohol');
  const hoja = p.split(' > ').pop();
  if (/sin alcohol/.test(hoja)) {
    etiquetas.delete('bebidas con alcohol');
    if (!etiquetas.has('cervezas')) etiquetas.add('bebidas sin alcohol');
  }
  // - Raíces compuestas de pastas/tapas ("Lácteos > Pastas y Tapas", "Tapas y pastas frescas",
  //   "Pastas Frescas y Tapas"): si la hoja dice cuál es, solo esa.
  if (etiquetas.has('pastas frescas') && etiquetas.has('tapas')) {
    const debajo = p.replace(/^.*?(?:pastas y tapas|tapas y pastas frescas|pastas frescas y tapas|pastas frescas)/, '');
    if (/fideos|noquis|rellenas/.test(debajo)) etiquetas.delete('tapas');
    else if (/tapas?\b/.test(debajo)) etiquetas.delete('pastas frescas');
  }
  // - Aceites de bebé / capilares no son aceite comestible.
  if (etiquetas.has('bebe') || etiquetas.has('perfumeria')) etiquetas.delete('aceites');
  // - Leches vegetales ("Bebidas Vegetales", "Leches vegetales", "Alimentos Vegetales") no son lácteos.
  if (/vegetal/.test(hoja)) { etiquetas.delete('leches'); etiquetas.delete('lacteos'); }
  const resultado = expandirPadres(etiquetas);
  cacheProducto.set(p, resultado);
  return resultado;
}

// ─── Texto de la promo → etiquetas ───────────────────────────────────────────

// Frases de una LISTA de categorías incluidas ("… de descuento en galletitas, cervezas, chocolate y
// golosinas, conservas de verduras, legumbres y frutas"). Se matchean de la más larga a la más
// corta; si queda algo sin matchear, la lista no es segura (la promo se descarta, ver
// restriccionesDeCategoria en promos-bancarias.js). Sin acentos, en minúscula.
const TERMINOS_LISTA = [
  ['conservas? de verduras, legumbres y frutas', ['conservas vegetales']],
  ['conservas? de frutas y verduras', ['conservas vegetales']],
  ['conservas? de (?:verduras|vegetales|legumbres)', ['conservas vegetales']],
  ['conservas?', ['conservas']],
  ['galletitas', ['galletitas']],
  ['chocolates?', ['golosinas']],
  ['golosinas', ['golosinas']],
  ['cervezas?', ['cervezas']],
  ['bebidas? sin alcohol', ['bebidas sin alcohol']],
  ['bebidas', ['bebidas']],
  ['perfumeria del bebe', ['bebe']],
  ['perfumeria', ['perfumeria']],
  ['limpieza', ['limpieza']],
  ['alimentos secos', ['almacen']],
  ['almacen(?: seco)?', ['almacen']],
  ['congelados', ['congelados']],
  ['lacteos', ['lacteos']],
  ['fiambres|fiambreria', ['fiambres']],
  ['quesos', ['quesos']],
  ['papeles', ['papeles']],
  ['tapas(?: de)? empanadas y tartas|tapas', ['tapas']],
  ['pastas frescas', ['pastas frescas']],
  ['salchichas?', ['salchichas']],
  ['panales', ['bebe']],
  ['farmacia venta libre|farmacia', ['farmacia']],
].map(([re, etiquetas]) => [new RegExp(`^(?:${re})\\b`), etiquetas]);

// Lo que puede ir entre dos frases de la lista.
const SEPARADOR_LISTA = /^(?:\s|,|;|\by\b|\be\b|\bde\b|\blas?\b|\blos\b|\bsecciones?\b|\bproductos\b|\bseleccionados\b)+/;

/**
 * Parsea una lista de categorías. @returns { etiquetas, desconocidos, primeroConocido }.
 * `desconocidos` = pedazos que no son ninguna frase conocida (ej. "almacen sin tacc",
 * "horneables y gelificables" de la promo ANSES de Chango Más).
 */
function parsearListaCategorias(lista) {
  let resto = normalizar(lista).replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
  const etiquetas = new Set();
  const desconocidos = [];
  let primeroConocido = null;
  while (resto) {
    const sep = resto.match(SEPARADOR_LISTA);
    if (sep) { resto = resto.slice(sep[0].length); continue; }
    const termino = TERMINOS_LISTA.find(([re]) => re.test(resto));
    if (termino) {
      const m = resto.match(termino[0]);
      termino[1].forEach(e => etiquetas.add(e));
      if (primeroConocido === null) primeroConocido = true;
      resto = resto.slice(m[0].length);
      continue;
    }
    // Pedazo desconocido: hasta la próxima coma / " y " / " e ".
    const corte = resto.search(/,|\sy\s|\se\s/);
    const pedazo = corte === -1 ? resto : resto.slice(0, corte);
    desconocidos.push(pedazo.trim());
    if (primeroConocido === null) primeroConocido = false;
    resto = corte === -1 ? '' : resto.slice(corte);
  }
  return { etiquetas: [...etiquetas], desconocidos, primeroConocido: !!primeroConocido };
}

// Términos de EXCLUSIÓN ("no incluye carnicería, huevos de gallina, frutas, verduras, electros…").
// Acá no hace falta mapear todo: lo que no se reconoce ("ofertón por bulto", "precio súper bajo",
// "programa precios cuidados") se ignora y la promo sigue calculándose sobre esas filas, como
// antes de este cambio. Sin "cervezas"/"gaseosas"/"bebidas" a propósito: en los feeds solo
// aparecen como "cervezas y gaseosas de Quilmes (…)" (se excluyen las MARCAS, ver MARCAS),
// "productos Carrefour de … bebidas" (marca propia) o "conservadoras de cerveza".
const TERMINOS_EXCLUSION = [
  ['carniceria', /\bcarniceria\b|\bcaniceria\b|\bcarnes\b|\bcarne (?:vacuna|de vaca)\b|\bgranja\b/],
  ['embutidos', /\bembutidos\b/],
  ['huevos', /\bhuevos\b/],
  ['frutas y verduras', /\bfrutas\s*(?:,|y)\s*verduras\b/],
  ['leches infantiles', /\bleches\s+infantiles\b/],
  ['leches', /\bleches?\b(?!\s+(?:infantiles|saborizadas|maternizadas))(?!\s+(?:y|ni)\s+maternizadas)/],
  ['quesos', /\bquesos\b/],
  ['aceites', /\baceites\b/],
  ['harinas', /\bharinas\b/],
  ['azucar', /\bazucar(?:es)?\b/],
  ['bebidas blancas', /\bbebidas blancas\b/],
  ['vinos', /\bvinos\b(?!\s+en\s+brik)/],
  ['fernet', /\bfernet\b/],
  ['yerbas', /\byerbas\b/],
  ['fideos', /\bfideos\b/],
  ['yogures', /\byogures\b/],
  ['electro', /\belectro(?:s|domesticos|nicos|nica)?\b/],
  ['bazar', /\bbazar\b/],
  ['textil', /\btextil\b/],
];

// Marcas que los legales excluyen por nombre. Solo este diccionario (una marca que no está acá se
// ignora) y cada una atada a la etiqueta donde puede aparecer, para no confundir "Patagonia"
// (cerveza) con otra cosa o "Andes"/"Corona" con un producto que no es cerveza. `texto` = cómo
// aparece en el legal; `producto` = cómo aparece en el nombre del producto (default = texto).
const CERVEZA = 'cervezas', GASEOSA = 'bebidas sin alcohol', VINO = 'bebidas con alcohol';
const MARCAS = [
  // "Cervezas y gaseosas de Cervecería y Maltería Quilmes (…)" + "Línea Coca Cola (…)" (Chango Más).
  ['quilmes', CERVEZA], ['stella artois', CERVEZA], ['budweiser', CERVEZA], ['corona', CERVEZA],
  ['brahma', CERVEZA], ['michelob', CERVEZA], ['patagonia', CERVEZA], ['eazy', CERVEZA],
  ['goose island', CERVEZA], ['andes', CERVEZA], ['temple', CERVEZA],
  ['pepsi', GASEOSA], ['seven up|7 ?up', GASEOSA, 'seven up|7 ?up'], ['paso de los toros', GASEOSA],
  ['gatorade', GASEOSA], ['glaciar', GASEOSA], ['eco de los andes', GASEOSA],
  ['h2oh?|h20', GASEOSA, 'h2oh'], ['aguas nestle', GASEOSA, 'nestle'], ['awafrut', GASEOSA],
  ['mirinda', GASEOSA], ['red bull', GASEOSA], ['rockstar', GASEOSA], ['coca ?cola', GASEOSA],
  ['fanta', GASEOSA], ['sprite', GASEOSA], ['schweppes', GASEOSA], ['powerade', GASEOSA],
  ['cepita', GASEOSA], ['ades', GASEOSA], ['aquarius', GASEOSA], ['benedictino', GASEOSA],
  ['bonaqua', GASEOSA], ['smart water', GASEOSA], ['monster', GASEOSA], ['crush', GASEOSA],
  // Bodegas (Cencosud, Carrefour).
  ['la rural', VINO], ['trumpeter', VINO], ['rutini', VINO], ['chandon', VINO], ['33 sur', VINO],
  ['terrazas de los andes', VINO, 'terrazas'], ['latitud 33', VINO], ['mercier', VINO], ['baron b', VINO],
  ['clos de los (?:7|siete)', VINO], ['monteviejo', VINO], ['cuvelier', VINO], ['diamandes', VINO],
  ['michel rolland', VINO], ['leoncio arizu', VINO], ['valmont', VINO], ['catena', VINO],
  ['escorihuela', VINO], ['alamos', VINO], ['el enemigo', VINO], ['luigi bosca', VINO],
  ['saint felicien', VINO], ['san felipe', VINO], ['casa de herrero', VINO], ['cuchillo de palo', VINO],
  ['nicasia', VINO], ['altaland', VINO], ['aruma', VINO], ['ojo de buen cubero', VINO],
  ['angelica zapata', VINO], ['birth of cabernet', VINO],
].map(([texto, etiqueta, producto]) => ({
  clave: texto.split('|')[0].replace(/[^a-z0-9 ]/g, ''),
  enTexto: new RegExp(`\\b(?:${texto})\\b`),
  enProducto: new RegExp(`\\b(?:${producto || texto})\\b`),
  etiqueta,
}));
// Marca propia de Carrefour ("no incluye productos Carrefour de alimentos, lácteos, …"): la detecta
// promos-bancarias.js por esa frase puntual (nunca por la palabra suelta, que está en todos los
// legales de Carrefour); cualquier categoría.
MARCAS.push({ clave: 'carrefour', enTexto: /(?!)/, enProducto: /\bcarrefour\b/, etiqueta: null });
const MARCA_POR_CLAVE = new Map(MARCAS.map(m => [m.clave, m]));

// ─── Cálculo ──────────────────────────────────────────────────────────────────

/** ¿La promo tiene alguna restricción por producto (categoría, marca u oferta)? */
function promoRestringeProductos(promo) {
  return !!(promo.soloSinOferta || promo.categoriasIncluidas || promo.categoriasExcluidas || promo.marcasExcluidas);
}

/**
 * ¿Esta fila del carrito cuenta para la base de la promo?
 * linea: { sinOferta?: boolean (false = tiene promo de producto), categorias?: string[]|null,
 *          nombre?: string }
 */
function lineaCumplePromo(promo, linea) {
  if (promo.soloSinOferta && linea.sinOferta === false) return false;
  const cats = linea.categorias;
  if (promo.categoriasIncluidas) {
    if (!cats || !promo.categoriasIncluidas.some(c => cats.includes(c))) return false;
  }
  if (promo.categoriasExcluidas && cats && promo.categoriasExcluidas.some(c => cats.includes(c))) return false;
  if (promo.marcasExcluidas && linea.nombre) {
    const nombre = normalizar(linea.nombre).replace(/[^a-z0-9]+/g, ' '); // "Coca-Cola" → "coca cola"
    for (const clave of promo.marcasExcluidas) {
      const marca = MARCA_POR_CLAVE.get(clave);
      if (marca && marca.enProducto.test(nombre) && (!marca.etiqueta || !cats || cats.includes(marca.etiqueta))) return false;
    }
  }
  return true;
}

/** "galletitas, golosinas y cervezas" (para "solo en …" en la app). */
function textoCategorias(etiquetas) {
  const textos = Object.keys(VOCABULARIO).filter(k => (etiquetas || []).includes(k)).map(k => VOCABULARIO[k]);
  if (textos.length <= 1) return textos.join('');
  return `${textos.slice(0, -1).join(', ')} y ${textos[textos.length - 1]}`;
}

module.exports = {
  VOCABULARIO,
  MARCAS,
  TERMINOS_EXCLUSION,
  categoriasDeProducto,
  parsearListaCategorias,
  lineaCumplePromo,
  promoRestringeProductos,
  textoCategorias,
  normalizar,
};
