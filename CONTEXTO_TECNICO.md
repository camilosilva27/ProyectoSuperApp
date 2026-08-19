# Contexto técnico — AllPromos

Herramienta personal para comparar precios y promociones entre **Vea**, **Carrefour**, **Chango Más**, **Día** y **Coto** — 5 supermercados. Empezó como una CLI **interactiva** (`buscar-promos.js`) y hoy tiene además una app mobile/web (`app/`, React Native + Expo) sobre un backend HTTP (`backend/`) que reusa exactamente la misma lógica de `AllPromos/core/*`. El usuario (en Luján, Buenos Aires) busca o escribe el producto (o una lista) y recibe precios en vivo, con promos calculadas correctamente para la cantidad que quiere comprar. La CLI pregunta por consola (usando `readline` nativo de Node, sin dependencias) cuando hay ambigüedad o cuando cambiar la cantidad activaría una promo — ver "Interactividad" más abajo; la app resuelve la ambigüedad de nombre de otra forma (el usuario elige de una lista, ver `app/app/(tabs)/index.tsx`) y muestra la sugerencia de cantidad como un aviso no bloqueante en vez de una pregunta.

**Importante — los 3 supers parecen tener precio único a nivel país, no por sucursal.** Esto se creyó cierto solo para Carrefour y Chango Más durante buena parte del proyecto (ver sus quirks más abajo), pero se asumía que Vea era la excepción "hiperlocal". Confirmado en vivo el 2026-08-10 que **no lo es**: se armaron cookies `vtex_segment` con `regionId` de Luján, Córdoba (700 km de distancia) y La Plata, y se consultaron 5 productos distintos (con y sin promoción activa) — el precio fue idéntico centavo por centavo en los tres casos. El endpoint `/checkout/pub/regions` tampoco filtra por código postal: devuelve la misma lista de sucursales (mezclando Chivilcoy, Santiago del Estero, Tucumán, Chaco, San Luis, Bahía Blanca) para el CP de Luján y el de CABA. Ver el detalle en "API de Vea — quirks críticos" más abajo. Sigue sin confirmarse que el precio online coincida con el de góndola de una sucursal física puntual — lo que se descartó es que varíe *entre* sucursales dentro del canal online.

---

## Estructura de archivos

```
AllPromos/
├── buscar-promos.js            ← CLI: readline + console.log (capa delgada sobre core/)
├── core/                       ← Lógica compartida entre el CLI y el backend
│   ├── catalogo.js             ← nombre → EAN/skuId, estado de frescura (con caché por mtime)
│   ├── fetchers.js             ← consultas en vivo a las 5 APIs + SUPERMERCADOS
│   └── comparador.js           ← mejor opción, sugerencia de cantidad, resumen final
├── promo-engine.js             ← Motor de cálculo de promos (por producto)
├── promos-bancarias.js         ← Promos "por ticket": bancos/billeteras/tarjetas propias (ver sección propia más abajo)
├── mis-tarjetas.json           ← Tarjetas del usuario para la CLI (no versionado — personal, ver .gitignore)
├── scraper-promos-vea.js       ← Actualiza catalogo-vea.json
├── scraper-promos-carrefour.js ← Actualiza catalogo-carrefour.json
├── scraper-promos-changomas.js ← Actualiza catalogo-changomas.json
├── scraper-promos-dia.js       ← Actualiza catalogo-dia.json
├── scraper-promos-coto.js      ← Actualiza catalogo-coto.json
├── catalogo-{vea,carrefour,changomas,dia,coto}.json  ← Diccionarios locales (nombre → EAN, + skuId en Vea)
├── promos-{vea,carrefour,changomas,dia,coto}.json    ← Subconjunto de cada catálogo con solo SKUs con descuento
├── compras-real.txt            ← Lista de compras real del usuario (no versionada, personal)
└── compras-prueba.txt          ← Lista de prueba (10 ítems, sí versionada — para probar cambios)
```

`promos-*.json` los generan los scrapers como salida secundaria, pensada para inspección manual rápida (ej. ver el top de descuentos sin filtrar el catálogo completo a mano). `buscar-promos.js` no los lee — no forman parte del flujo en vivo.

**Además de la CLI, el repo tiene dos consumidores más de la misma lógica: el backend y la app mobile/web.**

```
backend/                        ← API HTTP para la app mobile (Express)
├── src/server.js               ← rate limit (sin token, ver backend/README.md § Seguridad)
├── src/routes/catalogo.js      ← GET /api/catalogo/buscar|categorias|producto/:ean (SIN precios)
├── src/routes/comparar.js      ← POST /api/comparar y /api/precios (precio cacheado primero, en vivo solo como fallback)
├── src/routes/misDescuentos.js ← GET /api/mis-descuentos (promos bancarias de TODAS las tarjetas conocidas)
├── src/routes/health.js        ← GET /api/health (frescura de catálogos + caché de precio + último cron + sonda en vivo)
├── src/catalogoUnificado.js    ← búsqueda en memoria sobre catalogo-unificado.json (nombre/EAN, sin precio)
├── src/precioCache.js          ← índice de precio+promo derivado de catalogo-*.json (ver más abajo)
├── src/limitadorGlobal.js      ← semáforo global (no por IP) para el fallback en vivo
├── src/sondaEnVivo.js          ← sonda en background que prueba un EAN conocido cada 15 min (+ uno propio y un CP fijo para La Anónima, que necesita cobertura confirmada para tocar la red)
├── src/cron/unificarCatalogo.js   ← dedupe de los 6 catálogos por EAN (escritura atómica) + descarga de fotos
├── src/cron/descargarImagenes.js  ← baja y guarda fotos de producto una sola vez, redimensionadas
└── src/cron/refrescarCatalogos.js ← corre los 6 scrapers como subprocesos + enriquecimiento de La Anónima + sonda de promos bancarias

app/                            ← App mobile/web (React Native + Expo SDK 57, expo-router)
├── app/(tabs)/index.tsx        ← Buscar/seleccionar productos
├── app/(tabs)/carrito.tsx      ← Carrito + tarjetas con las que se paga
├── app/(tabs)/ajustes.tsx      ← Placeholder (tema, preferencia online/física — sin diseñar todavía)
├── app/resultado.tsx           ← Veredicto: dónde comprar cada cosa
├── app/mis-descuentos.tsx      ← Qué desbloquea cada tarjeta/app/club conocido
└── src/                        ← theme.ts (tokens), api.ts, carrito.tsx, filtrosSupers.tsx, componentes/
```

**Invariante que sigue vigente para la CLI y para `catalogo-unificado.json`:** el índice que ve la app para buscar/seleccionar productos (`catalogo-unificado.json`) sigue excluyendo a propósito los campos de precio — solo resuelve nombre → EAN (+ skuId en Vea). La CLI (`buscar-promos.js`, `AllPromos/core/*`) tampoco cambió: sigue pidiendo precio y promo en vivo en el 100% de los casos, sin caché, como siempre.

**Lo que SÍ cambió (2026-08-13), solo en el backend — `POST /api/comparar` y `POST /api/precios`:** dejaron de pedir precio en vivo a los supers en cada request. Con tráfico concurrente eso multiplicaba conexiones contra Carrefour/Chango Más, que ya rate-limitean con el uso normal de una sola familia (ver `sondaEnVivo.js`). Ahora:

