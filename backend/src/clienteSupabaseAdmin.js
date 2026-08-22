/**
 * Cliente de Supabase con la service role key — bypasea RLS legítimamente porque quien
 * actúa es el propio backend (ej. el webhook de Mercado Pago), no un usuario. Nunca usar
 * esta key para nada que dependa de datos que mande un usuario sin antes validar su sesión
 * (ver requiereSesion.js) en la ruta que la invoque.
 *
 * Instanciado en lazy + singleton: si todavía no están seteadas las variables de entorno
 * (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY), devuelve null en vez de tirar el server abajo
 * al arrancar — el resto del backend (comparar, catálogo, etc.) no depende de Supabase.
 */

const { createClient } = require('@supabase/supabase-js');
const { supabaseUrl, supabaseServiceRoleKey } = require('./config');

let cliente = null;

function clienteSupabaseAdmin() {
  if (!supabaseUrl || !supabaseServiceRoleKey) return null;
  if (!cliente) {
    cliente = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return cliente;
}

module.exports = { clienteSupabaseAdmin };
