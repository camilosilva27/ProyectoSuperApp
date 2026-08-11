/**
 * Descarga y guarda en disco, UNA SOLA VEZ por EAN, la foto de producto que ya viene en la
 * misma respuesta que usamos para precio (`items[].images[].imageUrl`) — no hace falta
 * scrapear nada nuevo, el dato ya está en catalogo-{vea,carrefour,changomas,dia,coto}.json una
 * vez que los scrapers lo capturan (ver el campo `imagenUrl` que agregan).
 *
 * "Para siempre" es la decisión explícita acá: si `backend/imagenes/<ean>.<ext>` ya existe,
 * NUNCA se vuelve a descargar, ni siquiera si el cron diario corre de nuevo — la foto de un
 * producto no cambia día a día, y no tiene sentido depender de que el CDN del super siga
 * respondiendo esa URL cada vez que alguien abre la app. Si en algún momento hace falta
 * refrescar una imagen puntual (ej. el super la cambió), hay que borrar el archivo a mano;
 * no hay lógica de "vencimiento" para fotos.
 *
 * Se descarga en 300x300, no el tamaño original — Vea, Carrefour, Chango Más y Día corren
 * sobre VTEX, y su CDN soporta pedir un tamaño puntual insertando `-ancho-alto` en la URL
 * (confirmado en vivo el 2026-08-10 contra esos 4: Vea 7.4x más chica, Carrefour ~20x, Chango
 * Más ~8.4x). Coto no es VTEX y su URL no matchea ese patrón — `conTamano()` la deja sin
 * tocar en ese caso (ver el fallback ahí abajo), así que sus fotos se bajan en el tamaño
 * original. La app nunca muestra la foto a más de ~44px, así que servir el original (hasta
 * 1000x1000, algunos de Carrefour pesan 350KB+) sería bajar datos que se tiran al achicarla en
 * el cliente. 300x300 deja margen para una futura pantalla de "ver foto grande" sin verse
 * claramente pixelada, a cambio de solo ~4x menos ahorro que ir directo a 150x150.
 */

const fs = require('fs');
const path = require('path');
const { rutaImagenes } = require('../config');

const EXTENSION_POR_CONTENT_TYPE = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

const LADO_THUMBNAIL = 300;

/**
 * Inserta `-ancho-alto` en la URL de VTEX para pedir esa versión redimensionada en vez del
 * original: `.../arquivos/ids/852564/foo.jpg` → `.../arquivos/ids/852564-300-300/foo.jpg`.
 * Si la URL no matchea el patrón esperado (por si algún día cambia el formato de origen),
 * devuelve la URL sin tocar — mejor bajar la original de más que romper la descarga.
 */
function conTamano(url, lado = LADO_THUMBNAIL) {
  return url.replace(/\/arquivos\/ids\/(\d+)\//, `/arquivos/ids/$1-${lado}-${lado}/`);
}

/** Si ya hay un archivo `<ean>.*` en disco, devuelve su extensión (sin el punto). */
function extensionGuardada(ean, indiceArchivos) {
  const archivo = indiceArchivos.get(ean);
  return archivo ? archivo.slice(archivo.lastIndexOf('.') + 1) : null;
}

function indexarArchivosExistentes() {
  fs.mkdirSync(rutaImagenes, { recursive: true });
  const indice = new Map(); // ean → nombre de archivo
  for (const archivo of fs.readdirSync(rutaImagenes)) {
    const ean = archivo.slice(0, archivo.lastIndexOf('.'));
    if (ean) indice.set(ean, archivo);
  }
  return indice;
}

async function descargarUna(ean, url) {
  const res = await fetch(conTamano(url));
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const contentType = (res.headers.get('content-type') || '').split(';')[0].trim();
  const ext = EXTENSION_POR_CONTENT_TYPE[contentType] || 'jpg';
  const buffer = Buffer.from(await res.arrayBuffer());
  if (!buffer.length) throw new Error('respuesta vacía');
  const archivo = `${ean}.${ext}`;
  fs.writeFileSync(path.join(rutaImagenes, archivo), buffer);
  return archivo;
}

/**
 * @param productos [{ ean, imagenUrl }] — imagenUrl es la URL de origen (VTEX), puede ser null
 * @returns { intentadas, descargadas, fallidas, yaExistian } + muta `productos` agregando
 *          `imagenArchivo` (nombre del archivo local, o null) a cada uno.
 */
async function descargarFaltantes(productos, { concurrencia = 8 } = {}) {
  const indice = indexarArchivosExistentes();

  let yaExistian = 0;
  const pendientes = [];
  for (const p of productos) {
    const existente = extensionGuardada(p.ean, indice);
    if (existente) {
      p.imagenArchivo = `${p.ean}.${existente}`;
      yaExistian++;
    } else if (p.imagenUrl) {
      pendientes.push(p);
    } else {
      p.imagenArchivo = null;
    }
  }

  let descargadas = 0;
  let fallidas = 0;
  let cursor = 0;
  const trabajadores = Array.from({ length: Math.min(concurrencia, pendientes.length) }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= pendientes.length) return;
      const p = pendientes[i];
      try {
        p.imagenArchivo = await descargarUna(p.ean, p.imagenUrl);
        descargadas++;
      } catch {
        // Si falla (404, super caído, formato raro), no se reintenta en esta misma corrida —
        // el próximo refresco de catálogo lo va a volver a intentar porque nunca se guardó
        // el archivo. No hace falta backoff especial: el volumen de fallos esperado es bajo.
        p.imagenArchivo = null;
        fallidas++;
      }
    }
  });
  await Promise.all(trabajadores);

  return { intentadas: pendientes.length, descargadas, fallidas, yaExistian };
}

module.exports = { descargarFaltantes, conTamano };
