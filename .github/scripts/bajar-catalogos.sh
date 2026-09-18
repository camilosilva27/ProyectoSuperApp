#!/usr/bin/env bash
# Baja los catalogo-*.json y catalogo-*-extras.json vigentes de la VM al runner, ANTES de
# correr los scrapers — es el "antes" que necesitan el guardrail (AllPromos/core/
# guardrailCatalogo.js) y el diff (backend/src/cron/diffCatalogos.js). Si algún archivo no
# existe todavía en la VM (ej. la primera vez), no rompe nada: el guardrail y el diff simplemente
# arrancan sin punto de comparación para ese archivo puntual.
set -euo pipefail

mkdir -p ~/.ssh
echo "$VM_SSH_KEY" > ~/.ssh/vm_key
chmod 600 ~/.ssh/vm_key
ssh-keyscan -H "$VM_HOST" >> ~/.ssh/known_hosts 2>/dev/null

ssh -i ~/.ssh/vm_key -o StrictHostKeyChecking=no "$VM_USER@$VM_HOST" \
  'cd ~/ProyectoSuperApp/AllPromos && shopt -s nullglob && archivos=(catalogo-*.json) && if [ ${#archivos[@]} -gt 0 ]; then tar czf - "${archivos[@]}"; else tar czf - --files-from=/dev/null; fi' \
  | tar xzf - -C AllPromos/

echo "--- catálogos bajados de la VM ---"
ls -la AllPromos/catalogo-*.json AllPromos/catalogo-*-extras.json 2>/dev/null || echo "(ninguno todavía)"
