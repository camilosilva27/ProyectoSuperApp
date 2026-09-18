#!/usr/bin/env bash
# Sube los catalogo-*.json y catalogo-*-extras.json ya scrapeados en el runner de vuelta a la
# VM, y dispara ahí el post-proceso (unificar, fotos, promos bancarias, avisos — ver
# postProcesarCatalogos.js). No toca imágenes ni catalogo-unificado.json: eso lo regenera el
# post-proceso EN la VM, donde ya están las ~65.000 fotos existentes.
set -euo pipefail

cd AllPromos
tar czf - catalogo-*.json \
  | ssh -i ~/.ssh/vm_key -o StrictHostKeyChecking=no "$VM_USER@$VM_HOST" \
    'cd ~/ProyectoSuperApp/AllPromos && tar xzf -'
cd ..

echo "--- catálogos subidos, disparando post-proceso en la VM ---"
ssh -i ~/.ssh/vm_key -o StrictHostKeyChecking=no "$VM_USER@$VM_HOST" \
  'cd ~/ProyectoSuperApp/backend && node src/cron/postProcesarCatalogos.js'
