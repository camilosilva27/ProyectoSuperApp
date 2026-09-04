# Contexto técnico — AllPromos

Herramienta personal para comparar precios y promociones entre **Vea**, **Carrefour**, **Chango Más**, **Día**, **Coto**, **Jumbo** y **Disco** — 7 supermercados. Empezó como una CLI **interactiva** (`buscar-promos.js`) y hoy tiene además una app mobile/web (`app/`, React Native + Expo) sobre un backend HTTP (`backend/`) que reusa exactamente la misma lógica de `AllPromos/core/*`. El usuario (en Luján, Buenos Aires) busca o escribe el producto (o una lista) y recibe precios en vivo, con promos calculadas correctamente para la cantidad que quiere comprar. La CLI pregunta por consola (usando `readline` nativo de Node, sin dependencias) cuando hay ambigüedad o cuando cambiar la cantidad activaría una promo — ver "Interactividad" más abajo; la app resuelve la ambigüedad de nombre de otra forma (el usuario elige de una lista, ver `app/app/(tabs)/index.tsx`) y muestra la sugerencia de cantidad como un aviso no bloqueante en vez de una pregunta.

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
├── scraper-coto-por-ean.js     ← Actualiza catalogo-coto.json (busca por EAN, ver "Coto: de recorte por categoría a búsqueda por EAN")
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

**EAN compartido entre pack y unidad suelta (encontrado y corregido 2026-08-21, misma investigación de arriba):** al auditar todo el catálogo cruzando precio por EAN entre los 5 supers con catálogo local, aparecieron 4 cervezas (Stella Artois y Andes) donde Vea vende un pack de 6 bajo el MISMO EAN que Día usa para la lata suelta — ej. EAN 7792798010592: Vea "Cerveza Rubia **x 6 Un** 473cc Stella Artois" a $22.990, Día "Cerveza Vintage Stella Artois 473ml" a $3.150. No es un bug de scraping ni de matching: es un error de catalogación de Vea/Día que reusa el mismo código de barras para dos productos de tamaño distinto. Comparar esos precios como si fueran el mismo producto exagera el ahorro ~6-7x. 2 de los 4 casos ya se resuelven solos con el fix de disponibilidad de arriba (Vea los marca `IsAvailable:false`). Para los otros 2 (y cualquier caso similar futuro), se agregó `AllPromos/core/empaquetado.js`: detecta un multiplicador de empaquetado en el nombre (regex `x N Un/Unid/Unidad(es)`) y, si difiere entre supers para el mismo EAN **y además** el precio real difiere más de 2,5x, vacía la comparación completa para ese EAN (ninguno de los lados se descarta individualmente — no hay forma confiable de saber cuál de los dos lee bien el empaquetado real). Se llama desde `buscarPorEAN` (fetchers.js, fetch en vivo) y `precioPorEAN` (precioCache.js, camino cacheado), así CLI y backend quedan consistentes.

**Por qué el nombre solo no alcanza como señal — confirmado en vivo:** mirar solo si el multiplicador del nombre coincide entre supers, sin exigir también la diferencia de precio, marcaba **195 de 2.289 EAN comparables (8,5%)** como "inconsistentes" — casi todos falsos positivos, porque cada super abrevia "unidades" distinto o ni la menciona ("Pack x5 108 g" en Carrefour vs "x 5 Un" en Vea para la MISMA galletita real). Exigiendo también que el precio difiera >2,5x, la misma auditoría completa cae a exactamente los 2 casos reales que quedan (los otros 2 ya filtrados por disponibilidad) — no hace falta volver a relajar este umbral sin repetir esta auditoría contra el catálogo completo primero.

**Limitación conocida, no cubierta:** si un super vende un pack sin ningún indicador de cantidad en el nombre (pasó con "Cerveza Ipa 473ml Andes Origen" de Vea, un pack de 6 real sin "x N Un" en el texto), el heurístico de nombre no lo detecta aunque el precio sí sea un outlier — en ese caso puntual no importó porque el mismo SKU también estaba sin stock (`IsAvailable:false`) y ya se filtra por el otro fix, pero en general un pack sin indicador de cantidad en el nombre puede pasar sin marcarse. No se amplió a "cualquier outlier de precio entre supers" porque eso sí generaría falsos positivos reales (ofertas puntuales, Coto con su precio dominante por sucursal, etc.) — ver umbral de 2,5x arriba, elegido para separar este caso específico, no para detectar cualquier diferencia de precio grande.

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

**Promo por producto condicionada a tarjeta propia:** `interpretarTeaserTarjetaPropia(teaser, nombreTarjeta)` interpreta el teaser "Tarjeta Carrefour X%" de Carrefour (único caso implementado hoy — identificado por el campo estructurado `RestrictionsBins`, no por texto). El caller (`core/fetchers.js`, `precioCache.js`) decide si pedirla según si el usuario tiene esa tarjeta — le pasa `'Tarjeta Carrefour Crédito'` como `nombreTarjeta` (corregido 2026-09-04, antes decía `'Mi Carrefour'`, ver nota abajo).

**Corregido 2026-09-04 — "Mi Carrefour", "Cuenta Digital" y "Tarjeta Carrefour Crédito" son 3 cosas distintas.** Investigado en 2 rondas (la primera asumió mal que el 2do nivel era la tarjeta Prepaga; la segunda, pedida por el usuario para revisar por qué el scraper "no traía bien" ese nivel, corrigió eso). Confirmado buscando en vivo (micarrefour.com.ar, carrefourbanco.com.ar, y el HTML real de `carrefour.com.ar/promociones`):
- **Mi Carrefour Clásico** — se identifica solo con el DNI (a veces + un prefijo) en la caja. No hace falta tarjeta ni cuenta de ningún tipo. Descuentos chicos y acotados (ej. 10% para jubilados/ANSES ciertos días).
- **Cuenta Digital de Carrefour Banco** — billetera/cuenta digital real (hay que abrirla: registro + aprobación + app), del mismo banco propio de Carrefour (Banco de Servicios Financieros) que emite la tarjeta de crédito. Da los descuentos de súper que Carrefour promociona junto con la Tarjeta Prepaga (10% sáb/dom, 15% viernes, 10% Express a diario) — **pero el texto legal de esos descuentos en `carrefourbanco.com.ar/beneficios-prepaga/` dice explícitamente "ABONANDO CON CUENTA DIGITAL", no "abonando con tarjeta prepaga"**: son cosas distintas aunque se publiciten en la misma página. La tarjeta Prepaga física en sí, fuera de la Cuenta Digital, solo tiene un beneficio confirmado (5% en combustible AXION, tope $2-3mil) y ninguno de súper — por eso NO se modela como tarjeta separada (se probó primero como "Tarjeta Carrefour Prepaga" con un alias que nunca iba a matchear nada, y se corrigió a "Cuenta Digital Carrefour" que sí tiene promos reales).
- **Tarjeta Carrefour Crédito** — tarjeta de crédito real del mismo banco. Los descuentos más grandes (20% los martes sin tope, 3 cuotas sin interés, el 15% que ya se calculaba en la app).

Antes el código trataba las 3 como una sola cosa ("Mi Carrefour"), lo cual sobreestimaba el descuento de quien solo tiene el nivel Clásico (caso real: usuario pagó con DNI en caja y el descuento fue menor al que mostraba la app). Se separaron en `ALIAS_TARJETAS`/`TARJETAS_CONOCIDAS` (`promos-bancarias.js`), `TARJETAS_DISPONIBLES` (`app/src/carrito.tsx`) y `mis-tarjetas.json` como 3 tarjetas independientes: `Mi Carrefour`, `Cuenta Digital Carrefour`, `Tarjeta Carrefour Crédito`.

El teaser de producto "Tarjeta Carrefour X%" (`RestrictionsBins`, ver arriba) confirmado en vivo que corresponde a la tarjeta de **Crédito** (el BIN implica una tarjeta real con número, no el nivel Clásico) — de ahí que `TARJETAS_QUE_AFECTAN_PRODUCTO` en `comparar.js` sea `['Tarjeta Carrefour Crédito']`. Para las promos "por ticket" (`promos-bancarias.js`), se confirmó en vivo el raw name real de cada nivel en el feed GraphQL de Carrefour (`GetBanks`/`GetCards`/`GetPromotions`, host `carrefour.com.ar`):
- `GetBanks` id `442cdb4d-...`, name `"Mi Carrefour"` → nivel Clásico. Única promo activa vista: "10% si sos parte de Mi Carrefour y beneficiario de Anses o mayor de 60 años" (no es un descuento general).
- `GetCards` id `bbf9150c-...`, name `"Mi Carrefour"` (mismo nombre, id de tarjeta distinto — no se vio ninguna promo activa referenciándolo).
- `GetBanks`/`GetCards` id `ec75bbe7-...`/`c442ddb1-...`, name `"Cuenta Digital"` → la cuenta digital. Antes se descartaba en silencio por falta de alias; ahora resuelve a `Cuenta Digital Carrefour`.
- `GetCards` id `9217c372-...`, name `"Tarjeta_Standard_Master_Carrefour"` → nivel Crédito. Varias promos activas ("20% de descuento en un pago con tarjeta de crédito de Carrefour Banco", 3 cuotas sin interés, etc.) que antes se descartaban en silencio porque no había alias para ese raw name.

