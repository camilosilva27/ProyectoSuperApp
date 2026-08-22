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
│   ├── fetchers.js             ← consultas en vivo a las 7 APIs + SUPERMERCADOS
│   └── comparador.js           ← mejor opción, sugerencia de cantidad, resumen final
├── promo-engine.js             ← Motor de cálculo de promos (por producto)
├── promos-bancarias.js         ← Promos "por ticket": bancos/billeteras/tarjetas propias (ver sección propia más abajo)
├── mis-tarjetas.json           ← Tarjetas del usuario para la CLI (no versionado — personal, ver .gitignore)
├── scraper-promos-vea.js       ← Actualiza catalogo-vea.json
├── scraper-promos-carrefour.js ← Actualiza catalogo-carrefour.json
├── scraper-promos-changomas.js ← Actualiza catalogo-changomas.json
├── scraper-promos-dia.js       ← Actualiza catalogo-dia.json
├── scraper-promos-coto.js      ← Actualiza catalogo-coto.json
├── scraper-promos-jumbo.js     ← Actualiza catalogo-jumbo.json (misma cuenta VTEX que Vea, ver sección propia)
├── scraper-promos-disco.js     ← Actualiza catalogo-disco.json (idem)
├── catalogo-{vea,carrefour,changomas,dia,coto,jumbo,disco}.json  ← Diccionarios locales (nombre → EAN, + skuId en Vea/Jumbo/Disco)
├── promos-{vea,carrefour,changomas,dia,coto,jumbo,disco}.json    ← Subconjunto de cada catálogo con solo SKUs con descuento
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
├── src/sondaEnVivo.js          ← sonda en background que prueba un EAN conocido cada 15 min
├── src/cron/unificarCatalogo.js   ← dedupe de los 7 catálogos por EAN (escritura atómica) + descarga de fotos
├── src/cron/descargarImagenes.js  ← baja y guarda fotos de producto una sola vez, redimensionadas
└── src/cron/refrescarCatalogos.js ← corre los 7 scrapers como subprocesos + sonda de promos bancarias

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

1. **Camino común — `src/precioCache.js`:** lee precio+promo directo de `catalogo-{vea,carrefour,changomas,dia,coto,jumbo,disco}.json` — los mismos archivos que ya escriben los scrapers diarios y que, además de EAN/nombre, siempre trajeron `precioBase`/`descuentoDirecto`/`promosInternas`/`promosBancarias`/`promocion` capturados en el momento del scraping (antes se descartaban a propósito para el precio; ahora se usan). No reinterpreta promociones por su cuenta: traduce esa forma ya calculada por el scraper a la misma forma que devuelven los parsers en vivo de `core/fetchers.js`, llamando a las mismas funciones de `promo-engine.js` — no hay una segunda lógica de promos que pueda divergir.
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
| Cookie | **Ninguna** desde 2026-08-20 en todo el código (ver quirk de precio desactualizado abajo) — antes se mandaba `vtex_segment=<valor hardcodeado>` |

**Quirk precio desactualizado con cookie fija (encontrado 2026-08-13, arreglado a medias esa vez, recién resuelto del todo 2026-08-20):** las queries en vivo de `core/fetchers.js` (`veaLive`, `veaLiveNombre`, `/_v/search-promotions`) mandaban un `vtex_segment` fijo, capturado una vez, con el `regionId` de una sucursal puntual (Luján). Comparando en vivo con y sin ese cookie sobre 20 productos reales, 4 (20%) mostraban un precio **desactualizado** con el cookie fijo, frente al precio vigente que se obtiene tanto sin ningún cookie como logueado con una cuenta real (bypaseando el caché de CloudFront para descartar que fuera solo una respuesta cacheada). Hipótesis: ese `regionId` puntual queda atado a una foto de precios de esa sucursal que no se actualiza al mismo ritmo que el precio "default" de la web. Fix del 13-08: se dejó de mandar el cookie en `core/fetchers.js` — la promo por SKU depende del `seller` en el body, no del cookie, así que no se pierde nada.

**Lo que ese fix no cubrió:** `scraper-promos-vea.js` (el que genera `catalogo-vea.json`) seguía mandando la misma cookie hardcodeada, sin que nadie lo tocara. Y ese mismo día 13-08, por otro motivo (evitar bloqueos de IP por volumen, ver `backend/README.md` § "Caché de precio"), el backend pasó a servir precio desde `precioCache.js` — que lee directo de `catalogo-*.json` — como camino común de `/comparar` y `/precios`, dejando el fetch en vivo (ya arreglado) como fallback raro. O sea: el fix quedó aislado en el código que la app casi no usa, mientras el camino que sí usa siempre seguía con la cookie rota. Confirmado en vivo el 2026-08-20 barriendo el catálogo completo (2.551 SKUs): **10,6% marcados `IsAvailable:false` con la cookie vieja**, de los cuales el 84% (muestra de 25) eran productos reales y disponibles con precio distinto al mostrado (a veces mucho más caro, a veces más barato, sin patrón de dirección) — no eran SKUs discontinuados, como sí pasa en Coto (ver más abajo). Fix definitivo: se sacó la cookie también de `scraper-promos-vea.js`. Sin cookie, el catálogo completo bajó a **0,04%** (1/2.551) marcados no disponibles, ese caso sí genuino (coincide con la página real). **No agregar de nuevo un `vtex_segment` fijo sin volver a confirmar que sigue devolviendo precio vigente — y esta vez, confirmarlo tanto en `core/fetchers.js` como en `scraper-promos-vea.js`.**

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
- `commertialOffer.Teasers[]` / `PromotionTeasers[]` → promos condicionales (NxM, Ndo al X%). **No confirmado:** se escanearon ~450 productos de categorías comunes (gaseosas, aceites, fideos, shampoo, cerveza, galletitas, yerba, desodorante, jabón) más el cluster interno "Ofertas" y **no apareció ningún ejemplo real** de teaser poblado. El parseo está implementado (reutilizando `interpretarPromoCarrefour`, aceptando tanto `t['<Name>k__BackingField']` como `t.Name`/`t.name` por si el formato difiere del de Carrefour) pero nunca se ejecutó contra un caso real. Cuando aparezca la primera promo condicional real de Chango Más, revisar que el parseo funcione como se espera. **Reverificado 2026-08-19** apuntando específicamente a si había algo de MasClub por producto (ver "Cerrado, no implementar" abajo): ~1050 SKUs más en vivo (búsquedas por término + paginación directa) además del catálogo local ya scrapeado (2550 SKUs, 10/08) — **0 teasers de cualquier tipo** en los ~3600 SKUs combinados, y 0 apariciones del string "masclub" en el JSON crudo de `commertialOffer`. Sigue siendo "nunca visto", ahora con mucho más volumen verificado.
- **Cerrado, no implementar: MasClub "por producto" — investigado 2026-08-19, sin evidencia de que exista.** A diferencia de Mi Carrefour (que sí tiene teasers de tarjeta propia a nivel de producto, ver `interpretarTeaserTarjetaPropia` en `promo-engine.js`), Chango Más no puebla `Teasers`/`PromotionTeasers` a nivel de producto para NINGÚN emisor — ni MasClub ni terceros — a pesar de correr la misma infraestructura VTEX (ver punto de arriba). No es una fuente "abandonada" como Cencopay (que tuvo ofertas reales hace 9 meses): acá nunca se observó contenido, en ~3600 SKUs distintos revisados en dos sesiones de scrapeo. La promo de MasClub "por ticket" (`isMasClub`, `promos-bancarias.js:240-282`) es un mecanismo aparte y sigue funcionando normalmente — esto solo cierra la idea de un mecanismo *adicional* por producto. Si en el futuro aparece un teaser real de MasClub, retomar en `promo-engine.js` (función hermana de `interpretarTeaserTarjetaPropia`) — no vale la pena construirlo sin un ejemplo real del formato.

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

