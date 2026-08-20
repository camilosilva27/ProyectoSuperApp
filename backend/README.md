# AllPromos — backend

API HTTP sobre la lógica de `../AllPromos`. No duplica cálculo: importa `AllPromos/core/*`,
`promo-engine.js` y `promos-bancarias.js`, los mismos módulos que usa la CLI. Si la CLI y la
app dan números distintos para la misma compra, es un bug.

## Por qué existe

La app mobile no habla directo con las APIs de los supermercados por dos razones:

1. ~~La cookie `vtex_segment` de Vea no debe viajar dentro de un binario distribuido.~~ Motivo
   histórico, ya no aplica: desde 2026-08-20 ningún código (ni el fetch en vivo, ni el scraper
   de catálogo) manda esa cookie — se encontró que causaba precios desactualizados, ver
   `CONTEXTO_TECNICO.md` § "API de Vea". No queda ninguna credencial de super que no pueda
   viajar en un binario.
2. Centralizar las consultas permite controlar el ritmo de requests en un solo lugar en vez
   de en cada teléfono (Carrefour tira 429 y Chango Más además 502 intermitentes).

## Puesta en marcha

```bash
npm install
cp .env.example .env

npm run unificar              # genera catalogo-unificado.json desde los 5 catálogos locales
npm start                     # http://localhost:3000
curl -s localhost:3000/api/health
```

`catalogo-unificado.json` es generado: no está en git. Sin él, los endpoints de catálogo
devuelven 503 con la instrucción de generarlo.

## Endpoints

| Método | Ruta | Qué hace |
|---|---|---|
| GET | `/api/health` | Frescura de los 5 catálogos (= frescura del caché de precio), estado del unificado y resultado del último refresco. Es donde se ve si se venció la cookie de Vea o si se rompió un hash de GraphQL. |
| GET | `/api/catalogo/buscar?q=…` | Busca en el catálogo unificado. **Nunca devuelve precios.** |
| GET | `/api/catalogo/categorias` | Categorías agrupadas por rubro. |
| GET | `/api/catalogo/producto/:ean` | Un producto del catálogo local. |
| POST | `/api/comparar` | El endpoint central: precios y promos de los 5 supers para un carrito. |
| POST | `/api/precios` | Versión liviana para la pantalla de búsqueda (mejor precio de un lote de EANs). |

Ningún endpoint pide token — ver "Seguridad" abajo para por qué.

`POST /api/comparar`:

```bash
curl -s -X POST localhost:3000/api/comparar \
  -H 'Content-Type: application/json' \
  -d '{"items":[{"ean":"7793704000911","cantidad":2}],"tarjetas":["Mi Carrefour"]}'
```

Cada ítem de la respuesta puede traer `sugerenciaCantidad`: qué cantidades activarían una
promo que hoy no se activa, con el total de cada alternativa en cada super ya calculado. Es
el equivalente de la pregunta que la CLI hace por consola, pero como dato — la app lo muestra
como aviso con un botón y no vuelve a consultar nada hasta que el usuario acepta.

## Caché de precio (2026-08-13) — por qué `/comparar` y `/precios` ya no pegan en vivo en el camino común

Antes, cada request a `/comparar`/`/precios` disparaba 5 requests reales a los supers, en el
momento del click. Con un solo usuario ya alcanzaba para que Carrefour/Chango Más devolvieran
429/502 de vez en cuando (ver `sondaEnVivo.js`); con varios usuarios concurrentes ese volumen se
multiplica y el riesgo deja de ser "alguna respuesta lenta" y pasa a ser que directamente nos
bloqueen la IP del servidor — rompiendo la app para todos, no solo para quien generó el pico.

Ahora:

1. **`src/precioCache.js`** lee precio+promo directo de los `catalogo-*.json` que ya escriben
   los scrapers (siempre trajeron `descuentoDirecto`/`promosInternas`/`promosBancarias`/
   `promocion` — antes se descartaban a propósito para el precio, ver `unificarCatalogo.js`).
   Traduce esa forma a la misma que devuelve el fetch en vivo de `AllPromos/core/fetchers.js`,
   reusando las mismas funciones de `promo-engine.js` — no hay una segunda lógica de promos.
   Cubre el recorte de ~2550 SKUs por super que ya capturan los scrapers (la gran mayoría de lo
   que se compara habitualmente), sin pegarle a ningún super en el momento del request.
2. **Fallback en vivo, solo para EANs que el paso 1 no tiene** (fuera de ese recorte, o producto
   nuevo): sigue siendo el `buscarPorEAN` de siempre, pero atrás de `src/limitadorGlobal.js` —
   un semáforo **global** (no por IP, a diferencia del rate limiting de `server.js`) que permite
   como mucho 2 búsquedas de este fallback en vuelo a la vez, sin importar cuántos usuarios
   distintos las disparen. Esto es lo que efectivamente resuelve la escala: el volumen hacia los
   supers ya no depende de cuánto tráfico tenga la app.

El costo real de este cambio: el precio que ve la app tiene la frescura del cron (1-2 hs), no
la del segundo exacto del click. Para esta app (uso familiar, nadie nota 40 minutos de
diferencia en un precio de supermercado) es un cambio aceptado a propósito — ver la discusión
completa en `CONTEXTO_TECNICO.md`. La CLI (`AllPromos/`) no cambió: sigue siendo 100% en vivo,
sin caché, como siempre.

## Cron

```bash
npm run refrescar    # corre los 5 scrapers + regenera el unificado + sonda de promos bancarias
```

Los scrapers se lanzan como **subprocesos con `cwd = AllPromos/`**, no se refactorizan: tienen
lógica de retry/backoff que `AllPromos/CLAUDE.md` pide no tocar, y escriben con rutas relativas
al cwd (`./catalogo-vea.json`), así que correrlos desde otro directorio dejaría los catálogos en
el lugar equivocado. Tardan ~17 min en total y pegan a APIs de producción: no correrlos en loop.

Ahora que `precioCache.js` sirve el precio que ve la app, la frecuencia de este cron pasó a ser
la frescura real del precio (antes solo afectaba nombre/EAN). Crontab sugerido, arrancando
conservador — es un punto de partida a monitorear con `/api/health` (`problemas`, 429/502 en
`logs/cron.log`), no un número ya probado a esta frecuencia:

```
0 */2 * * * cd /ruta/ProyectoSuperApp/backend && /usr/bin/node src/cron/refrescarCatalogos.js >> logs/cron.log 2>&1
```

**Este archivo de crontab vive en la VM, no en el repo — hay que actualizarlo ahí a mano** (no
se puede versionar ni se aplica solo con el deploy). El resultado de cada corrida queda en
`logs/ultimo-refresco.json` y lo expone `/api/health`, para enterarse de un fallo sin leer logs.

## Seguridad

**Sin token.** Se sacó a propósito (2026-08) al pasar a app web: un token que la app manda
`Authorization: Bearer …` queda escrito en texto plano en el JS que descarga el navegador de
cualquier visitante — no protege nada en un cliente web, cualquiera lo puede leer con
"Inspeccionar" y usarlo directo contra el backend. En vez de fingir un secreto que no lo es,
se sacó y se dejó como única defensa el rate limiting: 120 req/min global y 20/min para
`/api/comparar` (más estricto porque, aunque desde el caché de precio ya no dispara requests
reales a los supers, sigue siendo el endpoint más pesado a nivel CPU/memoria del backend, y el
que puede caer al fallback en vivo — ver "Caché de precio" arriba, protegido además por su
propio límite global independiente de este rate limiting por IP).

Esto es una decisión de esta etapa (uso familiar/difusión chica por link), no un principio
fijo — cuando exista login de usuarios (ver `PLAN_FEATURES_APP.md`), ahí sí va a haber una
identidad real por request y vale la pena revisar si conviene sumar autenticación de nuevo,
esta vez atada a un usuario y no a un secreto compartido.
