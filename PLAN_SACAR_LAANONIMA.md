# Plan: sacar La Anónima de la app

**Estado: ✅ ejecutado y deployado (2026-08-20).** Commit `c9bc6ee` en `master`, deploy a la VM confirmado (`gh run` exitoso) y `/api/health` en producción ya muestra solo 5 supers. Único punto pendiente de que se autolimpie: el próximo cron de `refrescarCatalogos.js` (cada 2hs) va a reemplazar el `ultimo-refresco.json` viejo, que todavía menciona los 3 pasos de La Anónima porque esa corrida fue anterior al deploy — no es un error del código nuevo, ver sección 9.

## Motivo (ya decidido, no reabrir sin releer esto)

El WAF de CloudFront bloquea la IP de la VM de forma recurrente al pegarle a La Anónima — no es un bloqueo puntual ya resuelto, vuelve una y otra vez (se levantó el 18/08 y volvió a caer el 19/08), y afecta tanto al scraper de catálogo como al fetch de precio en vivo (`laAnonimaLiveEAN`), porque ambos pegan desde la misma IP. No se encontró forma confiable de evitarlo (ya se usan headers/UA de navegador real). Es además el super con menos cobertura real: sin EAN propio, solo ~22% del catálogo (1794/8197 SKUs) entra en comparaciones cruzadas con los otros supers, y requiere que el usuario tenga un código postal con cobertura confirmada (hoy solo Patagonia/La Pampa) para aparecer. Un super que se cae sin aviso y que aporta poco valor comparativo sale más caro en mantenimiento que lo que suma. Ver `CONTEXTO_TECNICO.md` línea 491 y memoria `laanonima-plan-sacarla`.

Después de este plan quedan **5 supers activos**: Vea, Carrefour, Chango Más, Día, Coto.

## Orden recomendado de ejecución

El proyecto tiene dos zonas con distinto nivel de red de seguridad:

1. **Frontend (TypeScript)**: sacar `'laanonima'` de `SuperKey` en `app/src/api.ts` **primero**, y correr `npx tsc --noEmit` en `app/`. El compilador va a señalar automáticamente cada `Record<SuperKey, ...>` o uso que todavía tenga la entrada vieja — no hace falta memorizarlos todos a mano.
2. **Backend/scraper (JS puro, sin chequeo de tipos)**: no hay red de seguridad equivalente. Hay que revisar a mano los 5 puntos de la lista de abajo y confirmar con una corrida real del cron (`refrescarCatalogos.js` y `unificarCatalogo.js`) que no quedó ninguna referencia colgada.
3. **Assets, config, docs, memoria**: al final, son limpieza sin riesgo de romper nada en runtime.

## 1. Backend/scraper — archivos a BORRAR completos

- `AllPromos/scraper-promos-laanonima.js`
- `AllPromos/enriquecer-catalogo-laanonima.js`
- `AllPromos/resolver-ean-laanonima-flix.js`
- `AllPromos/aplicar-ean-flix-laanonima.js`
- `AllPromos/core/laanonima-zona.js`
- `AllPromos/mi-codigo-postal.js` (persistencia CLI del CP, uso exclusivo de este super)
- `backend/src/routes/laanonima.js` (endpoint `GET /api/laanonima/cobertura`)
- Generados/gitignoreados, borrar si existen en disco: `AllPromos/catalogo-laanonima.json`, `AllPromos/promos-laanonima.json`, `AllPromos/laanonima-ean-flix.json`, `AllPromos/laanonima-reporte-matching.json`, `AllPromos/mi-codigo-postal.json`

## 2. Backend/scraper — archivos COMPARTIDOS a editar

- `AllPromos/core/catalogo.js`: sacar la entrada `{ key: 'laanonima', ... }` del array de catálogos/fuentes, la función `urlLaAnonimaPorEAN` y su export.
- `AllPromos/core/fetchers.js`: sacar `LAANONIMA_HEADERS`, la entrada con tag `⚪` en la lista de supers, `parsearProductoLaAnonima`, `laAnonimaLiveEAN`, `laAnonimaLiveNombre`, su presencia en los `Promise.all` de `buscarPorEAN`/`buscarPorNombreEnVivo` y en los objetos de retorno `{vea, carr, changomas, dia, coto, laanonima}`, y sus exports.
- `AllPromos/buscar-promos.js`: sacar el import de `tieneCobertura` desde `laanonima-zona` y el comentario asociado; confirmar que no queda usado en el flujo CLI.
- `backend/src/routes/comparar.js`: sacar el comentario de cabecera sobre La Anónima, el import de `tieneCoberturaCacheada`, la función `filtrarPorCoberturaLaAnonima` completa y sus dos invocaciones (en los dos endpoints de comparación). **Ojo**: revisar si `codigoPostal`/`coberturaConfirmada` en el body de la request siguen usándose para algo más antes de sacarlos — si no, también se van.
- `backend/src/precioCache.js`: sacar los comentarios de cabecera, la entrada en el array de catálogos, la función `entradasLaAnonima` y su lugar en los objetos índice compartidos `{vea, carr, changomas, dia, coto, laanonima}`.
- `backend/src/sondaEnVivo.js`: sacar `EAN_SONDA_LAANONIMA`, `CP_SONDA_LAANONIMA`, la rama `grupoLaAnonima`, el `if (s.key === 'laanonima') continue` y `resultados.laanonima`.
- `backend/src/cron/unificarCatalogo.js`: sacar la entrada `{ key: 'laanonima', archivo: 'catalogo-laanonima.json' }`.
- `backend/src/cron/refrescarCatalogos.js`: sacar la entrada de scraper `La Anónima`, las constantes `APLICAR_EAN_FLIX_LAANONIMA`/`ENRIQUECIMIENTO_LAANONIMA` y los dos pasos extra de post-procesamiento que solo corren para este super (aplicar EAN Flix + enriquecimiento por nombre). Es la pieza con más código a remover del cron.
- `backend/src/server.js`: sacar el import de `laAnonimaRouter` y su registro en el router principal.

