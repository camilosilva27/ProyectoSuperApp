-- trial_termina_en NULL equivale a trial eterno: GatePaywallFinTrial lo toma como vigente y
-- bajar_planes_vencidos() no lo baja (NULL < now() es falso). Ya pasó una vez (0021 redefinió
-- manejar_usuario_nuevo() sin la columna; corregido en 0022). Auditoría 2026-09-24:
-- - default de 30 días (el mismo que usa el trigger de alta), para que si una futura versión del
--   trigger vuelve a olvidar la columna, el registro siga funcionando con un trial normal;
-- - NOT NULL, para que nada pueda dejarla vacía explícitamente.
-- Al aplicarla había 0 filas con NULL.

alter table public.perfil_usuario
  alter column trial_termina_en set default (now() + interval '30 days');

alter table public.perfil_usuario
  alter column trial_termina_en set not null;
