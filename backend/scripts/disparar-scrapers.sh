#!/usr/bin/env bash
# Dispara el workflow "Scraping de catálogos" de GitHub Actions (.github/workflows/scrapers.yml)
# desde el cron de la VM, en vez de depender del `schedule` nativo de GitHub — confirmado en
# vivo el 2026-09-18 que ese schedule se descarta la mayoría de las veces (documentado por
# GitHub: puede demorarse o directamente no dispararse en momentos de carga alta de su
# infraestructura). El cron de la VM sí es puntual (ver CONTEXTO_TECNICO.md), así que ahora solo
# hace esta llamada liviana en vez de correr los scrapers — el trabajo pesado sigue en GitHub
# Actions, esto es nada más el "botón".
set -euo pipefail

GH_TRIGGER_TOKEN=$(grep '^GH_TRIGGER_TOKEN=' ~/ProyectoSuperApp/backend/.env | cut -d= -f2-)

RESPUESTA=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST \
  -H "Authorization: Bearer $GH_TRIGGER_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  https://api.github.com/repos/camilosilva27/ProyectoSuperApp/actions/workflows/scrapers.yml/dispatches \
  -d '{"ref":"master"}')

echo "$(date -u '+%Y-%m-%dT%H:%M:%SZ') dispatch scrapers.yml -> HTTP $RESPUESTA"

if [ "$RESPUESTA" != "204" ]; then
  echo "ERROR: se esperaba 204, la API respondió $RESPUESTA" >&2
  exit 1
fi