**Formato "Nx$M", no visto en los otros 3 supers:** `"2x$2500"` / `"2x$3500"` — precio fijo TOTAL por N unidades, no un % de descuento. **Implementado (2026-08-19):** `interpretarPromoCarrefour()` en `promo-engine.js` lo reconoce como tipo `oferta_precio_fijo` (`precioFijoTotal` en vez de `descuentoPct`/`pagaM`) y `calcularCosto()` lo resuelve igual que `nxm` pero cobrando `precioFijoTotal` por grupo completo en vez de una fracción del precio unitario. Investigado antes de implementar (2026-08-19, scan en vivo de 2500 SKUs + snapshot del 10/08): siempre N=2 en la práctica, ~1% de los SKUs totales pero **~12% de las promos activas** de Día en un momento dado, casi exclusivo de golosinas/alfajores/chocolates, con descuentos reales de 13%-45% (mayoría 26-35%) — nada trivial. Un mismo SKU rota entre este formato y otros ya soportados (2x1, 2do al X%) de un día a otro, así que el 12% no son siempre los mismos productos.

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

**SKUs fantasma — productos discontinuados con precio congelado (encontrado y corregido 2026-08-20):** Constructor.io mantiene indexados productos que ya no se venden en ninguna sucursal, con el último `price[]` que tuvieron cuando sí tenían stock — a veces muy viejo. Caso real que disparó la investigación: buscando "puré de tomate arcor" aparecían 3 resultados — $650 y $110 (ambos exclusivos de Coto) más el real a $1.110 (presente en los otros supers también). Los primeros dos no aparecen buscando manualmente en coto.com.ar. La señal es el campo `store_availability` (array de sucursales con stock) — viene vacío (`[]`) en los discontinuados, con 30+ sucursales en los vigentes. Ninguno de los dos EAN coincidía entre sí ni con el real (no es un bug de matching): son 3 SKUs distintos, legítimos como registros, pero 2 de los 3 no deberían mostrarse. Confirmado en la categoría "Puré de Tomate" completa (53 SKUs, el 100% real de Coto para esa categoría): 28 con `store_availability` vacío, 25 con sucursales reales — los 25 reales ocupan los primeros puestos en el orden de relevancia de Constructor.io, los 28 fantasma quedan después (un solo caso, no generaliza que siempre sea así). Fix: `scraper-promos-coto.js` (dentro de `scrapearCategoria`) y `parsearProductosCoto` en `core/fetchers.js` descartan cualquier SKU con `store_availability` vacío, tanto al armar el catálogo como en la consulta en vivo. Efecto en el catálogo completo: bajó de ~5.000 a **2.889 SKUs reales** (ver "Alcance y limitaciones" — la cifra de 5.000/11.586 de la decisión del 19-08 queda desactualizada, la real hoy es más chica).

**Nota — no es lo mismo que el bug de Vea:** en Coto, los SKUs fantasma están genuinamente descatalogados (ausentes del sitio real, EAN propio, no aparecen buscando a mano). El problema de Vea encontrado el mismo día (ver "API de Vea" arriba) es distinto: productos reales y disponibles que mostraban precio/disponibilidad mal por una cookie de sesión vencida, no por estar discontinuados. Se investigó también Carrefour (10/2.559 = 0,4%, genuino — mayormente verdura/fruta fresca con `errMsg` explícito), Chango Más (0/2.550) y Día (0/2.550): ninguno de los tres tiene ninguno de los dos problemas.

**Corrección a la nota anterior — el 0,4%/0%/0% de arriba solo miraba el fetch en vivo, no el catálogo cacheado (bug encontrado y corregido 2026-08-21):** la conclusión del 20-08 de que Carrefour/Chango Más/Día "no tienen ninguno de los dos problemas" fue sobre `core/fetchers.js`, que sí filtra con un guard `price > 0`. Pero desde el 13-08 el camino real que usa la app es `backend/src/precioCache.js`, que lee directo de `catalogo-*.json` — y los scrapers (`scraper-promos-{carrefour,changomas,dia,vea,jumbo,disco}.js`) nunca leían `IsAvailable`, solo `Price`. Un SKU sin stock en VTEX viene con `Price: 0, IsAvailable: false`, y esos 6 scrapers lo guardaban igual en el catálogo con precio $0. Caso real que disparó la investigación: "Aceite de Oliva Oliovita Virgen Extra 500ml" (EAN 7798061190312) en Chango Más — sin stock, `Price: 0`, cacheado y mostrado como $0 en la app; no era un duplicado, es un EAN real distinto de la variante "Clásico" (que sí tiene precio). Fix: los 6 scrapers ahora descartan el SKU (`continue`, no lo empujan a `allSkus`) si `commertialOffer.IsAvailable` es `false` — mismo criterio que ya usaba Coto para sus SKUs fantasma (ver arriba). Además, `entradasVtexConTeasers` en `precioCache.js` ahora exige `precioActual > 0` en su fallback, como red de seguridad mientras un `catalogo-*.json` viejo (generado antes del fix) sigue en caché hasta la próxima corrida del cron. Coto no tenía este bug — ya filtraba por `store_availability` desde el 20-08.

---

## API de Jumbo/Disco — quirks críticos

**Estado (2026-08-21): investigado en vivo, scraper escrito y validado (`scraper-promos-jumbo.js`/`scraper-promos-disco.js`), wireados en `core/fetchers.js`, `core/catalogo.js`, `promos-bancarias.js` y el cron del backend.**

