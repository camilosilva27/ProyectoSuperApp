-- Turnos 12/13 (design_handoff_allpromos_v2/PANTALLA-12-eleccion-de-plan.md): la pantalla de
-- selección de plan y la hoja de confirmación de mail de Mercado Pago necesitan tres datos que
-- hoy no se guardan en ningún lado.

-- Mail que el usuario confirmó/cambió en MercadoPagoEmailSheet antes de pagar. Resuelve un bug
-- de producto real (opciones_planes.md, Fase 3): el payer_email de una suscripción (PreApproval)
-- tiene que coincidir exactamente con la cuenta de Mercado Pago del pagador, y hoy se manda
-- siempre el mail de la sesión de Super App sin preguntar. Se persiste para prellenar la
-- próxima vez — null hasta el primer intento de cobro.
alter table public.perfil_usuario add column mail_mercado_pago text;

comment on column public.perfil_usuario.mail_mercado_pago is
  'Mail confirmado/editado en MercadoPagoEmailSheet antes del último intento de cobro. Prellenado por default con el mail de la cuenta de Super App.';

-- next_payment_date que devuelve Mercado Pago (PreApproval.get()) — se actualiza en cada
-- webhook de suscripción (manejarSuscripcion en webhookMercadoPago.js). No se pide en vivo a la
-- API de MP en cada carga de pantalla, se guarda acá.
alter table public.perfil_usuario add column siguiente_cobro_en timestamptz;

comment on column public.perfil_usuario.siguiente_cobro_en is
  'Próximo cobro de la suscripción (mensual/anual), según next_payment_date de MP. null para plan permanente o sin plan activo.';

-- date_approved del pago único (Payment.get()) cuando se confirma el plan permanente
-- (manejarPago en webhookMercadoPago.js).
alter table public.perfil_usuario add column pagado_en timestamptz;

comment on column public.perfil_usuario.pagado_en is
  'Fecha del pago único aprobado del plan permanente. null para mensual/anual o sin plan activo.';