1. **Camino común — `src/precioCache.js`:** lee precio+promo directo de `catalogo-{vea,carrefour,changomas,dia,coto}.json` — los mismos archivos que ya escriben los scrapers diarios y que, además de EAN/nombre, siempre trajeron `precioBase`/`descuentoDirecto`/`promosInternas`/`promosBancarias`/`promocion` capturados en el momento del scraping (antes se descartaban a propósito para el precio; ahora se usan). No reinterpreta promociones por su cuenta: traduce esa forma ya calculada por el scraper a la misma forma que devuelven los parsers en vivo de `core/fetchers.js`, llamando a las mismas funciones de `promo-engine.js` — no hay una segunda lógica de promos que pueda divergir.
2. **Fallback angosto — solo para EANs que el paso 1 no encuentra** (fuera del recorte de ~2550 SKUs por super que ya capturan los scrapers, o producto nuevo): ahí sí se pide en vivo con `AllPromos/core/fetchers.js` sin cambios, pero protegido por un semáforo **global** (`src/limitadorGlobal.js`, no por IP): como mucho 2 búsquedas de este fallback en vuelo a la vez, sin importar cuántos usuarios distintos las disparen. Es lo que evita que el problema de rate-limit original (fetch en vivo en el camino común, multiplicado por usuarios concurrentes) se reintroduzca por otra puerta.
3. **Frescura:** el precio que ve la app tiene la frescura del cron (ver `refrescarCatalogos.js` — se subió la frecuencia a cada 1-2 hs, antes 1 vez por día), no la del momento exacto del click. `GET /api/health` expone `cachePrecio.fuentes[].fecha` para ver esto de un vistazo.

**Cambio de firma en los fetchers:** `parsearProductosCarrefour`/`buscarPorEAN` reciben `{ tarjetas }` por parámetro en vez de leer `mis-tarjetas.json` a nivel de módulo. La CLI le pasa `leerMisTarjetas()` (comportamiento idéntico al anterior); el backend recibe la lista en cada request, porque cada teléfono de la familia puede tener tarjetas distintas.

---

## Cómo correr la app

```bash
# Buscar un producto por nombre
node buscar-promos.js "coca cola 2.25" 2

# Buscar por EAN directo (8-14 dígitos)
node buscar-promos.js 7790895000122 1

# Modo lista (archivo .txt)
node buscar-promos.js --lista compras-real.txt
```

**Formato del archivo de lista:**
```
coca cola 2.25, 2
heineken 473, 4
# esto es un comentario
7790580131364, 1    ← EAN directo también funciona
```

---

## Interactividad

`buscar-promos.js` usa `readline/promises` (nativo de Node, sin dependencias) para preguntar por consola en dos situaciones. Aplica tanto en modo individual como en `--lista` (en `--lista`, uno por uno — se pausa en el ítem que lo necesita y sigue con el siguiente después de responder):

1. **Resolución de nombre ambigua** (`resolverCandidatoInteractivo` en `buscar-promos.js`):
   - **0 candidatos en catálogo local** → puede ser un error de tipeo (ej. "arun" en vez de "atun"). Pregunta: `(r)` reintentar con otro texto, `(v)` buscar en vivo igual (fallback existente, menos confiable), `(s)` saltear este ítem. A propósito **no se intenta autocorregir** el texto — el riesgo de "adivinar mal" y comparar el producto equivocado es peor que preguntar.
   - **2+ candidatos distintos** (ej. "pepitos 357 gr" matchea variantes distintas entre los supers) → pregunta cuál es el correcto, con la opción `0` de comparar los N como antes (comportamiento previo a este cambio).
   - Cualquier respuesta no reconocida (vacío, texto raro) cae al comportamiento más permisivo: "usar todos" para ambigüedad, "mantener cantidad actual" para el punto 2.

2. **Sugerencia de cambio de cantidad** (`detectarCantidadesCandidatas` / `preguntarCambioDeCantidad`): después de mostrar los resultados, si **cualquier** promo de **cualquier** super no llega a activarse con la cantidad pedida (no solo cuando falta 1 unidad — cualquier diferencia cuenta), pregunta si se quiere cambiar la cantidad. Si distintos supers necesitan distintas cantidades para activar promos distintas (ej. Carrefour 2x1 necesita 2, Vea 3x2 necesita 3), **no pregunta dos veces** — muestra una vista previa completa (todos los supers) para cada cantidad candidata en la misma pregunta (`mejorOpcionCombinada()`), y el usuario elige una sola vez con toda la información. Si se acepta un cambio, recalcula y vuelve a mostrar todo con la cantidad nueva — **sin re-consultar las APIs**, porque `precioBase` y `promo` por candidato ya están en memoria y no dependen de la cantidad (solo `calcularCosto()` sí, y ya maneja correctamente los grupos parciales para cualquier cantidad).

**Consecuencia práctica:** el script ya no es "correr y listo" para listas grandes — puede pausar varias veces por ítem. Para probar cambios de código sin responder cada prompt a mano, se puede pipear una secuencia de respuestas por stdin (ej. `printf '0\n\n0\n\n...' | node buscar-promos.js --lista compras-prueba.txt`), pero ojo: si el pipe se cierra (EOF) antes de que el script llegue a la siguiente pregunta, esa pregunta puede quedarse esperando para siempre sin tirar error — hay que dejar el pipe abierto el tiempo suficiente (ver `ask()`, que sí maneja el caso de que el pipe ya esté cerrado del todo, pero no el de "se cerró a mitad de una pregunta que todavía no se hizo").

---

## Arquitectura: separación catálogo local / precios en vivo

```
Usuario escribe "coca cola 2.25, 2"
       ↓
[Catálogo local]  nombre → EAN (7790895000122) + skuId de Vea (si existe)
       ↓
[API en vivo] — en paralelo, 6 supers:
  Vea:        GET /api/catalog_system/pub/products/search?fq=skuId:{id}&sc=34
              POST /_v/search-promotions  → promos activas por skuId
  Carrefour:  GET /api/catalog_system/pub/products/search?fq=alternateIds_Ean:{ean}&sc=1
              (promos embebidas en la respuesta del catálogo)
  Chango Más: GET /api/catalog_system/pub/products/search?fq=alternateIds_Ean:{ean}&sc=1
              (promos embebidas, mismo mecanismo que Carrefour — host masonline.com.ar)
  Día:        GET /api/catalog_system/pub/products/search?fq=alternateIds_Ean:{ean}&sc=1
              (VTEX, mismo mecanismo que Carrefour/Chango Más — host diaonline.supermercadosdia.com.ar)
  Coto:       GET .../products/search/{ean}  (Constructor.io — no es VTEX, busca por texto y filtra el EAN exacto)
  La Anónima: GET /{slug}/n3_{id}/  (HTML de categoría, re-pedido desde catalogo-laanonima.json —
              sin CP con cobertura confirmada, corta antes de pegarle a la red, ver sección propia)
       ↓
[promo-engine.js] → calcula costo real para la cantidad deseada
       ↓
Muestra comparativo + resumen final (+ promos bancarias, ver sección propia)
```

En el backend (`backend/src/precioCache.js`) el mismo cálculo corre sobre precio+promo ya capturados por el cron en vez de pegarle en vivo a los supers en cada request — ver `backend/README.md` para el porqué.

---

## API de Vea — quirks críticos

| Parámetro | Valor |
|-----------|-------|
| Host | `https://www.vea.com.ar` |
| Canal | `sc=34` (único canal activo probado en vea.com.ar — no confirmado que sea "el canal de Luján": ver nota de alcance nacional arriba) |
| Seller preferido | `jumboargentinav700cordoba700` (constante `VEA_SELLER` en `core/fetchers.js`) |
| Cookie | **Ninguna** desde 2026-08-13 (ver quirk de precio desactualizado abajo) — antes se mandaba `vtex_segment=<valor hardcodeado>`, ya no |