**Jumbo, Disco y Vea son la MISMA cuenta VTEX** ("Jumbo Argentina IO", `sellerName` confirmado en la respuesta pública del catálogo) — mismo `skuId`/EAN/master data, confirmado en vivo pidiendo el mismo producto a los 3 dominios. No son 3 integraciones independientes: son 3 storefronts (banners) sobre un único catálogo.

- **Sin `sc=` especial** (a diferencia de Vea, que necesita `sc=34` por una razón histórica propia de esa marca) — no se encontró evidencia de variación regional de precio en jumbo.com.ar ni disco.com.ar.
- **El mecanismo de promo por producto es el de Vea (`_v/search-promotions`), NO el de Teasers/PromotionTeasers embebidos** que usan Día/Chango Más/Carrefour — confirmado escaneando ~2500 SKUs de cada sitio (ninguno tenía Teasers poblados, y el descuento directo `Price < ListPrice` da falsos positivos ~90% en productos pesados/por kg, así que no es una señal usable acá).
- **El `seller` que hay que mandarle a `_v/search-promotions` NO es el `"1"` que devuelve el catálogo público** (`sellers[0].sellerId`, que siempre es `"1"` en los 3 sitios) — es el mismo string interno que ya usaba Vea, `jumboargentinav700cordoba700`. Confirmado en vivo: con seller `"1"` el endpoint responde 200 pero vacío siempre (probado contra ~2500 SKUs de Jumbo, 0 promos); con el seller de Vea aparecen ~660 promos reales de inmediato. Es un dato de la cuenta VTEX compartida, no algo específico de Vea — por eso funciona igual en los 3 dominios.
- **Las promos de producto son de cuenta completa, no de sitio**: la misma promo (mismo `ref_id`) aparece idéntica en Jumbo, Disco y Vea vía este endpoint. Sí puede haber diferencia de **precio base** entre banners para el mismo skuId (confirmado en vivo: un producto a $5.800 en Jumbo/Disco y $5.790 en Vea el mismo día) — no es 100% redundante comparar los 3 por separado.
- **Mismo tope legacy de paginación (~2550 ítems)** que Vea/Carrefour/Chango Más/Día — confirmado con 400 en `_from=2550+`. Catálogo real de cada uno es gigante (Jumbo ~325k, Disco ~379k, igual de recortado que los otros VTEX de la lista).
- **Alto solapamiento de EAN con Vea** (mismo master data): de ~2550 SKUs scrapeados en cada uno, solo ~1.330 EAN combinados son genuinamente nuevos respecto del catálogo de Vea — el catálogo unificado creció de ~9.700 a 9.556... en realidad prácticamente no creció (los catálogos de Carrefour/Chango Más/Día estaban desactualizados al momento de esta medición, así que la comparación exacta no es limpia, pero el orden de magnitud confirma que NO se dispara la RAM de la VM — ver "Alcance y limitaciones" y `catalogo-coto-capado-ram.md` en la memoria del proyecto).

**Promos bancarias — bug encontrado y corregido en Vea al agregar Jumbo/Disco:** el feed de `promos-bancarias.js` (`fetchVea()`, ahora generalizado a `fetchCencosud()`) sale de un Master Data VTEX (`/api/dataentities/JN/documents/bankDiscount?an=jumboargentina`) que es **de cuenta completa, no de sitio** — confirmado pegándole al mismo endpoint desde los 3 dominios: devuelve exactamente el mismo array. Cada entrada tiene un campo `websites` que indica a qué banner aplica esa promo puntual (ej. `["discoargentina"]`, `["veaargentina"]`). **La versión anterior de `fetchVea()` no filtraba por ese campo** — tomaba las ~193 entradas sin mirarlo, así que un usuario de Vea podía ver una promo bancaria exclusiva de Disco (o viceversa). Se corrigió filtrando por `websites`.

**Resuelto — dos tags para Jumbo, no es online/física:** el feed usa tanto `"jumboargentina"` como `"jumboargentinaio"` para Jumbo. Se investigó a fondo (2026-08-21) si eran "sitio online" vs. "sucursal física" — descartado: existe una promo real ("Jumbo Mas Personal", 20%, texto legal "Exclusivo Canal ONLINE") tagueada SOLO `jumboargentina` (sin `"io"`), así que esa hipótesis no explica los datos. Los tags se repiten dentro de la misma entrada una vez por cada sucursal física alcanzada (mismo patrón que `veaargentina`/`discoargentina`, que aparecen igual de repetidos) — lo más probable es que sean dos identificadores de sucursal/sistema coexistentes del banner Jumbo (código de tienda viejo vs. nuevo), no dos sitios distintos. `WEBSITE_TAGS_POR_SUPER.Jumbo` en `promos-bancarias.js` usa la **unión** de ambos — filtrar solo por `"io"` habría descartado la promo de "Jumbo Mas Personal" del ejemplo.

**Dos bugs más del mismo tipo, encontrados recién al probar el server real (no al leer el código) — listas de supers hardcodeadas en el backend que Jumbo/Disco no alcanzaban a atravesar aunque `core/fetchers.js` ya los tuviera:**

1. **`backend/src/precioCache.js`** — el índice de precio+promo cacheado (fuente primaria de `POST /api/comparar`) tenía su propio array `FUENTES` de 5 supers y un objeto por-EAN hardcodeado `{ vea:[], carr:[], changomas:[], dia:[], coto:[] }`. Sin el fix, `/api/comparar` simplemente no devolvía a Jumbo/Disco en su camino rápido (habría caído al fallback en vivo angosto, o ni eso). Se agregaron a `FUENTES`, se generalizó `entradasVea()` → `entradasCencosud(sku, superNombre)`, y el objeto por-EAN ahora se construye desde `FUENTES` en vez de listarse a mano.
2. **`backend/src/promosBancariasCache.js`** — `revivirFechas()` reconstruía el resultado del cron con un array fijo `SUPER_KEYS` de 5 supers, así que aunque `logs/promos-bancarias.json` en disco ya tenía las promos de Jumbo/Disco (el cron sí las escribía bien), esta función las descartaba antes de que `GET /api/mis-descuentos` llegara a verlas. Se hizo genérico sobre `Object.entries(datosPorSuper)`.

**Verificado end-to-end contra un server real levantado en esta sesión** (no solo llamando las funciones sueltas): `GET /api/health`, `GET /api/catalogo/buscar?supers=jumbo`, `POST /api/comparar` (Jumbo/Disco aparecen con precio y promo correctos, ej. Coca Cola 2,25L con "2do al 50%" a $8.700 en ambos) y `GET /api/mis-descuentos` (MODO ya lista a `jumbo`/`disco` en `supers` junto con los demás) — los 3 bugs de arriba estaban activos hasta que se corrigieron en esta misma sesión.

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