---

## Promos bancarias "por ticket" (`promos-bancarias.js`)

A diferencia de `promo-engine.js` (promos atadas a un producto), esto cubre el otro tipo de promo: un % de descuento (o cashback) sobre **todo el ticket**, condicionado a día de la semana + banco/tarjeta + a veces canal, con tope de reintegro y a veces monto mínimo — Cencopay, Mi Carrefour (las 3 tarjetas: Mi Carrefour/Cuenta Digital Carrefour/Tarjeta Carrefour Crédito, ver "Corregido 2026-09-04" arriba), MasClub, y bancos/billeteras de terceros (Santander, Mercado Pago, Cuenta DNI, Banco Provincia, MODO, Galicia, Galicia Modo, Banco Macro, HSBC, BBVA, ICBC, Comafi, Naranja X, Credicoop, Banco Ciudad, Supervielle, Banco Columbia, Banco Patagonia, Banco Nación, TCI). No depende de qué productos hay en el carrito: se calcula una vez sobre el subtotal ya armado por super.

**Fuente por super — cada uno expone esto de una forma distinta:**

| Super | Mecanismo | Detalle |
|---|---|---|
| Vea | Master Data VTEX | `GET /api/dataentities/JN/documents/bankDiscount?_fields=value,id&an=jumboargentina` — sin auth, `value` es un JSON-string con ~40-190 promos. Mismo endpoint responde en `disco.com.ar`/`jumbo.com.ar` (infra compartida de Cencosud). Sin campo de canal confiable (el booleano `checkout` no correlaciona con nada — no se intenta inferir por regex). |
| Carrefour | GraphQL persistido | 3 operaciones contra `/_v/public/graphql/v1` (`GetPromotions`/`GetBanks`/`GetCards`), identificadas por `sha256Hash` fijo — **pueden romperse sin aviso** si Carrefour actualiza la app `valtech.carrefourar-bank-promotions` (ver `detectarHashRoto`/error `PersistedQueryNotFound`). Trae flags de día y de canal (`hyper`/`market`/`ecommerce`/`express`/`maxi`) estructurados. |
| Chango Más | GraphQL persistido, mismo patrón | App `valtech.gdn-banks-promotions`, mismo riesgo de hash roto. Tiene además `isMasClub` (booleano propio). |
| Día | Bloque de CMS embebido en HTML | No es GraphQL en esta parte del sitio: hay que buscar un `<script>` en `/medios-de-pago-y-promociones` por una marca de bloque (`DIA_BLOQUE_MARCA`) y parsear el JSON balanceado de adentro. Sin campo numérico de %: el porcentaje se extrae con regex del texto legal (`terms`), y si el regex encuentra valores distintos en el mismo texto (tarjetas con varios niveles mezclados) se descarta la promo entera antes que adivinar cuál aplica. |
| Coto | REST propio (ATG/Oracle Commerce) | `getPromocionesMulticanal`, público, sin cookie. El % sí viene limpio (`textoDescuento`, ej. "20% DE DESCUENTO"); el día también. El tope sigue siendo texto libre. |

**Coto — el banco se identifica por `icono`, no por `descripcion` (corregido 2026-08-26).** `p.descripcion` es una oración corta que en la mayoría de las promos NO menciona el banco (ej. "3-6-9-12 cuotas sin interés con tarjetas de crédito Visa, Mastercard y American express" para una promo de Banco Macro) — solo dice qué redes de tarjeta acepta. El banco real solo se identifica por el nombre de archivo del logo, `p.icono` (ej. `logo_comafi.png`, `bbva2.png`). `ICONO_BANCO_COTO` en `promos-bancarias.js` mapea esos archivos a nombre canónico, y `fetchCoto()` combina `resolverCanonicosDesdeNombre(descripcion)` con ese mapeo (unión, sin duplicar). Antes de este fix, `fetchCoto()` solo miraba `descripcion` y devolvía apenas 2 promos vigentes de Coto pese a que el feed trae 71 — confirmado en vivo el mismo día: subió a 25 tras el fix. Deliberadamente no se mapean íconos de redes de tarjeta genéricas (Visa/Mastercard/Amex/Cabal) ni de programas que no son "tener una tarjeta propia" (comunidad Coto, ciudadanía porteña, beneficios ANSES, jubilados y pensionados) — mismo criterio de exclusión que ya regía para `ALIAS_TARJETAS`.

**Normalización de nombres de banco/tarjeta:** cada super nombra las mismas entidades distinto (ej. "Banco Provincia" solo existe como "Cuenta DNI" en Vea, como dos entidades separadas en Carrefour, y unidas como "Banco Provincia - Cuenta DNI" en Chango Más). `ALIAS_TARJETAS` mapea cada nombre canónico a substrings a buscar, con `EXCLUSIONES_ALIAS` para casos ambiguos (ej. "Banco provincia **de Neuquén**" es una entidad distinta que matchea el substring por error si no se excluye a mano).

**`ALIAS_TARJETAS` es una whitelist manual, no algo derivado del feed.** El feed de Vea/Jumbo/Disco (`bankDiscount`) trae de por sí decenas de bancos (BBVA, Ciudad, Columbia, Comafi, Córdoba, Hipotecario, Itaú, Patagonia, Santa Fe, de Corrientes, de Entre Ríos, Neuquén, Supervielle, etc.) — si un banco no tiene alias en `ALIAS_TARJETAS`, `resolverCanonicosDesdeNombre` devuelve `[]` y la promo se descarta **en silencio** (`if (!canonicosPosibles.length) continue;`, sin log ni error), aunque el dato haya llegado perfecto y con % real. Así fue como se perdieron Galicia y Banco Macro hasta 2026-08-25 (agregados esa fecha junto con HSBC/BBVA/ICBC, a pedido del usuario) — no era un problema de scraping ni de la fuente, sino de whitelist incompleta. `resolverCanonicosDesdeNombre` es compartida por los 5 fetchers, así que agregar un alias nuevo lo habilita automáticamente en todos los supers a la vez (confirmado en vivo: HSBC/BBVA/ICBC aparecieron de inmediato en Vea, Jumbo, Disco y Chango Más). El 2026-08-26 se repitió el patrón con Comafi, Naranja X, Credicoop, Banco Ciudad, Supervielle, Banco Columbia, Banco Patagonia y Banco Nación (identificados al auditar el campo `icono` del feed de Coto, ver más arriba) — confirmados en vivo también en `banks[].name` de Vea/Jumbo/Disco ("Banco Comafi", "Tarjeta Naranja X", etc.), con el mismo efecto: el conteo de promos capturadas subió en los 7 supers, no solo en Coto (antes → después el mismo día: Vea 38→53, Carrefour 6→9, Chango Más 12→16, Día 3→4, Coto 2→25, Jumbo 40→60, Disco 38→57). `TCI` es la excepción: tarjeta propia de Coto, no apareció en texto de ningún otro super al verificar. Quedan afuera, sin agregar todavía, el resto de los bancos que trae el feed de Vea (Banco Córdoba, Banco Hipotecario, Banco Itaú, Banco Santa Fe, Banco de Corrientes, Banco de Entre Ríos, y varios programas locales/regionales) — se van agregando de a poco a medida que se identifican.

**"Galicia" vs. "Galicia Modo" — dos canónicos separados a propósito.** El feed de Vea trae ambos como entidades distintas: "Galicia Modo" exige pagar escaneando el QR de MODO desde la app Galicia o la app MODO (no alcanza con tener la tarjeta Galicia), mientras que "Galicia" a secas es la promo genérica de tarjeta. Decisión del usuario (2026-08-25): tratarlas como dos tarjetas separadas en las 3 listas (`ALIAS_TARJETAS`, `TARJETAS_DISPONIBLES` del carrito, `TARJETAS_CONOCIDAS`/Mis descuentos), igual que ya se hace con MODO vs. Mercado Pago. `EXCLUSIONES_ALIAS.Galicia = ['modo']` evita que una promo de "Galicia Modo" matchee también el alias genérico `'Galicia'` (que de otro modo la capturaría por el substring compartido).

**Filtrado conservador:** promos de financiación (cuotas sin interés) se descartan siempre, sin importar la tarjeta — no es un ahorro real de precio. Topes que no se pueden extraer del texto legal con confianza (ejemplos ilustrativos, o dos topes para segmentos distintos sin decir cuál aplica) se dejan en `null` ("sin tope detectado, verificar") en vez de adivinar.

