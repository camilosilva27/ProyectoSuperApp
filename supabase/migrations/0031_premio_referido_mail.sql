-- Mail "ganaste 2 meses gratis" (referidos, PLAN_REFERIDOS.md; mails_y_notificaciones.md tipo #9).
-- Cuándo se mandó el aviso del premio: el backend lo manda una sola vez, en el mismo momento en
-- que otorgar_premio_referido() devuelve 'otorgado' (backend/src/mailPremioReferidos.js). null =
-- todavía no salió (o falló): sirve para ver a quién reenviárselo a mano.
alter table public.premio_referido
  add column mail_enviado_en timestamptz;