**MasClub "por ticket" — confirmado en vivo el 2026-08-19: sí existe y es real.** El usuario vio en `masonline.com.ar` un cartel de "15% con MasClub, miércoles y jueves, sin tope" — no confundir con MasClub "por producto" (descartado más arriba, sección de Chango Más): esto es el mecanismo por ticket, que ya estaba implementado (`isMasClubField` en `fetchChangoMas()`). Consulta en vivo a la API de Chango Más lo confirmó byte a byte: `{descuentoPct: 0.15, dias: [3,4], tope: null, canales: ['express']}`. El `canales: ['express']` es solo metadata (no filtra nada en el camino de `/api/comparar`/`/api/mis-descuentos`, que no llaman `promoAplicaEnCanal` — ver Fase 2 en `promos-bancarias.js`, es lógica exclusiva de la CLI). Lo que sí pasó: **el cache de producción (`backend/logs/promos-bancarias.json`) no existía en el momento de la verificación** — por eso la app no mostraba la promo aunque el mecanismo funcionaba. Se regeneró a mano; el cron (cada 2hs) la mantiene fresca de ahí en más. Causa raíz de por qué faltaba el archivo: no determinada con certeza (el log del cron mostraba "OK" en corridas previas, así que no fue un error de fetch/escritura reportado).

**Función nueva en `core/comparador.js`: `comprasPorSuperDesdeAsignacion(items, asignacion, supermercados)`** reconstruye `comprasPorSuper` a partir de la asignación que eligió `reoptimizarAsignacion()` (que puede mover un producto a un super que no es el más barato por unidad, para maximizar el reintegro dentro del tope) — sin modificar `calcularResumenFinal`. Requiere que `items` sea su salida (`calcularResumenFinal(...).items`, ya filtrada/recortada a `supermercados`) y que `asignacion` venga de `reoptimizarAsignacion()` llamado con `itemsReoptimizarDesdeFinal(items, supermercados)` — **no** con `itemsParaReoptimizar()` (que trabaja sobre el `resumen` crudo pre-`calcularResumenFinal` y puede desalinear índices si `supermercados` es un subconjunto). `itemsReoptimizarDesdeFinal` es un `.map()` sin filtrar nada, así el índice i-ésimo siempre corresponde al ítem i-ésimo de `items`.

**Selección de tarjetas del usuario — una sola fuente de verdad.** No existe una lista de tarjetas separada por pantalla: `carrito.tarjetas` (contexto `ProveedorCarrito`/`useCarrito` en `app/src/carrito.tsx`, campo persistido en AsyncStorage bajo `allpromos:carrito:v1` junto con los ítems del carrito) es leída y escrita tanto por el bloque "Mis descuentos" del carrito (`app/app/(tabs)/carrito.tsx`, solo lectura ahí — tocarlo navega a `/mis-descuentos`) como por los switches de `app/app/mis-descuentos.tsx` (`carrito.setTarjetas(...)`). `TARJETAS_DISPONIBLES` en `carrito.tsx` (8 nombres: Mi Carrefour, MasClub, Cencopay, Santander, MODO, Mercado Pago, Cuenta DNI, Banco Provincia) coincide 1 a 1 con `ALIAS_TARJETAS`/`TARJETAS_CONOCIDAS` de `promos-bancarias.js` — mismos strings canónicos, sin mapeo de por medio. Ese array llega tal cual al backend en cada `POST /api/comparar` como `tarjetas`; el backend nunca lee `mis-tarjetas.json` (eso es solo del CLI, ver `leerMisTarjetas()` más abajo).

**Cerrado, no implementar: Cencopay "por producto" (Vea) — la fuente investigada está abandonada (verificado 2026-08-19).** Había una investigación previa sobre un segundo mecanismo de Cencopay (además de la promo "por ticket" de arriba): la página `https://www.vea.com.ar/descuentos-del-dia?type=cencopay` tiene un bloque de contenido (`veaargentina.store-theme@7.x:menu-ofertas`) con categorías de ofertas, cada una con `{offerName, url: "/<clusterId>?map=productClusterIds", initialDate, expiredDate}` — clusters consultables con `fq=productClusterIds:<id>&sc=34` contra la API de búsqueda de Vea. Al verificar en profundidad para implementarlo, aparecieron dos problemas que invalidan la idea:

1. **El parámetro `?type=cencopay` no filtra nada** — el HTML es *byte a byte idéntico* con o sin ese parámetro. El bloque `menu-ofertas` es un menú de navegación genérico y sitewide, no algo específico de Cencopay.
2. **Las únicas 2 categorías cuyo nombre menciona "Cencopay" están vacías de ofertas vigentes.** Revisado el 2026-08-19: de sus 16 ofertas combinadas, **0 estaban vigentes hoy**. Las únicas 2 que alguna vez fueron un % real de descuento (no financiación) — "Hasta 2do al 80% en Lácteos" y "Hasta 2do al 70% en Café" — vencieron el 2025-11-29, **9 meses antes** de esta verificación, mientras que la categoría genérica de al lado ("Especial de la Semana", sin relación con ninguna tarjeta) se actualiza cada semana. El resto de las entradas de "Cencopay" son financiación en cuotas ("15% + 12CSI/18CSI en Heladeras, Aires, Electros"), no descuento de precio.

**Conclusión:** este mecanismo de Cencopay por producto parece discontinuado por Vea, no simplemente "vacío por ahora". No vale la pena construir el fetcher/cron/cache para una fuente que lleva 9 meses sin una oferta real — si en el futuro se quiere retomar, primero hay que confirmar que Vea volvió a usarlo (mismo chequeo: consultar la categoría "Solo por hoy - Cencopay" del bloque `menu-ofertas` y ver si tiene ofertas con `expiredDate` futuro que no sean financiación).

---

## Tope de supers — cantidad máxima de viajes (hoja "Qué supers comparar")

Preferencia persistente (2026-08-21), independiente de `supers_activos` pero siempre aplicada
junto con él: "de los supers que elegí, a cuántos como mucho estoy dispuesto a ir". Cambia el
resultado del cálculo, no es una preferencia de vista/orden.

