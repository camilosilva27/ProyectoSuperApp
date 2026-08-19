-- Ajustes encontrados al revisar 0001 contra la skill de seguridad de Supabase:
-- 1) UPDATE necesita "with check" además de "using" (sin eso, una policy de update
--    no revisa los valores nuevos, solo los viejos).
-- 2) Explicitar "to authenticated" en vez de dejar la policy abierta a cualquier rol
--    (anon incluido). El predicado auth.uid() = ... ya bloqueaba a anon en la práctica,
--    pero conviene no depender de eso.

drop policy "leer perfil propio" on public.perfil_usuario;
create policy "leer perfil propio" on public.perfil_usuario
  for select to authenticated using ((select auth.uid()) = id);

drop policy "actualizar perfil propio" on public.perfil_usuario;
create policy "actualizar perfil propio" on public.perfil_usuario
  for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

drop policy "ver mis listas guardadas" on public.carrito_guardado;
create policy "ver mis listas guardadas" on public.carrito_guardado
  for select to authenticated using ((select auth.uid()) = usuario_id);

drop policy "crear mis listas guardadas" on public.carrito_guardado;
create policy "crear mis listas guardadas" on public.carrito_guardado
  for insert to authenticated with check ((select auth.uid()) = usuario_id);

drop policy "borrar mis listas guardadas" on public.carrito_guardado;
create policy "borrar mis listas guardadas" on public.carrito_guardado
  for delete to authenticated using ((select auth.uid()) = usuario_id);
