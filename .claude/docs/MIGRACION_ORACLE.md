# Migración del backend: GCP → Oracle Cloud (Always Free)

**Estado: CORTE HECHO 2026-11-03 ~01:35 UTC** — producción corre en Oracle; GCP queda prendida sin crons hasta verificar un ciclo de scrapers y después se borra. Arrancada 2026-11-02. Plazo duro: la prueba de GCP vence ~**2026-11-08** (proyecto creado 2026-08-10, 90 días). Sin upgrade, la VM se apaga ese día y se borra 30 días después.

**Por qué:** en GCP, aun con upgrade, se cobra la IPv4 externa en uso (US$0,005/h ≈ US$3,65/mes; el Free Tier solo cubre 1 h/mes) + egress por encima de 1 GB/mes. Oracle Always Free incluye VM, IP pública y 10 TB/mes de egress sin costo. Decisión del usuario 2026-11-02: migrar ahora en vez de pagar.

## Inventario de lo que vive en la VM actual (`super-app-backend`, e2-micro us-east1-d, IP 34.24.10.174)

- **Servicios systemd:** `allpromos-backend` (Node 22, `backend/`, puerto 3000) y `caddy` (HTTPS automático, Caddyfile = `34.24.10.174.nip.io { reverse_proxy localhost:3000 }`).
- **Repo clonado** en `/home/camilosilva28/ProyectoSuperApp` (617 MB, incluye catálogos, fotos en `backend/imagenes/`, logs). Disco usado: 11 GB de 28.
- **`backend/.env`** (secretos de producción: Supabase service role, Mercado Pago token de Producción, Brevo, etc.) — copiar tal cual, NO commitear.
- **Swapfile de 1 GB** (en e2-micro hacía falta; en Oracle ARM con más RAM probablemente no, pero no molesta).
- **Crontab de `camilosilva28`** (9 entradas en GCP; en Oracle se sumó `feedbackTrialVencido` diario 12:30 UTC el 04/11): descubrirCandidatosExtras (mensual), pingSupabase (lunes), recordatorioSemanal, resumenMensualAhorro, avisoFinTrial (diario), avisoInactividad (diario), resumenSemanalAhorro, reintentarPagosPendientes (cada 2 h), y `backend/scripts/disparar-scrapers.sh` (cada 2 h, dispara el workflow de GitHub). Copiar con `crontab -l` → `crontab -`.
- **`~/.config/gcloud`** en la VM — revisar si algo lo usa antes de descartarlo (no apareció en los crons).

## Todo lo que apunta a la URL/IP del backend (hay que cambiarlo)

