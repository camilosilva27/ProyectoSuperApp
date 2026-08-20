# AllPromos — instrucciones para Claude Code

CLI personal en Node.js (sin dependencias externas, usa `fetch` nativo) que compara precios y promos entre Vea, Carrefour y Chango Más. El usuario está en Luján, Buenos Aires, pero **los 3 supers muestran precio único a nivel país** (confirmado en vivo el 2026-08-10 — ver "Alcance y limitaciones" en `CONTEXTO_TECNICO.md`), no algo específico de esa zona. Contexto completo en [`../CONTEXTO_TECNICO.md`](../CONTEXTO_TECNICO.md) y [`../COMO_FUNCIONA.md`](../COMO_FUNCIONA.md) — leelos antes de tocar código. Este archivo no repite ese contenido, solo agrega lo operativo y lo que verifiqué contra el código real.

## Cómo quiero que trabajes conmigo

- **Sé crítico, no complaciente.** No valides una idea mía solo porque la propuse. Si algo tiene un problema, una alternativa mejor, o no tiene sentido, decilo directamente.
- **Discutí conmigo.** Esto es un proyecto personal chico, no hay presión de plazos — priorizo llegar a la mejor solución sobre "resolver rápido". Si ves una tensión entre dos enfoques, plantéala en vez de elegir en silencio.
- **Ante ambigüedad, preguntá — no asumas.** Si una instrucción mía admite más de una interpretación razonable, o si falta un dato para decidir (ej: qué hacer cuando dos promos empatan, cómo tratar un producto sin EAN), preguntame antes de escribir código. Prefiero una pregunta a que adivines y tengamos que deshacer trabajo.
- Si vas a cambiar un comportamiento documentado en `CONTEXTO_TECNICO.md` o `COMO_FUNCIONA.md`, decímelo explícitamente — esos archivos hay que mantenerlos sincronizados con el código.

## Invariantes que no se deben romper