**Quirk precio desactualizado con cookie fija (encontrado y corregido 2026-08-13):** las queries en vivo de `core/fetchers.js` (`veaLive`, `veaLiveNombre`, `/_v/search-promotions`) mandaban un `vtex_segment` fijo, capturado una vez, con el `regionId` de una sucursal puntual (Luján). Comparando en vivo con y sin ese cookie sobre 20 productos reales, 4 (20%) mostraban un precio **desactualizado** con el cookie fijo, frente al precio vigente que se obtiene tanto sin ningún cookie como logueado con una cuenta real (bypaseando el caché de CloudFront para descartar que fuera solo una respuesta cacheada). Hipótesis: ese `regionId` puntual queda atado a una foto de precios de esa sucursal que no se actualiza al mismo ritmo que el precio "default" de la web. Fix: se dejó de mandar el cookie por completo — la promo por SKU depende del `seller` en el body, no del cookie, así que no se pierde nada. **No agregar de nuevo un `vtex_segment` fijo sin volver a confirmar que sigue devolviendo precio vigente.**

**Nota sobre el hallazgo de "precio único a nivel país" de abajo:** la comparación entre regiones (Luján/Córdoba/La Plata) que confirmó eso usaba el mismo tipo de cookie de región fija — coincidían entre sí, pero no se comparó contra una sesión sin cookie en ese momento. No se encontró evidencia de que el precio varíe *entre* regiones (sigue sin contradecirse), pero sí de que un cookie de región fija puede quedar desactualizado *en el tiempo* respecto al precio default vigente.

**Quirk seller "1":** al buscar por `skuId`, por EAN o por nombre con `sc=34`, la API siempre devuelve `sellerId = "1"` — nunca `VEA_SELLER` ni ningún otro seller regional (confirmado en vivo el 2026-08-10 contra 5 SKUs distintos, con y sin skuId). Esto es un comportamiento de la plataforma VTEX. El código actual (`parsearProductosVea` en `core/fetchers.js`) hace `sellers.find(s => s.sellerId === VEA_SELLER) || sellers[0]` — como `VEA_SELLER` nunca matchea en la práctica, siempre se usa el fallback `sellers[0]` (que hoy es "1"). La constante `VEA_SELLER` queda como preferencia legacy sin efecto real hoy; no se encontró necesidad de sacarla porque no rompe nada, solo no hace nada.
**Nota histórica:** este documento describía una variable `requireLujanSeller` para decidir si exigir el seller regional según el método de búsqueda. Al verificar contra el código real (2026-08-10) se confirmó que esa variable **no existe ni existió** en `buscar-promos.js` — era documentación desactualizada de una iteración anterior que nunca se corrigió. `core/fetchers.js` (extraído de `buscar-promos.js` sin cambiar comportamiento) tampoco la tiene.

**Búsqueda por skuId es más fiable que por EAN:** `fq=alternateIds_Ean:{ean}` a veces no devuelve resultados en Vea incluso cuando el producto existe. Por eso se prioriza `fq=skuId:{id}` cuando el skuId está en el catálogo local.

**Endpoint de promos:** `POST /_v/search-promotions` con `{ seller, skus: [skuId, ...] }`. Máximo 10 SKUs por request. Devuelve `promotions.generic.promotions[skuId].{ name, effectiveDiscount }`.

**Nombres de promo de Vea:** El campo `name` codifica el tipo:
- `"3x2 GALLETAS | Ofertas Trafico"` → NxM
- `"2x1 ARTESANO | Ofertas Trafico"` → NxM
- `"2do al 80% | Ofertas Trafico"` → Ndo al X% (la 2da unidad cuesta 20%)
- `"25% CALDOS | Ofertas Trafico"` → descuento directo

**Detección de promos online:** El sufijo `| Ofertas Trafico` o `| Ecommerce` indica descuento exclusivo online. Regex: `ONLINE_RE = /trafico|ecommerce|online|web/i`. En la práctica, **todas las promos de Vea son online** (la API `/_v/search-promotions` solo expone promos del canal web). Se marcan con 🌐 en el output.

---

## API de Carrefour — quirks críticos

| Parámetro | Valor |
|-----------|-------|
| Host | `https://www.carrefour.com.ar` |
| Canal | `sc=1` |
| Seller | `"1"` |
| Cookie | No requerida |
| Rate limit | 429 frecuente → el scraper reintenta con 10s de espera, 800ms entre páginas |

**Promos embebidas:** A diferencia de Vea, las promos de Carrefour vienen dentro de la respuesta del catálogo:
- `Price < ListPrice` → descuento directo. Ejemplo: ListPrice=$1000, Price=$660 → 34% off. No son online-only (son precios de góndola).
- `commertialOffer.Teasers[].['<Name>k__BackingField']` → promos condicionales (NxM, Ndo al X%).

**Formato de teasers:** `"Reg-2-80 2do al 80% off"` donde `Reg-N-M` significa N unidades con M% de descuento. `Reg-3-100` = 3ra gratis = 3x2 encubierto. Promos con "Tarjeta", "Cuenta Digital", "Banco" se ignoran (son promos bancarias fuera de scope).

---

## API de Chango Más — quirks críticos

| Parámetro | Valor |
|-----------|-------|
| Host | `https://www.masonline.com.ar` (**changomas.com.ar redirige acá con 301** — Chango Más rebrandeó su web a "Masonline") |
| Canal | `sc=1` |
| Seller | `"1"` (nombre comercial `MasOnline`) |
| Cookie | No requerida |
| Rate limit | 429 y también **502 intermitentes** → el scraper reintenta ambos con 10s de espera |

**No es precio de sucursal, es precio nacional (igual que Carrefour y, según se confirmó después, también Vea):** probamos el endpoint `/api/checkout/pub/regions?postalCode=6700` (Luján) y devuelve una lista de ~10 sellers regionales (`masonlineprod0006`, `masonlineprod0008`, etc. — logística/fulfillment, no pricing). Pero al consultar el catálogo con `sc=1` (sin pasar por esa regionalización), el precio de un mismo `skuId` fue idéntico probando con el `regionId` de Luján y con el de una ciudad lejana (Ushuaia). No se encontró ningún mecanismo de precio diferenciado por sucursal en este endpoint. Conclusión: se trata como un precio online nacional único — **no está confirmado que sea el precio de góndola de una sucursal física puntual**. Si en el futuro se nota una discrepancia grande vs. el precio real en el local, esto es lo primero a revisar.

**Promos embebidas, igual mecanismo que Carrefour:**
- `Price < ListPrice` → descuento directo. **Confirmado en vivo** (ej: Nivea Milk 100ml, $4.449 → $2.891,85 = 35% off).
- `commertialOffer.Teasers[]` / `PromotionTeasers[]` → promos condicionales (NxM, Ndo al X%). **No confirmado:** se escanearon ~450 productos de categorías comunes (gaseosas, aceites, fideos, shampoo, cerveza, galletitas, yerba, desodorante, jabón) más el cluster interno "Ofertas" y **no apareció ningún ejemplo real** de teaser poblado. El parseo está implementado (reutilizando `interpretarPromoCarrefour`, aceptando tanto `t['<Name>k__BackingField']` como `t.Name`/`t.name` por si el formato difiere del de Carrefour) pero nunca se ejecutó contra un caso real. Cuando aparezca la primera promo condicional real de Chango Más, revisar que el parseo funcione como se espera.

**Límite de paginación de ~2550 ítems:** la API de catálogo de Chango Más responde `resources: 0-49/59826` (~59.826 SKUs reales), pero pedir `_from`/`_to` más allá de ~2550 devuelve `400 Bad Request`. Esto **no es exclusivo de Chango Más** — al revisar Vea y Carrefour para este mismo problema, ambos tienen el mismo techo (Vea: catálogo real de 378.449 SKUs, Carrefour: 104.272 — sus `catalogo-*.json` locales también capturan solo los primeros ~2.550-2.600). Es una limitación del endpoint legacy `catalog_system/pub/products/search` de VTEX, no algo introducido por este scraper. Ver "Pendientes" para una posible mejora futura (Intelligent Search API, que sí pagina más allá de ese límite).

