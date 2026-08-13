# Contexto técnico — AllPromos

Herramienta CLI personal e **interactiva** para comparar precios y promociones entre **Vea**, **Carrefour** y **Chango Más**. El usuario (en Luján, Buenos Aires) escribe el nombre del producto (o una lista) y recibe precios en vivo, con promos calculadas correctamente para la cantidad que quiere comprar. La herramienta pregunta por consola (usando `readline` nativo de Node, sin dependencias) cuando hay ambigüedad o cuando cambiar la cantidad activaría una promo — ver "Interactividad" más abajo.

**Importante — los 3 supers parecen tener precio único a nivel país, no por sucursal.** Esto se creyó cierto solo para Carrefour y Chango Más durante buena parte del proyecto (ver sus quirks más abajo), pero se asumía que Vea era la excepción "hiperlocal". Confirmado en vivo el 2026-08-10 que **no lo es**: se armaron cookies `vtex_segment` con `regionId` de Luján, Córdoba (700 km de distancia) y La Plata, y se consultaron 5 productos distintos (con y sin promoción activa) — el precio fue idéntico centavo por centavo en los tres casos. El endpoint `/checkout/pub/regions` tampoco filtra por código postal: devuelve la misma lista de sucursales (mezclando Chivilcoy, Santiago del Estero, Tucumán, Chaco, San Luis, Bahía Blanca) para el CP de Luján y el de CABA. Ver el detalle en "API de Vea — quirks críticos" más abajo. Sigue sin confirmarse que el precio online coincida con el de góndola de una sucursal física puntual — lo que se descartó es que varíe *entre* sucursales dentro del canal online.

---

## Estructura de archivos

```
AllPromos/
├── buscar-promos.js            ← CLI: readline + console.log (capa delgada sobre core/)
├── core/                       ← Lógica compartida entre el CLI y el backend
│   ├── catalogo.js             ← nombre → EAN/skuId, estado de frescura (con caché por mtime)
│   ├── fetchers.js             ← consultas en vivo a las 3 APIs + SUPERMERCADOS
│   └── comparador.js           ← mejor opción, sugerencia de cantidad, resumen final
├── promo-engine.js             ← Motor de cálculo de promos
├── scraper-promos-vea.js       ← Actualiza catalogo-vea.json
├── scraper-promos-carrefour.js ← Actualiza catalogo-carrefour.json
├── scraper-promos-changomas.js ← Actualiza catalogo-changomas.json
├── catalogo-vea.json           ← Diccionario local Vea (nombre → EAN + skuId)
├── catalogo-carrefour.json     ← Diccionario local Carrefour (nombre → EAN)
├── catalogo-changomas.json     ← Diccionario local Chango Más (nombre → EAN)
├── promos-vea.json             ← Subconjunto de catalogo-vea.json con solo SKUs con promo activa
├── promos-carrefour.json       ← Subconjunto de catalogo-carrefour.json con solo SKUs con descuento
├── promos-changomas.json       ← Subconjunto de catalogo-changomas.json con solo SKUs con descuento
├── compras-real.txt            ← Lista de compras real del usuario (20 ítems)
└── compras-prueba.txt          ← Lista de prueba (10 ítems)
```

`promos-*.json` los generan los scrapers como salida secundaria, pensada para inspección manual rápida (ej. ver el top de descuentos sin filtrar el catálogo completo a mano). `buscar-promos.js` no los lee — no forman parte del flujo en vivo.

**Además de la CLI, el repo ahora tiene dos consumidores más de la misma lógica** (ver también el plan de la app mobile):

```
backend/                        ← API HTTP para la app mobile (Express)
├── src/server.js               ← rate limit + API key por token compartido
├── src/routes/catalogo.js      ← GET /api/catalogo/buscar|categorias (SIN precios)
├── src/routes/comparar.js      ← POST /api/comparar (precios en vivo, mismo cálculo que la CLI)
├── src/routes/health.js        ← GET /api/health (frescura de catálogos + último cron)
├── src/catalogoUnificado.js    ← búsqueda en memoria sobre catalogo-unificado.json
├── src/cron/unificarCatalogo.js   ← dedupe de los 3 catálogos por EAN (escritura atómica)
└── src/cron/refrescarCatalogos.js ← corre los 3 scrapers como subprocesos + sonda de promos bancarias

app/                            ← App mobile (React Native + Expo SDK 57, expo-router)
├── app/(tabs)/index.tsx        ← Buscar/seleccionar productos
├── app/(tabs)/carrito.tsx      ← Carrito + tarjetas con las que se paga
├── app/resultado.tsx           ← Veredicto: dónde comprar cada cosa
└── src/                        ← theme.ts (tokens), api.ts, carrito.tsx, componentes/
```

