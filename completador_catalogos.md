# Completadores de catálogo por EAN — estado y próximos pasos

**Fecha de esta sesión: 2026-08-25/26.** Este doc es el handoff completo para retomar el trabajo
sin tener que redescubrir nada. Sesión larga, con mucho debugging en vivo — leelo entero antes
de tocar código, hay más de un hallazgo no obvio.

## 1. Por qué existe esto

Un usuario buscó "manteca ilolay" y no apareció en Coto, aunque el producto existía ahí. Investigando
se encontró que el catálogo local de cada super es un **recorte parcial** del catálogo real:

- **Vea, Carrefour, Chango Más, Día**: tope duro de ~2.550 ítems del endpoint legacy de VTEX
  (`_from`/`_to` — no es una decisión, es un techo de la API).
- **Jumbo, Disco**: mismo techo VTEX, pero además comparten la misma cuenta/master-data que Vea.
- **Coto**: recorte "a propósito" de ~5.000 SKUs por categoría (decisión de RAM del 19/08),
  ya reemplazado hoy (ver más abajo).

Consecuencia medida antes de esta sesión: del catálogo unificado (6.506 productos), **2.964
(45.6%) estaban "solo en 1 super"** — sin nada con qué compararlos, que es el propósito central
de la app.

## 2. La idea (ya validada y aplicada)

En vez de pedirle a cada super "traeme más páginas" (imposible, el techo es duro), se le pregunta
puntualmente por cada EAN que **ya sabemos que existe en otro super** — usando el endpoint de
búsqueda por EAN de VTEX (`fq=alternateIds_Ean:{EAN}`), un camino totalmente distinto del de
paginación masiva, sin ese techo. Mismo patrón para Coto pero con el autocomplete de
Constructor.io (`ac.cnstrc.com/autocomplete/{EAN}`).

Esto **no es al azar**: como cada candidato ya viene de otro super, cualquier hit tiene por
definición algo con qué comparar — no hay riesgo de sumar "ruido" sin valor para la app.

## 3. Resultado de la corrida de hoy (ya aplicado a los catalogo-*.json locales)

| Super | Antes | Ahora | Nuevos | % |
|---|---|---|---|---|
| Vea | 2.551 | 3.196 | +645 | +25.3% |
| Carrefour | 2.558 | 3.828 | +1.270 | +49.6% |
| Chango Más | 2.550 | 3.378 | +828 | +32.5% (*) |
| Día | 2.550 | 2.890 | +340 | +13.3% |
| Coto | 2.889 | 3.298 | +409 | +14.2% |
| Jumbo | 2.546 | 3.980 | +1.434 | +56.3% |
| Disco | 2.546 | 3.751 | +1.205 | +47.3% |

(*) Chango Más: la "pasada 2" de verificación no llegó a terminar limpia por los cortes de sesión
(ver § 6) — se cerró con los resultados de la pasada 1 solamente. Dado que en los otros 6 supers
la pasada 2 recuperó 0 casos sobre miles de negativos verificados, es muy poco probable que se
haya perdido algo real, pero si alguna vez se quiere ser 100% prolijo, correr
`completar-changomas-por-ean.js` de nuevo (el checkpoint ya no existe, así que sería una corrida
limpia) y ver si la pasada 2 encuentra algo.

**Catálogo unificado**: 6.506 → **7.379 productos únicos** (+873, +13.4%). "Solo en 1 super" bajó
de 45.6% a **33.2%** (2.450 productos). Más de un tercio del catálogo (34.3%) está ahora en 5+
supers. Verificado end-to-end contra el backend real: "Manteca Tradicional 200 Grs Ilolay" (el
caso que arrancó todo esto) pasó de estar en 0 a estar en **6 de los 7 supers**.

## 4. Estado de los archivos — IMPORTANTE, leer antes de correr nada