---

## API de Día — quirks críticos

**Estado (2026-08-10): investigado y confirmado en vivo, scraper (`scraper-promos-dia.js`) escrito y probado — no integrado todavía al resto de la app** (`core/fetchers.js`, paleta de colores, `PuntosDisponibilidad`). Ver `PLAN_FEATURES_APP.md` para el estado de la integración.

| Parámetro | Valor |
|-----------|-------|
| Host | `https://diaonline.supermercadosdia.com.ar` |
| Canal | `sc=1` (también responde sin `sc`) |
| Seller | `"1"` |
| Cookie | No requerida |
| Rate limit | No se observó 429 en la corrida de prueba (2.550 SKUs, ~500ms entre páginas) |

**Corre sobre VTEX, idéntico a Carrefour** — mismo mecanismo de `Price < ListPrice` para descuento directo y `Teasers` para promos condicionales. `scraper-promos-dia.js` es una copia casi textual de `scraper-promos-carrefour.js` (mismos campos, misma función `parseTeasers`), solo cambia `BASE_URL`.

**Catálogo real: 5.567 SKUs** (`resources: 0-49/5567`) — bastante más chico que los otros 3. Mismo tope de paginación legacy de VTEX que Vea/Carrefour/Chango Más: pedir más allá de `_from=2550` devuelve `400`, así que el catálogo local captura ~2.550 de los 5.567 reales (~46%, la fracción capturada más alta de los 4 supers, justamente por tener el catálogo real más chico).

**Promos confirmadas en vivo:** "2do al 50%", "2do al 70%", "3x2", "2x1" — mismos formatos que ya interpreta `interpretarPromoCarrefour()`, sin cambios necesarios.

**Formato nuevo, no visto en los otros 3 supers:** `"2x$2500"` / `"2x$3500"` — precio fijo total por N unidades, no un % de descuento. El scraper lo captura igual que cualquier otro teaser (guarda el nombre crudo), pero **`promo-engine.js` no lo interpreta hoy** en el cálculo en vivo — no es un problema para el catálogo local (nunca se usa para mostrar precios, ver invariante arriba), pero si se quiere que el comparador en vivo entienda este formato hay que sumar un tipo de promo nuevo (`nxm_precio_fijo` o similar) a `promo-engine.js`. Decisión pendiente, no tomada todavía.

**Imagen:** mismo CDN VTEX (`vteximg.com.br`) que los otros 3 — el truco de redimensionar con `-ancho-alto` en la URL (ver `descargarImagenes.js`) funciona igual.

---

## API de Coto — quirks críticos

**Estado (2026-08-10): investigado en vivo, scraper NO escrito todavía.** A diferencia de Vea/Carrefour/Chango Más/Día, esto no es una reutilización del patrón VTEX — es una integración nueva de cero.

**No corre sobre VTEX.** El `robots.txt` de `coto.com.ar` tiene los parámetros `_DARGS`/`_dyncharset`, característicos de **IBM WebSphere Commerce** (plataforma legacy, sin API REST pública limpia). Pero el buscador/catálogo real que usa el sitio pasa por **Constructor.io**, un servicio de búsqueda/personalización de terceros — es lo que hay que scrapear, no WebSphere directamente.

| Parámetro | Valor |
|-----------|-------|
| Búsqueda directa | `GET https://ac.cnstrc.com/search/{termino}?key=key_r6xzz4IAoTWcipni&c=cio-fe-web-coto-4.2.0&s=1&num_results_per_page=N` |
| Por categoría | `GET https://api.coto.com.ar/api/v1/ms-digital-sitio-bff-web/api/v1/products/categories/{categoryId}?key=key_r6xzz4IAoTWcipni&num_results_per_page=N` |
| Auth | Ninguna más allá del `key` — es una key pública de Constructor.io, visible en el JS del cliente (mismo patrón que una key pública de Algolia). No confirmado que sea estable a largo plazo. |
| Cookie | No requerida |
| Categorías | Códigos propios tipo `catv00002784` (no son categorías VTEX) — para armar un catálogo completo hay que enumerar el árbol de categorías, no hay paginación plana global como en VTEX. Sin resolver todavía. |

**Forma de la respuesta** (`response.results[].data`): `product_main_ean` (EAN, mismo campo que necesitamos), `sku_display_name`, `sku_id`, `price[]` (array **por sucursal**, cada entrada con `store` y `listPrice`), `discounts[]` (promo, ver abajo), `image_url` / `product_medium_image_url` / `product_large_image_url` (ya vienen pre-redimensionadas por Coto — no hace falta el truco de URL que usamos para VTEX).

**Promos confirmadas en vivo:** `discounts[].discountText` tipo `"35%Dto"`, con `discountPrice` y `regularPriceText` (precio final y precio antes del descuento). Es un descuento porcentual directo, mismo concepto que `pct_directo` en `promo-engine.js`, pero con un formato de texto distinto al de Vea/Carrefour — necesita su propio parser si se implementa (`interpretarPromoCoto()` o similar), no es reutilizable tal cual.

**HALLAZGO IMPORTANTE — Coto sí tiene precio por sucursal (a diferencia de Vea/Carrefour/Chango Más/Día, todos confirmados como precio único nacional):**

Se probó con una muestra de 50 productos de consumo común (arroz, leche, yerba, aceite, fideos, azúcar, harina, artículos de limpieza y perfumería, etc.), tomando el array `price[]` completo (no solo un producto) de cada uno:

- **48 de 49 productos analizados (98%) tuvieron precio distinto entre sucursales.** Diferencia mediana: 22%. Máxima observada: 47,7% (Aceite Girasol Cocinero 1.5L, $4.690 en la sucursal más barata vs. $6.925 en el resto).
- **No es variación aleatoria — hay un precio dominante y pocas excepciones puntuales.** En los casos revisados en detalle, entre el 90% y 92% de las sucursales comparten el mismo precio (el "precio dominante"), y solo 1 a 4 sucursales específicas tienen un precio distinto, casi siempre más bajo.
- **Las sucursales que aparecen como "más baratas" no son aleatorias — son casi siempre las mismas dos:**
  - **Sucursal "060" — Flores, Av. J.B. Alberdi 1737/49, CABA.** Precio más bajo en 48 de 49 productos donde apareció (98%).
  - **Sucursal "061" — Once, Alsina 2300, CABA.** Precio más bajo en 28 de 49 (57%).
  - Sucursales "133" y "710" también aparecieron como outlier con frecuencia (87% y 60% respectivamente, en menos productos), pero **no figuran en el buscador público de sucursales** (`https://www.coto.com.ar/sucursales/`, tabla de 122 sucursales con códigos hasta 242) — podrían ser otro formato (mayorista, centro de fulfillment online) no listado ahí. Sin confirmar.
  - Flores y Once son zonas de alta densidad comercial y competencia minorista/mayorista en Capital Federal — es consistente con que Coto compita más agresivo en precio ahí que en el resto de sus sucursales.
- **Fuente de nombres/direcciones de sucursales:** `https://www.coto.com.ar/sucursales/` — es una tabla HTML plana embebida en la página (columnas `Suc`, `Barrio`, `Direccion`, `Tipo`, horarios, `Telefono`), filtrada del lado del cliente con JS; no hay una API separada de sucursales, solo scrapear el HTML de esa página.