**Qué calcula, en capas:**
1. `promosAplicablesHoy` + `mejorPromoTicket` — la mejor promo bancaria vigente hoy sobre un subtotal dado (respetando tope y monto mínimo).
2. `mejoresDiasTicket` / `elegirMejorDia` — lo mismo repetido para los próximos 7 días, por super de forma independiente y opcionalmente por canal (online/físico) — no busca alinear el mismo día entre supers, ni recalcula qué producto va a cada super.
3. `calcularPlanFinal` — combina, por super, el subtotal ya fijado por las promos de producto con la mejor oportunidad bancaria de los próximos 7 días.
4. `reoptimizarAsignacion` (modo lista) — el ahorro bancario tiene tope en $, así que la asignación óptima de qué producto va a qué super ya no se puede decidir ítem por ítem de forma aislada. Se resuelve con una heurística iterativa (reasignar cada ítem al super de menor precio efectivo, repetir hasta estabilizar) que nunca puede recomendar algo peor que la asignación de hoy — si no mejora, se descarta.

**`GET /api/mis-descuentos`** (backend) usa `obtenerTodasLasPromosBancarias()` — sin filtrar por tarjetas del usuario — para poder mostrar qué desbloquea cada tarjeta conocida aunque el usuario todavía no la haya marcado como propia. La CLI, en cambio, usa `obtenerPromosBancarias()`, que sí filtra por `mis-tarjetas.json`.

**`POST /api/comparar` SÍ conecta este módulo (desde 2026-08-19).** Cuando el body trae `tarjetas` no vacío, `aplicarPromosBancarias()` (`backend/src/routes/comparar.js`) filtra el cache crudo con `filtrarPromosBancariasPorTarjetas()`, lo recorta a promos vigentes **hoy** (`promosAplicablesHoy` — ver por qué en la nota siguiente) y llama `reoptimizarAsignacion()` con los ítems ya resueltos por `calcularResumenFinal`. Si encuentra algo aplicable, pisa `resumen.comprasPorSuper`/`subtotalAsignadoPorSuper`/`requiereOnlinePorSuper`/`totalOptimo` con el resultado y agrega `resumen.bancario` (desglose por super: tarjeta, %, tope, `topeDetectado`, descuento) a la respuesta — ver tipos en `app/src/api.ts` (`RespuestaComparar.resumen.bancario`). Sin `tarjetas`, el comportamiento es idéntico a antes de este cambio (no lee el cache, `bancario: null`).

**Por qué solo "hoy" y no los 7 días que evalúa `reoptimizarAsignacion`/`mejorOportunidadTicket` por default:** las promos de PRODUCTO de los supers cambian día a día, así que mezclar "producto de hoy" con "banco de otro día" daría una recomendación inconsistente (decisión de producto, no reabrir). Por eso `aplicarPromosBancarias()` recorta cada `datosPorSuper[key].promos` con `promosAplicablesHoy()` ANTES de pasarlas a `reoptimizarAsignacion` — sin tocar la firma de esa función ni el comportamiento que sigue usando la CLI sin este recorte.

**Bug real corregido 2026-09-03: la suma de las filas de producto de un super no coincidía con el total de la cabecera de ese mismo super, y el "total sin descuentos" general tampoco coincidía con la suma de los "sin descuento" tachados por super.** Causa: había DOS caminos separados calculando "cuánto sale este super" — `aplicarPromosBancarias()`/`reoptimizarAsignacion()` (ve el carrito completo, el tope, y decide la asignación final) alimentaba `resumen.subtotalAsignadoPorSuper` (la cabecera), mientras que una función aparte, `aplicarPromoBancariaAOpcion()` (ya eliminada), restaba la misma promo de ticket a cada fila de producto POR SEPARADO, tratando cada producto como si fuera el ticket completo — sin conocer el tope ni el resto del carrito, y ANTES de que existiera la asignación final. Los dos números nunca estaban garantizados a coincidir. Aparte, el "total sin descuentos" general sumaba `item.mejor.totalSinPromo` (la opción globalmente más barata por producto) en vez de mirar a qué super terminó yendo cada producto en el plan final — si la reoptimización bancaria movía un producto a un super distinto del "más barato por unidad", el precio de lista de ese producto en el super real podía ser otro.

**Fix: reparto proporcional, una sola vez, después de fijar la asignación final.** `repartirDescuentoBancarioEntreFilas()` (`backend/src/routes/comparar.js`) corre después de `aplicarPromosBancarias()` (que ya decidió `comprasPorSuper`/el descuento de ticket por super, considerando el carrito completo y el tope) y reparte ese único descuento por super entre las filas de los productos que quedaron asignados ahí, proporcional al precio de cada uno (el último ítem de cada super absorbe el resto para no perder centavos por redondeo). `resumen.subtotalAsignadoPorSuper[key]` queda igual a la suma exacta de esas filas, por construcción — ya no son dos cálculos que "deberían" coincidir. El "total sin descuentos" general ahora suma, para cada producto, el `totalSinPromo` de la opción en el super donde REALMENTE quedó asignado (vía `resumen.comprasPorSuper`), no la opción más barata global. Decisión explícita del usuario: prorratear en vez de solo mostrar el descuento como una línea aparte a nivel super (que la UI de `resultado.tsx` ya tiene, `ahorroBancario`/"Pagando con X ahorrás $Y") — así la suma de filas cierra siempre, y esa línea queda como explicación adicional del ahorro.

**Regresión del mismo fix, encontrada y corregida el mismo día (2026-09-04): `item.opciones` podía quedar desordenado y `item.mejor` stale tras el reparto.** `calcularOpciones` (`core/comparador.js`) entrega `opciones` ordenadas ascendente por `total`, y varias partes de la UI confían en esa invariante sin volver a ordenar — en particular `app/src/componentes/BarraDiferencia.tsx` usa `opciones[0]` como "la opción más barata". La función vieja `aplicarPromoBancariaAOpcion` (eliminada en el fix de arriba) terminaba con un `opcionesPublicas.sort((a,b) => a.total - b.total)` que mantenía esa invariante; `repartirDescuentoBancarioEntreFilas` bajaba el `total` de la opción asignada sin volver a ordenar el array ni recalcular `item.mejor`. Caso real detectado: Yerba Rosamonte con Banco Nación activo — Carrefour terminaba más barato ($3.554,10 con el 10% de ticket) que Vea ($3.890) y el plan de compra la asignaba correctamente a Carrefour, pero `item.opciones[0]`/`item.mejor` seguían apuntando a Vea (el precio de lista, sin el descuento), así que otra parte de la pantalla mostraba "más barata en Vea" para el mismo producto. Fix: al final de `repartirDescuentoBancarioEntreFilas`, por cada ítem tocado por algún reparto, `item.opciones.sort((a,b) => a.total - b.total)` y `item.mejor = item.opciones[0]`.

**Cache de promos bancarias, para que `/api/comparar` no le pegue en vivo a los 5 supers en el camino de request.** `backend/src/cron/refrescarCatalogos.js` (`refrescarPromosBancarias()`, corre en cada pasada del cron) llama `obtenerTodasLasPromosBancarias()` (todas las tarjetas conocidas, sin filtrar) y persiste el resultado crudo en `backend/logs/promos-bancarias.json` (gitignoreado, mismo directorio que `ultimo-refresco.json`). `backend/src/promosBancariasCache.js` lo lee con cache por `mtime` (mismo patrón que `leerCatalogo` de `AllPromos/core/catalogo.js`) y revive `vigenciaDesde`/`vigenciaHasta` a `Date` (se serializan como string en el JSON). Tanto `/api/comparar` como `/api/mis-descuentos` leen de ahí — este último migró su cache TTL-en-memoria propio (que sí pegaba en vivo dentro del request) a esta misma fuente compartida.

