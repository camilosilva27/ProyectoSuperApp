/**
 * Referidos (.claude/docs/PLAN_REFERIDOS.md, lógica en src/referidos.js):
 * - GET  /api/referidos          → código, link, progreso, premio (pantalla de referidos).
 * - POST /api/referidos/asociar  → { codigo }: la app lo llama una vez, ya con sesión, si la
 *   usuaria llegó con ?ref=. Siempre responde 200 con un `resultado` (asociada, ya_asociada,
 *   codigo_invalido, ...): la app solo necesita saber que puede olvidar el código guardado.
 *
 * Solo `requiereSesion`, sin `requierePlanActivo`: ninguna de las dos consulta a los supers, y el
 * estado tiene que poder leerse aunque el plan cambie justo por el premio.
 */

const express = require('express');
const { requiereSesion } = require('../middleware/requiereSesion');
const { clienteSupabaseAdmin } = require('../clienteSupabaseAdmin');
const { asociarInvitada, estadoDelUsuario } = require('../referidos');

const router = express.Router();

router.get('/referidos', requiereSesion, async (req, res) => {
  const cliente = clienteSupabaseAdmin();
  if (!cliente) return res.status(503).json({ error: 'Referidos no disponibles (falta configurar Supabase)' });
  const estado = await estadoDelUsuario(cliente, req.usuarioId);
  if (!estado) return res.status(404).json({ error: 'No se encontró el perfil del usuario' });
  res.json(estado);
});

router.post('/referidos/asociar', requiereSesion, async (req, res) => {
  const cliente = clienteSupabaseAdmin();
  if (!cliente) return res.status(503).json({ error: 'Referidos no disponibles (falta configurar Supabase)' });
  const codigo = req.body?.codigo;
  if (typeof codigo !== 'string' || codigo.length > 32) {
    return res.status(400).json({ error: 'Falta codigo: string' });
  }
  res.json(await asociarInvitada(cliente, { invitadaId: req.usuarioId, codigo }));
});

module.exports = router;