**Decisión tomada (2026-08-10, revisable más adelante):** para todos los productos, usar el **valor dominante (moda) del array `price[]`** como "el precio de Coto" en el catálogo — no un promedio, no la sucursal 060 en particular. Es una aproximación consciente: representa correctamente entre el 90-98% de las sucursales reales, con la excepción documentada de Flores/Once (y posiblemente 133/710) que suelen ser más baratas. Revisar esta decisión cuando exista la feature de sucursal/distancia por geolocalización (`PLAN_FEATURES_APP.md`, sección 3) — ahí sí tendría sentido usar el precio real de la sucursal más cercana al usuario en vez de la moda.

---

## API de La Anónima — quirks críticos

**Estado (2026-08-18): investigado en vivo + scraper y fetchers escritos.** El sexto super agregado, y el primero en romper varios supuestos que valían para los otros 5.

**No es VTEX ni un SaaS de terceros.** Es HTML server-rendered propio (Apache detrás de CloudFront). No hay API de catálogo/búsqueda en JSON: cada categoría es una página HTML (`https://www.laanonima.com.ar/{slug}/n3_{id}/`) con los productos embebidos como atributos `data-*` de cada card — `data-codigo` (id interno), `data-nombre`, `data-precio_oferta`, `data-precio_anterior`, `data-rutacategorias` (breadcrumb). `scraper-promos-laanonima.js` los extrae con regex por atributo (no por límite de tag `>`, porque `data-rutacategorias` puede traer un `>` literal en el valor — ver el comentario del parser).

**El precio NO depende de zona/CP.** Se probó explícitamente (spike 2026-08-17): el HTML de una página de categoría es **byte a byte idéntico** pidiéndolo con distintos query params de CP/zona, y `api.laanonima.com.ar/sucursal/{cp}` nunca setea cookie de sesión. Ese endpoint solo informa `super.haySucursalSuper` (¿hay venta de supermercado online en esa zona?) — es un gate de cobertura, no un selector de precio. `core/laanonima-zona.js` lo usa exactamente así.

**Sin EAN.** Ni las cards de categoría ni la página de producto individual (`/{slug}/art_{id}/`) traen EAN, `gtin13`, ni JSON-LD de producto — la única identidad estable es `data-codigo`. `enriquecer-catalogo-laanonima.js` corre después del scraper y le asigna un EAN best-effort emparejando por nombre normalizado (marca + palabras + tamaño/peso, umbral Jaccard 0.8) contra los otros 5 catálogos, solo si hay un único candidato inequívoco (ante ambigüedad, sin EAN). Resultado real: 1794/8197 SKUs (~22%) — el resto son mayormente marca propia "La Anónima" (sin equivalente en otro super, esperado) o variantes que no están en la muestra de ~2550 SKUs de los catálogos VTEX.

**La página de producto individual NO sirve para precio en vivo.** A diferencia de lo esperado, no trae precio server-rendered (se carga por JS aparte contra algún endpoint no identificado). `laAnonimaLiveEAN` en `core/fetchers.js` por eso siempre re-pide `urlCategoria` (guardada por SKU en `catalogo-laanonima.json`) y busca el producto puntual ahí por `data-codigo`, nunca `urlProducto`.

**403 por User-Agent, no rate-limit puro.** El WAF de CloudFront bloquea UAs tipo curl pelado (confirmado: el mismo request con UA de Chrome real funciona). Con espaciado de 1500ms entre categorías y un UA de navegador no volvió a aparecer, salvo picos de requests muy seguidos (por eso el backoff de 10s en 403/429/5xx, igual que Carrefour/Chango Más).

**Sin buscador confiable.** `/catalogo/buscador/{term}` devolvió 403 en el spike (no confirmado si es bloqueo real o transitorio) — `laAnonimaLiveNombre` devuelve `[]` siempre, el camino principal es `buscarPorEAN`.

**Categorías: lista fija de 134 URLs**, obtenida de `sitemap-listados.xml` filtrando a los rubros de supermercado (almacén, bebidas, bebidas alcohólicas, lácteos y frescos, congelados, frutas y verduras, carnicería, limpieza, perfumería, cuidado personal, mascotas) y excluyendo electro/TV/indumentaria/hogar/construcción/celulares — La Anónima vende de todo, pero el comparador es de supermercado. Sin paginación detectada en las categorías probadas.

**Cobertura real:** con cobertura confirmada en Patagonia y La Pampa (Comodoro Rivadavia, Bariloche, Trelew, Santa Rosa, todos zona 8), sin cobertura en Luján/CABA/Bahía Blanca/Mendoza (zona 4, solo división electro). El CP del usuario se guarda en `AllPromos/mi-codigo-postal.json` (CLI, gitignoreado) o en AsyncStorage (app, `allpromos:cpLaAnonima:v1`) — opcional y específico de este super, no se le pregunta a nadie que no lo activa.

---

## Motor de promos (promo-engine.js)

Tres tipos soportados, todos calculados correctamente para cualquier cantidad:

| Tipo | Ejemplo | Cálculo |
|------|---------|---------|
| `pct_directo` | 25% de descuento | precio × (1 − 0.25) × cantidad |
| `nxm` | 3x2 (llevás 3, pagás 2) | grupos de N pagando M + resto al precio lleno |
| `ndo_al_pct` | 2do al 80% de descuento | por cada grupo de N: (N−1) al precio lleno + 1 al 20% del precio |

**"2do al 80%"** = la 2da unidad tiene 80% OFF, es decir, pagás el 20%. No confundir con "80% del precio".

Cada resultado de `interpretarPromo*()` incluye `esOnline: bool` que luego se usa para mostrar 🌐.

**Dos funciones de parseo, no una por super:** `interpretarPromoPorTexto(nombrePromo, effectiveDiscount)` parsea el formato "nombre + descuento efectivo" que expone la API de Vea, y **se reutiliza también para Carrefour** cuando el descuento viene del diff `Price` vs `ListPrice` (se la llama con `nombrePromo=''` para forzar la rama de `effectiveDiscount` genérico). `interpretarPromoCarrefour(teaser)` es aparte porque parsea el formato propio de los teasers de Carrefour (códigos `Reg-N-M`). No están separadas por super sino por formato de origen.

**Promo por producto condicionada a tarjeta propia:** `interpretarTeaserTarjetaPropia(teaser, nombreTarjeta)` interpreta el teaser "Tarjeta Carrefour X%" de Carrefour (único caso implementado hoy — identificado por el campo estructurado `RestrictionsBins`, no por texto). El caller (`core/fetchers.js`, `precioCache.js`) decide si pedirla según si el usuario tiene esa tarjeta.

---

## Promos bancarias "por ticket" (`promos-bancarias.js`)

A diferencia de `promo-engine.js` (promos atadas a un producto), esto cubre el otro tipo de promo: un % de descuento (o cashback) sobre **todo el ticket**, condicionado a día de la semana + banco/tarjeta + a veces canal, con tope de reintegro y a veces monto mínimo — Cencopay, Mi Carrefour, MasClub, y bancos/billeteras de terceros (Santander, Mercado Pago, Cuenta DNI, Banco Provincia, MODO). No depende de qué productos hay en el carrito: se calcula una vez sobre el subtotal ya armado por super.

**Fuente por super — cada uno expone esto de una forma distinta:**

