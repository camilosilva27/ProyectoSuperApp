/**
 * Configuración del backend. Todo lo sensible o dependiente del entorno vive en .env
 * (ver .env.example) — nada de secretos hardcodeados acá.
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const RAIZ_BACKEND = path.join(__dirname, '..');

module.exports = {
  puerto: Number(process.env.PORT) || 3000,
  entorno: process.env.NODE_ENV || 'development',
  rutaCatalogoUnificado: path.join(RAIZ_BACKEND, 'catalogo-unificado.json'),
  rutaLogs: path.join(RAIZ_BACKEND, 'logs'),
  // Fotos de producto descargadas una sola vez desde el CDN de cada super (ver
  // src/cron/descargarImagenes.js) y servidas desde acá — no se hotlinkea al super en cada
  // request de la app, ni se vuelve a descargar una imagen que ya está en disco.
  rutaImagenes: path.join(RAIZ_BACKEND, 'imagenes'),
  // Cuántos días puede tener un catálogo antes de considerarse vencido (mismo umbral que el CLI).
  diasMaximoCatalogo: 30,
  // Límite de resultados que devuelve la búsqueda de catálogo por request.
  limiteBusquedaDefault: 50,
  limiteBusquedaMaximo: 200,
  RAIZ_BACKEND,
};