| Dónde | Qué | Cómo |
|---|---|---|
| Secretos de GitHub | `VM_HOST`, `VM_USER`, `VM_SSH_KEY`, `VM_HOST_KEY` | `gh secret set` (usados por `deploy.yml` y `scrapers.yml` / `.github/scripts/*.sh`) |
| Vercel | `EXPO_PUBLIC_API_URL` (production) | `vercel env` + redeploy del front |
| `backend/.env` / `config.js` | `URL_PUBLICA_BACKEND` (default hardcodeado `https://34.24.10.174.nip.io`, se usa en el link de baja de mails) | env var en la VM nueva + actualizar el default |
| Mercado Pago | URL de Webhooks (`/api/webhooks/mercadopago`) | a mano en el panel de Developers de MP (ojo con el checkbox "Pagos", ver memoria fase 3) |
| Supabase | Database Webhook / `net.http_post` a `/api/webhooks/auth-usuarios` | a mano en el dashboard (ver `mails_y_notificaciones.md` § tipo #7) |
| UptimeRobot | monitor Keyword sobre `/api/health` | a mano |
| Brevo | whitelist de IPs de la API (no es una URL: es la IP de salida de la VM) | a mano en Security → Authorised IPs |
| `folletos-carrefour/comparar.js` | URL hardcodeada | editar |
| Caddyfile | hostname | en la VM nueva |

**Recomendación:** usar un hostname propio estable (`api.superahorro.com.ar`, registro A a la IP de Oracle) en vez de `<ip>.nip.io`. Así, si algún día hay que volver a mudar la VM, solo se cambia un registro DNS y no los 6 lugares de arriba.

## Cómo quedó en Oracle (2026-11-03)

- **Cuenta:** home region `sa-saopaulo-1` (única AD: `QEcD:SA-SAOPAULO-1-AD-1`), Free Tier (no se hizo upgrade a Pay As You Go). CLI `oci` (Homebrew) con **clave API permanente** desde 2026-11-03: `~/.oci/oci_api_key.pem` (fingerprint `5f:aa:b0:76:…`, subida al usuario con `oci iam user api-key upload`), perfil `DEFAULT` de `~/.oci/config` — no vence, no hace falta `OCI_CLI_AUTH`. (`export SUPPRESS_LABEL_WARNING=True` calla un warning cosmético.) Los primeros minutos tras subirla dio 401 intermitentes (propagación). Antes se usaba sesión de navegador (`oci session authenticate`, vence en ≤24 h; backup del config viejo en `~/.oci/config.bak-sesion`).
- **Costos:** US$0 verificado con `oci usage-api usage-summary request-summarized-usages` (2026-11-03). Presupuesto `presupuesto-1usd` (US$1/mes, todo el tenancy) con 2 alertas por mail a camilosilva28@gmail.com: `aviso-gasto-real` (gasto real ≥1% = cualquier centavo) y `aviso-gasto-pronosticado` (pronóstico ≥50%). Comando de budgets: `oci budgets budget budget …` / `oci budgets budget alert-rule …` (sí, `budget` dos veces).
- **Red:** VCN `superahorro-vcn` 10.0.0.0/16, internet gateway, subred pública `superahorro-subnet` 10.0.0.0/24; Security List por defecto con ingreso 22/80/443.
- **VM:** `superahorro-backend`, **VM.Standard.E2.1.Micro** (AMD, 1 OCPU, 1 GB RAM — igual que la e2-micro de GCP), Ubuntu 22.04 x86_64, boot volume 50 GB. IP pública **146.235.59.32** (efímera: dura mientras exista la instancia; si se recrea, cambia → actualizar el registro A y los secretos). Usuario `ubuntu`, clave local `~/.ssh/oracle_superahorro`.
- **ARM (A1.Flex) no se pudo:** "Out of host capacity" en São Paulo para 2/12 y 1/6, igual que la E2 al principio; la E2.1.Micro salió al reintentar a los ~3 min. Si algún día se quiere más RAM, reintentar A1 (gratis hasta 4 OCPU/24 GB) y repetir el corte. **Desde 03/11 hay un reintento automático en la Mac del usuario** (launchd `ar.superahorro.reintento-a1`, script y log en `~/.superahorro-reintento-a1/`): cada 5 min intenta A1 4/24 y 2/12 con la API key permanente; solo corre con la Mac prendida y se reanuda sola al prenderla. Al conseguirla escribe `LISTO`, avisa con notificación de macOS y deja de intentar; la VM nueva se llama `superahorro-arm` (falta migrar a ella con `preparar-vm-oracle.sh`). Para frenarlo: `launchctl bootout gui/$(id -u)/ar.superahorro.reintento-a1`.
- **Secretos de GitHub:** `VM_HOST=146.235.59.32`, `VM_USER=ubuntu`, `VM_SSH_KEY` = clave nueva `github-actions-deploy-oracle` (en `authorized_keys` de la VM), `VM_HOST_KEY` = clave **ed25519** del host (la usa OpenSSH en `.github/scripts/*.sh`), `VM_HOST_FINGERPRINT` = huella SHA256 de la clave **ECDSA** del host, con prefijo `SHA256:` — gotcha: `appleboy/ssh-action` (cliente Go) negocia ECDSA, con la de ed25519 da "host key fingerprint mismatch".
- **DNS:** registro A `api` → 146.235.59.32 (`rec_6e5a94d4b558a71df58e9b9c`). Caddy solo sirve `api.superahorro.com.ar` (nip.io de la IP vieja ya no aplica), con access log en `/var/log/caddy/access.log`.
- **Crontab:** movido tal cual (rutas `/home/camilosilva28` → `/home/ubuntu`); el de GCP quedó borrado (backup en `~/crontab.bak-20261103` de la VM de GCP). Ambas VMs en UTC.
- **Brevo tiene whitelist de IPs** (Security → Authorised IPs): desde la IP nueva la API respondía `401 unauthorized: unrecognised IP address` y NO salía ningún mail del backend (bienvenida, avisos de seguidos, resúmenes, fin de trial; los de confirmación de Supabase sí, van por su propio SMTP). Causó el error del aviso de seguidos del 03/11 04:00. El usuario autorizó `146.235.59.32` el 03/11; verificado con un envío real (HTTP 201). **Si la IP cambia otra vez, autorizarla en https://app.brevo.com/security/authorised_ips ANTES del corte.**
- **Repo en la VM:** remoto cambiado a HTTPS (el de GCP era `git@github.com` con deploy key; el repo es público).
- Sonda en vivo OK contra los 7 supers desde la IP de Brasil.

## Ya hecho (2026-11-02, antes de tener cuenta de Oracle)

- **`api.superahorro.com.ar`** creado: registro A en el DNS de Vercel (`vercel dns add superahorro.com.ar api A 34.24.10.174`, id `rec_4d88a30fad0ddbdeedd17450`) → hoy apunta a la VM de GCP. Caddy de GCP sirve **los dos** hostnames (`34.24.10.174.nip.io, api.superahorro.com.ar`; backup en `/etc/caddy/Caddyfile.bak-20261102`).
- Vercel `EXPO_PUBLIC_API_URL` = `https://api.superahorro.com.ar` (production). Default de `URL_PUBLICA_BACKEND` en `config.js` y de `folletos-carrefour/comparar.js` cambiados igual.
- `backend/scripts/preparar-vm-oracle.sh`: deja la VM nueva lista (Node 22, Caddy, iptables 80/443, swap, systemd, clone + `npm ci`). No toca secretos ni datos.
- **Supabase:** no es un webhook del dashboard (roto en este proyecto) sino la función `public.notificar_webhook_auth_usuarios` con `net.http_post`; URL reemplazada in situ (`replace(pg_get_functiondef(...))`, sin tocar el secreto) el 2026-11-02 y verificado con un login real: llegó por `api.superahorro.com.ar`, 200.
- **UptimeRobot:** cambiado por el usuario; verificado en el access log de Caddy (chequeos a `api.superahorro.com.ar/api/health`, 200).
- **Mercado Pago:** URL cambiada por el usuario en Modo productivo; sin verificar todavía (falta un evento real o "Simular notificación").
- Caddy de GCP tiene access log en `/var/log/caddy/access.log` (rota a 20 MB × 3) — sirve para ver por qué hostname entra cada request. Replicarlo en Oracle (el dir y el archivo tienen que ser de `caddy:caddy`, si no el reload falla).
- Con esto, el día del corte solo se cambia el registro A (+ secretos de GitHub).
- Links de baja de mails ya enviados apuntan a `34.24.10.174.nip.io/...`: dejan de andar cuando se apague GCP (aceptado: el mail siguiente trae el link nuevo).

## Plan de corte (sin downtime)

1. Crear VM Oracle (Ampere A1, Ubuntu 22.04/24.04 aarch64), abrir 80/443 en la Security List **y** en iptables de la imagen (Oracle Ubuntu trae iptables cerrado por defecto — gotcha clásico).
2. Correr `preparar-vm-oracle.sh` en la VM nueva. Copiar los datos ignorados por git (`backend/.env`, `AllPromos/catalogo-*.json`/`promos-*.json`, `backend/catalogo-unificado.json`, `backend/imagenes/`, `backend/logs/`) — lo más simple es la carpeta entera sin `node_modules`, desde la Mac: `gcloud compute ssh camilosilva28@super-app-backend --zone us-east1-d --command 'tar czf - --exclude=node_modules -C ~ ProyectoSuperApp' | ssh ubuntu@<ip-oracle> 'tar xzf - -C ~'` y volver a correr el script (hace `npm ci` y arranca).
3. Levantar systemd + Caddy, verificar `/api/health` con `ok:true` en la URL nueva.
4. Probar Oracle con `curl --resolve api.superahorro.com.ar:443:<ip-oracle> https://api.superahorro.com.ar/api/health` (Caddy saca el cert recién cuando el DNS apunta ahí — antes, probar por HTTP a la IP). Cambiar el registro A a la IP de Oracle (`vercel dns rm rec_4d88a30fad0ddbdeedd17450` + `vercel dns add ... api A <ip>`) y los secretos de GitHub (`VM_HOST`, `VM_USER=ubuntu`, `VM_SSH_KEY`, `VM_HOST_FINGERPRINT`).
5. Copiar crontab a Oracle y **sacarlo de GCP** en el mismo paso (si no, los mails/cobros corren dos veces).
6. Verificar un ciclo completo de scrapers (workflow de GitHub → VM nueva) y un login/comparar real en la app.
7. Recién entonces apagar y borrar la VM de GCP + liberar la IP estática. **Hecho parcial 2026-11-03:** IP estática `34.24.10.174` liberada (antes se le sacó el access config a la VM, que quedó corriendo sin IP pública). La VM y su disco se dejaron a propósito: sin upgrade, GCP no cobra nada y los borra solo ~30 días después del fin de la prueba (08/11). Ojo: `34.24.10.174.nip.io` ya no responde (links de baja de mails viejos).