| Super | Mecanismo | Detalle |
|---|---|---|
| Vea | Master Data VTEX | `GET /api/dataentities/JN/documents/bankDiscount?_fields=value,id&an=jumboargentina` — sin auth, `value` es un JSON-string con ~40-190 promos. Mismo endpoint responde en `disco.com.ar`/`jumbo.com.ar` (infra compartida de Cencosud). Sin campo de canal confiable (el booleano `checkout` no correlaciona con nada — no se intenta inferir por regex). |
| Carrefour | GraphQL persistido | 3 operaciones contra `/_v/public/graphql/v1` (`GetPromotions`/`GetBanks`/`GetCards`), identificadas por `sha256Hash` fijo — **pueden romperse sin aviso** si Carrefour actualiza la app `valtech.carrefourar-bank-promotions` (ver `detectarHashRoto`/error `PersistedQueryNotFound`). Trae flags de día y de canal (`hyper`/`market`/`ecommerce`/`express`/`maxi`) estructurados. |
| Chango Más | GraphQL persistido, mismo patrón | App `valtech.gdn-banks-promotions`, mismo riesgo de hash roto. Tiene además `isMasClub` (booleano propio). |
| Día | Bloque de CMS embebido en HTML | No es GraphQL en esta parte del sitio: hay que buscar un `<script>` en `/medios-de-pago-y-promociones` por una marca de bloque (`DIA_BLOQUE_MARCA`) y parsear el JSON balanceado de adentro. Sin campo numérico de %: el porcentaje se extrae con regex del texto legal (`terms`), y si el regex encuentra valores distintos en el mismo texto (tarjetas con varios niveles mezclados) se descarta la promo entera antes que adivinar cuál aplica. |
| Coto | REST propio (ATG/Oracle Commerce) | `getPromocionesMulticanal`, público, sin cookie. El % sí viene limpio (`textoDescuento`, ej. "20% DE DESCUENTO"); el día también. El tope sigue siendo texto libre. |

**Normalización de nombres de banco/tarjeta:** cada super nombra las mismas entidades distinto (ej. "Banco Provincia" solo existe como "Cuenta DNI" en Vea, como dos entidades separadas en Carrefour, y unidas como "Banco Provincia - Cuenta DNI" en Chango Más). `ALIAS_TARJETAS` mapea cada nombre canónico a substrings a buscar, con `EXCLUSIONES_ALIAS` para casos ambiguos (ej. "Banco provincia **de Neuquén**" es una entidad distinta que matchea el substring por error si no se excluye a mano).

**Filtrado conservador:** promos de financiación (cuotas sin interés) se descartan siempre, sin importar la tarjeta — no es un ahorro real de precio. Topes que no se pueden extraer del texto legal con confianza (ejemplos ilustrativos, o dos topes para segmentos distintos sin decir cuál aplica) se dejan en `null` ("sin tope detectado, verificar") en vez de adivinar.

**Qué calcula, en capas:**
1. `promosAplicablesHoy` + `mejorPromoTicket` — la mejor promo bancaria vigente hoy sobre un subtotal dado (respetando tope y monto mínimo).
2. `mejoresDiasTicket` / `elegirMejorDia` — lo mismo repetido para los próximos 7 días, por super de forma independiente y opcionalmente por canal (online/físico) — no busca alinear el mismo día entre supers, ni recalcula qué producto va a cada super.
3. `calcularPlanFinal` — combina, por super, el subtotal ya fijado por las promos de producto con la mejor oportunidad bancaria de los próximos 7 días.
4. `reoptimizarAsignacion` (modo lista) — el ahorro bancario tiene tope en $, así que la asignación óptima de qué producto va a qué super ya no se puede decidir ítem por ítem de forma aislada. Se resuelve con una heurística iterativa (reasignar cada ítem al super de menor precio efectivo, repetir hasta estabilizar) que nunca puede recomendar algo peor que la asignación de hoy — si no mejora, se descarta.

**`GET /api/mis-descuentos`** (backend) usa `obtenerTodasLasPromosBancarias()` — sin filtrar por tarjetas del usuario — para poder mostrar qué desbloquea cada tarjeta conocida aunque el usuario todavía no la haya marcado como propia. La CLI, en cambio, usa `obtenerPromosBancarias()`, que sí filtra por `mis-tarjetas.json`.

**`POST /api/comparar` SÍ conecta este módulo (desde 2026-08-19).** Cuando el body trae `tarjetas` no vacío, `aplicarPromosBancarias()` (`backend/src/routes/comparar.js`) filtra el cache crudo con `filtrarPromosBancariasPorTarjetas()`, lo recorta a promos vigentes **hoy** (`promosAplicablesHoy` — ver por qué en la nota siguiente) y llama `reoptimizarAsignacion()` con los ítems ya resueltos por `calcularResumenFinal`. Si encuentra algo aplicable, pisa `resumen.comprasPorSuper`/`subtotalAsignadoPorSuper`/`requiereOnlinePorSuper`/`totalOptimo` con el resultado y agrega `resumen.bancario` (desglose por super: tarjeta, %, tope, `topeDetectado`, descuento) a la respuesta — ver tipos en `app/src/api.ts` (`RespuestaComparar.resumen.bancario`). Sin `tarjetas`, el comportamiento es idéntico a antes de este cambio (no lee el cache, `bancario: null`).

**Por qué solo "hoy" y no los 7 días que evalúa `reoptimizarAsignacion`/`mejorOportunidadTicket` por default:** las promos de PRODUCTO de los supers cambian día a día, así que mezclar "producto de hoy" con "banco de otro día" daría una recomendación inconsistente (decisión de producto, no reabrir). Por eso `aplicarPromosBancarias()` recorta cada `datosPorSuper[key].promos` con `promosAplicablesHoy()` ANTES de pasarlas a `reoptimizarAsignacion` — sin tocar la firma de esa función ni el comportamiento que sigue usando la CLI sin este recorte.

**Cache de promos bancarias, para que `/api/comparar` no le pegue en vivo a los 5 supers en el camino de request.** `backend/src/cron/refrescarCatalogos.js` (`refrescarPromosBancarias()`, corre en cada pasada del cron) llama `obtenerTodasLasPromosBancarias()` (todas las tarjetas conocidas, sin filtrar) y persiste el resultado crudo en `backend/logs/promos-bancarias.json` (gitignoreado, mismo directorio que `ultimo-refresco.json`). `backend/src/promosBancariasCache.js` lo lee con cache por `mtime` (mismo patrón que `leerCatalogo` de `AllPromos/core/catalogo.js`) y revive `vigenciaDesde`/`vigenciaHasta` a `Date` (se serializan como string en el JSON). Tanto `/api/comparar` como `/api/mis-descuentos` leen de ahí — este último migró su cache TTL-en-memoria propio (que sí pegaba en vivo dentro del request) a esta misma fuente compartida.

**Función nueva en `core/comparador.js`: `comprasPorSuperDesdeAsignacion(items, asignacion, supermercados)`** reconstruye `comprasPorSuper` a partir de la asignación que eligió `reoptimizarAsignacion()` (que puede mover un producto a un super que no es el más barato por unidad, para maximizar el reintegro dentro del tope) — sin modificar `calcularResumenFinal`. Requiere que `items` sea su salida (`calcularResumenFinal(...).items`, ya filtrada/recortada a `supermercados`) y que `asignacion` venga de `reoptimizarAsignacion()` llamado con `itemsReoptimizarDesdeFinal(items, supermercados)` — **no** con `itemsParaReoptimizar()` (que trabaja sobre el `resumen` crudo pre-`calcularResumenFinal` y puede desalinear índices si `supermercados` es un subconjunto). `itemsReoptimizarDesdeFinal` es un `.map()` sin filtrar nada, así el índice i-ésimo siempre corresponde al ítem i-ésimo de `items`.

