-- El registro con mail+contraseña ya manda `nombre` en user_metadata (ver
-- 0003_nombre_en_perfil.sql), pero el login con Google nunca pasó por ese campo: Supabase
-- completa raw_user_meta_data con lo que devuelve Google (`full_name`/`name`, no `nombre`), así
-- que esas cuentas quedaban con perfil_usuario.nombre en null. El trigger ahora prueba las tres
-- claves en orden; no se toca el resto de la fila para los usuarios que ya existen.
create or replace function public.manejar_usuario_nuevo()
returns trigger as $$
begin
  insert into public.perfil_usuario (id, nombre) values (
    new.id,
    coalesce(
      new.raw_user_meta_data->>'nombre',
      new.raw_user_meta_data->>'full_name',
      new.raw_user_meta_data->>'name'
    )
  );
  return new;
end;
$$ language plpgsql security definer;
