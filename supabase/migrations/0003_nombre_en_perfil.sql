-- Nombre del usuario, pedido al registrarse (no existía ningún dato de personalización más
-- allá del mail). Llega vía user_metadata en signUp() y el trigger lo copia a perfil_usuario
-- para que viva junto al resto de los datos propios de la app, no separado en auth.users.
alter table public.perfil_usuario add column nombre text;

create or replace function public.manejar_usuario_nuevo()
returns trigger as $$
begin
  insert into public.perfil_usuario (id, nombre) values (new.id, new.raw_user_meta_data->>'nombre');
  return new;
end;
$$ language plpgsql security definer;