**Selección de tarjetas del usuario — una sola fuente de verdad.** No existe una lista de tarjetas separada por pantalla: `carrito.tarjetas` (contexto `ProveedorCarrito`/`useCarrito` en `app/src/carrito.tsx`, campo persistido en AsyncStorage bajo `allpromos:carrito:v1` junto con los ítems del carrito) es leída y escrita tanto por el bloque "Mis descuentos" del carrito (`app/app/(tabs)/carrito.tsx`, solo lectura ahí — tocarlo navega a `/mis-descuentos`) como por los switches de `app/app/mis-descuentos.tsx` (`carrito.setTarjetas(...)`). `TARJETAS_DISPONIBLES` en `carrito.tsx` (8 nombres: Mi Carrefour, MasClub, Cencopay, Santander, MODO, Mercado Pago, Cuenta DNI, Banco Provincia) coincide 1 a 1 con `ALIAS_TARJETAS`/`TARJETAS_CONOCIDAS` de `promos-bancarias.js` — mismos strings canónicos, sin mapeo de por medio. Ese array llega tal cual al backend en cada `POST /api/comparar` como `tarjetas`; el backend nunca lee `mis-tarjetas.json` (eso es solo del CLI, ver `leerMisTarjetas()` más abajo).

**Cerrado, no implementar: Cencopay "por producto" (Vea) — la fuente investigada está abandonada (verificado 2026-08-19).** Había una investigación previa sobre un segundo mecanismo de Cencopay (además de la promo "por ticket" de arriba): la página `https://www.vea.com.ar/descuentos-del-dia?type=cencopay` tiene un bloque de contenido (`veaargentina.store-theme@7.x:menu-ofertas`) con categorías de ofertas, cada una con `{offerName, url: "/<clusterId>?map=productClusterIds", initialDate, expiredDate}` — clusters consultables con `fq=productClusterIds:<id>&sc=34` contra la API de búsqueda de Vea. Al verificar en profundidad para implementarlo, aparecieron dos problemas que invalidan la idea:

1. **El parámetro `?type=cencopay` no filtra nada** — el HTML es *byte a byte idéntico* con o sin ese parámetro. El bloque `menu-ofertas` es un menú de navegación genérico y sitewide, no algo específico de Cencopay.
2. **Las únicas 2 categorías cuyo nombre menciona "Cencopay" están vacías de ofertas vigentes.** Revisado el 2026-08-19: de sus 16 ofertas combinadas, **0 estaban vigentes hoy**. Las únicas 2 que alguna vez fueron un % real de descuento (no financiación) — "Hasta 2do al 80% en Lácteos" y "Hasta 2do al 70% en Café" — vencieron el 2025-11-29, **9 meses antes** de esta verificación, mientras que la categoría genérica de al lado ("Especial de la Semana", sin relación con ninguna tarjeta) se actualiza cada semana. El resto de las entradas de "Cencopay" son financiación en cuotas ("15% + 12CSI/18CSI en Heladeras, Aires, Electros"), no descuento de precio.

**Conclusión:** este mecanismo de Cencopay por producto parece discontinuado por Vea, no simplemente "vacío por ahora". No vale la pena construir el fetcher/cron/cache para una fuente que lleva 9 meses sin una oferta real — si en el futuro se quiere retomar, primero hay que confirmar que Vea volvió a usarlo (mismo chequeo: consultar la categoría "Solo por hoy - Cencopay" del bloque `menu-ofertas` y ver si tiene ofertas con `expiredDate` futuro que no sean financiación).

---

## Búsqueda por nombre — matchesBusqueda

```javascript
// Requiere que TODAS las palabras de la búsqueda aparezcan en el nombre del producto
// Normaliza: minúsculas + quita tildes
// Manejo especial: "357g" o "400ml" — si no matchea tal cual,
//   intenta matchear solo el número (para "357g" vs "357 Gr")
const UNIDADES_RE = /^(\d{2,}\.?\d*)(g|gr|grs|kg|ml|cc|l|lt|lts|un|u|unid)$/i;
```

La búsqueda **requiere todas las palabras** — "lata" en "lomo atun lata" fallaría si el catálogo dice "Lomo De Atun Al Natural". Usar términos que aparezcan en el nombre real del producto.

---

## Resolución nombre → EAN

1. Busca en `catalogo-vea.json` primero (para capturar skuId de Vea)
2. Busca en `catalogo-carrefour.json`, `catalogo-changomas.json`, `catalogo-dia.json` y `catalogo-coto.json` (en ese orden) para EANs adicionales
3. Cross-referencia: si el EAN vino de un super que no sea Vea (skuIdVea=null), intenta igualmente buscarlo en el catálogo de Vea por EAN para obtener el skuId
4. Si no hay nada en catálogos locales → **ya no cae directo al fallback en vivo**: pregunta al usuario (ver "Interactividad") porque puede ser un error de tipeo. Solo si el usuario confirma explícitamente, hace fallback a búsqueda en vivo por nombre (menos confiable)

---

## Modo lista — resumen final

Para cada ítem muestra, por cada uno de los supers que tenga resultado:
- Precio (mejor variante) + oferta activa + 🌐 si es online
- Cuál conviene

Al final:
- **Total óptimo** (mezcla de supermercados, el más barato por ítem)
- **Total todo en Vea / todo en Carrefour / todo en Chango Más / todo en Día / todo en Coto / todo en La Anónima**
- Plan de compra: qué comprar en cada super
- Ítems no encontrados

La comparación y el resumen están generalizados sobre el array `SUPERMERCADOS` en `core/fetchers.js` (no en `buscar-promos.js`, que solo lo importa e itera), así que agregar un super nuevo solo requiere sumar una entrada ahí + sus funciones `xLive*`/`parsearProductosX`, sin tocar la lógica de comparación ni de totales.

---

## Catálogos locales — cuándo actualizar

Los catálogos capturan el estado en el momento del scraping. Las **promos cambian semanalmente** (Vea las actualiza los jueves). El script avisa si el catálogo tiene más de 30 días.

```bash
node scraper-promos-vea.js           # ~5 min  → catalogo-vea.json
node scraper-promos-carrefour.js     # ~10 min → catalogo-carrefour.json
node scraper-promos-changomas.js     # ~2 min  → catalogo-changomas.json (tope de ~2550 SKUs, ver quirks arriba)
node scraper-promos-dia.js           # ~2 min  → catalogo-dia.json (tope de ~2550 SKUs, catálogo real más chico)
node scraper-promos-coto.js          # ~min variable → catalogo-coto.json (sin tope de paginación, 57.623 SKUs reales)
node scraper-promos-laanonima.js     # ~5-6 min → catalogo-laanonima.json (134 categorías, sin EAN todavía)
node enriquecer-catalogo-laanonima.js # correr SIEMPRE después del anterior → le asigna EAN best-effort (~22% del catálogo)
```

El scraper de Vea: pagina el catálogo, consulta `/_v/search-promotions` en batches de 10, guarda todo en `catalogo-vea.json` con campo `fecha`.

El scraper de Carrefour: pagina el catálogo con retry en 429, extrae promos de teasers y price diff, guarda en `catalogo-carrefour.json` con campo `fecha`.

El scraper de Chango Más: igual que el de Carrefour (retry en 429 **y 502**), guarda en `catalogo-changomas.json` con campo `fecha`. Solo capturó descuentos directos hasta ahora — ninguna promo tipo teaser confirmada en producción, ver quirks arriba.

El scraper de Día: copia casi textual del de Carrefour (mismo mecanismo VTEX), guarda en `catalogo-dia.json`.

El scraper de Coto: no es VTEX — pagina las categorías de nivel superior de Constructor.io, calcula la moda de `price[]` como `precioBase` (ver "API de Coto" arriba) y guarda en `catalogo-coto.json`.