**Invariante nuevo a respetar:** `catalogo-unificado.json` (el índice que ve la app) se genera excluyendo a propósito los campos `precioBase`/`precioActual`/`promocion`/`descuentoDirecto` que sí traen los `catalogo-*.json`. Esos precios son de la fecha del scraping; mostrarlos en la app sería mostrar un precio viejo como vigente. La app pide precios en vivo con `POST /api/comparar`.

**Cambio de firma en los fetchers:** `parsearProductosCarrefour`/`buscarPorEAN` reciben `{ tarjetas }` por parámetro en vez de leer `mis-tarjetas.json` a nivel de módulo. La CLI le pasa `leerMisTarjetas()` (comportamiento idéntico al anterior); el backend recibe la lista en cada request, porque cada teléfono de la familia puede tener tarjetas distintas.

**Importante:** `catalogo-*.json` NUNCA se usan para precios. Solo para resolver nombre → EAN y (en Vea) → skuId. Los precios y promos siempre se traen en vivo.
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
   - **2+ candidatos distintos** (ej. "pepitos 357 gr" matchea 3 variantes distintas entre los 3 supers) → pregunta cuál es el correcto, con la opción `0` de comparar los N como antes (comportamiento previo a este cambio).
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
[API en vivo] — en paralelo:
  Vea:        GET /api/catalog_system/pub/products/search?fq=skuId:{id}&sc=34
              POST /_v/search-promotions  → promos activas por skuId
  Carrefour:  GET /api/catalog_system/pub/products/search?fq=alternateIds_Ean:{ean}&sc=1
              (promos embebidas en la respuesta del catálogo)
  Chango Más: GET /api/catalog_system/pub/products/search?fq=alternateIds_Ean:{ean}&sc=1
              (promos embebidas, mismo mecanismo que Carrefour — host masonline.com.ar)
       ↓
[promo-engine.js] → calcula costo real para la cantidad deseada
       ↓
