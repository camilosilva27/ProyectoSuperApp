-- Baja de un clic de los mails NO transaccionales (2026-09-24, backend/src/routes/bajaMails.js).
--
-- Resúmenes de ahorro (semanal/mensual), aviso de inactividad y mails de Alertas se saltean a
-- quien tenga esta columna en false; el push de esos mismos avisos no cambia (se maneja aparte:
-- alertas_activas / suscripción push). Bienvenida, recibo de pago y fin de trial son
-- transaccionales y salen igual.
--
-- La escribe SOLO el backend con service_role (POST /api/mails/baja, autenticado por el token
-- HMAC del link del mail). A propósito NO se suma al GRANT de update de `authenticated` de 0024:
-- el usuario la puede leer (select de su propia fila, RLS), pero no editarla desde la API.
-- Volver a suscribirse hoy es a mano (pedido por mail a contacto@).
--
-- OJO al deployar: los crons de mail la seleccionan, así que esta migración tiene que correr
-- ANTES de que llegue a la VM el código que la usa (si no, esos selects fallan por columna
-- inexistente y el cron no manda nada).

alter table public.perfil_usuario
  add column if not exists mails_no_transaccionales boolean not null default true;

comment on column public.perfil_usuario.mails_no_transaccionales is
  'false = el usuario se dio de baja de mails no transaccionales (resúmenes, inactividad, Alertas) vía /api/mails/baja. Solo la escribe service_role.';