**Código nuevo, sin commitear todavía** (`git status` limpio de todo lo demás):
```
AllPromos/completar-vea-por-ean.js
AllPromos/completar-carrefour-por-ean.js
AllPromos/completar-changomas-por-ean.js
AllPromos/completar-dia-por-ean.js
AllPromos/completar-jumbo-por-ean.js
AllPromos/completar-disco-por-ean.js
AllPromos/core/checkpointEAN.js
completador_catalogos.md          (este archivo)
```
Y una **modificación** (no archivo nuevo): `.gitignore` — se agregó
`AllPromos/.checkpoint-*.json` para no versionar los checkpoints a medio camino.
`AllPromos/scraper-coto-por-ean.js` y el cambio en `backend/src/cron/refrescarCatalogos.js`
(Coto al final de la lista, llama a este script en vez de al viejo) **sí están commiteados**
(commit `b133743`, sesión anterior) — Coto es un caso aparte, ver § 7.

**Catálogos locales (`AllPromos/catalogo-*.json`, gitignorados, no se versionan)**: ya tienen los
resultados de hoy mezclados adentro — el archivo de cada super es hoy "los ~2.550 del scraper
normal" + "los encontrados por el completador", todo junto en la misma lista `skus`. Esto es
importante para la § 6.

**catalogo-unificado.json** (`backend/`, gitignorado): ya regenerado con todo lo de hoy
(`node backend/src/cron/unificarCatalogo.js`).

**La VM de producción NO tiene nada de esto todavía** — todo lo de hoy corrió en la Mac local.
Para que la app en producción se beneficie, hay que decidir cómo se lleva esto a la VM (¿correr
los completadores ahí a mano una vez? ¿esperar a resolver § 6 y que entre por el cron normal?).

## 5. Cómo funciona cada `completar-*-por-ean.js`

Mismo patrón en los 6 (Vea/Carrefour/Chango Más/Día/Jumbo/Disco), estructura casi idéntica:

1. Lee el `catalogo-X.json` actual → set de EAN que ya tiene.
2. Arma la lista de candidatos: unión de EAN de los **otros** catálogos (los que ya trajeron sus
   propios scrapers), menos los que X ya tiene. Jumbo/Disco no se usan como fuente de candidatos
   para Vea/Carrefour/Chango Más/Día (comparten master data con Vea, no aportan nada nuevo), pero
   sí se cruzan entre sí y contra Vea.
3. **Pasada 1**: un intento por EAN candidato, ritmo `PACE_MS = 250`ms. Guarda checkpoint cada 50.
4. **Pasada 2**: reintenta los que dieron negativo en la pasada 1 (mismo ritmo, sin espera
   especial). **Medido en los 5 supers que la terminaron limpia: Vea 1, Disco 2, Carrefour 0,
   Día 0, Jumbo 0 — 3 recuperados sobre ~16.650 negativos verificados en total** (Chango Más no
   se cuenta, nunca terminó limpia por los cortes de sesión). O sea, no es cero, pero es
   marginal: ~0.02% de recuperación. Sigue siendo un resguardo barato de mantener, pero no es
   el motivo por el que valga la pena tolerar el tiempo que agrega — ver § 8 para la disyuntiva
   real (tiempo vs. esos pocos casos).
5. Si hubo hits: arma el catálogo completo (`[...actuales, ...nuevos]`) y **reescribe el archivo
   entero** (`catalogo-X.json` + `promos-X.json`).

Reusan el mismo parseo (`parsearProducto`, `interpretarDescuentos`, etc.) que ya usaba cada
scraper normal — mismo shape de salida, cero cambios downstream necesarios en
`unificarCatalogo.js` ni `precioCache.js`.

## 6. PROBLEMA ABIERTO — por qué esto no se puede conectar al cron tal cual

