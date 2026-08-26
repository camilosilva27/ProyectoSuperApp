/**
 * Escritura atómica genérica: escribe a un archivo temporal y renombra sobre el destino.
 * `rename` es atómico en el mismo filesystem, así que un lector concurrente (leerCatalogo, y
 * por lo tanto el server de producción vía precioCache.js) nunca puede ver un archivo a medio
 * escribir — o ve la versión vieja completa, o la nueva completa, nunca algo intermedio.
 *
 * Mismo patrón que ya usa unificarCatalogo.js para catalogo-unificado.json. Necesario acá desde
 * que completar-*-por-ean.js y refrescar-precio-extras-*.js empezaron a reescribir
 * catalogo-X-extras.json (2026-08-26) mientras el server de producción puede estar leyéndolo al
 * mismo tiempo — antes de esto escribían con fs.writeFileSync directo.
 */
const fs = require('fs');
const path = require('path');

function escribirAtomico(ruta, contenido) {
  const tmp = `${ruta}.tmp.${process.pid}-${Math.random().toString(36).slice(2)}`;
  const dir = path.dirname(ruta);
  if (dir) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(tmp, contenido);
  fs.renameSync(tmp, ruta);
}

module.exports = { escribirAtomico };