- **Los precios NUNCA salen del catálogo local — pero esto ya solo es cierto para la CLI, no para el backend/app.** Para `buscar-promos.js`/`core/*` acá en `AllPromos/`, `catalogo-*.json` solo resuelven nombre → EAN (+ skuId en Vea); leer `precioBase`/`price` del catálogo para mostrarlo al usuario en la CLI sigue siendo un bug. **Desde 2026-08-13, `backend/src/precioCache.js` rompió esto a propósito para el backend/app**: lee precio directo de `catalogo-*.json` como camino común de `/comparar`/`/precios` (ver `backend/README.md` § "Caché de precio" y `CONTEXTO_TECNICO.md` § "Alcance y limitaciones"). Consecuencia real: un catálogo desactualizado o con datos malos (cookie vieja, SKU fantasma, lo que sea) ya no es "solo un problema de resolución de nombre" — es un problema de precio real que ve el usuario. Si tocás un scraper, tené esto en cuenta.
- **Prioridad de búsqueda en Vea: skuId sobre EAN.** `fq=alternateIds_Ean` no es confiable en la API de Vea; por eso `veaLive()` en [buscar-promos.js](buscar-promos.js) arma la query con `skuId` cuando está disponible.
- **Vea siempre devuelve `sellerId: "1"`**, sin importar si se busca por skuId, EAN o nombre (confirmado en vivo, no es un caso especial de skuId). `core/fetchers.js` hace `sellers.find(s => s.sellerId === VEA_SELLER) || sellers[0]` — el fallback es lo que se usa siempre en la práctica. (Una versión vieja de esta doc mencionaba una variable `requireLujanSeller` que nunca existió en el código real — no la busques.)
- **Promos bancarias excluidas** (Tarjeta, Cuenta Digital, Banco) — se filtran en `buscar-promos.js`, `scraper-promos-carrefour.js` y `scraper-promos-changomas.js`. Si agregás una fuente de promos nueva, replicar el filtro.
- **Comparación generalizada a N supers vía el array `SUPERMERCADOS`** en `core/fetchers.js` (no en `buscar-promos.js`, que solo lo importa y lo itera — corregido acá porque esta doc decía lo contrario). Un super nuevo se suma agregando una entrada ahí + sus funciones `xLive*`/`parsearProductosX`, y sumando la key al `Promise.all` de `buscarPorEAN`/`buscarPorNombreEnVivo`; no tocar `mostrarComparativo`/`mostrarResumenFinal` para eso.
- **La herramienta es interactiva a propósito** (`readline/promises`, sin deps): pregunta ante ambigüedad de nombre, ante 0 matches (posible typo — no autocorregir nunca, preguntar), y ante cualquier promo que no llegue a activarse con la cantidad pedida. Esto fue pedido explícitamente, no lo "simplifiques" a un fallback silencioso aunque parezca más prolijo — la razón fue evitar que la herramienta adivine mal y compare el producto equivocado sin que el usuario se entere.
- **`preguntarCambioDeCantidad` pregunta UNA sola vez aunque haya varias cantidades candidatas** (ej. Carrefour necesita 2 para un 2x1, Vea necesita 3 para un 3x2): muestra la vista previa completa (todos los supers) para cada cantidad candidata en la misma pregunta, en vez de preguntar una vez por cantidad. Si tocás esto y se te ocurre "simplificarlo" a una sola cantidad sugerida, no lo hagas — se descartó a propósito porque ocultaría la alternativa del otro super.
- **La lógica de cálculo vive en `core/`, no en `buscar-promos.js`.** `core/catalogo.js`, `core/fetchers.js` y `core/comparador.js` los comparten la CLI y `backend/`. Regla: en `core/` no va ni un `console.log` ni un `readline` — las funciones calculan y devuelven datos; imprimir y preguntar es responsabilidad de la CLI. Si agregás una función que hace las dos cosas, separala antes de que el backend tenga que duplicarla.
- **La CLI tiene que seguir imprimiendo exactamente lo mismo.** Después de tocar `core/` o `buscar-promos.js`, corré `compras-prueba.txt` y compará la salida contra la de antes del cambio (así se validó la extracción de `core/`: 653 líneas idénticas).
- **`tarjetas` se pasa por parámetro**, no se lee de `mis-tarjetas.json` dentro de los fetchers: la CLI le pasa `leerMisTarjetas()` y el backend recibe la lista en cada request. No volver a leer el archivo dentro de `core/`.
- Sin dependencias npm **en `AllPromos/`** — este directorio no tiene `package.json` y sigue corriendo con Node pelado. `backend/` y `app/` sí usan npm (Express, Expo): es un quiebre consciente que aplica solo a ellos. Si proponés agregar una librería, preguntame primero; probablemente prefiero resolverlo con `fetch`/JS plano (esto incluye `readline`, que ya se resolvió con el módulo nativo de Node, no una lib de terceros).

## Discrepancias entre la documentación y el código que encontré

Al leer el código fuente noté un par de cosas que `CONTEXTO_TECNICO.md` no mencionaba (ya corregido en esa doc, dejo la nota acá por si vuelve a pasar con código nuevo):

1. `promos-*.json` son un subconjunto filtrado (solo SKUs con promo/descuento) que generan los scrapers para inspección rápida. `buscar-promos.js` no los lee — no forman parte del flujo en vivo.
2. La función que parsea "nombre de promo + descuento efectivo" se llama `interpretarPromoPorTexto` (antes `interpretarPromoVea`, la renombramos porque Carrefour y Chango Más también la usan para su descuento directo). Si ves código viejo o memoria de una sesión anterior con el nombre viejo, está desactualizado.

## Chango Más / Masonline — lo que hay que saber antes de tocar esa parte

