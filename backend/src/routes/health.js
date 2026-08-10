/**
 * GET /api/health — estado operativo del backend.
 *
 * Existe para detectar sin mirar logs los dos modos de falla silenciosa del proyecto:
 *   1. Catálogos locales vencidos (el scraper dejó de correr).
 *   2. El último refresco del cron falló (cookie `vtex_segment` de Vea expirada, o el
 *      sha256Hash de las queries GraphQL de promos bancarias quedó desactualizado).
 * Ambos se ven igual que "no hay promos hoy" si no se reportan explícitamente.
 *
 * No requiere token: es el endpoint que se usa para verificar que el server está vivo.
 */

const fs = require('fs');
const express = require('express');
const { estadoCatalogos } = require('../../../AllPromos/core/catalogo');
const { leerEstadoUnificado } = require('../catalogoUnificado');
const { diasMaximoCatalogo, rutaLogs, entorno } = require('../config');
const path = require('path');

const router = express.Router();

function leerUltimoRefresco() {
  try {
    return JSON.parse(fs.readFileSync(path.join(rutaLogs, 'ultimo-refresco.json'), 'utf8'));
  } catch {
    return null;
  }
}

router.get('/health', (req, res) => {
  const catalogos = estadoCatalogos({ diasMaximo: diasMaximoCatalogo });
  const unificado = leerEstadoUnificado();
  const ultimoRefresco = leerUltimoRefresco();

  const problemas = [];
  for (const c of catalogos) {
    if (!c.disponible) problemas.push(`Falta ${c.archivo} — generalo con: node ${c.scraper}`);
    else if (c.vencido) problemas.push(`${c.archivo} tiene ${c.dias} dias — regeneralo con: node ${c.scraper}`);
  }
  if (!unificado.disponible) {
    problemas.push('Falta catalogo-unificado.json — generalo con: npm run unificar');
  }
  if (ultimoRefresco?.errores?.length) {
    problemas.push(...ultimoRefresco.errores);
  }

  res.json({
    ok: problemas.length === 0,
    entorno,
    ahora: new Date().toISOString(),
    catalogos,
    catalogoUnificado: unificado,
    ultimoRefresco,
    problemas,
  });
});

module.exports = router;
