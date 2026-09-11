/**
 * Estado de promo EN VIVO para productos que el usuario sigue (pantalla Alertas, ver
 * .claude/docs/ALERTAS-notificaciones-plan.md). Reusa la misma función que arma el contenido
 * del mail/push de "promo nueva" (`estadoPromoPorEan` en cron/diffCatalogos.js) para no tener
 * una segunda fuente de verdad del % de descuento — es el mismo cálculo, solo expuesto acá
 * para que el frontend (que no puede leer los catalogo-*.json del disco del backend) lo
 * consulte bajo demanda al abrir la pantalla, en vez de esperar al próximo cron.
 *
 * A diferencia de /api/comparar y /api/precios, esto NO pide nada en vivo a los supers: solo
 * lee los catalogo-*.json ya cacheados en disco (igual que refrescarCatalogos.js), así que no
 * hace falta el rate limit más estricto que protege a esos dos endpoints.
 */

const express = require('express');
const path = require('path');
const { requiereSesion, requierePlanActivo } = require('../middleware/requiereSesion');
const { leerJSON, estadoPromoPorEan } = require('../cron/diffCatalogos');

const router = express.Router();

const DIR_ALLPROMOS = path.join(__dirname, '..', '..', '..', 'AllPromos');

// Mismo orden que SCRAPERS en refrescarCatalogos.js: si un EAN tiene promo en más de un super,
// gana el primero de esta lista.
const CATALOGOS = [
  { nombre: 'Vea', archivo: 'catalogo-vea.json' },
  { nombre: 'Carrefour', archivo: 'catalogo-carrefour.json' },
  { nombre: 'Chango Más', archivo: 'catalogo-changomas.json' },
  { nombre: 'Día', archivo: 'catalogo-dia.json' },
  { nombre: 'Jumbo', archivo: 'catalogo-jumbo.json' },
  { nombre: 'Disco', archivo: 'catalogo-disco.json' },
  { nombre: 'Coto', archivo: 'catalogo-coto.json' },
];

// Mismo tope que TOPE_PRODUCTOS_SEGUIDOS en app/src/alertas.ts — nunca hace falta pedir más de
// eso en un solo pedido.
const MAX_EANS = 20;

router.post('/productos-seguidos/estado', requiereSesion, requierePlanActivo, (req, res) => {
  const { eans } = req.body ?? {};
  if (!Array.isArray(eans) || eans.length === 0) {
    return res.status(400).json({ error: 'Falta eans (array no vacio)' });
  }
  if (eans.length > MAX_EANS) {
    return res.status(400).json({ error: `Maximo ${MAX_EANS} EAN por pedido` });
  }

  const estadoPorEan = new Map();
  for (const { nombre, archivo } of CATALOGOS) {
    const catalogo = leerJSON(path.join(DIR_ALLPROMOS, archivo));
    for (const [ean, estado] of estadoPromoPorEan(catalogo, nombre)) {
      if (!estadoPorEan.has(ean)) estadoPorEan.set(ean, estado);
    }
  }

  const resultados = eans.map(ean => {
    const estado = estadoPorEan.get(String(ean));
    return {
      ean,
      enPromo: !!estado,
      descuentoPct: estado?.descuentoPct ?? null,
      super: estado?.super ?? null,
      precioFinal: estado?.precioFinal ?? null,
    };
  });

  res.json({ generado: new Date().toISOString(), resultados });
});

module.exports = router;
