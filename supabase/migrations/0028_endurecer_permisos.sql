-- Endurecimiento de permisos (auditoría 2026-09-24, .claude/docs/AUDITORIA_2026-09-24.md).
--
-- 1) manejar_usuario_nuevo() es SECURITY DEFINER sin search_path fijo (el advisor de Supabase
--    lo marca como function_search_path_mutable). Las otras tres SECURITY DEFINER ya lo tienen.
--
-- 2) anon tenía todos los privilegios de tabla (incluido TRUNCATE) en las tablas de public: es
--    el default de Supabase, y hoy RLS lo contiene, pero la app nunca lee ni escribe tablas sin
--    sesión (todo pasa con el rol authenticated o por el backend con service_role). Se revoca
--    como defensa en profundidad, también para tablas futuras.

alter function public.manejar_usuario_nuevo() set search_path = public;

revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;

alter default privileges for role postgres in schema public revoke all on tables from anon;
alter default privileges for role postgres in schema public revoke all on sequences from anon;
