# AllPromos — backend

API HTTP sobre la lógica de `../AllPromos`. No duplica cálculo: importa `AllPromos/core/*`,
`promo-engine.js` y `promos-bancarias.js`, los mismos módulos que usa la CLI. Si la CLI y la
app dan números distintos para la misma compra, es un bug.

## Por qué existe

La app mobile no habla directo con las APIs de los supermercados por dos razones:

1. La cookie `vtex_segment` de Vea no debe viajar dentro de un binario distribuido.
2. Centralizar las consultas permite controlar el ritmo de requests en un solo lugar en vez
   de en cada teléfono (Carrefour tira 429 y Chango Más además 502 intermitentes).

## Puesta en marcha

```bash
npm install
cp .env.example .env

npm run unificar              # genera catalogo-unificado.json desde los 3 catálogos locales
npm start                     # http://localhost:3000
curl -s localhost:3000/api/health
```

`catalogo-unificado.json` es generado: no está en git. Sin él, los endpoints de catálogo
devuelven 503 con la instrucción de generarlo.

## Endpoints

| Método | Ruta | Qué hace |
|---|---|---|
| GET | `/api/health` | Frescura de los 3 catálogos, estado del unificado y resultado del último refresco. Es donde se ve si se venció la cookie de Vea o si se rompió un hash de GraphQL. |
| GET | `/api/catalogo/buscar?q=…` | Busca en el catálogo unificado. **Nunca devuelve precios.** |
| GET | `/api/catalogo/categorias` | Categorías agrupadas por rubro. |
| GET | `/api/catalogo/producto/:ean` | Un producto del catálogo local. |
| POST | `/api/comparar` | El endpoint central: precios y promos en vivo de los 3 supers para un carrito. |

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

## Cron

```bash
npm run refrescar    # corre los 3 scrapers + regenera el unificado + sonda de promos bancarias
```

Los scrapers se lanzan como **subprocesos con `cwd = AllPromos/`**, no se refactorizan: tienen
lógica de retry/backoff que `AllPromos/CLAUDE.md` pide no tocar, y escriben con rutas relativas
al cwd (`./catalogo-vea.json`), así que correrlos desde otro directorio dejaría los catálogos en
el lugar equivocado. Tardan ~17 min en total y pegan a APIs de producción: no correrlos en loop.

Crontab sugerido en el VPS:

```
30 5 * * * cd /ruta/ProyectoSuperApp/backend && /usr/bin/node src/cron/refrescarCatalogos.js >> logs/cron.log 2>&1
```

El resultado queda en `logs/ultimo-refresco.json` y lo expone `/api/health`, para enterarse de
un fallo sin leer logs.

## Seguridad

**Sin token.** Se sacó a propósito (2026-08) al pasar a app web: un token que la app manda
`Authorization: Bearer …` queda escrito en texto plano en el JS que descarga el navegador de
cualquier visitante — no protege nada en un cliente web, cualquiera lo puede leer con
"Inspeccionar" y usarlo directo contra el backend. En vez de fingir un secreto que no lo es,
se sacó y se dejó como única defensa el rate limiting: 120 req/min global y 20/min para
`/api/comparar` (más estricto porque cada comparación dispara 3 requests reales a los supers —
Carrefour y Chango Más ya devuelven 429/502 con tráfico normal, así que un abuso ahí arriesga
que nos bloqueen a nosotros, no solo "gastar de más" el backend propio).

Esto es una decisión de esta etapa (uso familiar/difusión chica por link), no un principio
fijo — cuando exista login de usuarios (ver `PLAN_FEATURES_APP.md`), ahí sí va a haber una
identidad real por request y vale la pena revisar si conviene sumar autenticación de nuevo,
esta vez atada a un usuario y no a un secreto compartido.
