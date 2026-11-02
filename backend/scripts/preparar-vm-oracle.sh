#!/usr/bin/env bash
# Deja una VM nueva de Oracle Cloud (Ubuntu 22.04/24.04, Ampere A1 aarch64 o x86) lista para
# correr el backend, igual que la VM de GCP. Idempotente: se puede correr de nuevo sin romper nada.
# Uso, en la VM nueva, como el usuario por defecto (`ubuntu`):
#   curl -fsSL https://raw.githubusercontent.com/camilosilva27/ProyectoSuperApp/master/backend/scripts/preparar-vm-oracle.sh | bash
# Después hay que copiar backend/.env, catálogos y fotos desde la VM vieja (ver
# .claude/docs/MIGRACION_ORACLE.md § "Plan de corte") — este script NO toca secretos ni datos.
set -euo pipefail

USUARIO=$(whoami)
REPO_DIR="$HOME/ProyectoSuperApp"
HOSTNAME_API="${HOSTNAME_API:-api.superahorro.com.ar}"

echo "== paquetes base"
sudo apt-get update -y
sudo apt-get install -y git curl ca-certificates gnupg debian-keyring debian-archive-keyring apt-transport-https iptables-persistent

echo "== swap de 1 GB (por si la VM es chica; en A1 con más RAM no molesta)"
if ! swapon --show | grep -q /swapfile; then
  sudo fallocate -l 1G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
fi

echo "== Node.js 22 (NodeSource)"
if ! node -v 2>/dev/null | grep -q '^v22'; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi

echo "== Caddy"
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
  sudo apt-get update -y && sudo apt-get install -y caddy
fi
printf '%s {\n    reverse_proxy localhost:3000\n}\n' "$HOSTNAME_API" | sudo tee /etc/caddy/Caddyfile >/dev/null

echo "== firewall del SO: las imágenes Ubuntu de Oracle traen iptables con todo cerrado salvo 22."
# Además hay que abrir 80/443 en la Security List de la VCN (consola de Oracle) — son dos capas.
for p in 80 443; do
  sudo iptables -C INPUT -p tcp --dport $p -j ACCEPT 2>/dev/null || sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport $p -j ACCEPT
done
sudo netfilter-persistent save

echo "== repo"
[ -d "$REPO_DIR/.git" ] || git clone https://github.com/camilosilva27/ProyectoSuperApp.git "$REPO_DIR"
mkdir -p "$REPO_DIR/backend/logs"
(cd "$REPO_DIR/backend" && npm ci --no-audit --no-fund)

echo "== servicio systemd (mismo que en GCP)"
sudo tee /etc/systemd/system/allpromos-backend.service >/dev/null <<EOF
[Unit]
Description=AllPromos backend
After=network.target

[Service]
Type=simple
User=$USUARIO
WorkingDirectory=$REPO_DIR/backend
ExecStart=/usr/bin/node src/server.js
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable allpromos-backend caddy

if [ -f "$REPO_DIR/backend/.env" ]; then
  sudo systemctl restart allpromos-backend caddy
  echo "== listo: backend y Caddy reiniciados"
else
  echo "== listo, FALTA copiar backend/.env (y catálogos/fotos) antes de arrancar el backend"
fi
