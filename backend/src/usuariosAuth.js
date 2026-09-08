/**
 * `perfil_usuario` no tiene mail ni último login — eso vive en `auth.users`, que no es una
 * tabla consultable por PostgREST (no está expuesta), así que hay que pasar por la Admin API
 * de GoTrue (`auth.admin.listUsers`, incluida en supabase-js con la service role key). Paginada
 * (50 por página por default) — se recorre entera porque los crons de mail necesitan la lista
 * completa de usuarios, no una página.
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
      usuarios.push({ id: u.id, email: u.email, ultimoLogin: u.last_sign_in_at });
    }

    if (data.users.length < 200) break;
    pagina++;
  }

  return usuarios;
}

module.exports = { listarTodosLosUsuarios };
