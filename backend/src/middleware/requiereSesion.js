/**
 * Verifica el JWT de sesión de Supabase que manda la app en el header
 * `Authorization: Bearer <token>`. Este proyecto firma sus tokens con clave asimétrica
 * (ES256, confirmado 2026-08-21 decodificando un token real — no con el secreto compartido
 * HS256 legado que se había asumido al principio). Se valida contra el JWKS público del
 * proyecto (`jose.createRemoteJWKSet`, que cachea las claves — no hay un llamado a la red de
 * Supabase en cada request, solo cuando cambia el `kid` o vence el cache), a diferencia de
 * `supabase.auth.getUser(token)`, que sí pega contra su API cada vez que se usa.
 */

const { createRemoteJWKSet, jwtVerify } = require('jose');
const { supabaseUrl } = require('../config');

const JWKS = supabaseUrl
  ? createRemoteJWKSet(new URL('/auth/v1/.well-known/jwks.json', supabaseUrl))
  : null;

async function requiereSesion(req, res, next) {
  if (!JWKS) {
    return res.status(503).json({ error: 'Sesión todavía no configurada (falta SUPABASE_URL)' });
  }

  const header = req.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : null;
  if (!token) {
    return res.status(401).json({ error: 'Falta la sesión (header Authorization: Bearer <token>)' });
  }

  try {
    const { payload } = await jwtVerify(token, JWKS, { audience: 'authenticated' });
    req.usuarioId = payload.sub;
    req.usuarioEmail = payload.email ?? null;
    // Viene del Auth Hook (ver supabase/migrations/0006_auth_hook_plan_en_jwt.sql) — ningún
    // chequeo de plan existe todavía en el Express (fase 2 solo deja lista la mecánica).
    req.usuarioPlan = payload.plan ?? null;
    next();
  } catch {
    res.status(401).json({ error: 'Sesión inválida o vencida' });
  }
}

module.exports = { requiereSesion };
