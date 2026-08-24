-- Fase 3 (opciones_planes.md): además de mensual, se suman plan anual (suscripción recurrente
-- de 12 meses, misma mecánica de PreApproval) y plan permanente (pago único, sin recurrencia).
--
-- `tipo_plan` trackea CUÁL plan pago tiene el usuario, separado de `plan` (que sigue siendo el
-- estado trial/premium/gratis) — sin esto, `premium` no dice si el usuario paga mes a mes, una
-- vez al año, o ya pagó para siempre.
--
-- No hace falta tocar `bajar_planes_vencidos()` (migración 0005): esa función solo baja a
-- usuarios con `plan = 'trial'` vencido — un usuario ya en `plan = 'premium'` (incluido
-- permanente) nunca entra en su `where`, así que el permanente no necesita ninguna exclusión
-- nueva ahí.
alter table public.perfil_usuario
  add column tipo_plan text check (tipo_plan in ('mensual', 'anual', 'permanente'));

comment on column public.perfil_usuario.tipo_plan is
  'Qué plan pago tiene el usuario (solo tiene valor cuando plan=premium): mensual/anual son suscripción recurrente de MP (PreApproval), permanente es pago único sin vencimiento.';