**`elegirSupersConTope(resumen, supermercados, tope)` en `AllPromos/core/comparador.js`** —
dado el `resumen` ya armado (mismo formato que recibe `calcularResumenFinal`) y un `tope`
entero, prueba TODAS las combinaciones de `supermercados` de tamaño exacto `tope` (helper
privado `combinaciones()`, no hace falta probar tamaños menores: agregar un super más a elegir
nunca puede empeorar el resultado) y devuelve la mejor, rankeada por
`[noEncontrados.length, totalOptimo]` **en ese orden** — cobertura completa del carrito antes
que precio, porque un combo que "gana" en precio pero deja afuera al único super que vende
cierto producto empujaría ese ítem a `noEncontrados` y se vería más barato sin serlo de
verdad. No hace falta recalcular precios por combinación: `mejores` (dentro de `resumen`) ya
tiene el mejor precio de cada super de forma independiente de qué otros supers se estén
considerando. Si `tope` es inválido o `>=` la cantidad de supers, devuelve `supermercados` sin
tocar (no hay nada que elegir). Con como mucho 7 supers, el peor caso es C(7,3)=35
combinaciones — aritmética en memoria sobre datos ya traídos, sin pegarle de nuevo a ninguna
API externa. Cubierto por un test suite con oráculo independiente (ver
`AllPromos/core/comparador.test.js`, corrido con `node --test`) — no confiar solo en la lectura
del código para este tipo de lógica combinatoria, un bug de tie-break o de ranking es fácil de
no notar a ojo.

**En `backend/src/routes/comparar.js`**, `POST /api/comparar` acepta un `tope` opcional en el
body. Cuando restringe algo (`tope < supers.length`), el handler:
1. Calcula `supermercadosUsados = elegirSupersConTope(...)` y usa ESE subconjunto (no
   `supermercados`) para `calcularResumenFinal`, `aplicarPromosBancarias`, `linksCarrito`, y el
   campo `supermercados` de la respuesta.
2. Recorta `opciones`/`mejor`/`sugerenciaCantidad` de cada ítem a `supermercadosUsados`
   (`filtrarOpcionesPorSupers`/`filtrarSugerenciaPorSupers` en `comparador.js`) — esos tres se
   calculan sobre TODOS los supers elegidos antes de saber qué subconjunto ganó (hace falta el
   precio de cada uno para poder elegir), así que sin este recorte `item.mejor` podría señalar
   un super fuera del plan capado, inconsistente con `resumen.comprasPorSuper`.
3. Calcula también `resumen.totalOptimoSinTope` (mismo carrito, sin el tope, con la MISMA
   reoptimización bancaria aplicada para que ambos números estén en pie de igualdad si hay
   tarjetas seleccionadas) — es la base para que la app muestre cuánto "cuesta" el tope.

**En la app**, `topeSupers` vive en el mismo contexto que `supersActivos`
(`ProveedorFiltrosSupers` en `app/src/filtrosSupers.tsx`), sincronizado en el mismo blob de
Supabase (`perfil_usuario.tope_supers`, migración `0007_tope_supers.sql`). Sentinel `0` = "sin
tope explícito / Los N" — no se persiste el número N literal porque queda obsoleto en cuanto
`supersActivos` cambia; `normalizarTope(tope, cantidadElegidos)` (duplicada, a propósito, en
`filtrosSupers.tsx` y en `HojaSupers.tsx` — son dos lugares distintos con su propio estado
local/persistido, no vale la pena una dependencia cruzada por una función de una línea) trata
cualquier tope `>=` la cantidad elegida como "sin tope".

