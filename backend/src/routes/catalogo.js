/**
 * Catálogo para la vista de selección de productos de la app.
 *
 * Estos endpoints NO devuelven precios: el catálogo local es una foto de la fecha del
 * scraping y mostrar esos precios sería mostrar datos viejos como vigentes. El precio se
 * pide aparte, en vivo, con POST /api/comparar.
 *
 * Que el usuario elija de una lista (en vez de escribir texto) es lo que elimina la
 * ambigüedad de nombre que el CLI tiene que resolver preguntando: acá cada resultado ya
 * viene con su EAN exacto.
 */

const express = require('express');
const catalogoUnificado = require('../catalogoUnificado');
const { SUPERMERCADOS } = require('../../../AllPromos/core/fetchers');
const { requiereSesion, requierePlanActivo } = require('../middleware/requiereSesion');
const { elegirProductosTour } = require('../precioCache');

const router = express.Router();
const KEYS_SUPERMERCADOS = new Set(SUPERMERCADOS.map(s => s.key));
const ORDENES_VALIDOS = new Set(['alfabetico', 'disponibilidad']);

router.get('/catalogo/buscar', requiereSesion, requierePlanActivo, (req, res) => {
  const { q = '', categoria = '', supers: supersCrudo = '', orden = 'alfabetico', limit, offset } = req.query;

  if (!q && !categoria) {
    return res.status(400).json({ error: 'Falta el parametro q (texto) o categoria' });
  }
  const supers = supersCrudo
    ? String(supersCrudo).split(',').map(s => s.trim()).filter(Boolean)
    : [];
  for (const s of supers) {
    if (!KEYS_SUPERMERCADOS.has(s)) return res.status(400).json({ error: `super invalido: ${s}` });
  }
  if (!ORDENES_VALIDOS.has(orden)) {
    return res.status(400).json({ error: `orden invalido: ${orden}` });
  }

  const resultado = catalogoUnificado.buscar({ q, categoria, supers, orden, limit, offset });

  if (!resultado.disponible) {
    return res.status(503).json({
      error: 'El catalogo unificado no esta generado todavia. Corre: npm run unificar',
    });
  }

  res.json(resultado);
});

router.get('/catalogo/categorias', requiereSesion, requierePlanActivo, (req, res) => {
  const resultado = catalogoUnificado.categorias();
  if (!resultado.disponible) {
    return res.status(503).json({
      error: 'El catalogo unificado no esta generado todavia. Corre: npm run unificar',
    });
  }
  res.json(resultado);
});

router.get('/catalogo/producto/:ean', requiereSesion, requierePlanActivo, (req, res) => {
  const producto = catalogoUnificado.porEAN(req.params.ean);
  if (!producto) return res.status(404).json({ error: 'EAN no encontrado en el catalogo local' });
  // skuIdVea e imagenUrl son detalles internos (ver core/catalogoUnificado.js).
  const { skuIdVea, imagenUrl, imagenArchivo, ...publico } = producto;
  res.json(publico);
});

/**
 * Productos para precargar el carrito del tour interactivo (ver app/src/tour/precarga.ts):
 * elegidos entre Vea/Carrefour/Coto por precio real y diferencia/descuento (ver
 * elegirProductosTour en precioCache.js). Devuelve la misma forma pública que
 * /catalogo/producto/:ean, ya lista para carrito.agregar() en la app.
 */
router.get('/catalogo/tour-sugeridos', requiereSesion, requierePlanActivo, (req, res) => {
  const productos = elegirProductosTour()
    .map(({ ean }) => catalogoUnificado.porEAN(ean))
    .filter(Boolean)
    .map(({ skuIdVea, imagenUrl, imagenArchivo, ...publico }) => publico);
  res.json({ productos });
});

module.exports = router;
