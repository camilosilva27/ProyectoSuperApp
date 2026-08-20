/**
 * GET /api/health — estado operativo del backend.
 *
 * Existe para detectar sin mirar logs los dos modos de falla silenciosa del proyecto:
 *   1. Catálogos locales vencidos (el scraper dejó de correr).
 *   2. El último refresco del cron falló (el sha256Hash de las queries GraphQL de promos
 *      bancarias quedó desactualizado, u otro error del scraper).
 * Ambos se ven igual que "no hay promos hoy" si no se reportan explícitamente.
 *
 * (Ya no aplica como causa de (2): la cookie `vtex_segment` de Vea que podía expirar se sacó
 * del código por completo el 2026-08-20 — ver CONTEXTO_TECNICO.md § "API de Vea". Si el cron
 * de Vea falla hoy, no sospechar de una cookie.)
 *
 * No requiere token: es el endpoint que se usa para verificar que el server está vivo.
 */

const fs = require('fs');
const express = require('express');
const { estadoCatalogos } = require('../../../AllPromos/core/catalogo');
const { leerEstadoUnificado } = require('../catalogoUnificado');
const precioCache = require('../precioCache');
const { diasMaximoCatalogo, horasMaximoPromosBancarias, rutaLogs, entorno } = require('../config');
const sondaEnVivo = require('../sondaEnVivo');
const { fechaGeneracionPromosBancarias } = require('../promosBancariasCache');
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
  const sonda = sondaEnVivo.estadoActual();
  const generadoPromosBancarias = fechaGeneracionPromosBancarias();
  const horasPromosBancarias = generadoPromosBancarias
    ? (Date.now() - new Date(generadoPromosBancarias).getTime()) / 3_600_000
    : null;

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
  if (sonda.error) {
    problemas.push(`Sonda en vivo no pudo correr: ${sonda.error}`);
  }
  if (sonda.resultados) {
    for (const [key, r] of Object.entries(sonda.resultados)) {
      if (!r.ok) problemas.push(`Comparación en vivo de ${r.nombre} sin resultados para el EAN de prueba (${key}) — puede estar rota`);
    }
  }
  if (!generadoPromosBancarias) {
    problemas.push('Falta logs/promos-bancarias.json — el cron todavía no lo generó, o se perdió (correlo con: npm run refrescar)');
  } else if (horasPromosBancarias > horasMaximoPromosBancarias) {
    problemas.push(`logs/promos-bancarias.json tiene ${horasPromosBancarias.toFixed(1)}hs — como estas promos son día-específicas, un cache viejo puede mostrar el día equivocado (regeneralo con: npm run refrescar)`);
  }

  res.json({
    ok: problemas.length === 0,
    entorno,
    ahora: new Date().toISOString(),
    catalogos,
    catalogoUnificado: unificado,
    // Misma fecha que ya reportan `catalogos[].vencido` arriba (es la fuente de
    // precioCache.js) — se repite acá para ver de un vistazo si /comparar y /precios están
    // sirviendo precio de hace 1 hora o de hace 3 semanas, sin tener que cruzar campos.
    cachePrecio: { fuentes: precioCache.estadoFuentes() },
    promosBancarias: { generado: generadoPromosBancarias, horas: horasPromosBancarias },
    ultimoRefresco,
    sondaEnVivo: sonda,
    problemas,
  });
});

module.exports = router;
