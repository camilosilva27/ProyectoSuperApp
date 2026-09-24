-- Cierra la autopromoción a premium (auditoría 2026-09-24, .claude/docs/AUDITORIA_2026-09-24.md).
--
-- La policy "actualizar perfil propio" (0002) solo limita QUÉ FILA se edita (auth.uid() = id),
-- no QUÉ COLUMNAS. Como authenticated tenía UPDATE sobre la tabla entera (default de Supabase),
-- cualquier usuario logueado podía hacer desde la consola del navegador
--   supabase.from('perfil_usuario').update({ plan: 'premium', premium_manual: true })
-- y el Auth Hook (0006) copiaba ese plan al JWT. RLS no filtra columnas: eso se hace con
-- privilegios por columna.
--
-- Solo se le deja escribir al cliente las columnas de preferencias que la app realmente edita
-- (carrito.tsx, filtrosSupers.tsx, alertas.ts, TourContext.tsx). Todo lo de plan/cobro/trial lo
-- escribe únicamente el backend con service_role, que no se ve afectado por estos revoke.
--
-- OJO al agregar una columna nueva que la app tenga que escribir desde el cliente: hay que
-- sumarla al GRANT de abajo en una migración nueva, o el update falla con "permission denied".

revoke insert, update, delete, truncate, references, trigger
  on public.perfil_usuario from anon, authenticated;

-- anon no lee perfiles nunca (RLS ya lo bloqueaba; esto es defensa extra).
revoke select on public.perfil_usuario from anon;

grant update (
  carrito_items,
  carrito_tarjetas,
  supers_activos,
  tope_supers,
  tour_visto,
  alertas_activas
) on public.perfil_usuario to authenticated;