**MasClub "por ticket" — confirmado en vivo el 2026-08-19: sí existe y es real.** El usuario vio en `masonline.com.ar` un cartel de "15% con MasClub, miércoles y jueves, sin tope" — no confundir con MasClub "por producto" (descartado más arriba, sección de Chango Más): esto es el mecanismo por ticket, que ya estaba implementado (`isMasClubField` en `fetchChangoMas()`). Consulta en vivo a la API de Chango Más lo confirmó byte a byte: `{descuentoPct: 0.15, dias: [3,4], tope: null, canales: ['express']}`. **Corrección 2026-08-26 a esta nota: la afirmación de que `canales` "es solo metadata, no filtra nada en `/api/comparar`" quedó desactualizada y era parcialmente incorrecta incluso en ese momento.** `promoAplicaEnCanal` (Fase 2, `promos-bancarias.js`) sí se usa en el camino real de `/api/comparar`, dentro de `reoptimizarAsignacion` → `mejorOportunidadTicket` → `mejoresDiasTicket`, para elegir entre canal online/físico al armar `resumen.bancario`/`resumen.totalOptimo` (expuesto además como `resumen.requiereOnlinePorSuper` por super, `backend/src/routes/comparar.js`). Donde el gap era real: `aplicarPromoBancariaAOpcion()` (el badge de promo bancaria por producto, `comparar.js`) llamaba a `mejorPromoTicket()` sin filtrar por canal y además hardcodeaba `esOnline: false` en el badge — con eso, una promo bancaria solo-online podía elegirse como "mejor" para ese producto sin que el badge `ONLINE` (ya renderizado en el frontend para promos de producto, `BarraDiferencia.tsx`/`index.tsx`) lo reflejara. Arreglado agregando `promoBancariaRequiereOnline(promo)` (deriva de `promoAplicaEnCanal(promo, 'fisico')`) y usándolo para setear `esOnline` en ambas ramas de `aplicarPromoBancariaAOpcion`. **`aplicarPromoBancariaAOpcion()` ya no existe (eliminada 2026-09-03, ver nota de esa fecha más arriba) — el badge de ticket por fila lo arma ahora `repartirDescuentoBancarioEntreFilas()`, tomando `esOnline` de `resumen.requiereOnlinePorSuper[key]` (ya calculado por `reoptimizarAsignacion` con el canal correcto), así que ese problema de canal no reaparece con el nuevo mecanismo.** **`/api/mis-descuentos` (`backend/src/routes/misDescuentos.js`) sigue sin usar `canales`/`promoAplicaEnCanal` en absoluto** — esa pantalla ("Mis descuentos") no distingue promos solo-online de solo-en-local; queda pendiente si se decide exponerlo ahí (el frontend tampoco tiene hoy un lugar para mostrarlo en esa pantalla). Lo que sí pasó: **el cache de producción (`backend/logs/promos-bancarias.json`) no existía en el momento de la verificación** — por eso la app no mostraba la promo aunque el mecanismo funcionaba. Se regeneró a mano; el cron (cada 2hs) la mantiene fresca de ahí en más. Causa raíz de por qué faltaba el archivo: no determinada con certeza (el log del cron mostraba "OK" en corridas previas, así que no fue un error de fetch/escritura reportado).

**Función nueva en `core/comparador.js`: `comprasPorSuperDesdeAsignacion(items, asignacion, supermercados)`** reconstruye `comprasPorSuper` a partir de la asignación que eligió `reoptimizarAsignacion()` (que puede mover un producto a un super que no es el más barato por unidad, para maximizar el reintegro dentro del tope) — sin modificar `calcularResumenFinal`. Requiere que `items` sea su salida (`calcularResumenFinal(...).items`, ya filtrada/recortada a `supermercados`) y que `asignacion` venga de `reoptimizarAsignacion()` llamado con `itemsReoptimizarDesdeFinal(items, supermercados)` — **no** con `itemsParaReoptimizar()` (que trabaja sobre el `resumen` crudo pre-`calcularResumenFinal` y puede desalinear índices si `supermercados` es un subconjunto). `itemsReoptimizarDesdeFinal` es un `.map()` sin filtrar nada, así el índice i-ésimo siempre corresponde al ítem i-ésimo de `items`.

**Selección de tarjetas del usuario — una sola fuente de verdad.** No existe una lista de tarjetas separada por pantalla: `carrito.tarjetas` (contexto `ProveedorCarrito`/`useCarrito` en `app/src/carrito.tsx`, campo persistido en AsyncStorage bajo `allpromos:carrito:v1` junto con los ítems del carrito) es leída y escrita tanto por el bloque "Mis descuentos" del carrito (`app/app/(tabs)/carrito.tsx`, solo lectura ahí — tocarlo navega a `/mis-descuentos`) como por los switches de `app/app/mis-descuentos.tsx` (`carrito.setTarjetas(...)`). `TARJETAS_DISPONIBLES` en `carrito.tsx` (25 entradas: Mi Carrefour, Cuenta Digital Carrefour, Tarjeta Carrefour Crédito, MasClub, Cencopay, Santander, MODO, Mercado Pago, Cuenta DNI, Banco Provincia, Galicia, Galicia Modo, Banco Macro, HSBC, BBVA, ICBC, Comafi, Naranja X, Credicoop, Banco Ciudad, Supervielle, Banco Columbia, Banco Patagonia, Banco Nación, TCI — los 3 beneficios propios de Carrefour separados 2026-09-04, ver "Corregido 2026-09-04" arriba; los 9 bancos de Cencosud sumados 2026-08-26, ver quirk de Coto/icono de banco más arriba) coincide 1 a 1 con `ALIAS_TARJETAS`/`TARJETAS_CONOCIDAS` de `promos-bancarias.js` — mismos strings canónicos, sin mapeo de por medio. Si se agrega un banco nuevo a `ALIAS_TARJETAS`, hay que sumarlo también acá a mano (no se deriva automáticamente); `mis-descuentos.tsx`, en cambio, sí deriva de `TARJETAS_CONOCIDAS` sin necesidad de tocarlo. Ese array llega tal cual al backend en cada `POST /api/comparar` como `tarjetas`; el backend nunca lee `mis-tarjetas.json` (eso es solo del CLI, ver `leerMisTarjetas()` más abajo).

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
Supabase (`perfil_usuario.tope_supers`, migración `0008_tope_supers.sql`). Sentinel `0` = "sin
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

**Botones del segmentado (`BloqueTope` dentro de `HojaSupers.tsx`, 2026-08-31)**: son fijos,
`1..ORDEN_SUPERS.length` (hoy 1-7), sin un botón "Todos"/"Los N" aparte — no dependen de
cuántos supers están tildados en el borrador (`n`). Tocar el botón cuyo número coincide con
`n` es la opción de "sin tope" (manda el sentinel `0` igual que antes). Los números por
encima de `n` no desaparecen al destildar un super — quedan visibles pero
deshabilitados/grisados (`disabled` + estilo `opcionTopeDeshabilitada`), así la fila no
cambia de tamaño ni salta de lugar mientras se arma la selección.

---

## Tour interactivo guiado (reemplaza a "Cómo funciona")

**2026-08-31, implementado.** `app/src/componentes/ComoFunciona.tsx` (modal estático de 4
slides) se borró: lo reemplaza un tour de spotlight sobre la app real (`app/src/tour/`), que
hace que el usuario arme una compra real guiada en vez de ver una demo — carga una tarjeta en
Descuentos, busca un producto, elige supers y tope en la hoja de supers, arma el carrito y
compara precios de verdad. Handoff de diseño original en
`design_handoff_allpromos_v2 /design_handoff_allpromos_v2/TOUR-interactivo-handoff.md`.

**Un solo mecanismo, sin Context de React para el estado del tour** (evita re-renderizar todo
el árbol en cada tecla tipeada) — `app/src/tour/TourContext.tsx` es un store externo
(`useSyncExternalStore`) con un hook colocado:

```ts
useTourPaso(id: PasoId, cumplido: boolean, alCompletar?: () => void): RefObject<T | null>
```

Se llama en el componente real que ya tiene el dato que decide si el paso está cumplido (su
propio estado local, o un contexto global existente como `useCarrito()`/`useFiltrosSupers()`) y
devuelve un ref para ponerle al elemento real. Mientras ese paso está activo, el ref queda
anotado en un registro module-level (`targets`, fuera de React a propósito) que
`app/src/tour/TourOverlay.tsx` lee para medir y dibujar el spotlight. `avanzarTour(id)` es la
salida imperativa para el único paso que no puede detectarse con un booleano (cerrar la hoja de
supers: el componente se desmonta como parte de la propia acción que completa el paso).

**El paso 4 del handoff ("elegir tope → cierra la hoja") se partió en dos** (`tope-elegido` /
`listo`, ver `pasos.ts`): tal como estaba escrito, el botón "Listo" —lo único que de verdad
cierra y confirma la hoja de supers— quedaba fuera del recorte del spotlight y por lo tanto
bloqueado por el propio overlay. Sin el split, el usuario no podía salir de la hoja.

**Medición de targets**: `measureInWindow` con reintento en cada frame durante ~1.5s después de
cada cambio de paso, y cada 400ms indefinidamente después de esa ventana (no cubre solo la
animación de `HojaSupers` — un target que tarda en montar por otro motivo, ej. una pantalla
esperando datos de red, antes se quedaba sin spotlight para siempre). **Mientras no hay rect
medido, el overlay bloquea TODA la pantalla** (no deja pasar nada) en vez de no renderizar
nada — la versión anterior dejaba una ventana real, entre que el paso cambiaba y que el target
se encontraba, en la que se podía tocar cualquier cosa antes de que el bloqueo "enganchara".

