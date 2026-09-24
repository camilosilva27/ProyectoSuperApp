#!/usr/bin/env bash
# Sube los catalogo-*.json y catalogo-*-extras.json ya scrapeados en el runner de vuelta a la
# VM, y dispara ahí el post-proceso (unificar, fotos, promos bancarias, avisos — ver
# postProcesarCatalogos.js). No toca imágenes ni catalogo-unificado.json: eso lo regenera el
# post-proceso EN la VM, donde ya están las ~65.000 fotos existentes.
set -euo pipefail

CORRIDA_EN=$(cat AllPromos/.corrida-en)

cd AllPromos
# Extracción atómica (auditoría 2026-09-24): antes era `tar xzf -` directo sobre los
# catalogo-*.json vivos, así que el server (precioCache.js, catalogo.js) podía leer un JSON a
# medio escribir durante la subida. Ahora se extrae a un directorio temporal DENTRO de
# AllPromos/ (mismo filesystem, requisito para que `mv` sea un rename atómico) y recién con
# todo extraído OK se mueve archivo por archivo. Si la extracción falla, los catálogos vivos
# quedan intactos. El temporal empieza con punto para que ningún glob catalogo-*.json lo vea.
tar czf - catalogo-*.json \
  | ssh -i ~/.ssh/vm_key -o StrictHostKeyChecking=yes "$VM_USER@$VM_HOST" \
    'set -euo pipefail
     cd ~/ProyectoSuperApp/AllPromos
     TMP=$(mktemp -d .subida-catalogos-XXXXXX)
     trap "rm -rf \"$TMP\"" EXIT
     tar xzf - -C "$TMP"
     for f in "$TMP"/catalogo-*.json; do
       [ -e "$f" ] || continue
       mv -f "$f" "./$(basename "$f")"
     done'
cd ..

echo "--- catálogos subidos, disparando post-proceso en la VM (corrida_en=$CORRIDA_EN) ---"
ssh -i ~/.ssh/vm_key -o StrictHostKeyChecking=yes "$VM_USER@$VM_HOST" \
  "cd ~/ProyectoSuperApp/backend && CORRIDA_EN='$CORRIDA_EN' node src/cron/postProcesarCatalogos.js"