El scraper de La Anónima: tampoco es VTEX — HTML server-rendered propio, sin API de catálogo en JSON (ver sección propia más abajo). Recorre 134 categorías fijas parseando atributos `data-*` de cada card, guarda `catalogo-laanonima.json` **sin EAN** (La Anónima no lo expone). `enriquecer-catalogo-laanonima.js` corre después y le asigna un EAN best-effort por nombre contra los otros 5 catálogos — sin este segundo paso, La Anónima queda invisible para cualquier comparación por EAN.

En producción, los scrapers los corre `backend/src/cron/refrescarCatalogos.js` como subprocesos (ver `backend/README.md`), seguidos del enriquecimiento de La Anónima y recién después la unificación — no hace falta correrlos a mano salvo para debug local.

---

## Bugs conocidos y fixes históricos

| Problema | Causa | Fix |
|----------|-------|-----|
| Vea devuelve 0 resultados con EAN | `fq=alternateIds_Ean` no confiable en Vea | Usar `fq=skuId:{id}` cuando skuId disponible |
| Seller "1" en vez de `VEA_SELLER` al buscar por skuId | VTEX devuelve seller "1" con sc=34 (confirmado que pasa también por EAN y por nombre, no solo skuId) | `sellers.find(s => s.sellerId === VEA_SELLER) \|\| sellers[0]` — como nunca matchea, usa el fallback (hoy siempre "1") |
| "357g" no matchea "357 Gr" en catálogo | String concatenado sin espacio falla en includes | UNIDADES_RE extrae el número y matchea solo ese |
| Totales con $0 de ahorro | Vea sin resultados → mezcla = todo Carrefour | Corregido al solucionar el bug de seller |
| Decimal "$1.844,999" en resumen | Falta de redondeo antes de `fmt()` | `Math.round(total * 100) / 100` |
| Precio de Vea desactualizado en ~20% de una muestra | Cookie `vtex_segment` fijo con `regionId` de una sucursal puntual, con una foto de precios vieja | Se dejó de mandar el cookie en las queries en vivo de `core/fetchers.js` (ver quirk arriba) |

---

## Alcance y limitaciones

- **4 de los 5 supers VTEX (Vea, Carrefour, Chango Más, Día) muestran precio único a nivel país** — confirmado en vivo el 2026-08-10 para Vea (regionId de Luján vs. Córdoba vs. La Plata, 5 productos, precio idéntico) y ya se sabía para Carrefour y Chango Más; Día corre sobre el mismo mecanismo VTEX y no se encontró evidencia de regionalización tampoco. No está confirmado que ese precio online coincida con el de góndola de una sucursal física en particular.
- **Coto es la excepción: sí varía por sucursal de verdad** (confirmado en vivo, 98% de una muestra de 50 productos con precio distinto entre sucursales). Se usa el precio dominante (moda) como aproximación — ver "API de Coto" arriba para el detalle y las sucursales que sistemáticamente quedan por debajo de esa moda (Flores, Once).
- **La Anónima también es precio único** (confirmado byte a byte en el spike, ver "API de La Anónima" arriba), pero por un motivo distinto a los 4 de VTEX: no es que se haya probado que distintas zonas devuelvan el mismo precio, es que el HTML servido no varía nunca según ningún parámetro de zona — no hay mecanismo de regionalización de precio en absoluto en ese sitio. Lo que sí varía es la **cobertura** (si hay venta de supermercado online en esa zona), que es un dato aparte (`haySucursalSuper`), no de precio.
- Solo **productos envasados con EAN real** (no productos al peso: queso, fiambre, carne)
- **Promos bancarias por producto excluidas del cálculo salvo Mi Carrefour** (única implementada hoy en `core/fetchers.js`/`precioCache.js`) — las promos "por ticket" (Cencopay, bancos de terceros, MasClub) sí están cubiertas, pero en un módulo aparte (`promos-bancarias.js`, ver sección propia).
- El catálogo local puede desincronizarse con productos discontinuados o renombrados
- Las queries en vivo de Vea (`core/fetchers.js`) ya no usan cookie `vtex_segment` (ver quirk de precio desactualizado). El scraper de catálogo local (`scraper-promos-vea.js`) todavía la usa para bajar el catálogo masivo — ahí no importa que se desactualice porque `precioBase` del catálogo local nunca se muestra al usuario (ver invariante en `AllPromos/CLAUDE.md`), pero si ese scraper empieza a devolver 0 resultados o errores, sospechar de esa cookie expirada, no de esto.
- **4 de los 5 catálogos locales capturan solo una fracción del catálogo real** (tope de ~2.550 ítems del endpoint legacy de VTEX — Vea, Carrefour, Chango Más y Día). Coto es la excepción: no tiene ese tope (Constructor.io pagina distinto) y captura sus ~57.623 SKUs reales completos. La búsqueda por nombre puede no encontrar productos poco comunes que no entraron en ese recorte en los otros 4.
- **Promos condicionales (NxM, Ndo al X%) de Chango Más sin confirmar**: el código las soporta pero nunca se observó un ejemplo real en producción.
- El formato **"2x$X" (precio fijo total, no %) de Día** no lo interpreta `promo-engine.js` hoy — el scraper lo captura como texto crudo, pero queda sin promo calculada en vez de romper (mismo criterio que un teaser desconocido de cualquier super).
- **La Anónima solo participa en comparaciones por EAN para ~22% de su catálogo** (1794/8197 SKUs, ver "API de La Anónima" arriba) — no tiene EAN propio, así que el resto (mayormente marca propia) queda fuera de toda comparación cruzada con los otros 5 supers, aunque sí es visible en su propio listado/búsqueda de la app.
- **La Anónima requiere que el usuario tenga cobertura confirmada en su CP** para aparecer en cualquier comparación — sin CP guardado, o con un CP sin venta de supermercado online (todo fuera de Patagonia/La Pampa al momento de escribir esto), se excluye en silencio, igual que cualquier super que el usuario no activó.

---

## Pendientes / ideas futuras

- ~~Agregar Chango Más~~ / ~~agregar Día y Coto~~ ✅ hecho — ver las secciones de API de cada uno arriba
- ~~Preguntar ante ambigüedad de nombre y ante promos que no llegan a activarse~~ ✅ hecho (CLI) — ver "Interactividad"
- ~~Interfaz web~~ ✅ hecho — `app/` (React Native + Expo, corre igual en web) sobre `backend/`
- ~~Promos bancarias por ticket (Cencopay, bancos, MasClub)~~ ✅ hecho — ver `promos-bancarias.js` arriba
- Confirmar el formato real de `Teasers`/`PromotionTeasers` de Chango Más cuando aparezca la primera promo condicional (hoy sin verificar)
- Evaluar migrar los scrapers VTEX (Vea/Carrefour/Chango Más/Día) a la Intelligent Search API (`/api/io/_v/api/intelligent-search/...`) para superar el tope de ~2.550 ítems del endpoint legacy
- Renovar automáticamente la `vtex_segment` cookie de Vea via browser headless (solo aplica a `scraper-promos-vea.js` — las queries en vivo ya no la usan)
- Interpretar el formato "2x$X" (precio fijo) de Día en `promo-engine.js` — ver "Alcance y limitaciones" arriba
- Promos por producto condicionadas a tarjeta propia más allá de Mi Carrefour: MasClub (Cencopay por producto se descartó, ver "Cerrado, no implementar" en la sección de promos bancarias arriba — fuente abandonada por Vea)
- ~~Conectar promos bancarias con tope a `/api/comparar`~~ ✅ hecho (2026-08-19) — ver "`POST /api/comparar` SÍ conecta este módulo" en la sección de promos bancarias arriba
- Si el prompt de cambio de cantidad se siente repetitivo en listas grandes (CLI), evaluar juntar todas las oportunidades de toda la lista y preguntar una sola vez al final en vez de uno por uno
