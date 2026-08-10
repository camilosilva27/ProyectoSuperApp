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

const router = express.Router();

router.get('/catalogo/buscar', (req, res) => {
  const { q = '', categoria = '', limit, offset } = req.query;

  if (!q && !categoria) {
    return res.status(400).json({ error: 'Falta el parametro q (texto) o categoria' });
  }

  const resultado = catalogoUnificado.buscar({ q, categoria, limit, offset });

  if (!resultado.disponible) {
    return res.status(503).json({
      error: 'El catalogo unificado no esta generado todavia. Corre: npm run unificar',
    });
  }

  res.json(resultado);
});

router.get('/catalogo/categorias', (req, res) => {
  const resultado = catalogoUnificado.categorias();
  if (!resultado.disponible) {
    return res.status(503).json({
      error: 'El catalogo unificado no esta generado todavia. Corre: npm run unificar',
    });
  }
  res.json(resultado);
});

router.get('/catalogo/producto/:ean', (req, res) => {
  const producto = catalogoUnificado.porEAN(req.params.ean);
  if (!producto) return res.status(404).json({ error: 'EAN no encontrado en el catalogo local' });
  // skuIdVea e imagenUrl son detalles internos (ver core/catalogoUnificado.js).
  const { skuIdVea, imagenUrl, imagenArchivo, ...publico } = producto;
  res.json(publico);
});

module.exports = router;