**Ojo con condiciones de avance que miran estado persistido en vez del toque real.** Tres pasos
tuvieron el mismo bug: miraban si algo YA estaba en el estado (`borrador.includes('coto')` en
`coto`, `carrito.tarjetas.includes('Mercado Pago')` en `mercado-pago`, `carrito.items.length > 0`
en `primer-resultado`) en vez de si el usuario lo acababa de tocar. Como `supersActivos` viene
con los 7 supers activos por defecto, y tanto `carrito.tarjetas` como `carrito.items` persisten
entre sesiones de la misma cuenta, las tres condiciones podían estar cumplidas desde ANTES de
que el paso arrancara (muy fácil de pisar sin querer probando el tour varias veces seguidas con
la misma cuenta) — el paso se saltaba solo, sin que el usuario llegara a ver ni tocar nada. El
arreglo en los tres casos es el mismo patrón: un booleano local que arranca en `false` y se pone
en `true` recién dentro del handler real del control (`toggle` en `HojaSupers.tsx`, `onCambiar`
del switch en `mis-descuentos.tsx`, `onAgregar` de la fila índice 0 en `index.tsx`), nunca
derivado del valor resultante ni de una condición leída directo de estado global/persistido.
Cualquier paso nuevo que agregue algo al tour tiene que evaluar esto antes de escribir su
condición — es el bug más repetido de todo el feature.

**Coto puede quedar fuera de la pantalla visible de la hoja de supers** (depende de cuánto
ocupa `BloqueTope` arriba y cuántos supers hay) — como el overlay bloquea todo menos su fila,
sin nada más el usuario quedaba sin forma de scrollear hasta ella. `HojaSupers.tsx` mide su
propia fila contra el contenedor de la lista (dos `measureInWindow`, no uno: hace falta la
posición de los dos para calcular cuánto desplazar) y hace `scrollRef.current.scrollTo(...)`
para centrarla, medio segundo después de que el paso arranca (tiempo para que la animación de
apertura de la hoja termine — medir antes da la posición todavía en tránsito).

**El mismo auto-scroll de Mercado Pago podía quedar bloqueado para siempre si la fila tardaba en montar (bug real, corregido 2026-09-04).** El paso `mercado-pago` de `mis-descuentos.tsx` (mismo mecanismo de arriba: medir la fila y la del contenedor, `scrollTo` para centrarla) disparaba un único `setTimeout(300ms)` atado solo a `[pasoActivo]` — pero la fila recién existe en el árbol cuando `useQuery(['mis-descuentos'], ...)` resuelve (antes se muestra un `ActivityIndicator`). El paso `mercado-pago` se activa apenas el usuario toca la pestaña (con el foco, `useFocusEffect`, no con datos ya cargados), así que con latencia de red real (no una query ya en cache de una visita previa) el fetch casi siempre tarda más que esos 300ms: el timeout corría con la fila todavía sin montar (`refMercadoPago.current === null`), hacía `return` sin reintentar, y como `TourOverlay` sí sigue midiendo la posición REAL de la fila (fuera de la pantalla, sin haber scrolleado) el recorte del spotlight quedaba con alto 0 pegado al borde inferior — pantalla oscurecida sin nada tocable, indistinguible de "la app se congeló". Nació con el mismo commit que agregó este auto-scroll (no es una regresión posterior) — no se detectó antes porque en pruebas manuales la query solía estar ya en cache (`staleTime: 10min`) de una visita previa a la pestaña en la misma sesión. Fix: el efecto ahora depende también de `isLoading` (`[pasoActivo, isLoading]`) y no dispara el `setTimeout` mientras la query sigue cargando — se re-ejecuta apenas `isLoading` pasa a `false`, momento en el que la fila ya está montada (los refs se asignan en el commit, antes de que corran los effects).

**El toque de Mercado Pago en el paso `mercado-pago` nunca desactiva** — si la cuenta ya la
tenía activada de una sesión anterior, el toque igual cuenta para avanzar el paso, pero
`onCambiar` corta antes de mandarle `false` a `carrito.setTarjetas`. Apagar sin querer una
promo real que el usuario ya tenía cargada, solo por seguir el tutorial, sería un efecto
secundario que nadie pidió.

**El target de la pestaña "Descuentos" en la barra inferior no se mide con un ref** — customizar
`tabBarButton` en `app/(tabs)/_layout.tsx` para eso es frágil (vendoreado por Expo Router, no es
un paquete propio). Se calcula por fórmula (5 tabs de ancho igual, índice 2) usando el alto real
de la tab bar, que `app/(tabs)/index.tsx` reporta una sola vez vía `tourReportarAltoTabBar()`
(el `TourOverlay` vive fuera del navigator de tabs, en `app/_layout.tsx`, así que no puede leer
`useBottomTabBarHeight()` directamente).

**Montaje**: `<TourOverlay />` es hermano del `<Stack>` en `app/_layout.tsx`, dentro de
`GatePaywallFinTrial` — sobrevive la navegación entre tabs y hacia `/resultado` sin remontarse.
El auto-onboarding (primera vez, `AsyncStorage` clave `allpromos:tourVisto:v1`) y el botón
manual ("Ver el tutorial", en el estado inicial de Buscar y en Ajustes) llaman a
`iniciarTour()`/`useTour().iniciar`.

**Orden real de los pasos, distinto del handoff original**: el handoff pedía abrir la hoja de
supers apenas se escribía en el buscador, antes de tocar ningún resultado. A pedido, se invirtió
— `primer-resultado` (agregar un producto) va antes que `selector-otros` (abrir la hoja), ver el
orden final en `ORDEN_PASOS` de `pasos.ts`.

**Sin botón de salir en los pasos intermedios (a pedido) — el tour se completa siempre de punta
a punta.** Solo el último paso tiene un botón en el cartel.

**Último paso (`ahorro`, resultado.tsx)**: resalta el bloque de precio/ahorro de `/resultado`.
No avanza solo — termina tocando el recuadro resaltado (el bloque en sí es un `Pressable`, no
solo una `View` con un ref) o tocando "Finalizar" en el cartel (único paso que lo tiene, ver
`TourOverlay.tsx`: `ULTIMO_PASO = ORDEN_PASOS[ORDEN_PASOS.length - 1]`, así no queda hardcodeado
si se agrega un paso después). El ref/Pressable envuelve tanto el total (repartido o único)
como el bloque " ahorrás $X" cuando existe — este último es condicional
(`valeRepartir && mejorUnico`), así que el wrapper cubre siempre al menos el total para que el
target nunca falte.

### Precarga dinámica de productos (2026-08-31, ajustado 2026-09-01)

Al iniciar el tour (`useTour().iniciar` en `TourContext.tsx`, ver `app/src/tour/precarga.ts`),
se fuerza Vea+Carrefour como únicos supers activos (`setSupersYTope(['vea','carr'], 0)`,
síncrono, no depende de red) y se precargan 2-3 productos elegidos dinámicamente — así el paso
`coto` (sumar Coto en la hoja de supers) tiene un efecto visible real en vez de ser un toggle
sin consecuencia, y la comparación final no depende de qué producto elija buscar el usuario.

**A pedido, esto pisa cualquier carrito/selección real que hubiera antes — no hay guard de
"solo si el carrito está vacío".** La primera versión sí lo tenía (para no destruir una compra
real en curso si alguien reabría el tour desde Ajustes), pero eso hacía que la precarga
quedara bloqueada en silencio con datos persistidos de sesiones anteriores — pasó en la propia
cuenta de prueba: `perfil_usuario.carrito_items`/`supers_activos` tenían restos de un test
viejo (19/08), así que ni los productos de demo ni el forzado de supers se aplicaban. Se sacó
el guard a propósito: iniciar el tour (aun manualmente, con algo cargado) siempre muestra la
misma demo. Si falla el fetch de productos (sin red/token), no se toca el carrito — mejor
dejarlo real que vaciarlo sin nada para poner en su lugar (`precarga.ts`).

**Backend — `elegirProductosTour()` en `backend/src/precioCache.js`**: recorre el índice ya
construido por `asegurarIndice()` buscando EANs con precio real en Vea, Carrefour Y Coto,
reusando `calcularOpciones()` de `AllPromos/core/comparador.js` (la misma función que ordena
por precio en `/api/comparar`, no hay una segunda lógica de promos). Filtra por
`UMBRAL_DIFERENCIA` (10% entre el más barato y el más caro de los 3) y prioriza los que además
tienen `descuentoFuerte` (≥15% de descuento en alguno de los 3) — constantes al tope del
archivo, ajustables sin tocar la lógica. Expuesto en `GET /api/catalogo/tour-sugeridos`
(`backend/src/routes/catalogo.js`, mismo patrón `requiereSesion`/`requierePlanActivo` que el
resto de `/api/catalogo/*`), que resuelve los EANs a la forma pública de `ProductoCatalogo` vía
`catalogoUnificado.porEAN`.

**Nota de calidad de datos**: en la corrida de verificación, `diferenciaPct` salió tan alto como
~213% para algún candidato — no se investigó si es una diferencia real de precio o un problema
de matching/empaquetado entre el EAN de Coto y el de los otros supers (ver
`fix-empaquetado-ean-compartido` en memoria). Si algún producto precargado se ve sospechoso en
la demo (precio absurdamente distinto), revisar ese EAN puntual antes de asumir que el criterio
de selección está mal.

