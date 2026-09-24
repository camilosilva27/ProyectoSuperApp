/**
 * `perfil_usuario` no tiene mail ni último login — eso vive en `auth.users`, que no es una
 * tabla consultable por PostgREST (no está expuesta), así que hay que pasar por la Admin API
 * de GoTrue (`auth.admin.listUsers`, incluida en supabase-js con la service role key). Paginada
 * (50 por página por default) — se recorre entera porque los crons de mail necesitan la lista
 * completa de usuarios, no una página.
 *
 * Incluye `emailConfirmado` porque los crons de mail deben excluir a quien nunca confirmó el
 * mail — bug real encontrado el 2026-09-14: `perfil_usuario` se crea en el INSERT de
 * `auth.users` (antes de la confirmación), así que sin este chequeo una cuenta sin confirmar
 * podía recibir mails igual si cumplía la demás elegibilidad de cada cron.
 */

async function listarTodosLosUsuarios(clienteAdmin) {
  const usuarios = [];
  let pagina = 1;
  // Tope de seguridad: nunca debería hacer falta, pero evita un loop infinito si la API
  // cambiara su forma de indicar "no hay más páginas".
  const TOPE_PAGINAS = 1000;

  while (pagina <= TOPE_PAGINAS) {
    const { data, error } = await clienteAdmin.auth.admin.listUsers({ page: pagina, perPage: 200 });
    if (error) throw new Error(`listUsers falló (página ${pagina}): ${error.message}`);

    for (const u of data.users) {
      usuarios.push({
        id: u.id,
        email: u.email,
        ultimoLogin: u.last_sign_in_at,
        emailConfirmado: Boolean(u.email_confirmed_at),
      });
    }

    if (data.users.length < 200) break;
    pagina++;
  }

  return usuarios;
}

/**
 * ¿El usuario tiene la app habilitada ahora mismo? Mismo criterio que el cliente
 * (GatePaywallFinTrial.tsx): premium, o trial cuyo `trial_termina_en` todavía no pasó (o es
 * null, igual que en el cliente). NO se confía solo en `plan`: el downgrade trial → gratis
 * (`bajar_planes_vencidos`, pg_cron diario 3:00 UTC) puede tardar hasta 24hs, y en ese hueco
 * `plan` sigue diciendo 'trial' con el trial ya vencido.
 *
 * Nació en la auditoría 2026-09-24: Alertas e inactividad le mandaban avisos a usuarios en
 * 'gratis' / trial vencido, que no pueden usar la app sin pagar (paywall sin plan gratis).
 *
 * @param {{plan?: string|null, trial_termina_en?: string|null}|undefined} perfil - fila de perfil_usuario.
 * @param {number} [ahora] - ms epoch (inyectable para tests).
 */
function tienePlanActivo(perfil, ahora = Date.now()) {
  if (!perfil) return false;
  if (perfil.plan === 'premium') return true;
  if (perfil.plan !== 'trial') return false;
  if (!perfil.trial_termina_en) return true;
  return new Date(perfil.trial_termina_en).getTime() > ahora;
}

/**
 * Lee TODAS las filas de un select de PostgREST paginando con `.range()` — PostgREST corta cada
 * respuesta en 1000 filas (max-rows de Supabase) SIN avisar, así que un `select()` suelto sobre
 * perfil_usuario / ahorro_registro / producto_seguido dejaba afuera en silencio a todo lo que
 * pasara de la fila 1000 (auditoría 2026-09-24). Vive acá, junto a `listarTodosLosUsuarios`,
 * porque es el mismo problema ("los crons necesitan la lista completa, no una página").
 *
 * @param {() => object} armarQuery - devuelve un query builder NUEVO en cada llamada, con un
 *   `.order()` por una columna única (sin orden estable, la paginación puede repetir/saltear filas).
 * @returns {Promise<{data: Array, error: object|null}>} misma forma que un select de supabase-js.
 */
async function leerTodasLasFilas(armarQuery, tamanioPagina = 1000) {
  const filas = [];
  // Tope de seguridad contra un loop infinito (1000 páginas × 1000 filas = 1M filas).
  for (let pagina = 0; pagina < 1000; pagina++) {
    const desde = pagina * tamanioPagina;
    const { data, error } = await armarQuery().range(desde, desde + tamanioPagina - 1);
    if (error) return { data: null, error };
    filas.push(...(data ?? []));
    if (!data || data.length < tamanioPagina) break;
  }
  return { data: filas, error: null };
}

module.exports = { listarTodosLosUsuarios, tienePlanActivo, leerTodasLasFilas };
