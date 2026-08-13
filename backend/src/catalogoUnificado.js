/**
 * Acceso en memoria al catálogo unificado, con búsqueda por texto y por categoría.
 *
 * El archivo se carga una vez y se revalida por mtime, así el cron puede regenerarlo sin
 * reiniciar el server. La búsqueda reusa matchesBusqueda/palabrasDeBusqueda de
 * AllPromos/core/catalogo.js a propósito: así "357g" matchea "357 Gr" igual que en el CLI
 * y el usuario no encuentra resultados distintos según por dónde entre.
 *
 * A este volumen (~5-7k productos) un filtro lineal en memoria sobra; no hace falta un
 * motor de búsqueda ni un índice invertido.
 */

const fs = require('fs');
const {
  normalize, matchesBusqueda, palabrasDeBusqueda,
} = require('../../AllPromos/core/catalogo');
const { rutaCatalogoUnificado, limiteBusquedaDefault, limiteBusquedaMaximo } = require('./config');

let cache = null; // { mtimeMs, catalogo, indice }

function cargar() {
  let stat;
  try {
    stat = fs.statSync(rutaCatalogoUnificado);
  } catch {
    cache = null;
    return null;
  }

  if (cache && cache.mtimeMs === stat.mtimeMs) return cache;

  const catalogo = JSON.parse(fs.readFileSync(rutaCatalogoUnificado, 'utf8'));
  // Se precalcula el texto normalizado de búsqueda una vez por carga, no por request.
  const indice = catalogo.productos.map(p => ({
    producto: p,
    haystackNombre: p.nombre,
    haystackVariante: p.variante || '',
    categoriaNorm: p.categoria ? normalize(p.categoria) : '',
  }));

  cache = { mtimeMs: stat.mtimeMs, catalogo, indice };
  return cache;
}

function leerEstadoUnificado() {
  const c = cargar();
  if (!c) return { disponible: false, total: 0, generado: null, fuentes: [] };
  return {
    disponible: true,
    total: c.catalogo.total,
    generado: c.catalogo.generado,
    fuentes: c.catalogo.fuentes,
  };
}

/**
 * Busca productos por texto libre y/o categoría, con filtro opcional por uno o más
 * supermercados y orden opcional.
 * @param {string[]} supers si viene con elementos, solo entran productos disponibles en al
 *   menos uno de esos supers (vacío = sin filtro, entran los 5).
 * @param {string} orden 'alfabetico' (default — es el orden en que ya vienen guardados los
 *   productos, ver unificarCatalogo.js) o 'disponibilidad' (más supers primero; empate
 *   preserva el orden alfabético porque Array#sort de Node es estable).
 * @returns { total, resultados: [{ ean, nombre, variante, categoria, disponibleEn }] }
 */
function buscar({
  q = '', categoria = '', supers = [], orden = 'alfabetico', limit = limiteBusquedaDefault, offset = 0,
} = {}) {
  const c = cargar();
  if (!c) return { total: 0, resultados: [], disponible: false };

  const palabras = q ? palabrasDeBusqueda(q) : [];
  const categoriaNorm = categoria ? normalize(categoria) : '';
  const supersFiltro = supers.length ? new Set(supers) : null;

  const coincidencias = [];
  for (const entrada of c.indice) {
    if (categoriaNorm && !entrada.categoriaNorm.startsWith(categoriaNorm)) continue;
    if (supersFiltro && !entrada.producto.disponibleEn.some(k => supersFiltro.has(k))) continue;
    if (palabras.length && !matchesBusqueda(entrada.haystackNombre, entrada.haystackVariante, palabras)) continue;
    coincidencias.push(entrada.producto);
  }

  if (orden === 'disponibilidad') {
    coincidencias.sort((a, b) => b.disponibleEn.length - a.disponibleEn.length);
  }

  const tope = Math.min(Math.max(1, Number(limit) || limiteBusquedaDefault), limiteBusquedaMaximo);
  const desde = Math.max(0, Number(offset) || 0);

  return {
    disponible: true,
    total: coincidencias.length,
    resultados: coincidencias.slice(desde, desde + tope).map(sinCamposInternos),
  };
}

/**
 * El skuId de Vea y la URL de origen de la foto (VTEX) son detalles de implementación del
 * backend: la app no los necesita. `imagen` es la ruta ya local (`/imagenes/<ean>.<ext>`) —
 * null si el producto no tiene foto o todavía no se descargó.
 */
function sinCamposInternos(p) {
  return {
    ean: p.ean,
    nombre: p.nombre,
    variante: p.variante,
    categoria: p.categoria,
    disponibleEn: p.disponibleEn,
    imagen: p.imagen ?? null,
  };
}

/** Producto completo (incluye skuIdVea) — uso interno del backend para consultar precios. */
function porEAN(ean) {
  const c = cargar();
  if (!c) return null;
  return c.catalogo.productos.find(p => p.ean === ean) || null;
}

/**
 * Árbol de categorías. Las categorías vienen como "Almacén > Bebidas > Gaseosas";
 * se devuelven agrupadas por el primer nivel para que la app pueda ofrecer navegación
 * por rubro sin tener que parsear strings.
 */
function categorias() {
  const c = cargar();
  if (!c) return { disponible: false, categorias: [] };

  const porRaiz = new Map();
  for (const p of c.catalogo.productos) {
    if (!p.categoria) continue;
    const partes = p.categoria.split('>').map(s => s.trim()).filter(Boolean);
    if (!partes.length) continue;
    const raiz = partes[0];
    if (!porRaiz.has(raiz)) porRaiz.set(raiz, { nombre: raiz, cantidad: 0, subcategorias: new Map() });
    const nodo = porRaiz.get(raiz);
    nodo.cantidad++;
    if (partes[1]) {
      nodo.subcategorias.set(partes[1], (nodo.subcategorias.get(partes[1]) || 0) + 1);
    }
  }

  const resultado = [...porRaiz.values()]
    .map(n => ({
      nombre: n.nombre,
      cantidad: n.cantidad,
      subcategorias: [...n.subcategorias.entries()]
        .map(([nombre, cantidad]) => ({ nombre, cantidad, ruta: `${n.nombre} > ${nombre}` }))
        .sort((a, b) => b.cantidad - a.cantidad),
    }))
    .sort((a, b) => b.cantidad - a.cantidad);

  return { disponible: true, categorias: resultado };
}

module.exports = { buscar, porEAN, categorias, leerEstadoUnificado, cargar };