**Los scrapers normales (`scraper-promos-vea.js`, etc.) REEMPLAZAN `catalogo-vea.json` entero
cada vez que corren** — vuelven a traer solo su propio top ~2.550 desde cero, no lo suman a lo
que ya había. Si el cron corriera el scraper normal y DESPUÉS el completador (como se hizo con
Coto), el completador se encontraría el catálogo reseteado a los 2.550 de siempre — **perdiendo
los 645-1.434 que agregó hoy cada super** — y tendría que redescubrirlos todos de cero, cada
ciclo, para siempre. Los ~6.000 SKUs nuevos de hoy **no persisten solos**: son un enriquecimiento
de una sola vez sobre el archivo actual, no algo que sobreviva al próximo `scraper-promos-vea.js`.

Esto es un problema real, no teórico: la próxima vez que alguien corra
`node scraper-promos-vea.js` (a mano o vía cron), **pisa silenciosamente los 645 productos
nuevos de Vea sin ningún aviso**.

### Diseño propuesto para resolverlo (no implementado todavía)

Separar en dos archivos por super:
- `catalogo-vea.json` — sigue siendo 100% del scraper normal, se resetea cada corrida (como
  siempre, sin tocar su lógica).
- `catalogo-vea-extras.json` — SOLO lo que aportó el completador, con su propio `fecha`. El
  scraper normal nunca lo toca.

`unificarCatalogo.js` pasa a leer ambos archivos por super y unirlos (mismo criterio de
prioridad/dedupe que ya usa entre supers, aplicado también extras vs. base).

El completador, en vez de partir de cero cada vez, pasa a hacer dos cosas separadas:
1. **Refrescar precio** de los EAN que YA están en `-extras.json` (consulta directa, no hace
   falta recalcular candidatos — son conocidos). Esto es rápido: son cientos-pocos miles de
   consultas, no ~4.000.
2. **Buscar candidatos nuevos**: la única parte cara sigue siendo esta, pero el volumen real
   de "candidatos genuinamente nuevos desde la última corrida" debería ser bastante menor a los
   ~4.000 de hoy (que era la primera vez, cubriendo TODO el hueco acumulado) — en corridas
   siguientes solo hay que cubrir lo que cambió entre medio (productos nuevos en otro super,
   altas/bajas de catálogo).

### Estimación de tiempo (NO medida, solo razonada — falta implementar y medir con una corrida real)

- Refrescar precio de extras conocidos: Vea ~645 EAN × 250ms ≈ 2.7 min. Carrefour ~1.270 ≈
  5.3 min. Chango Más ~828 ≈ 3.4 min. Día ~340 ≈ 1.4 min. Jumbo ~1.434 ≈ 6 min. Disco ~1.205 ≈
  5 min. **Total serie: ~24 min** (o ~6 min si corren en paralelo entre sí, distintos hosts).
- Búsqueda incremental de candidatos nuevos: **desconocido sin medir** — depende de cuánto
  cambia el top-2.550 de cada super entre corridas. Podría ser chico (unos minutos) o no tanto.

**No hay un número confiable todavía.** Antes de decidir la frecuencia del cron, hay que
implementar el diseño de arriba y correrlo una vez para medir el tiempo real de la parte
incremental.

## 7. Caso aparte: Coto

Coto es distinto y **ya está resuelto y en producción-ready**: `scraper-coto-por-ean.js`
reemplazó por completo al scraper de categorías (borrado, `scraper-promos-coto.js` ya no existe).
No tiene el problema de "reemplaza y pisa" del § 6 porque **es su única fuente** — no hay un
scraper normal de Coto corriendo en paralelo que lo resetee. Corre desde el cron real
(`refrescarCatalogos.js`, al final de la lista) sin ningún trabajo pendiente.

## 8. Hallazgos técnicos que hay que tener en cuenta si se toca este código

Todos verificados en vivo, con evidencia — no son suposiciones:

1. **CloudFront cachea respuestas vacías 5 minutos** (`s-maxage=300`, header `x-cache: Hit from
   cloudfront`). Si el primer pedido a un EAN da 0 por un hipo transitorio, cualquier reintento
   en esos 5 min recibe el mismo vacío cacheado. Fix: parámetro `_cb` único por request
   (`Date.now() + random`) en la URL — confirmado que pasa de "Hit" a "Miss".