**Frontend — bloqueo en la hoja de supers**: `HojaSupers.tsx` acepta una prop `bloqueados:
SuperKey[]` (default `[]`) que hace no-op a `toggle()` y grisa la fila — `index.tsx` la pasa
como `tour.activo ? ['vea','carr'] : []`. Se libera sola al salir del tour (depende de
`tour.activo`, no de un flag separado).

---

## Notificaciones push web (recordatorio semanal)

**2026-09-01, implementado y verificado.** Primer caso de uso de un circuito de Web Push
completo (llegan a la barra de notificaciones nativa del OS, no dependen de tener la pestaña
abierta) — sin `expo-notifications` (eso es para builds nativos, que no existen en este
proyecto), es la Push API estándar del navegador.

**Piezas:**
- `supabase/migrations/0012_push_suscripciones.sql` — tabla `push_suscripcion` (`endpoint` como
  PK, `usuario_id`, `p256dh`, `auth` — sí, se llama `auth` igual que el schema de Supabase, **ver
  la nota más abajo sobre por qué eso no es un problema**). RLS con policies de insert/delete
  propio únicamente (sin select — no hace falta, el cron lee con la service role). Corrida contra
  el proyecto real con `supabase db push --linked` (usando `SUPABASE_ACCESS_TOKEN` del entorno —
  no hay CLI instalado global, se usa `npx supabase`).
- VAPID keys generadas una vez (`npx web-push generate-vapid-keys`) — privada en
  `backend/.env` (`VAPID_PRIVATE_KEY`), pública duplicada en `backend/.env`
  (`VAPID_PUBLIC_KEY`) y en `app/.env` (`EXPO_PUBLIC_VAPID_PUBLIC_KEY` — no es secreta, viaja en
  el bundle a propósito).
- `app/public/sw.js` — service worker mínimo (`push` → `showNotification`, `notificationclick` →
  enfoca la app). Expo copia `app/public/` tal cual a la raíz del build web, igual que
  `manifest.json`, así que queda servible en `/sw.js` sin config adicional.
- `app/src/push/push.ts` — `soportaPush()` (feature-detect), `pedirPermisoYSuscribir(usuarioId)`,
  `desuscribir()`, `yaSuscripto()`. Suscribe/desuscribe escribiendo directo en
  `push_suscripcion` desde el cliente (mismo patrón que `tour_visto` en `TourContext.tsx` —
  sin endpoint Express de por medio).
  **`soportaPush()` da `false` en TODO navegador de iOS, no solo Safari** — Chrome/Firefox/Edge
  para iOS corren sobre el motor de Safari por regla de Apple, pero el permiso de push en iOS
  solo lo obtiene una instalación a pantalla de inicio hecha DESDE la app de Safari; hacerlo
  desde Chrome en iOS no habilita nada, es una restricción de Apple a nivel de sistema.
- Toggle en `app/app/(tabs)/ajustes.tsx` (sección "NOTIFICACIONES") — la sección entera (título
  incluido) solo se renderiza si `soportaPush()` da `true`; a pedido, si no hay soporte no se
  muestra nada, sin explicar por qué (se probó primero un hint explicando el caso de iOS/Safari,
  descartado 2026-09-01 porque el user-agent es poco confiable para detectarlo bien — con "Sitio
  de escritorio" activado en Chrome iOS, por ejemplo, se disfraza de Mac y rompe la detección
  — y de todos modos no era el comportamiento que se quería).
- Paso obligatorio en el tour (`app/src/tour/pasos.ts`, `PasoId "notificaciones"`, primero en
  `ORDEN_PASOS`): sin target real en pantalla (es un permiso del navegador, no un componente), se
  resuelve en `TourOverlay.tsx` con un `rect` fijo fuera de pantalla (spotlight invisible, overlay
  oscurecido completo) y un botón propio en el cartel ("Activar notificaciones", mismo mecanismo
  que el botón "Finalizar" del último paso). El botón llama `pedirPermisoYSuscribir` y **avanza el
  tour en el `finally`, haya aceptado o rechazado el permiso** — un navegador no deja re-preguntar
  tras un rechazo, así que bloquear el tour hasta que acepte dejaría afuera a quien rechace.
- `backend/src/cron/recordatorioSemanal.js` — mismo esqueleto que `pingSupabase.js` (reporte a
  `logs/`, `require.main === module`). Manda el mismo mensaje genérico a todas las filas de
  `push_suscripcion` (lee con la service role) y borra las que respondan 404/410 (suscripción
  vencida del lado del navegador). **Cargado en la crontab de la VM 2026-09-01**
  (`0 13 * * 1`, bajo el usuario `camilosilva28` — mismo criterio que los demás crons, no vive
  en el repo; la VM corre en UTC, así que 13:00 UTC = 10:00 hora Argentina). Las VAPID keys
  también se cargaron a mano en `backend/.env` de la VM (no viajan por git, igual que el resto
  de los secretos). Probado corriendo el comando del cron a mano en la VM: llegó una
  notificación real al dispositivo suscripto.

**Bug real encontrado y corregido al probar en navegador**: `pushManager.subscribe()` tira
`AbortError: ... no active Service Worker` si se usa el resultado de `serviceWorker.register()`
directo — el registro puede devolver antes de que el worker esté activo. Hay que esperar
`navigator.serviceWorker.ready` (que resuelve recién con un worker activo) antes de llamar a
`subscribe()`. Ya corregido en `push.ts`.

**Nota sobre el nombre de columna `auth`**: se probó a fondo si `auth` como nombre de columna en
`push_suscripcion` colisiona con el schema `auth` de Supabase dentro de las policies de RLS de
esa misma tabla (`auth.uid()` ambiguo entre función y campo) — **se descartó**: se verificó con
SQL directo que `auth.uid()` resuelve bien igual, incluso con una columna `auth` en scope. El 403
que se vio al principio al probar manualmente era por pedir `Prefer: return=representation` (que
exige policy de SELECT, que no existe a propósito) — el código real (`push.ts`) no la pide.

**Verificado en navegador real (Chrome vía chrome-devtools-mcp) hasta donde el entorno de
automatización lo permite**: paso del tour completo (incluye avance tras rechazo simulado del
permiso), toggle de Ajustes disparando el flujo, y el insert a `push_suscripcion` confirmado por
SQL directo. La suscripción real (`pushManager.subscribe`) se cuelga en el Chromium de
automatización por no tener backend de push configurado (limitación del entorno, no del código) —
falta una verificación final con un navegador real de usuario antes de dar la feature por 100%
probada end-to-end.

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
node scraper-promos-jumbo.js         # → catalogo-jumbo.json (misma cuenta VTEX que Vea)
node scraper-promos-disco.js         # → catalogo-disco.json (misma cuenta VTEX que Vea)
node scraper-coto-por-ean.js         # ~9 min  → catalogo-coto.json (busca por EAN los productos de los otros 6 supers, correr último — ver "Coto: de recorte por categoría a búsqueda por EAN")
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
| Botón flotante "Ver carrito"/"Comparar precios" (Buscar/Carrito) quedaba separado del tab bar por un hueco vacío (~49px, medido en vivo en prod el 2026-08-31) | Dos causas apiladas: (1) el `paddingBottom` reservado en el scroll para no tapar el último ítem era un número fijo a ojo (120/140) que sobraba respecto al alto real del botón; (2) en **web** la escena del tab y el tab bar son hermanos que no se superponen (a diferencia de nativo, donde el tab bar flota encima de la escena) — sumarle `tabBarHeight` al `bottom` del botón, que hace falta en nativo para no quedar tapado, en web duplicaba ese alto y generaba el hueco | `app/(tabs)/index.tsx` y `carrito.tsx`: el alto del botón se mide con `onLayout` (nada de números fijos) y se usa para el `paddingBottom` del scroll; el `bottom` del contenedor pasa a `Platform.OS === 'web' ? 0 : tabBarHeight` |
| En `resultado.tsx`, el bloque "Ahorrás" del header mostraba `ahorroRepartiendo` (comprar todo en un solo super vs. repartir entre paradas) en vez del ahorro por promos/descuentos — un número chico y confuso al lado de "PRECIO SIN DESCUENTOS" (2026-09-01) | Eran dos métricas distintas a propósito (ver el bug ya corregido de `ahorroRepartiendo` en el registro de historial, 2026-08-22), pero mostrar `ahorroRepartiendo` justo debajo de "precio sin descuentos" hacía pensar al usuario que esa era la diferencia entre ambos totales, y no lo era | "Ahorrás" ahora muestra `montoAhorradoPromos` (`totalSinPromo - totalOptimo`), la misma cuenta que ya se usaba para el historial de ahorro; `ahorroRepartiendo`/`valeRepartir` se eliminaron del componente. De paso, el título "REPARTIENDO EN N PARADAS" pasó a "Compra óptima en N paradas" (ya no en mayúsculas fijas) |