Muestra comparativo + resumen final
```

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
2. Busca en `catalogo-carrefour.json` para EANs adicionales
3. Busca en `catalogo-changomas.json` para EANs adicionales
4. Cross-referencia: si el EAN vino de Carrefour o Chango Más (skuIdVea=null), intenta igualmente buscarlo en el catálogo de Vea por EAN para obtener el skuId
5. Si no hay nada en catálogos locales → **ya no cae directo al fallback en vivo**: pregunta al usuario (ver "Interactividad") porque puede ser un error de tipeo. Solo si el usuario confirma explícitamente, hace fallback a búsqueda en vivo por nombre (menos confiable)

---

## Modo lista — resumen final

Para cada ítem muestra, por cada uno de los 3 supers que tenga resultado:
- Precio (mejor variante) + oferta activa + 🌐 si es online
- Cuál de los 3 conviene

Al final:
- **Total óptimo** (mezcla de supermercados, el más barato por ítem)
- **Total todo en Vea / todo en Carrefour / todo en Chango Más**
- Plan de compra: qué comprar en cada super
- Ítems no encontrados

La comparación y el resumen están generalizados sobre el array `SUPERMERCADOS` en `buscar-promos.js` (no hardcodeados a 2 supers), así que agregar un 4to super a futuro solo requiere sumar una entrada ahí + sus funciones `xLive*`/`parsearProductosX`, sin tocar la lógica de comparación ni de totales.

---

## Catálogos locales — cuándo actualizar

Los catálogos capturan el estado en el momento del scraping. Las **promos cambian semanalmente** (Vea las actualiza los jueves). El script avisa si el catálogo tiene más de 30 días.

```bash
node scraper-promos-vea.js           # ~5 min  → catalogo-vea.json
node scraper-promos-carrefour.js     # ~10 min → catalogo-carrefour.json
node scraper-promos-changomas.js     # ~2 min  → catalogo-changomas.json (tope de ~2550 SKUs, ver quirks arriba)
```

El scraper de Vea: pagina el catálogo, consulta `/_v/search-promotions` en batches de 10, guarda todo en `catalogo-vea.json` con campo `fecha`.

El scraper de Carrefour: pagina el catálogo con retry en 429, extrae promos de teasers y price diff, guarda en `catalogo-carrefour.json` con campo `fecha`.

El scraper de Chango Más: igual que el de Carrefour (retry en 429 **y 502**), guarda en `catalogo-changomas.json` con campo `fecha`. Al día de escribir esto solo capturó descuentos directos (122 de 2597 SKUs) — ninguna promo tipo teaser, ver quirks arriba.

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

- **Los 3 supers (Vea, Carrefour, Chango Más) muestran precio único a nivel país** — confirmado en vivo el 2026-08-10 para Vea (regionId de Luján vs. Córdoba vs. La Plata, 5 productos, precio idéntico) y ya se sabía para Carrefour y Chango Más. No está confirmado que ese precio online coincida con el de góndola de una sucursal física en particular.
- Solo **productos envasados con EAN real** (no productos al peso: queso, fiambre, carne)
- **Promos bancarias excluidas** (Tarjeta Carrefour, Cuenta DNI, etc.)
- El catálogo local puede desincronizarse con productos discontinuados o renombrados
- Las queries en vivo de Vea (`core/fetchers.js`) ya no usan cookie `vtex_segment` (ver quirk de precio desactualizado). El scraper de catálogo local (`scraper-promos-vea.js`) todavía la usa para bajar el catálogo masivo — ahí no importa que se desactualice porque `precioBase` del catálogo local nunca se muestra al usuario (ver invariante en `AllPromos/CLAUDE.md`), pero si ese scraper empieza a devolver 0 resultados o errores, sospechar de esa cookie expirada, no de esto.
- **Los 3 catálogos locales capturan solo una fracción del catálogo real de cada super** (tope de ~2.550 ítems del endpoint legacy de VTEX, ver quirk de Chango Más). Para Vea y Carrefour esto ya era así desde el principio; para Chango Más significa ~2.600 de ~59.826 SKUs reales. La búsqueda por nombre puede no encontrar productos poco comunes que no entraron en ese recorte.
- **Promos condicionales (NxM, Ndo al X%) de Chango Más sin confirmar**: el código las soporta pero nunca se observó un ejemplo real en producción.

---

## Pendientes / ideas futuras

- ~~Agregar Chango Más~~ ✅ hecho — ver secciones de arriba para los quirks encontrados
- ~~Preguntar ante ambigüedad de nombre y ante promos que no llegan a activarse~~ ✅ hecho — ver "Interactividad"
- Confirmar el formato real de `Teasers`/`PromotionTeasers` de Chango Más cuando aparezca la primera promo condicional (hoy sin verificar)
- Evaluar migrar los 3 scrapers a la Intelligent Search API de VTEX (`/api/io/_v/api/intelligent-search/...`) para superar el tope de ~2.550 ítems del endpoint legacy — hoy los 3 catálogos locales son un recorte parcial del catálogo real
- Renovar automáticamente la `vtex_segment` cookie de Vea via browser headless (solo aplica a `scraper-promos-vea.js` — las queries en vivo ya no la usan)
- Interface web mínima (hoy es solo CLI) — sería un rediseño más grande ahora que el flujo tiene pasos interactivos por consola
- Si el prompt de cambio de cantidad se siente repetitivo en listas grandes, evaluar la alternativa que se descartó ahora: juntar todas las oportunidades de toda la lista y preguntar una sola vez al final en vez de uno por uno
- **Día**: scraper listo y probado (`scraper-promos-dia.js`), falta integrarlo a `core/fetchers.js` (agregar a `SUPERMERCADOS`, función `diaLive*`/`parsearProductosDia`), a `core/catalogo.js` (prioridad en `resolverEANporNombre`), a `unificarCatalogo.js`, y al frontend (`SuperKey`, `PuntosDisponibilidad`, colores ya definidos en `app/src/theme.ts`). Ver "API de Día" arriba y `PLAN_FEATURES_APP.md`.
- **Coto**: scraper listo y probado (`scraper-promos-coto.js`, 2026-08-10) — pagina las 10 categorías de nivel superior de Constructor.io (excluye "Ofertas", ver comentario del archivo), calcula la moda de `price[]` como `precioBase`, e interpreta `discounts[]` (formatos confirmados en la corrida completa: "X%Dto" y "NxM" tipo 2x1/3x2). Resultado real: **57.623 SKUs, 100% con EAN e imagen** (sin el tope de paginación de VTEX, cobertura mucho mayor que los otros 4 supers). Falta integrarlo al resto del stack — mismo trabajo pendiente que Día: `core/fetchers.js` (`SUPERMERCADOS`, `cotoLive*`/`parsearProductosCoto`), `core/catalogo.js` (prioridad en `resolverEANporNombre`), `unificarCatalogo.js`, y frontend (`SuperKey`, `PuntosDisponibilidad`). Colores ya definidos (`#D6293E` claro / `#F0555F` oscuro).