2. **`fetch`/undici con keep-alive devuelve datos corruptos/incompletos bajo ráfaga de requests
   a EAN distintos contra el mismo host** — a veces `sellers: []` o `IsAvailable: false` para un
   producto que sí existe y sí tiene stock. Reproducido de forma consistente con `fetch` (con o
   sin header `Connection: close`, que igual no soluciona nada porque `undici` no lo termina de
   respetar). **Solución real**: usar el módulo `https` nativo de Node con un
   `new https.Agent({ keepAlive: false })` — cada request abre su propia conexión TCP/TLS, sin
   nada que reusar mal. Confirmado 4/4 veces limpio con este approach donde `fetch` fallaba
   ~1-2 de cada 15 requests.
3. **Rate limits**: Coto (Constructor.io) publica uno real en headers
   (`x-ratelimit-limit: 201` cada ~3s) — se usó 12 req/s con margen de sobra, 0 errores en 6.506
   requests. VTEX (Vea/Carrefour/Chango Más/Día/Jumbo/Disco) **no publica ningún límite** en este
   endpoint — se probó con 250ms de ritmo (4 req/s) y salió limpio en TODOS: 0 errores de red en
   miles de requests por super, incluyendo Carrefour (que sí tiene 429 conocido en su endpoint
   de paginación masiva, pero no en este de búsqueda por EAN).
4. **La pasada 2 (reintento de negativos) aportó casi nada**: 3 recuperados (Vea 1, Disco 2,
   Carrefour/Día/Jumbo 0) sobre ~16.650 negativos verificados en los 5 supers que la terminaron
   limpia (Chango Más no se cuenta, no la terminó). Es sospecha razonable que valga la pena
   sacarla — ahorraría ~40-50% del tiempo de cada corrida a cambio de un puñado de productos
   sobre miles — pero es una decisión de trade-off, no algo "confirmado inútil al 100%".
5. **Cortes de sesión sin explicación**: el proceso background se cortó solo, sin ningún error en
   los logs, **al menos 8 veces** durante esta sesión — corriendo solo, corriendo en paralelo con
   otros, contra hosts distintos, con corridas cortas y largas. No se identificó la causa (no es
   sleep de la Mac — se descartó explícitamente, hubo corridas largas sin cortes en la misma
   sesión sin actividad del usuario). El mecanismo de checkpoint (§ 9) hace que esto no importe
   en la práctica, pero si se vuelve a ver, no asumir que es un bug del script.

## 9. Checkpoint (`AllPromos/core/checkpointEAN.js`)

Dado el punto 5 de arriba, cada `completar-*-por-ean.js` guarda progreso cada 50 EAN procesados
en `.checkpoint-<nombre>.json` (gitignorado si hace falta agregarlo — chequear `.gitignore`,
no se verificó explícitamente). Si el proceso se corta, correr el mismo comando de nuevo lo
retoma automáticamente (compara la lista de candidatos por longitud — si cambió, invalida el
checkpoint y arranca de cero). El checkpoint se borra solo al terminar con éxito.

**Ojo**: el checkpoint solo cubre la pasada 1 (la cara). Si se corta en la pasada 2, al
retomar se vuelve a hacer la pasada 2 completa desde el principio (no es grave, dado el punto 4
de arriba — la pasada 2 probablemente ni haga falta).

## 10. Estado 2026-08-26 — § 6 y pasada 2 ya resueltos

Sesión de retomada (2026-08-26): se implementó el diseño de § 6 y se sacó la pasada 2. Detalle:

1. **Pasada 2 sacada de los 6 scripts** (aportaba ~0.02%, no valía el ~40-50% de tiempo extra).
   Cada script ahora hace un solo barrido por EAN candidato.