## 3. Frontend — archivos a BORRAR completos

- `app/src/codigoPostalLaAnonima.tsx` (contexto del CP)
- `app/src/componentes/ModalCodigoPostalLaAnonima.tsx` (modal de pedido de CP)

## 4. Frontend — archivos COMPARTIDOS a editar

- `app/src/api.ts`: sacar `'laanonima'` de `type SuperKey` (**hacer esto primero**, ver orden de ejecución), sacar `verificarCoberturaLaAnonima` y el comentario asociado.
- `app/app/_layout.tsx`: sacar el import y el wrapping con `<ProveedorCodigoPostalLaAnonima>`.
- `app/app/(tabs)/index.tsx`: sacar los imports, el uso de `useCodigoPostalLaAnonima()`, la lógica de `codigoPostalActivo` y el toggle especial `if (key === 'laanonima' ...)`, y el render de `<ModalCodigoPostalLaAnonima>`.
- `app/app/resultado.tsx`: sacar el import y el uso de `cpLaAnonima` al armar `codigoPostalActivo`.
- `app/src/filtrosSupers.tsx`: sacar el comentario y simplificar `SUPERS_ACTIVOS_POR_DEFECTO` — hoy es `ORDEN_SUPERS.filter(k => k !== 'laanonima')`, una vez que `laanonima` ya no está en `ORDEN_SUPERS` esto se reduce a `SUPERS_ACTIVOS_POR_DEFECTO = ORDEN_SUPERS` directamente (o sacar la constante intermedia y usar `ORDEN_SUPERS` donde se lea).
- `app/src/theme.ts`: sacar la entrada `laanonima` de los mapas de color `light` y `dark`, y el comentario sobre logos.
- `app/src/componentes/comunes.tsx`: sacar `'laanonima'` de `ORDEN_SUPERS` y la entrada `laanonima: 'La Anónima'` de `NOMBRE_SUPER`.
- `app/src/componentes/HeaderNegro.tsx`: sacar la entrada de color `laanonima` en el mapa de colores sobre fondo oscuro.

## 5. Assets

- `app/assets/logos/laanonima.svg` y `app/assets/logos/laanonima-simbolo.png`: borrar. Confirmado que ningún logo de `app/assets/logos/` (ni el de este super ni los de los otros 5) está todavía wireado a componentes — es trabajo en progreso sin integrar, así que no hay ningún `require`/`import` que vaya a quedar roto.

## 6. Config

- `.gitignore` (raíz): sacar la línea `AllPromos/laanonima-reporte-matching.json`.

## 7. Documentación técnica a actualizar

- `CONTEXTO_TECNICO.md`: sacar la sección "API de La Anónima" completa (parsing HTML, gate de cobertura, EAN best-effort, comandos CLI) y las menciones sueltas en "Alcance y limitaciones". Actualizar la línea 491 (pendiente "Sacar La Anónima de la app") a `✅ hecho`, con fecha y breve resumen de qué se hizo — mismo patrón que las otras entradas ya cerradas en esa sección.
- `COMO_FUNCIONA.md`: sacar la mención en la explicación de los supers soportados (pasa a ser "5 supers") y los comandos de scraper/enriquecimiento específicos.
- `AllPromos/CLAUDE.md`: sacar las notas de comportamiento del scraper (no VTEX, sin EAN, sin buscador) y los comandos.

## 8. Memoria de Claude Code (fuera del repo)

En `~/.claude/projects/-Users-camilosilva-ProyectosPersonales-ProyectoSuperApp/memory/`:

- Borrar (exclusivas de La Anónima, ya sin vigencia una vez ejecutado el plan): `laanonima-integracion.md`, `laanonima-403-vm-produccion.md`, `laanonima-flix-scraping-retomado.md`.
- Actualizar (compartidas, mencionan La Anónima como uno de los supers): `MEMORY.md` y `super-app-supermercados-soportados.md` — pasan a reflejar 5 supers.
- `laanonima-plan-sacarla.md`: convertir en memoria de cierre (o borrar) una vez que este plan se ejecute — deja de ser "plan pendiente" y pasa a ser historia cerrada.

## 9. Verificación

1. `npx tsc --noEmit` en `app/` sin errores — confirma que no quedó ningún `Record<SuperKey, ...>` incompleto ni referencia rota en el frontend.
2. Correr el cron manualmente (`refrescarCatalogos.js` → `unificarCatalogo.js`) y confirmar que no intenta tocar ningún archivo/scraper de La Anónima y que el catálogo unificado sigue generándose bien con 5 fuentes.
3. `grep -ri "anonima"` sobre todo el repo (excluyendo `node_modules`, `.git`, y los backups/dumps si los hay) — no debería quedar nada salvo este mismo plan y el historial en `CONTEXTO_TECNICO.md`.
4. Probar la app en vivo: selector de supers muestra 5, ninguna referencia rota al CP, `/api/comparar` responde igual sin el filtro de cobertura.
5. Confirmar en la VM de producción que `GET /api/laanonima/cobertura` ya no existe (404) y que el cron no falla al no encontrarlo.

## 10. Deploy

Deploy a la VM de producción siguiendo el flujo de auto-deploy ya existente (push a `master` dispara el deploy). Después del deploy, verificar en vivo que la sonda (`sondaEnVivo.js`) y el caché de `/api/comparar` funcionan igual sin la rama de La Anónima.
