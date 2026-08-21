/**
 * Verifica el JWT de sesión de Supabase que manda la app en el header
 * `Authorization: Bearer <token>`. Se valida localmente contra SUPABASE_JWT_SECRET
 * (Dashboard > Project Settings > API > JWT Settings) — no hay ningún llamado a la red de
 * Supabase en cada request, a diferencia de `supabase.auth.getUser(token)`, que sí pega
 * contra su API cada vez que se usa.
 */

const jwt = require('jsonwebtoken');
const { supabaseJwtSecret } = require('../config');

function requiereSesion(req, res, next) {
  if (!supabaseJwtSecret) {
    return res.status(503).json({ error: 'Sesión todavía no configurada (falta SUPABASE_JWT_SECRET)' });
  }

  const header = req.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : null;
  if (!token) {
    return res.status(401).json({ error: 'Falta la sesión (header Authorization: Bearer <token>)' });
  }

  try {
    const payload = jwt.verify(token, supabaseJwtSecret, { audience: 'authenticated' });
    req.usuarioId = payload.sub;
    req.usuarioEmail = payload.email ?? null;
    // Viene del Auth Hook (ver supabase/migrations/0006_auth_hook_plan_en_jwt.sql) — puede
    // venir undefined en tokens emitidos antes de activar el hook en el dashboard de
    // Supabase; ningún chequeo de plan existe todavía en el Express (fase 2 solo deja lista
    // la mecánica), así que ese caso no rompe nada hoy.
    req.usuarioPlan = payload.plan ?? null;
    next();
  } catch {
    res.status(401).json({ error: 'Sesión inválida o vencida' });
  }
}

module.exports = { requiereSesion };
