-- Idempotencia de los resúmenes de ahorro semanal/mensual (auditoría 2026-09-24).
--
-- Antes, si resumenSemanalAhorro.js / resumenMensualAhorro.js se corrían dos veces para el
-- mismo período (re-corrida manual, cron duplicado, reintento tras un fallo a mitad), cada
-- usuario recibía el mail y el push repetidos. Ahora el cron "reclama" el envío insertando
-- (usuario, tipo, periodo) ANTES de mandar: la primary key hace que un segundo insert del mismo
-- período falle con 23505 y ese usuario se saltea. Si el envío no llegó por ningún canal, el
-- cron borra su fila para que una re-corrida lo pueda reintentar.
--
-- `periodo`: 'YYYY-MM' (mes resumido) para el mensual, 'YYYY-Www' (semana ISO de la corrida,
-- hora Argentina) para el semanal. Tabla genérica a propósito: otro envío periódico futuro
-- puede usar la misma con otro `tipo`.
--
-- Solo el backend (service_role, bypasea RLS) lee/escribe: RLS habilitado SIN policies, mismo
-- criterio que scraper_diffs / scraper_errores.
create table public.envio_mail_periodico (
  usuario_id uuid not null references auth.users(id) on delete cascade,
  tipo text not null check (tipo in ('resumen_semanal', 'resumen_mensual')),
  periodo text not null,
  enviado_en timestamptz not null default now(),
  primary key (usuario_id, tipo, periodo)
);

comment on table public.envio_mail_periodico is
  'Marca de envío de mails periódicos (resumen semanal/mensual) por usuario y período, para no duplicarlos si el cron se re-corre. Solo service_role.';

alter table public.envio_mail_periodico enable row level security;

revoke all on public.envio_mail_periodico from anon, authenticated;