**La hoja "Qué supers comparar" (`HojaSupers.tsx`) calcula su propia preview de costo en
vivo**, llamando ella misma a `/api/comparar` con el carrito real (`useCarrito()`) — la hoja
hoy solo se abre desde Buscar (`app/(tabs)/index.tsx`), que no tiene un plan de carrito
calculado (eso solo existe en Resultado, después de armar el carrito), así que no hay otro
dato del que partir. Debounced (400ms) + contador de secuencia para descartar respuestas fuera
de orden si el usuario sigue tocando el segmentado mientras hay una consulta en vuelo (mismo
patrón que `usePreciosProgresivos` en la pantalla de Buscar). Con carrito vacío, o con "Los N"
seleccionado, no se llama al backend.

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
- **Total todo en Vea / todo en Carrefour / todo en Chango Más / todo en Día / todo en Coto**
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
node scraper-promos-coto.js          # ~1 min  → catalogo-coto.json (recortado a propósito a ~5.000 SKUs, ver quirks arriba)
```

El scraper de Vea: pagina el catálogo, consulta `/_v/search-promotions` en batches de 10, guarda todo en `catalogo-vea.json` con campo `fecha`.

El scraper de Carrefour: pagina el catálogo con retry en 429, extrae promos de teasers y price diff, guarda en `catalogo-carrefour.json` con campo `fecha`.

El scraper de Chango Más: igual que el de Carrefour (retry en 429 **y 502**), guarda en `catalogo-changomas.json` con campo `fecha`. Solo capturó descuentos directos hasta ahora — ninguna promo tipo teaser confirmada en producción, ver quirks arriba.

El scraper de Día: copia casi textual del de Carrefour (mismo mecanismo VTEX), guarda en `catalogo-dia.json`.

El scraper de Coto: no es VTEX — pagina las categorías de nivel superior de Constructor.io, calcula la moda de `price[]` como `precioBase` (ver "API de Coto" arriba) y guarda en `catalogo-coto.json`.

En producción, los scrapers los corre `backend/src/cron/refrescarCatalogos.js` como subprocesos (ver `backend/README.md`) y recién después la unificación — no hace falta correrlos a mano salvo para debug local.

---

## Bugs conocidos y fixes históricos

| Problema | Causa | Fix |
|----------|-------|-----|
| Vea devuelve 0 resultados con EAN | `fq=alternateIds_Ean` no confiable en Vea | Usar `fq=skuId:{id}` cuando skuId disponible |
| Seller "1" en vez de `VEA_SELLER` al buscar por skuId | VTEX devuelve seller "1" con sc=34 (confirmado que pasa también por EAN y por nombre, no solo skuId) | `sellers.find(s => s.sellerId === VEA_SELLER) \|\| sellers[0]` — como nunca matchea, usa el fallback (hoy siempre "1") |
| "357g" no matchea "357 Gr" en catálogo | String concatenado sin espacio falla en includes | UNIDADES_RE extrae el número y matchea solo ese |
| Totales con $0 de ahorro | Vea sin resultados → mezcla = todo Carrefour | Corregido al solucionar el bug de seller |
| Decimal "$1.844,999" en resumen | Falta de redondeo antes de `fmt()` | `Math.round(total * 100) / 100` |
| Precio de Vea desactualizado en ~20% de una muestra (2026-08-13) | Cookie `vtex_segment` fijo con `regionId` de una sucursal puntual, con una foto de precios vieja | Se dejó de mandar el cookie en las queries en vivo de `core/fetchers.js` (ver quirk arriba) |
| Promo real de MasClub (15% mié/jue, sin tope) no aparecía en la app aunque el usuario la vio en el sitio de Chango Más | `backend/logs/promos-bancarias.json` no existía en producción — `/api/health` nunca chequeaba esta caché (`fechaGeneracionPromosBancarias()` existía en `promosBancariasCache.js` "para /api/health" pero no estaba conectada) | Se regeneró el cache a mano y se conectó `fechaGeneracionPromosBancarias()` a `/api/health` (2026-08-19): ahora reporta `promosBancarias: {generado, horas}` y un problema si falta o supera `horasMaximoPromosBancarias` (6hs, `config.js`) |
| Precio de Vea desactualizado en ~10,6% del catálogo (2026-08-20) — el fix del 13-08 de arriba no alcanzó | El fix del 13-08 solo tocó `core/fetchers.js`; `scraper-promos-vea.js` seguía mandando la misma cookie fija, y desde ese mismo día `precioCache.js` (que lee de `catalogo-*.json`) pasó a ser el camino común de precio en la app, no el fetch en vivo ya arreglado | Se sacó la cookie también de `scraper-promos-vea.js` (ver quirk de Vea arriba) |
| Coto mostraba productos discontinuados con precio viejo (ej. "puré de tomate arcor" a $650/$110 en vez de $1.110) | `store_availability` (disponibilidad real por sucursal) nunca se leía — ni el scraper ni el fetch en vivo lo chequeaban | `scraper-promos-coto.js` y `parsearProductosCoto` en `core/fetchers.js` descartan SKUs con `store_availability` vacío (ver quirk de Coto arriba) |

---

## Alcance y limitaciones

- **4 de los 5 supers VTEX (Vea, Carrefour, Chango Más, Día) muestran precio único a nivel país** — confirmado en vivo el 2026-08-10 para Vea (regionId de Luján vs. Córdoba vs. La Plata, 5 productos, precio idéntico) y ya se sabía para Carrefour y Chango Más; Día corre sobre el mismo mecanismo VTEX y no se encontró evidencia de regionalización tampoco. No está confirmado que ese precio online coincida con el de góndola de una sucursal física en particular.
- **Coto es la excepción: sí varía por sucursal de verdad** (confirmado en vivo, 98% de una muestra de 50 productos con precio distinto entre sucursales). Se usa el precio dominante (moda) como aproximación — ver "API de Coto" arriba para el detalle y las sucursales que sistemáticamente quedan por debajo de esa moda (Flores, Once).
- Solo **productos envasados con EAN real** (no productos al peso: queso, fiambre, carne)
- **Promos bancarias por producto excluidas del cálculo salvo Mi Carrefour** (única implementada hoy en `core/fetchers.js`/`precioCache.js`) — las promos "por ticket" (Cencopay, bancos de terceros, MasClub) sí están cubiertas, pero en un módulo aparte (`promos-bancarias.js`, ver sección propia).
- El catálogo local puede desincronizarse con productos discontinuados o renombrados
- Ninguna query de Vea (ni en vivo en `core/fetchers.js`, ni el scraper de catálogo `scraper-promos-vea.js`) usa cookie `vtex_segment` desde 2026-08-20 (ver quirk de precio desactualizado). **Corrección a una nota vieja de esta misma sección:** durante un tiempo esto decía que no importaba que el scraper tuviera la cookie desactualizada porque `precioBase` del catálogo local "nunca se muestra al usuario" — eso dejó de ser cierto el 2026-08-13, cuando `precioCache.js` pasó a servir precio directo desde `catalogo-*.json` como camino común de `/comparar`/`/precios` (ver `backend/README.md` § "Caché de precio"). El invariante de `AllPromos/CLAUDE.md` ("los precios nunca salen del catálogo local") sigue siendo cierto para la CLI, pero ya **no** para el backend/app desde esa fecha — hay que actualizar esa nota si se vuelve a tocar.
- **Los 5 catálogos locales capturan solo una fracción del catálogo real de cada super**, por dos motivos distintos. Vea, Carrefour, Chango Más y Día: tope de ~2.550 ítems del endpoint legacy de VTEX (no es una decisión, es un techo de la API — ver más abajo el detalle). **Coto: recortado A PROPÓSITO a ~5.000 SKUs desde el 2026-08-19**, más el filtro de SKUs fantasma agregado el 2026-08-20 (ver quirk de Coto arriba) — el resultado real hoy es **2.889 SKUs**, no 5.000: casi la mitad de lo que Constructor.io devuelve como "más relevante" por categoría tiene 0 disponibilidad real. La búsqueda por nombre puede no encontrar productos poco comunes que no entraron en ese recorte, en ningún de los 5.

  **Decisión (2026-08-19): capar Coto en vez de ampliar los otros 4.** Surgió directamente de la investigación de RAM de abajo — Coto era el responsable de que el catálogo unificado fuera ~5x más grande que la suma de los otros 4 juntos (57.789 de 60.611 productos). Motivo para no lamentarlo: **un producto que existe SOLO en Coto no le sirve al fin de la app** (comparar entre supers) — no hay nada con qué compararlo. `scraper-promos-coto.js` ahora mide el tamaño real de cada una de las 10 categorías con un pedido liviano (`num_results_per_page=1`) y reparte un objetivo de ~5.000 SKUs proporcional a ese tamaño (`repartirPresupuesto()`), scrapeando cada categoría con el sort default de Constructor.io — que sin pasar `sort_by` ya es `relevance` (`sort_options[].status === "selected"`, confirmado en vivo) — no es literalmente "más vendidos" como el `OrderByTopSaleDESC` de VTEX (Constructor.io no expone un sort de ventas), pero es la mejor aproximación disponible y no cuesta nada extra. **Resultado medido en el momento (19-08)**: catálogo unificado real bajó de 60.611 a 11.586 productos; la búsqueda (`catalogoUnificado.buscar()`) bajó de ~50-84ms a **6-8ms**. Elimina por completo el riesgo de out-of-memory de la VM (ver medición abajo) con margen de sobra — incluso deja presupuesto para eventualmente ampliar un poco el tope de los otros 4 supers sin volver a acercarse al límite.

**Actualización (2026-08-20), tras el filtro de SKUs fantasma de Coto (ver quirk arriba):** con `catalogo-coto.json` en 2.889 SKUs reales (no 5.000) y `catalogo-vea.json` regenerado sin la cookie rota, `catalogo-unificado.json` bajó de 11.586 a **9.706 productos únicos por EAN** (`node backend/src/cron/unificarCatalogo.js`) — bien lejos todavía del límite de RAM que motivó el cap original, así que no cambia ninguna decisión, solo el número.

  **Investigado a fondo el 2026-08-19 (replanteado: no es "migrar de API", ver "Pendientes" abajo):**
  1. **La API "Intelligent Search" de VTEX (candidata para reemplazar el endpoint legacy) tiene su propio techo, más generoso pero igual de duro**: confirmado en vivo contra Día — `page` no puede superar 50, `count` (tamaño de página) no puede superar 100 → **máximo 5.000 ítems por consulta** (`{"data":"Page should not exceed 50 pages."}` / `{"data":"Count should not exceed 100 products."}`, mensajes de error reales de la API). Casi el doble del ~2.550 legacy, pero lejos de alcanzar para Vea (378.449 reales), Carrefour (104.272) o Chango Más (59.826) en una sola consulta sin filtrar.
  2. **El techo es por consulta, no global** — igual que el legacy. Los scrapers de hoy hacen UN solo loop plano sin filtrar por categoría (`scraper-promos-changomas.js` pide `_from`/`_to` sobre el catálogo entero, sin `fq=`), así que chocan el techo enseguida. Para cubrir el catálogo real con cualquiera de las dos APIs hace falta partir en muchas consultas más chicas por categoría — mismo patrón que ya usa `scraper-promos-coto.js` con su lista fija de categorías.
  3. **Ejemplo medido para Vea**: el árbol de categorías tiene 24 raíces y 458 hojas hasta profundidad 3 (`/api/catalog_system/pub/category/tree/3`). Pero las categorías raíz YA son demasiado grandes para una sola consulta: Almacén 38.952 ítems, Bebidas 15.326, Limpieza 12.295, Lácteos 7.239 — todas superan los dos techos (2.550 y 5.000). Hay que partir por categorías de nivel 2 o 3 (458 hojas), y probablemente algunas hojas grandes necesiten un cuarto nivel de partición (por marca, por rango de precio) para entrar bajo el techo. Esto es trabajo real de scraper, no un cambio de URL.
  4. **Riesgo de bloqueo al scrapear: bajo, medido en Día** — burst de 15 requests simultáneas y varias secuencias sin espaciado especial contra la Intelligent Search, sin un solo 429/403 (misma infra VTEX IO que ya se scrapea hoy sin problema). Carrefour y Chango Más ya tienen rate-limiting conocido HOY en el endpoint legacy (429/502, con retry de 10s) — no probado si la Intelligent Search se comporta distinto ahí, habría que confirmarlo en esos 2 antes de migrar.
  5. **El verdadero riesgo no es el scraping (corre en un cron cada 2hs, nadie espera eso) — es la búsqueda en vivo de la app.** `backend/src/catalogoUnificado.js` hace un filtro LINEAL en memoria sobre TODO el catálogo unificado en cada request de `/api/catalogo/buscar` (se dispara en cada tecla que escribe cualquier usuario, con 300ms de debounce) — el propio comentario del archivo ("a este volumen ~5-7k productos un filtro lineal alcanza") ya está desactualizado: hoy el catálogo unificado real ya es ~60.611 productos (por el catálogo completo de Coto), y una cobertura completa de los 4 restantes lo llevaría a un estimado de ~500-600 mil. **Medido en Mac con el código real (`catalogoUnificado.buscar()`) contra un catálogo sintético de 606.110 productos** (10x el actual, réplica del catálogo real de producción): cada búsqueda pasa de tardar ~55-220ms (hoy, a 60k) a **~270-315ms constantes, sin importar la especificidad de la query** — el costo lo domina escanear las 606k entradas, no filtrar los resultados. La carga inicial del archivo (una vez por cambio del cron) pasa de ser instantánea a **~1,5 segundos** de bloqueo del proceso. Como el escaneo es síncrono, bloquea el único hilo de Node — mientras resuelve la búsqueda de un usuario, el server no puede atender NINGUNA otra request (ni de otro usuario, ni `/api/comparar`) hasta terminar.
  6. **Repetido en la VM real (e2-micro): no es "más lento", es un crash por falta de memoria.** Se armó el mismo catálogo sintético de 606k directamente en la VM (copia aislada en `/tmp`, sin tocar el server corriendo ni el archivo real) y al intentar cargarlo, el proceso de Node murió con `FATAL ERROR: Reached heap limit — JavaScript heap out of memory`. La VM tiene **958 MB de RAM total** (`free -h`), con **hoy, a la escala actual (~60k productos), ya usando 293 MB de swap** — sin margen para un catálogo 10x más grande. El backend real (`allpromos-backend.service`) hoy usa solo 60 MB de RAM porque el catálogo actual es chico (22 MB de JSON); un catálogo de ~600k (≈223 MB de JSON crudo, varias veces más una vez parseado a objetos JS con el índice precalculado) no entra en esta máquina. La búsqueda a 60k en la VM real, para referencia, midió ~50-84ms (similar a la Mac) — el problema a escala real no es la velocidad de CPU, es la RAM.
  7. **Conclusión revisada: el bloqueante no es solo "indexar la búsqueda" — es la RAM de la VM.** Ampliar cobertura de catálogo con la arquitectura actual (todo el catálogo cargado entero en memoria de un solo proceso Node) directamente no es viable en esta VM sin subir de máquina o cambiar a un motor que no requiera tener todo el dataset en RAM (una base de datos real con índices en disco, por ejemplo). Indexar la búsqueda (punto 5) seguiría haciendo falta para la velocidad, pero primero hay que resolver que el dato ni siquiera entra en memoria.
  8. **Los ~2.550 capturados hoy no son arbitrarios ni cambian de corrida a corrida: son los más vendidos.** Confirmado en vivo en Chango Más: dos requests idénticos devolvieron los mismos productos en el mismo orden (estable, no aleatorio), y el orden default (sin pasar `O=`) resultó **idéntico** al de pedir explícitamente `O=OrderByTopSaleDESC` — la API ordena por ventas cuando no se pide otra cosa. Esto es una buena noticia parcial: lo que falta cubrir por el tope de paginación es la cola larga (productos poco vendidos/de nicho), no una mezcla al azar que podría estar excluyendo productos populares.
- **Promos condicionales (NxM, Ndo al X%) de Chango Más sin confirmar**: el código las soporta pero nunca se observó un ejemplo real en producción.

---

## Pendientes / ideas futuras

- ~~Agregar Chango Más~~ / ~~agregar Día y Coto~~ ✅ hecho — ver las secciones de API de cada uno arriba
- ~~Preguntar ante ambigüedad de nombre y ante promos que no llegan a activarse~~ ✅ hecho (CLI) — ver "Interactividad"
- ~~Interfaz web~~ ✅ hecho — `app/` (React Native + Expo, corre igual en web) sobre `backend/`
- ~~Promos bancarias por ticket (Cencopay, bancos, MasClub)~~ ✅ hecho — ver `promos-bancarias.js` arriba
- Confirmar el formato real de `Teasers`/`PromotionTeasers` de Chango Más cuando aparezca la primera promo condicional (hoy sin verificar)
- ~~Evaluar migrar los scrapers VTEX a la Intelligent Search API para superar el tope de ~2.550~~ **cerrado (2026-08-19), resuelto en la dirección opuesta.** Investigado a fondo (ver "Alcance y limitaciones" arriba): no era "migrar de API" (la Intelligent Search tiene su propio techo, 5.000/consulta, sigue siendo por consulta — ejemplo medido en Vea: hasta 458 categorías-hoja necesarias para cubrir todo) y el bloqueante real no era el scraping sino la RAM de la VM (958 MB, e2-micro) — probado que un catálogo unificado ~10x más grande crashea el proceso por out-of-memory. En vez de ampliar cobertura de Vea/Carrefour/Chango Más/Día, se decidió **recortar Coto** (que aportaba 57.789 de los 60.611 productos del catálogo unificado) a ~5.000 SKUs más relevantes por categoría — ver "Decisión (2026-08-19): capar Coto" en "Alcance y limitaciones" arriba. Un producto que existe solo en Coto no le sirve al fin de la app (no hay nada con qué compararlo), así que no es una pérdida real. Resultado: catálogo unificado 60.611 → 11.586, búsqueda 50-84ms → 6-8ms. Vea/Carrefour/Chango Más/Día siguen con su tope de ~2.550 (queda como posible pendiente futuro, ahora con mucho más margen de RAM disponible si alguna vez se quiere ampliar).

  **Se evaluó (2026-08-19) llevar también estos 4 supers a ~5.000 (como Coto) y se descartó por ahora — el atajo fácil no funciona igual acá.** La razón por la que el recorte de Coto fue simple es que Constructor.io ya ordena por `relevance` (correlaciona con lo importante) tanto para consultas sin filtrar como por categoría. Se probó el mismo supuesto para VTEX y **no se sostiene**:
  1. **Confirmado en Vea, Chango Más y Día: el default del endpoint LEGACY (sin pasar `O=`) es idéntico a pedir explícitamente `O=OrderByTopSaleDESC`** — mismos IDs, mismo orden, en los 3 casos probados. O sea, los ~2.550 que ya se capturan hoy con el endpoint de siempre SÍ son los más vendidos (ver hallazgo ya documentado arriba).
  2. **Pero el default de la Intelligent Search para una consulta sin filtrar (`query=&map=`) es un orden DISTINTO, no correlaciona con lo anterior** — probado en Día: los IDs devueltos no coinciden en nada con la lista de `OrderByTopSaleDESC`. Además, pasarle `sort=OrderByTopSaleDESC` explícito devuelve `400 "Unsupported sort"`, y la respuesta no expone `sort_options` para saber qué alternativas hay (a diferencia de Coto/Constructor.io, acá viene `"sorts": []` siempre vacío).
  3. **Conclusión:** el endpoint legacy da "más vendidos" gratis pero tiene el techo duro de ~2.550; la Intelligent Search llega a 5.000 pero, sin filtrar por categoría, en un orden que no es de fiar — traer los próximos ~2.450 de ahí no serían "los siguientes más vendidos", sería más bien ruido sin criterio claro. La única forma de llegar a 5.000 por super preservando "más vendidos primero" sería repetir el patrón de Coto (pedir por categoría, con el `O=OrderByTopSaleDESC` del propio legacy esta vez, no la Intelligent Search) — pero a diferencia de las 10 categorías parejas de Coto, acá las categorías son mucho más desparejas (Vea: la categoría raíz "Almacén" sola ya tiene 38.952 ítems, muy por encima de cualquier techo) y requeriría bajar varios niveles con recursión adaptativa (hasta las 458 hojas medidas en Vea) — un scraper bastante más complejo que el de Coto, no un cambio de un número. **Decisión del usuario (2026-08-19): no vale la pena ahora** — el problema urgente (RAM) ya se resolvió con el recorte de Coto; Coto queda con el doble de cobertura (~5.000) que los otros 4 (~2.550), aceptado como asimetría razonable.
- ~~Renovar automáticamente la `vtex_segment` cookie de Vea via browser headless~~ **descartado (2026-08-20)** — se encontró que la cookie causaba precios desactualizados en ~10% del catálogo (ver quirk de Vea arriba) y que no hace falta ninguna cookie para tener precio correcto. Se sacó del código por completo en vez de automatizar su renovación; no reabrir esto sin antes releer esa nota.
- ~~Sacar La Anónima de la app~~ ✅ hecho (2026-08-20) — el WAF de CloudFront bloqueaba la IP de la VM de forma recurrente (no un bloqueo puntual, volvía una y otra vez, afectando tanto al scraper como al fetch de precio en vivo) sin una forma confiable de evitarlo, y era el super con menos cobertura y sin EAN propio (~22% matcheado por nombre). Se sacó por completo: scrapers y módulos exclusivos borrados (`scraper-promos-laanonima.js`, `enriquecer-catalogo-laanonima.js`, `resolver-ean-laanonima-flix.js`, `aplicar-ean-flix-laanonima.js`, `core/laanonima-zona.js`, `mi-codigo-postal.js`, `backend/src/routes/laanonima.js`), y su entrada removida de `core/catalogo.js`, `core/fetchers.js`, `precioCache.js`, `sondaEnVivo.js`, `comparar.js` (incluido el gate de cobertura por CP y el parámetro `codigoPostal` de `/api/comparar`/`/api/precios`, que ya no tenía otro uso), `unificarCatalogo.js`, `refrescarCatalogos.js` y `server.js`, más el contexto/modal de CP y las listas de supers del frontend (`api.ts`, `comunes.tsx`, `theme.ts`, `HeaderNegro.tsx`, `filtrosSupers.tsx`). Quedan **5 supers activos**: Vea, Carrefour, Chango Más, Día, Coto. Ver `PLAN_SACAR_LAANONIMA.md` para el detalle completo del trabajo.
- ~~Interpretar el formato "2x$X" (precio fijo) de Día en `promo-engine.js`~~ ✅ hecho (2026-08-19) — tipo `oferta_precio_fijo`, ver "API de Día" arriba
- ~~Promos por producto condicionadas a tarjeta propia más allá de Mi Carrefour: MasClub~~ descartado (2026-08-19) — ver "Cerrado, no implementar" en "API de Chango Más" arriba, sin evidencia de que exista (mismo cierre que Cencopay, ver sección de promos bancarias)
- ~~Conectar promos bancarias con tope a `/api/comparar`~~ ✅ hecho (2026-08-19) — ver "`POST /api/comparar` SÍ conecta este módulo" en la sección de promos bancarias arriba
