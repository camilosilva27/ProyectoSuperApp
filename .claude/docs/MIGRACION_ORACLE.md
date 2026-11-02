# Migración del backend: GCP → Oracle Cloud (Always Free)

**Estado:** en curso, arrancada 2026-11-02. Plazo duro: la prueba de GCP vence ~**2026-11-08** (proyecto creado 2026-08-10, 90 días). Sin upgrade, la VM se apaga ese día y se borra 30 días después.

**Por qué:** en GCP, aun con upgrade, se cobra la IPv4 externa en uso (US$0,005/h ≈ US$3,65/mes; el Free Tier solo cubre 1 h/mes) + egress por encima de 1 GB/mes. Oracle Always Free incluye VM, IP pública y 10 TB/mes de egress sin costo. Decisión del usuario 2026-11-02: migrar ahora en vez de pagar.

## Inventario de lo que vive en la VM actual (`super-app-backend`, e2-micro us-east1-d, IP 34.24.10.174)

- **Servicios systemd:** `allpromos-backend` (Node 22, `backend/`, puerto 3000) y `caddy` (HTTPS automático, Caddyfile = `34.24.10.174.nip.io { reverse_proxy localhost:3000 }`).
- **Repo clonado** en `/home/camilosilva28/ProyectoSuperApp` (617 MB, incluye catálogos, fotos en `backend/imagenes/`, logs). Disco usado: 11 GB de 28.
- **`backend/.env`** (secretos de producción: Supabase service role, Mercado Pago token de Producción, Brevo, etc.) — copiar tal cual, NO commitear.
- **Swapfile de 1 GB** (en e2-micro hacía falta; en Oracle ARM con más RAM probablemente no, pero no molesta).
- **Crontab de `camilosilva28`** (9 entradas): descubrirCandidatosExtras (mensual), pingSupabase (lunes), recordatorioSemanal, resumenMensualAhorro, avisoFinTrial (diario), avisoInactividad (diario), resumenSemanalAhorro, reintentarPagosPendientes (cada 2 h), y `backend/scripts/disparar-scrapers.sh` (cada 2 h, dispara el workflow de GitHub). Copiar con `crontab -l` → `crontab -`.
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
| `folletos-carrefour/comparar.js` | URL hardcodeada | editar |
| Caddyfile | hostname | en la VM nueva |

**Recomendación:** usar un hostname propio estable (`api.superahorro.com.ar`, registro A a la IP de Oracle) en vez de `<ip>.nip.io`. Así, si algún día hay que volver a mudar la VM, solo se cambia un registro DNS y no los 6 lugares de arriba.

## Ya hecho (2026-11-02, antes de tener cuenta de Oracle)

- **`api.superahorro.com.ar`** creado: registro A en el DNS de Vercel (`vercel dns add superahorro.com.ar api A 34.24.10.174`, id `rec_4d88a30fad0ddbdeedd17450`) → hoy apunta a la VM de GCP. Caddy de GCP sirve **los dos** hostnames (`34.24.10.174.nip.io, api.superahorro.com.ar`; backup en `/etc/caddy/Caddyfile.bak-20261102`).
- Vercel `EXPO_PUBLIC_API_URL` = `https://api.superahorro.com.ar` (production). Default de `URL_PUBLICA_BACKEND` en `config.js` y de `folletos-carrefour/comparar.js` cambiados igual.
- `backend/scripts/preparar-vm-oracle.sh`: deja la VM nueva lista (Node 22, Caddy, iptables 80/443, swap, systemd, clone + `npm ci`). No toca secretos ni datos.
- **Pendiente a mano (usuario), se puede hacer YA sin esperar a Oracle:** Mercado Pago webhook → `https://api.superahorro.com.ar/api/webhooks/mercadopago`; Supabase webhook → `https://api.superahorro.com.ar/api/webhooks/auth-usuarios`; UptimeRobot → `https://api.superahorro.com.ar/api/health`. Hechos estos, el día del corte solo se cambia el registro A.
- Links de baja de mails ya enviados apuntan a `34.24.10.174.nip.io/...`: dejan de andar cuando se apague GCP (aceptado: el mail siguiente trae el link nuevo).

## Plan de corte (sin downtime)

1. Crear VM Oracle (Ampere A1, Ubuntu 22.04/24.04 aarch64), abrir 80/443 en la Security List **y** en iptables de la imagen (Oracle Ubuntu trae iptables cerrado por defecto — gotcha clásico).
2. Correr `preparar-vm-oracle.sh` en la VM nueva. Copiar los datos ignorados por git (`backend/.env`, `AllPromos/catalogo-*.json`/`promos-*.json`, `backend/catalogo-unificado.json`, `backend/imagenes/`, `backend/logs/`) — lo más simple es la carpeta entera sin `node_modules`, desde la Mac: `gcloud compute ssh camilosilva28@super-app-backend --zone us-east1-d --command 'tar czf - --exclude=node_modules -C ~ ProyectoSuperApp' | ssh ubuntu@<ip-oracle> 'tar xzf - -C ~'` y volver a correr el script (hace `npm ci` y arranca).
3. Levantar systemd + Caddy, verificar `/api/health` con `ok:true` en la URL nueva.
4. Probar Oracle con `curl --resolve api.superahorro.com.ar:443:<ip-oracle> https://api.superahorro.com.ar/api/health` (Caddy saca el cert recién cuando el DNS apunta ahí — antes, probar por HTTP a la IP). Cambiar el registro A a la IP de Oracle (`vercel dns rm rec_4d88a30fad0ddbdeedd17450` + `vercel dns add ... api A <ip>`) y los secretos de GitHub (`VM_HOST`, `VM_USER=ubuntu`, `VM_SSH_KEY`, `VM_HOST_FINGERPRINT`).
5. Copiar crontab a Oracle y **sacarlo de GCP** en el mismo paso (si no, los mails/cobros corren dos veces).
6. Verificar un ciclo completo de scrapers (workflow de GitHub → VM nueva) y un login/comparar real en la app.
7. Recién entonces apagar y borrar la VM de GCP + liberar la IP estática.
