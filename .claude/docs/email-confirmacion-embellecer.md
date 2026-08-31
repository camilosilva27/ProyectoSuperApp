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

## ✅ Dominio propio comprado y configurado (2026-08-31)

Se compró `mi-superapp.com.ar` en NIC Argentina ($8.500 ARS/año — **no es gratis**, corrigiendo una suposición anterior). Estado final:

- **DNS delegado a Vercel** (`ns1`/`ns2.vercel-dns.com`, gestionado vía `vercel dns add` desde la CLI) — NIC Argentina no permite cargar registros sueltos (A/TXT) manteniendo sus propios nameservers, solo delegar a un proveedor externo con mínimo 2 DNS. Con esto, `https://mi-superapp.com.ar` ya sirve la app (A record a `76.76.21.21`) y el DNS del dominio se maneja todo desde un solo lugar (Vercel), incluidos los registros de Brevo.
- **Brevo: dominio autenticado** con Brevo code (TXT) + DKIM (2 CNAME) + DMARC (`p=none`, monitoreo). Remitente cambiado de `camilosilva28@gmail.com` a `no-reply@mi-superapp.com.ar` (verificado en Brevo → Senders) y actualizado en Supabase → Authentication → SMTP Settings → Sender email.
- **Branded subdomain: descartado a propósito.** Solo suma alineación de SPF (DKIM ya alineado alcanza para `dmarc=pass`) y un subdominio nuevo arrancaría con reputación cero — no ayuda al problema real (ver abajo).
- **Verificado con headers reales:** en Gmail llega bien. En Outlook/Hotmail, `Authentication-Results` da `spf=pass`, `dkim=pass`, `dmarc=pass action=none`, `compauth=pass reason=100` (el máximo posible) — **pero igual cae a spam**. Causa confirmada: reputación de dominio nuevo (registrado el mismo día), no un problema de autenticación ni de blocklist (chequeado contra Spamhaus/Spamcop/Barracuda/SORBS — la IP de Brevo, `77.32.148.26`, no figura en ninguna). Microsoft es notoriamente más desconfiado que Gmail con dominios sin historial, sin importar que la autenticación esté perfecta.
- **No hay más configuración posible de nuestro lado para esto** — es cuestión de tiempo/volumen de envíos reales para que la reputación del dominio mejore en Outlook. Decisión del usuario (2026-08-31): dejarlo así, no perseguir más.
- **Pendiente sin urgencia**: borrar `camilosilva28@gmail.com` de los Senders de Brevo (se dejó a propósito hasta confirmar que el nuevo remitente funciona en producción, no solo en la prueba).

## Template con banner — armado 2026-08-31, pendiente de pegar en el dashboard

`supabase/email-templates/confirm-signup.html` (versionado en el repo) tiene el HTML completo: banner negro con logo (`https://mi-superapp.vercel.app/apple-touch-icon.png`) + "Super App", botón amarillo de confirmación, preheader oculto, footer con aviso estándar. Preserva el link armado a mano (`token_hash`).

**Cómo aplicarlo:** pegar el contenido en Supabase → Authentication → Email Templates → "Confirm signup" → "Message body", a mano desde el dashboard.

**✅ Probado en vivo (2026-08-31), pegado a mano en el dashboard y verificado con un registro real (mail distinto al de la cuenta de prueba ya confirmada):** el banner, el botón y el link con login automático funcionan bien. Único hallazgo: en Outlook/Hotmail el logo apareció como cuadro vacío al principio — es el bloqueo de imágenes remotas por defecto de Outlook para remitentes nuevos (banner "Se bloquearon algunas imágenes"), no un bug del template ni del hosting de la imagen (`apple-touch-icon.png` respondía 200 sin problema por `curl`). Al tocar "Descargar imágenes" se vio bien. No requiere ningún cambio — es el comportamiento esperado de cualquier mail con imágenes remotas la primera vez que llega de un remitente nuevo.

**Por qué no se aplicó vía CLI (`supabase config push`), aunque el CLI está disponible y el proyecto está linkeado:** ese comando sincroniza *todo* `supabase/config.toml` contra el proyecto remoto, no solo la plantilla — y ese archivo no existe en el repo hoy. Toda la config de Auth actual (SMTP de Brevo, Site URL de producción, hook de JWT del plan, redirect URLs) se cargó a mano desde el dashboard y nunca quedó en un archivo local; no hay `supabase config pull` en esta versión de la CLI para traerla. Escribir un `config.toml` desde cero y pushearlo arriesga resetear todo eso a los defaults de Supabase (empezando por la contraseña SMTP de Brevo, que es un secreto que no está en ningún lado legible). Decisión del usuario (2026-08-31): pegar a mano en el dashboard en vez de reconstruir el config.toml completo. Si en el futuro se quiere manejar esto por CLI, hay que armar ese `config.toml` completo primero (con los valores reales de SMTP/Site URL/etc.) antes de cualquier `config push`.
