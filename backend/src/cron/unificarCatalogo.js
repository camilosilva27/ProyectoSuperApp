/**
 * Genera backend/catalogo-unificado.json: el índice de productos que alimenta la vista de
 * selección de la app (buscar y tocar, en vez de escribir el nombre a mano).
 *
 * Combina los catálogos locales deduplicando por EAN. El orden de prioridad para el
 * nombre canónico es Vea → Carrefour → Chango Más → Día → Coto (el mismo que ya usa
 * resolverEANporNombre() en AllPromos/core/catalogo.js, para que un producto se llame igual
 * en la app y en el CLI) y por último La Anónima, que solo aporta nombre/disponibilidad
 * cuando ningún otro super ya trajo ese EAN (no tiene EAN propio — ver unificarCatalogo.js
 * FUENTES y AllPromos/enriquecer-catalogo-laanonima.js).
 *
 * IMPORTANTE — los campos de precio se excluyen a propósito. Los catalogo-*.json traen
 * `precioBase`/`precioActual`/`promocion`/`descuentoDirecto` de la fecha del scraping, que
 * puede ser de hace semanas. Mostrarlos en la app sería mostrar un precio viejo como si
 * fuera vigente, y rompería el invariante de AllPromos/CLAUDE.md ("los precios NUNCA salen
 * del catálogo local"). La app pide precios en vivo vía POST /api/comparar.
 *
 * Las fotos de producto son la excepción a "todo se pide en vivo": una vez descargadas (ver
 * descargarImagenes.js) se sirven siempre desde disco propio — no tiene el mismo problema de
 * frescura que el precio, así que no hace falta pedirlas de nuevo cada vez.
 *
 * Uso: node src/cron/unificarCatalogo.js   (o npm run unificar)
 */

const fs = require('fs');
const path = require('path');
const { leerCatalogo } = require('../../../AllPromos/core/catalogo');
const { rutaCatalogoUnificado } = require('../config');
const { descargarFaltantes } = require('./descargarImagenes');

// archivo del catálogo local → key de super usada en SUPERMERCADOS (core/fetchers.js).
// Se usan esas keys y no los nombres de archivo para que `disponibleEn` sea directamente
// comparable con las respuestas de /api/comparar.
const FUENTES = [
  { key: 'vea',       archivo: 'catalogo-vea.json' },
  { key: 'carr',      archivo: 'catalogo-carrefour.json' },
  { key: 'changomas', archivo: 'catalogo-changomas.json' },
  { key: 'dia',       archivo: 'catalogo-dia.json' },
  { key: 'coto',      archivo: 'catalogo-coto.json' },
  // Prioridad más baja a propósito: La Anónima no tiene EAN propio, el que trae acá es un
  // best-effort asignado por enriquecer-catalogo-laanonima.js contra los otros 5 (ver su
  // cabecera) — si el mismo EAN ya apareció en un super de mayor prioridad, ese nombre gana.
  { key: 'laanonima', archivo: 'catalogo-laanonima.json' },
];

function construirCatalogoUnificado() {
  const porEAN = new Map(); // ean → producto unificado
  const fuentes = [];

  for (const { key, archivo } of FUENTES) {
    const data = leerCatalogo(archivo);
    if (!data) {
      fuentes.push({ key, archivo, fecha: null, totalSkus: 0, disponible: false });
      continue;
    }
    const skus = Array.isArray(data.skus) ? data.skus : [];
    fuentes.push({ key, archivo, fecha: data.fecha ?? null, totalSkus: skus.length, disponible: true });

    for (const s of skus) {
      if (!s.ean) continue;

      const existente = porEAN.get(s.ean);
      if (existente) {
        // Ya lo vimos en un super de mayor prioridad: solo sumamos disponibilidad y,
        // si este super es Vea, el skuId (que Vea necesita para consultar precio).
        if (!existente.disponibleEn.includes(key)) existente.disponibleEn.push(key);
        if (key === 'vea' && s.skuId && !existente.skuIdVea) existente.skuIdVea = s.skuId;
        // Si el super de mayor prioridad no tenía foto (algunos SKUs vienen sin `images`),
        // se acepta la de un super de menor prioridad antes que no tener ninguna.
        if (!existente.imagenUrl && s.imagenUrl) existente.imagenUrl = s.imagenUrl;
        continue;
      }

      porEAN.set(s.ean, {
        ean: s.ean,
        nombre: s.productName || s.skuName || s.nombre || '(sin nombre)',
        // Solo cuando aporta información extra respecto del nombre (evita duplicar texto
        // en la lista de la app, que es donde más pesa el ruido visual).
        variante: s.skuName && s.skuName !== s.productName ? s.skuName : null,
        categoria: s.categoria || null,
        skuIdVea: key === 'vea' ? (s.skuId ?? null) : null,
        disponibleEn: [key],
        // URL de origen (VTEX) — interna, solo para descargarImagenes.js. El campo público
        // que ve la app es `imagen` (ver unificar()), la ruta local una vez descargada.
        imagenUrl: s.imagenUrl || null,
      });
    }
  }

  const productos = [...porEAN.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));

  return {
    generado: new Date().toISOString(),
    fuentes,
    total: productos.length,
    productos,
  };
}

/**
 * Escritura atómica: se escribe a .tmp y se renombra. `rename` es atómico en el mismo
 * filesystem, así que /api/catalogo/buscar nunca puede leer un JSON a medio escribir
 * mientras el cron lo regenera.
 */
function escribirAtomico(ruta, contenido) {
  const tmp = `${ruta}.tmp`;
  fs.mkdirSync(path.dirname(ruta), { recursive: true });
  fs.writeFileSync(tmp, contenido);
  fs.renameSync(tmp, ruta);
}

async function unificar({ silencioso = false } = {}) {
  const catalogo = construirCatalogoUnificado();

  // Descarga solo lo que falte (ver descargarImagenes.js — nunca re-descarga lo que ya
  // está en disco). Muta cada producto agregando `imagenArchivo`.
  const fotos = await descargarFaltantes(catalogo.productos);
  for (const p of catalogo.productos) {
    p.imagen = p.imagenArchivo ? `/imagenes/${p.imagenArchivo}` : null;
  }
  catalogo.fotos = fotos;

  escribirAtomico(rutaCatalogoUnificado, JSON.stringify(catalogo));

  if (!silencioso) {
    console.log(`✅ catalogo-unificado.json generado: ${catalogo.total} productos únicos por EAN`);
    for (const f of catalogo.fuentes) {
      const estado = f.disponible ? `${f.totalSkus} SKUs (${f.fecha?.slice(0, 10) ?? 'sin fecha'})` : 'NO DISPONIBLE';
      console.log(`   • ${f.archivo}: ${estado}`);
    }
    const sinVea = catalogo.productos.filter(p => !p.skuIdVea && p.disponibleEn.includes('vea')).length;
    if (sinVea) console.log(`   ⚠️  ${sinVea} productos de Vea sin skuId (se consultarán por EAN, menos fiable)`);
    console.log(`   📷 Fotos: ${fotos.yaExistian} ya en disco, ${fotos.descargadas} nuevas, ${fotos.fallidas} fallidas`);
  }

  return catalogo;
}

if (require.main === module) {
  unificar().catch(err => {
    console.error('❌ Error generando el catálogo unificado:', err.message);
    process.exit(1);
  });
}

module.exports = { unificar, construirCatalogoUnificado };
