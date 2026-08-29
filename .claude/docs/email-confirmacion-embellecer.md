# Email de confirmación — estado actual y qué se puede embellecer

Fuente: `Plan_Usuarios_y_cobros.md` (líneas 60-81), estado al 2026-08-20.

## Setup actual de envío

- **Único mail transaccional que existe:** confirmación de registro (Supabase Auth `signUp`). No hay mail de confirmación de pago propio (MercadoPago usa el email solo como `payer_email`, no dispara un correo nuestro).
- **Proveedor SMTP:** Brevo (no el mailer default de Supabase, que limita a 2 mails/hora compartidos entre proyectos free).
  - Host: `smtp-relay.brevo.com`, puerto 587.
  - Cargado en Supabase → Authentication → Settings → SMTP Settings.
- **Remitente ("From"):** `camilosilva28@gmail.com` — verificado individualmente en Brevo (código de 6 dígitos), **sin dominio propio detrás todavía**.
- **Por qué Brevo y no Resend:** Resend exige dominio propio verificado para mandar a destinatarios reales (su `onboarding@resend.dev` solo entrega al dueño de la cuenta). Brevo no exige dominio propio por debajo de 5.000 mails/día.
- **Plantilla:** "Confirm signup" en Supabase → Authentication → Email Templates. Se edita ahí a mano, no está versionada en el repo. Actualmente arma el link como `{{ .SiteURL }}/ajustes?token_hash={{ .TokenHash }}&type=email` (no usa `{{ .ConfirmationURL }}` tal cual) porque eso es lo que permite que el link deje al usuario logueado directo (`verifyOtp` en `app/src/auth.tsx`).
- **Site URL:** hoy `http://localhost:8081` (dev). Pendiente actualizar a `https://mi-superapp.vercel.app` cuando se pase a producción real — sin barra final (un `/` final rompió Expo Router una vez).

## Foto/avatar del remitente — ya investigado, descartado por ahora

Ya se investigó esto el 2026-08-20 (no es la primera vez que se pregunta):

- Gmail solo muestra la foto de una cuenta cuando el mail sale por infraestructura de Gmail o por un alias "Enviar como" verificado dentro de esa cuenta.
- Brevo relay no está autenticado como esa cuenta de Google → Gmail no muestra la foto aunque la cuenta `camilosilva28@gmail.com` tenga una.
- La única vía real para un logo "verificado" es **BIMI**, que requiere dominio propio + DMARC estricto + certificado de marca.
- Conclusión: la foto del remitente queda atada al mismo pendiente de comprar un dominio propio. No es un paso nuevo, no vale la pena reinvestigar sin que cambie esa premisa (dominio propio).

## Qué sí se puede embellecer ahora, sin dominio

Como el remitente no es alterable sin dominio, lo que queda para "embellecer" el email es el **contenido del template HTML** en Supabase (Authentication → Email Templates → Confirm signup):

- Maquetar HTML propio (logo de la app embebido como imagen con URL pública, o inline como base64 si Brevo/Supabase lo soportan bien en clientes de mail).
- Tipografía, colores de marca, botón de confirmación estilizado en vez del link plano.
- Ojo: hay que preservar el link armado a mano (`{{ .SiteURL }}/ajustes?token_hash={{ .TokenHash }}&type=email`) — no volver a `{{ .ConfirmationURL }}` sin querer al reemplazar el HTML, porque eso rompe el login automático ya resuelto.

## Pendiente relacionado (no bloqueante)

Cuando exista dominio propio: agregarlo como remitente en Brevo, autenticar por DNS, actualizar "Sender email" en Supabase, y recién ahí evaluar BIMI para la foto/logo verificado.
