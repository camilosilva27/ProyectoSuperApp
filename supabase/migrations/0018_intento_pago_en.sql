-- Soporte para el cron de reintento de pagos pendientes (ver Plan_Usuarios_y_cobros.md § "Bug
-- real: MP puede demorar días en avisar un pago ya aprobado"). Sin esto no hay forma de saber
-- "quién inició un checkout que todavía no se confirmó" sin recorrer TODA la tabla contra la
-- API de MP en cada corrida — con este timestamp el cron acota la búsqueda a intentos recientes.
alter table public.perfil_usuario
  add column intento_pago_en timestamptz;

comment on column public.perfil_usuario.intento_pago_en is
  'Cuándo se creó el último intento de pago (suscripción o pago único) en Mercado Pago, seteado por pagos.js al crear la Preference/Preapproval. No se limpia al confirmarse el pago — el cron de reintento ya excluye por plan=premium, así que un valor viejo no genera trabajo de más.';