2. **Diseño `-extras.json` implementado.** `AllPromos/core/catalogo.js` (`leerCatalogo`) ahora
   mezcla de forma transparente `catalogo-X.json` (base, 100% del scraper normal, se resetea
   cada corrida) + `catalogo-X-extras.json` (solo lo que aporta el completador, si existe) para
   CUALQUIER consumidor — CLI (`resolverEANporNombre`), `unificarCatalogo.js`, `precioCache.js`.
   Ninguno de esos tres tuvo que cambiar: el punto de merge es un solo lugar (`leerCatalogo`),
   cacheado por mtime de ambos archivos. Si un EAN de extras vuelve a aparecer en la base, se
   prioriza la versión de la base (más fresca) — implementado y testeado.
   Los 6 `completar-*-por-ean.js` ya NO tocan `catalogo-X.json`: leen la vista mezclada (vía
   `leerCatalogo`, así que los candidatos ya excluyen extras existentes) y escriben/actualizan
   solo `catalogo-X-extras.json` (+ `promos-X-extras.json`, mismo criterio, no consumido en
   ningún flujo — ver `AllPromos/CLAUDE.md` discrepancia #1), acumulando sobre lo que ya
   hubiera ahí en vez de perderlo.
3. **Importante — los `catalogo-*.json` locales del Mac NO son los de producción.** La VM corre
   sus propios scrapers vía su propio cron (`refrescarCatalogos.js`, cada 2hs) — no hay sync de
   archivos entre el Mac y la VM. Los `catalogo-*.json` mezclados (base+extras juntos) que quedaron
   en el Mac de la sesión anterior (25-26/08) son solo para desarrollo/CLI local; no hace falta
   "separarlos" retroactivamente para que el diseño nuevo funcione — simplemente no hay
   `catalogo-*-extras.json` todavía en el Mac, así que `leerCatalogo` los sigue leyendo tal cual
   (sin romper nada), y cualquier corrida nueva de un completador ya escribe en el archivo de
   extras correcto.
4. **Pendiente para que producción se beneficie**: correr los 6 `completar-*-por-ean.js`
   directamente en la VM (contra su propio `catalogo-*.json`, recién scrapeado por su cron) +
   `npm run unificar` ahí — no copiar nada del Mac. Requiere `git pull` en la VM primero (o
   esperar al auto-deploy de GitHub Actions) para tener el código nuevo. Ver § 11 para el estado
   de este paso.
5. **Sigue pendiente, sin implementar** (no bloqueante, no se tocó esta sesión):
   - Refrescar precio de los EAN ya conocidos en `-extras.json` en el cron normal — hoy el
     precio de los extras solo se actualiza cuando alguien vuelve a correr el completador
     completo (candidatos + barrido), no hay un camino liviano "solo refrescar precio de lo
     que ya sé que existe" todavía.
   - Decidir la frecuencia real del cron para "buscar candidatos nuevos" — falta medir el
     tiempo real de una corrida incremental (la de hoy, al no haber `-extras.json` previo en
     ningún lado, es equivalente a una primera corrida completa, no mide lo incremental).
   - Conectar los 6 completadores al cron real (`refrescarCatalogos.js`) — hoy siguen siendo
     scripts sueltos, se corren a mano.

## 11. Próximos pasos concretos, en orden

1. Commitear el código (ya no bloqueado por el diseño — el diseño ya está implementado).
2. SSH a la VM, `git pull` (o confirmar que ya llegó por auto-deploy), correr los 6
   `completar-*-por-ean.js` ahí + `npm run unificar` — esto es lo que efectivamente lleva el
   enriquecimiento a producción.
3. Medir cuánto tarda esa corrida en la VM (primera vez con este diseño, así que sigue siendo
   "completa", no incremental — pero da una cota real de tiempo con la que decidir frecuencia).
4. Con ese número, decidir si/cómo conectar esto al cron (diario, semanal, manual) — la
   intuición del usuario (2026-08-25) es que no es urgente reflejar un producto nuevo al
   instante.