---

## Alcance y limitaciones

- **4 de los 5 supers VTEX (Vea, Carrefour, Chango Más, Día) muestran precio único a nivel país** — confirmado en vivo el 2026-08-10 para Vea (regionId de Luján vs. Córdoba vs. La Plata, 5 productos, precio idéntico) y ya se sabía para Carrefour y Chango Más; Día corre sobre el mismo mecanismo VTEX y no se encontró evidencia de regionalización tampoco. No está confirmado que ese precio online coincida con el de góndola de una sucursal física en particular.
- **Coto es la excepción: sí varía por sucursal de verdad** (confirmado en vivo, 98% de una muestra de 50 productos con precio distinto entre sucursales). Se usa el precio dominante (moda) como aproximación — ver "API de Coto" arriba para el detalle y las sucursales que sistemáticamente quedan por debajo de esa moda (Flores, Once).
- Solo **productos envasados con EAN real** (no productos al peso: queso, fiambre, carne)
- **Promos bancarias por producto excluidas del cálculo salvo Tarjeta Carrefour Crédito** (única implementada hoy en `core/fetchers.js`/`precioCache.js` — ver "Corregido 2026-09-04": el teaser de producto exige la tarjeta de crédito, no el nivel Clásico "Mi Carrefour") — las promos "por ticket" (Cencopay, bancos de terceros, MasClub) sí están cubiertas, pero en un módulo aparte (`promos-bancarias.js`, ver sección propia).
- El catálogo local puede desincronizarse con productos discontinuados o renombrados
- Ninguna query de Vea (ni en vivo en `core/fetchers.js`, ni el scraper de catálogo `scraper-promos-vea.js`) usa cookie `vtex_segment` desde 2026-08-20 (ver quirk de precio desactualizado). **Corrección a una nota vieja de esta misma sección:** durante un tiempo esto decía que no importaba que el scraper tuviera la cookie desactualizada porque `precioBase` del catálogo local "nunca se muestra al usuario" — eso dejó de ser cierto el 2026-08-13, cuando `precioCache.js` pasó a servir precio directo desde `catalogo-*.json` como camino común de `/comparar`/`/precios` (ver `backend/README.md` § "Caché de precio"). El invariante de `AllPromos/CLAUDE.md` ("los precios nunca salen del catálogo local") sigue siendo cierto para la CLI, pero ya **no** para el backend/app desde esa fecha — hay que actualizar esa nota si se vuelve a tocar.
- **Los catálogos locales capturan solo una fracción del catálogo real de cada super**, por motivos distintos. Vea, Carrefour, Chango Más y Día: tope de ~2.550 ítems del endpoint legacy de VTEX (no es una decisión, es un techo de la API — ver más abajo el detalle). **Coto: desde el 2026-08-25 ya no es un recorte por categoría — es la unión de EAN de los otros 6 supers, buscados uno por uno** (ver "Coto: de recorte por categoría a búsqueda por EAN" más abajo) — hoy son **3.298 SKUs**, todos con algo con qué compararlos por construcción. La búsqueda por nombre puede seguir sin encontrar productos que ningún otro super tenga (Coto exclusivo) o que estén fuera del tope de ~2.550 de los 4 VTEX.

  **Decisión (2026-08-19): capar Coto en vez de ampliar los otros 4.** Surgió directamente de la investigación de RAM de abajo — Coto era el responsable de que el catálogo unificado fuera ~5x más grande que la suma de los otros 4 juntos (57.789 de 60.611 productos). Motivo para no lamentarlo: **un producto que existe SOLO en Coto no le sirve al fin de la app** (comparar entre supers) — no hay nada con qué compararlo. `scraper-promos-coto.js` ahora mide el tamaño real de cada una de las 10 categorías con un pedido liviano (`num_results_per_page=1`) y reparte un objetivo de ~5.000 SKUs proporcional a ese tamaño (`repartirPresupuesto()`), scrapeando cada categoría con el sort default de Constructor.io — que sin pasar `sort_by` ya es `relevance` (`sort_options[].status === "selected"`, confirmado en vivo) — no es literalmente "más vendidos" como el `OrderByTopSaleDESC` de VTEX (Constructor.io no expone un sort de ventas), pero es la mejor aproximación disponible y no cuesta nada extra. **Resultado medido en el momento (19-08)**: catálogo unificado real bajó de 60.611 a 11.586 productos; la búsqueda (`catalogoUnificado.buscar()`) bajó de ~50-84ms a **6-8ms**. Elimina por completo el riesgo de out-of-memory de la VM (ver medición abajo) con margen de sobra — incluso deja presupuesto para eventualmente ampliar un poco el tope de los otros 4 supers sin volver a acercarse al límite.

