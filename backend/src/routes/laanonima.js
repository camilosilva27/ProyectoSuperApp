/**
 * GET /api/laanonima/cobertura — la app lo usa para confirmar, al momento en que el usuario
 * guarda su código postal, si La Anónima tiene venta de supermercado online en esa zona (ver
 * AllPromos/core/laanonima-zona.js: es un gate binario, no selecciona precio). Sin esto, la
 * app no tendría forma de avisar "sin cobertura" antes de que el usuario actives el super.
 */

const express = require('express');
const { tieneCoberturaCacheada } = require('../../../AllPromos/core/laanonima-zona');

const router = express.Router();

router.get('/laanonima/cobertura', async (req, res) => {
  const cp = String(req.query.cp ?? '').trim();
  if (!cp) return res.status(400).json({ error: 'Falta el parametro cp' });

  const coberturaConfirmada = await tieneCoberturaCacheada(cp);
  res.json({ codigoPostal: cp, coberturaConfirmada });
});

module.exports = router;