- **El host real es `masonline.com.ar`**, no `changomas.com.ar` (que redirige con 301 — Chango Más rebrandeó su web). `CHANGOMAS_HOST` en `buscar-promos.js` y `BASE_URL` en `scraper-promos-changomas.js` apuntan a masonline.com.ar a propósito. El nombre "Chango Más" se mantiene en el código/UI porque es como el usuario conoce la marca.
- **No confirmado que sea precio de sucursal puntual** — es precio nacional único, igual que Carrefour y Vea (los 3 dieron el mismo resultado al comparar regiones). Probamos con `regionId` de Luján vs. una ciudad lejana y el precio de un mismo skuId fue idéntico bajo `sc=1`/seller `"1"`. No inventar lógica de regionalización para esto sin evidencia nueva.
- **Teasers/PromotionTeasers sin verificar.** El parseo de promos condicionales (NxM, Ndo al X%) está implementado por simetría con Carrefour, pero se escanearon ~450 productos reales y nunca apareció un teaser poblado. Si vas a debuggear "por qué no detecta esta promo de Chango Más", empezá por confirmar que el campo realmente tiene datos con `console.log` antes de asumir que el regex está mal.
- **Límite de ~2.550 ítems en el endpoint legacy de VTEX** (`_from`/`_to` acumulado > ~2550 → 400). Esto no es un bug del scraper: Vea (378k reales) y Carrefour (104k reales) tienen el mismo techo y sus catálogos locales también son un recorte parcial, solo que es menos notorio porque sus catálogos totales visibles son más chicos. No "arreglar" esto con reintentos o backoff — es un límite duro de la API, no un rate limit.

## Comandos

```bash
# Uso normal
node buscar-promos.js "coca cola 2.25" 2
node buscar-promos.js 7790895000122 1
node buscar-promos.js --lista compras-real.txt      # lista real (20 ítems)
node buscar-promos.js --lista compras-prueba.txt    # lista de prueba (10 ítems), usar para probar cambios

# Regenerar catálogos locales (para la CLI solo resuelven EAN/skuId/nombres; para el backend/app
# SÍ son la fuente de precio del camino común desde 2026-08-13, ver backend/README.md § "Caché
# de precio" — un catálogo desactualizado o con datos malos ahí impacta el precio real que ve
# el usuario, no es inocuo)
node scraper-promos-vea.js           # ~5 min
node scraper-promos-carrefour.js     # ~10 min
node scraper-promos-changomas.js     # ~2 min (tope de ~2550 SKUs, no ~10 min a pesar de que el catálogo real es más grande)
```

No hay test suite. Para validar un cambio, correlo contra `compras-prueba.txt` y revisá manualmente que los totales y promos calculados tengan sentido (comparar contra `COMO_FUNCIONA.md` para ver el formato esperado del resumen).

**Testear el flujo interactivo sin responder a mano:** se puede pipear respuestas por stdin, pero con un detalle importante — si el pipe se cierra (EOF) antes de que el script llegue a la siguiente pregunta, esa pregunta se queda esperando para siempre (no tira error, el proceso simplemente no avanza más). `printf 'a\nb\n' | node buscar-promos.js ...` puede fallar por esto si hay trabajo async (fetch a las 3 APIs) entre pregunta y pregunta. Usar en su lugar algo que mantenga el pipe abierto con delays entre respuestas, ej.: `( printf '1\n'; sleep 1; printf '2\n' ) | node buscar-promos.js "producto" 1`. La función `ask()` en el código maneja el caso de pipe ya cerrado del todo (devuelve `''`), pero no el de "se cerró justo a mitad de camino".

## Riesgos operativos a tener en cuenta

- ~~La cookie `vtex_segment` de Vea puede expirar~~ — ya no existe: se sacó del código por completo el 2026-08-20 (primero de `core/fetchers.js` el 13-08, después de `scraper-promos-vea.js`). No la vuelvas a agregar sin confirmar en vivo que sigue dando precio vigente — el motivo por el que se sacó fue justamente que una cookie fija terminaba devolviendo precio/disponibilidad de una tabla vieja para ~10% del catálogo, en silencio, sin error. Ver `CONTEXTO_TECNICO.md` § "API de Vea".
- Los scrapers son procesos que pegan directo a las APIs de producción de Vea/Carrefour/Chango Más. No los corras en loop ni los uses para probar cambios chicos — para eso están los catálogos ya generados.
- Carrefour rate-limitea con 429 frecuentemente; Chango Más además devolvió 502 intermitentes en pruebas. El retry con backoff de 10s en ambos scrapers es necesario, no un detalle a "simplificar".