**Actualización (2026-08-20), tras el filtro de SKUs fantasma de Coto (ver quirk arriba):** con `catalogo-coto.json` en 2.889 SKUs reales (no 5.000) y `catalogo-vea.json` regenerado sin la cookie rota, `catalogo-unificado.json` bajó de 11.586 a **9.706 productos únicos por EAN** (`node backend/src/cron/unificarCatalogo.js`) — bien lejos todavía del límite de RAM que motivó el cap original, así que no cambia ninguna decisión, solo el número.

  **Coto: de recorte por categoría a búsqueda por EAN (2026-08-25).** Disparador: un usuario buscó "manteca ilolay" y no apareció en Coto — el producto sí existía ahí, pero no había entrado en el recorte de 5.000 "más relevantes" por categoría. Investigando esto se encontró que Coto expone además un endpoint de autocomplete de Constructor.io (`ac.cnstrc.com/autocomplete/{término}`, mismo `key` público) que soporta búsqueda por EAN exacto y devuelve el producto completo con la misma forma que ya parseaba el scraper por categorías (`price[]`, `discounts`, `store_availability`, `groups`) — a diferencia del endpoint de categorías, este SÍ publica un rate limit real en los headers (`x-ratelimit-limit: 201` por ventana de ~3s).

  Dado el criterio ya establecido más arriba ("un producto que existe SOLO en Coto no le sirve al fin de la app — no hay nada con qué compararlo"), se reemplazó el scraper de categorías (`scraper-promos-coto.js`, borrado tras confirmar el reemplazo) por `scraper-coto-por-ean.js`: arma la unión de EAN de los otros 6 catálogos (`catalogo-vea/carrefour/changomas/dia/jumbo/disco.json`) y busca cada uno puntualmente en Coto, en vez de paginar categorías esperando que "lo más relevante" incluya lo que a la app le importa. Reusa el mismo parseo (`parsearProducto` y funciones asociadas) sin cambios — la forma de los datos es idéntica entre los dos endpoints.

  **Resultado medido en producción local (25-08), con los 4 catálogos VTEX disponibles (Jumbo/Disco se suman solos cuando corre en la VM, donde sí existen sus catálogos):** 6.506 EAN consultados, **3.298 encontrados en Coto con stock real** (vs. 2.889 del recorte por categoría — más cobertura, mejor dirigida), 430 descartados por SKU fantasma, 2.778 que Coto no vende. Cero 502 en las 6.506 consultas, a un ritmo de 12 req/s (~9 minutos) — bien por debajo del rate limit documentado. `refrescarCatalogos.js` mueve a Coto al final de la lista de scrapers porque necesita leer los catálogos de los otros 6 ya frescos de esa misma corrida.

  Efecto colateral bueno: al ser 100% productos que también existen en otro super, cada SKU nuevo de Coto participa en la comparación de precios desde el primer momento — no hay categoría "solo Coto, sin nada con qué comparar" en este catálogo, por construcción.

  **Investigado a fondo el 2026-08-19 (replanteado: no es "migrar de API", ver "Pendientes" abajo):**
  1. **La API "Intelligent Search" de VTEX (candidata para reemplazar el endpoint legacy) tiene su propio techo, más generoso pero igual de duro**: confirmado en vivo contra Día — `page` no puede superar 50, `count` (tamaño de página) no puede superar 100 → **máximo 5.000 ítems por consulta** (`{"data":"Page should not exceed 50 pages."}` / `{"data":"Count should not exceed 100 products."}`, mensajes de error reales de la API). Casi el doble del ~2.550 legacy, pero lejos de alcanzar para Vea (378.449 reales), Carrefour (104.272) o Chango Más (59.826) en una sola consulta sin filtrar.
  2. **El techo es por consulta, no global** — igual que el legacy. Los scrapers de hoy hacen UN solo loop plano sin filtrar por categoría (`scraper-promos-changomas.js` pide `_from`/`_to` sobre el catálogo entero, sin `fq=`), así que chocan el techo enseguida. Para cubrir el catálogo real con cualquiera de las dos APIs hace falta partir en muchas consultas más chicas por categoría — mismo patrón que usaba `scraper-promos-coto.js` (borrado el 2026-08-25, reemplazado por `scraper-coto-por-ean.js` — ver "Coto: de recorte por categoría a búsqueda por EAN" más abajo) con su lista fija de categorías.
  3. **Ejemplo medido para Vea**: el árbol de categorías tiene 24 raíces y 458 hojas hasta profundidad 3 (`/api/catalog_system/pub/category/tree/3`). Pero las categorías raíz YA son demasiado grandes para una sola consulta: Almacén 38.952 ítems, Bebidas 15.326, Limpieza 12.295, Lácteos 7.239 — todas superan los dos techos (2.550 y 5.000). Hay que partir por categorías de nivel 2 o 3 (458 hojas), y probablemente algunas hojas grandes necesiten un cuarto nivel de partición (por marca, por rango de precio) para entrar bajo el techo. Esto es trabajo real de scraper, no un cambio de URL.
  4. **Riesgo de bloqueo al scrapear: bajo, medido en Día** — burst de 15 requests simultáneas y varias secuencias sin espaciado especial contra la Intelligent Search, sin un solo 429/403 (misma infra VTEX IO que ya se scrapea hoy sin problema). Carrefour y Chango Más ya tienen rate-limiting conocido HOY en el endpoint legacy (429/502, con retry de 10s) — no probado si la Intelligent Search se comporta distinto ahí, habría que confirmarlo en esos 2 antes de migrar.
  5. **El verdadero riesgo no es el scraping (corre en un cron cada 2hs, nadie espera eso) — es la búsqueda en vivo de la app.** `backend/src/catalogoUnificado.js` hace un filtro LINEAL en memoria sobre TODO el catálogo unificado en cada request de `/api/catalogo/buscar` (se dispara en cada tecla que escribe cualquier usuario, con 300ms de debounce) — el propio comentario del archivo ("a este volumen ~5-7k productos un filtro lineal alcanza") ya está desactualizado: hoy el catálogo unificado real ya es ~60.611 productos (por el catálogo completo de Coto), y una cobertura completa de los 4 restantes lo llevaría a un estimado de ~500-600 mil. **Medido en Mac con el código real (`catalogoUnificado.buscar()`) contra un catálogo sintético de 606.110 productos** (10x el actual, réplica del catálogo real de producción): cada búsqueda pasa de tardar ~55-220ms (hoy, a 60k) a **~270-315ms constantes, sin importar la especificidad de la query** — el costo lo domina escanear las 606k entradas, no filtrar los resultados. La carga inicial del archivo (una vez por cambio del cron) pasa de ser instantánea a **~1,5 segundos** de bloqueo del proceso. Como el escaneo es síncrono, bloquea el único hilo de Node — mientras resuelve la búsqueda de un usuario, el server no puede atender NINGUNA otra request (ni de otro usuario, ni `/api/comparar`) hasta terminar.
  6. **Repetido en la VM real (e2-micro): no es "más lento", es un crash por falta de memoria.** Se armó el mismo catálogo sintético de 606k directamente en la VM (copia aislada en `/tmp`, sin tocar el server corriendo ni el archivo real) y al intentar cargarlo, el proceso de Node murió con `FATAL ERROR: Reached heap limit — JavaScript heap out of memory`. La VM tiene **958 MB de RAM total** (`free -h`), con **hoy, a la escala actual (~60k productos), ya usando 293 MB de swap** — sin margen para un catálogo 10x más grande. El backend real (`allpromos-backend.service`) hoy usa solo 60 MB de RAM porque el catálogo actual es chico (22 MB de JSON); un catálogo de ~600k (≈223 MB de JSON crudo, varias veces más una vez parseado a objetos JS con el índice precalculado) no entra en esta máquina. La búsqueda a 60k en la VM real, para referencia, midió ~50-84ms (similar a la Mac) — el problema a escala real no es la velocidad de CPU, es la RAM.
  7. **Conclusión revisada: el bloqueante no es solo "indexar la búsqueda" — es la RAM de la VM.** Ampliar cobertura de catálogo con la arquitectura actual (todo el catálogo cargado entero en memoria de un solo proceso Node) directamente no es viable en esta VM sin subir de máquina o cambiar a un motor que no requiera tener todo el dataset en RAM (una base de datos real con índices en disco, por ejemplo). Indexar la búsqueda (punto 5) seguiría haciendo falta para la velocidad, pero primero hay que resolver que el dato ni siquiera entra en memoria.
  8. **Los ~2.550 capturados hoy no son arbitrarios ni cambian de corrida a corrida: son los más vendidos.** Confirmado en vivo en Chango Más: dos requests idénticos devolvieron los mismos productos en el mismo orden (estable, no aleatorio), y el orden default (sin pasar `O=`) resultó **idéntico** al de pedir explícitamente `O=OrderByTopSaleDESC` — la API ordena por ventas cuando no se pide otra cosa. Esto es una buena noticia parcial: lo que falta cubrir por el tope de paginación es la cola larga (productos poco vendidos/de nicho), no una mezcla al azar que podría estar excluyendo productos populares.
- **Promos condicionales (NxM, Ndo al X%) de Chango Más sin confirmar**: el código las soporta pero nunca se observó un ejemplo real en producción.
- **El tope de una promo bancaria "por ticket" se trata como si estuviera siempre disponible entero para ESTA compra — no hay tracking de consumo acumulado.** `mejorPromoTicket` (`AllPromos/promos-bancarias.js:614-624`) calcula `descuento = Math.min(subtotal * pct, tope)` desde cero en cada comparación: el tope es un techo por cálculo, no un saldo real que se va gastando. Varios topes reales del cache son explícitamente **mensuales** (ej. texto legal de una promo de Mercado Pago en Carrefour: "Tope Mensual: $20.000") — la app no sabe si el usuario ya consumió parte de ese tope con otra compra ese mismo mes (en Super App o fuera de ella), así que siempre muestra el ahorro máximo teórico, que en la práctica puede estar parcial o totalmente agotado. No es un bug introducido por el fix de reparto del 2026-09-03 (ver nota de esa fecha, sección de promos bancarias) — es una limitación preexistente del mecanismo, nunca hubo tracking de reintegros ya usados. Implementarlo requeriría guardar por usuario+tarjeta+super cuánto reintegro ya se usó en el período de cada promo (mensual, semanal, etc.) — no hay ningún dato hoy de qué compras se concretaron realmente (la app arma links a los carritos de cada super pero no confirma la compra), así que ni siquiera hay una fuente confiable de "cuánto ya gastó" sin pedirle al usuario que lo cargue a mano.

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
- ~~Sacar La Anónima de la app~~ ✅ hecho (2026-08-20) — el WAF de CloudFront bloqueaba la IP de la VM de forma recurrente (no un bloqueo puntual, volvía una y otra vez, afectando tanto al scraper como al fetch de precio en vivo) sin una forma confiable de evitarlo, y era el super con menos cobertura y sin EAN propio (~22% matcheado por nombre). Se sacó por completo: scrapers y módulos exclusivos borrados (`scraper-promos-laanonima.js`, `enriquecer-catalogo-laanonima.js`, `resolver-ean-laanonima-flix.js`, `aplicar-ean-flix-laanonima.js`, `core/laanonima-zona.js`, `mi-codigo-postal.js`, `backend/src/routes/laanonima.js`), y su entrada removida de `core/catalogo.js`, `core/fetchers.js`, `precioCache.js`, `sondaEnVivo.js`, `comparar.js` (incluido el gate de cobertura por CP y el parámetro `codigoPostal` de `/api/comparar`/`/api/precios`, que ya no tenía otro uso), `unificarCatalogo.js`, `refrescarCatalogos.js` y `server.js`, más el contexto/modal de CP y las listas de supers del frontend (`api.ts`, `comunes.tsx`, `theme.ts`, `HeaderNegro.tsx`, `filtrosSupers.tsx`). En ese momento quedaron **5 supers activos**: Vea, Carrefour, Chango Más, Día, Coto — al día siguiente (2026-08-21) se sumaron Jumbo y Disco (ver "API de Jumbo/Disco" más arriba), así que **hoy son 7**. Ver `PLAN_SACAR_LAANONIMA.md` para el detalle completo del trabajo de sacar La Anónima.
- ~~Interpretar el formato "2x$X" (precio fijo) de Día en `promo-engine.js`~~ ✅ hecho (2026-08-19) — tipo `oferta_precio_fijo`, ver "API de Día" arriba
- ~~Promos por producto condicionadas a tarjeta propia más allá de Mi Carrefour: MasClub~~ descartado (2026-08-19) — ver "Cerrado, no implementar" en "API de Chango Más" arriba, sin evidencia de que exista (mismo cierre que Cencopay, ver sección de promos bancarias)
- ~~Conectar promos bancarias con tope a `/api/comparar`~~ ✅ hecho (2026-08-19) — ver "`POST /api/comparar` SÍ conecta este módulo" en la sección de promos bancarias arriba
