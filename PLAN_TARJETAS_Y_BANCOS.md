# Plan: promos con tarjeta propia y promos bancarias — AllPromos

**Estado: investigación terminada, decisiones de diseño tomadas (sección 4), implementación NO empezada.** Este documento es la entrada para quien vaya a programar esto — no asumas nada que no esté marcado como confirmado acá. La sección 4 tiene las decisiones ya tomadas por el usuario más notas técnicas de cómo implementarlas; no las vuelvas a cuestionar salvo que encuentres un problema técnico concreto al programarlas.

Contexto del proyecto: leer primero `CONTEXTO_TECNICO.md`, `COMO_FUNCIONA.md` y `AllPromos/CLAUDE.md` en la raíz del repo. AllPromos es una CLI en Node (sin dependencias) que compara precios entre Vea, Carrefour y Chango Más, con precios y promos siempre en vivo (nunca desde catálogo local). El usuario está en Luján, Buenos Aires, pero los 3 supers muestran precio único a nivel país (confirmado en vivo, ver CONTEXTO_TECNICO.md) — la nota de "excluye la sucursal de Luján" más abajo (4.3 en la investigación de Chango Más) es sobre elegibilidad de una promo bancaria puntual por sucursal, no sobre el precio base.

Motivación: el usuario quiere que la comparación tenga en cuenta:
- Las tarjetas/programas propios de cada super (Cencopay en Vea, Mi Carrefour en Carrefour, MasClub en Chango Más).
- Promos bancarias/de billeteras de las tarjetas que tiene la familia: **Santander Río, Banco Provincia, Mercado Pago, Cuenta DNI** (no cuentas bancarias adicionales, pero sí abierto a sumar otras billeteras virtuales a futuro).

---

## 1. Resumen ejecutivo

Investigamos en vivo (no por documentación de terceros) los 3 supers. Hallazgo central, y es lo más importante de todo el documento:

> **Existen dos tipos de promos con tarjeta, estructuralmente distintos, y necesitan modelos de cálculo distintos:**
>
> 1. **Promos por producto** — atadas a un SKU o cluster de productos específico (ej. "2x1 en Café con Cencopay", "Tarjeta Carrefour 15%" en un producto puntual). Encajan en el modelo actual de `promo-engine.js`: son "una promo más" sobre un producto, solo que condicionada a pagar con determinada tarjeta.
> 2. **Promos por ticket** — un % de descuento o cashback sobre **toda la compra**, condicionado a día de la semana + banco/tarjeta + formato de tienda, casi siempre con un tope de reintegro en pesos y a veces con un monto mínimo de compra. **No están atadas a ningún producto ni categoría** — aplican sobre el total, sea lo que sea que compres. Esto es la inmensa mayoría de lo que la gente conoce como "promos bancarias" (Cuenta DNI los jueves, Mercado Pago los viernes, etc.).

Las 4 tarjetas/billeteras que pidió el usuario (Santander, Banco Provincia, Mercado Pago, Cuenta DNI) son **casi todas del tipo 2** (por ticket), con la excepción de que Carrefour sí tiene promos tipo 1 pero solo para su propia tarjeta (Mi Carrefour), no para bancos de terceros.

**Buena noticia respecto de lo que yo mismo dije al arrancar esta conversación**: dije que las promos bancarias probablemente iban a requerir una tabla mantenida a mano porque no esperaba encontrar una API. Me equivoqué — **los 3 supers exponen esto vía APIs estructuradas** (GraphQL o Master Data de VTEX), con campos machine-readable para banco, tarjeta, día, tope, fechas de vigencia y hasta el texto legal completo. Es scrapeable de verdad, no hace falta mantenimiento manual — al menos para los tres supers de este proyecto.

**Mala noticia / la parte difícil de verdad**: el tipo 2 (por ticket) no encaja en el modelo actual de "un producto tiene una promo, calculamos su costo". Es una capa de cálculo nueva que se aplica DESPUÉS de armar el carrito completo, no por ítem. La sección 4 tiene las decisiones ya tomadas sobre cómo resolver esto.

---

## 2. Confirmado por supermercado

### 2.1 Vea (Cencosud)

**Tarjeta propia**: Cencopay — tarjeta de **crédito real** (no puntos, no débito), de Cencosud. Sitio: `pedila.cencopay.ar`.

**Promos por producto (tipo 1) — Cencopay atada a clusters:**
- Página: `https://www.vea.com.ar/descuentos-del-dia?type=cencopay` (el query param `type` no cambia el HTML que baja el servidor — es solo un hint para la pestaña activa en el cliente).
- Contiene un JSON embebido con objetos `{"offerName": "Hasta 2do al 80% en Lácteos", "url": "/61742?map=productClusterIds", "initialDate": "...", "expiredDate": "..."}`.
- El texto de `offerName` ya lo sabe parsear el motor actual (`interpretarPromoPorTexto`/regex de NxM y Ndo-al-X%).
- El cluster se consulta con el mismo mecanismo que ya usa el proyecto: `fq=productClusterIds:<id>&sc=34` (requiere la cookie `vtex_segment` ya hardcodeada en `buscar-promos.js`).
- **Confirmado end-to-end**: clusters 61742/61740/61747 devuelven productos reales, y esos productos YA están en `catalogo-vea.json` (matcheados por nombre y skuId).
- Ojo: algunas entradas de este feed son **financiación** ("15% + 12 CSI con Cencopay" — cuotas sin interés), no descuento de precio. Hay que filtrarlas (no bajan el total, solo cambian la forma de pago).
- **No confirmado**: si esta sección "por cluster" es la misma fuente que alimenta específicamente la pestaña "Cenco Pay" del sitio, o si es un feed de banners general que incluye ofertas sin tarjeta también. Tratarlo como "un feed más de promos candidatas", no como "la fuente definitiva de qué es exclusivo Cencopay".

**Promos por ticket (tipo 2) — bancos y Cencopay financiación:**
- Endpoint: `GET https://www.vea.com.ar/api/dataentities/JN/documents/bankDiscount?_fields=value,id&an=jumboargentina`
- Sin autenticación, HTTP 200 confirmado. **El mismo endpoint responde en `disco.com.ar` y `jumbo.com.ar`** con el mismo `an=jumboargentina` — es infraestructura compartida de Cencosud entre sus 3 banderas, no exclusiva de Vea.
- `value` es un string que hay que `JSON.parse()` — adentro, un array de ~191 objetos históricos (48 vigentes al 2026-07-01). Schema confirmado por ejemplo real:
  ```json
  {
    "banks": [{"name": "CencoPay", "image": "...", "order": "58", "refId": null}],
    "checkout": false,
    "collections": [],
    "dateStart": "1778209200",
    "dateEnd": "1785553200",
    "days": ["1","2","3","4","5","6"],
    "discount": "3.00",
    "discountText": "cuotas sin interés",
    "installments": "3",
    "installmentsText": "en Toda la Compra Online",
    "info": "...",
    "legals": "texto legal completo...",
    "paymentMethod": {"Crédito": {"type": "credit", "image": null}},
    "priority": "3",
    "isExclusive": false,
    "websites": ["veaargentina","discoargentina","jumboargentina","jumboargentinaio"],
    "stores": [],
    "excludedStores": []
  }
  ```
  - `dateStart`/`dateEnd`: unix timestamp en **segundos** (no milisegundos).
  - `days`: `1`=lunes ... `7`=domingo.
  - `banks[].name` es el campo que identifica el banco/tarjeta — valores vistos: `CencoPay`, `CencoPay Cuenta`, `Santander`, `Banco Nación`, `Banco Comafi`, `Bancor`, `Macro`, `NaranjaX`, `Patagonia`, `Patagonia 365`, `MODO`, `Mercado Pago`, `Amex`, `HSBC`, `BBVA`, `ICBC`, `Cuenta DNI`, `Supervielle`, `Visa`/`Master` genérico, etc.
  - **No existe campo booleano de acumulabilidad** — solo texto libre en `legals`.
- **Bancos del usuario, confirmado**:
  - Santander: "3 cuotas sin interés — con tarjetas Visa/Mastercard emitidas por Banco Santander". Legal dice explícitamente **"NO SE ACUMULA A OTRAS PROMOCIONES"**. Vigente jue-dom, 01/04 al 31/07/2026.
  - Mercado Pago: 20% con tope $20.000/usuario (vigencia puntual, ya vencida al 01/07/2026) y 12 CSI (también vencida). Legal: "no acumulativo con otras promociones".
  - Cuenta DNI (billetera de Banco Provincia — el nombre literal "Banco Provincia" no aparece en este feed, solo "Cuenta DNI"): la entrada más reciente encontrada (25% tope $10.000) está **vencida desde diciembre 2024** — no hay evidencia de una promo activa de Cuenta DNI en Vea ahora mismo.
  - No hay ninguna entrada con el string "Banco Provincia" tal cual (solo "Banco provincia de Neuquén", que es otra entidad).
- **Cumulatividad de Cencopay**: 30 de 43 entradas con banco Cencopay/Cencosud tienen la cláusula "NO ACUMULABLES CON OTRAS PROMOCIONES Y/O DESCUENTOS" en `legals` — parece boilerplate legal estándar de Cencopay, no algo caso por caso. Ambiguo si esto excluye específicamente los descuentos de catálogo (los de `/_v/search-promotions`) o solo otras promos de Cencopay entre sí.

**Ya conocido de antes (sin cambios)**: `/_v/search-promotions` (POST, requiere `vtex_segment`) da promos "genéricas" sin tarjeta, con campo booleano real `cumulative`.

### 2.2 Carrefour

**Tarjeta propia — "Mi Carrefour" es un programa de 3 niveles, no una sola tarjeta:**
- Mi Carrefour Clásico: solo DNI, sin tarjeta física, fidelización pura.
- Tarjeta Mi Carrefour Prepaga: nivel intermedio.
- **Tarjeta de Crédito Mi Carrefour / "Carrefour Banco"**: tarjeta de crédito real (Mastercard), emitida por **Banco de Servicios Financieros S.A.U.** — el equivalente de Cencopay para Carrefour.
- También existe "Cuenta Digital de Carrefour Banco" (billetera con QR), distinta de la tarjeta de crédito.

**Promos por producto (tipo 1) — SOLO tarjeta propia, ya en la API que usamos:**
- En `commertialOffer.Teasers`/`PromotionTeasers` (el mismo campo que ya leemos), aparece `"Tarjeta Carrefour 15%"` o similar.
- Campo estructurado (no texto libre) para identificar la tarjeta: `<Conditions>k__BackingField.<Parameters>k__BackingField[].<Name>k__BackingField == "RestrictionsBins"`, con `<Value>k__BackingField` = lista de BINs de tarjeta separados por coma (ej. `"507858,858110,858111,..."`).
- **Nunca aparecieron bancos de terceros ni Mercado Pago/Cuenta DNI en este endpoint** tras escanear ~20 categorías + el catálogo local completo (2566 SKUs). El catálogo de productos de Carrefour solo modela la tarjeta propia — todo lo demás vive en el sistema de tipo 2.
- **No existe campo de acumulabilidad estructurado** en ningún lado del `commertialOffer` de Carrefour (se buscó exhaustivamente: `DiscountHighLight`, `PromotionTeasers`, `PaymentOptions` — nada). Solo texto libre en el `legal` de la fuente de tipo 2.

**Promos por ticket (tipo 2) — GraphQL, el hallazgo más importante de Carrefour:**
- Página: `https://www.carrefour.com.ar/descuentos-bancarios` (o `/promociones`) — **renderizada por JS, indistinguible de una ruta inexistente con curl plano** (VTEX devuelve el fallback genérico 200 para cualquier ruta no reconocida). Hace falta un navegador (o replicar las queries GraphQL directo, ver abajo) para confirmar que existe.
- App VTEX IO responsable: `valtech.carrefourar-bank-promotions`.
- Tres operaciones GraphQL persistidas contra `https://www.carrefour.com.ar/_v/public/graphql/v1`:
  - `GetBanks` (hash `a17d0a4ae5248a8007075eb0c871b327be760c90f8ef994193758e4914e68c33`): catálogo estático de 32 bancos/billeteras, incluye **Santander_Rio, Banco_Provincia, Mercado Pago, Cuenta Dni** literalmente con esos nombres, además de Galicia, BBVA, Banco_Nacion, Macro, Citi, HSBC, ICBC, Itaú, Patagonia, Bancor, Supervielle, Tarjeta Naranja, Cuenta Digital, Mi Carrefour, Club La Nación, Otros_Bancos.
  - `GetCards` (hash `b0268b02cfc0021bcd0d0373f54e590bb71111cbcef4dcc62bf381a3a0abfa15`): catálogo estático de medios de pago (Amex, Cabal, Cuenta Digital, Cuenta Dni, Diners, Itaú, Mastercard, Mi Carrefour, Visa, etc.)
  - `GetPromotions` (hash `e3aa1d96402d80dbca5c2c9dbcb7ff859970db0ccfdb64e583fb8a9b1bbff49e`): el feed real de promos, filtro `where: active=true AND active_from < <ahora ISO> AND active_to > <ahora ISO>`, `account: carrefourar`.
- Schema de cada promo: `title`, `sub_title`, `discount_percentage`, `discounts_amount_installments`, `active_from`/`active_to`, `validText`, booleanos por día (`monday`...`sunday`), booleanos por formato (`hyper`, `market`, `ecommerce`, `express`, `maxi`), `idBank`, `idCard` (referencian `GetBanks`/`GetCards`), `legal`.
- **25 promociones activas confirmadas al 2026-07-01**, incluyendo:
  - **Cuenta DNI (Banco Provincia)**: title `"10% de descuento en tu compra con Cuenta DNI."`, sub_title `"10% acumulable con tu compra. ¡Sin Tope! NO INCLUYE CARNICERÍA, FRUTAS, VERDURAS, ELECTROS, BAZAR, TEXTIL..."`, miércoles, formatos hyper/market/express/maxi (no ecommerce). Legal firmado por Banco de la Provincia de Buenos Aires, **incluye la frase literal "ACUMULABLE CON PRODUCTOS EN OFERTA"** — este es el único ejemplo concreto encontrado en las 3 investigaciones donde la acumulabilidad está confirmada positivamente y sin ambigüedad.
  - **Mercado Pago**: "Hasta 3 Cuotas sin interés" (lunes/miércoles), "10% Ahorro... Acumulable con todas las promociones. Sin tope! Exclusivo con dinero en cuenta" (viernes, solo Maxi), "15% de descuento SIN TOPE... Exclusivo con dinero en cuenta" (jueves).
  - Santander/Galicia/BBVA: existen en el catálogo `GetBanks` pero **sin promo activa** en la consulta puntual del 2026-07-01 — el catálogo de bancos es más amplio que las promos vigentes en un momento dado.
- **Riesgo real a documentar para quien implemente**: los `sha256Hash` de las persisted queries son específicos de la versión desplegada de la app `valtech.carrefourar-bank-promotions` — pueden cambiar si Carrefour actualiza la app, rompiendo la integración sin aviso. Hay que tener un plan de "qué hacer si el hash deja de funcionar" (probablemente: volver a capturarlo con el navegador, no hay forma de evitarlo).

### 2.3 Chango Más (Masonline)

**Programa propio — MasClub, confirmado que NO es tarjeta de crédito:**
- Es puntos + descuentos (1 punto cada $100), registro gratis por DNI en `masclub.com.ar`. No hay tarjeta de crédito ni entidad financiera asociada — es más parecido a un carnet de socio que a Cencopay/Mi Carrefour Crédito.

**Promos por producto (tipo 1): NO encontradas.**
- Se escanearon ~1.870 productos en total (sumando esta investigación + la sesión anterior) en 51+ categorías distintas. **Cero ejemplos de `Teasers`/`PromotionTeasers` poblados** en la API de catálogo de Masonline. Es un hallazgo consistente y de alta confianza: Chango Más no parece modelar ninguna promo condicionada por tarjeta a nivel de producto — todo pasa por el sistema de ticket (tipo 2).

**Promos por ticket (tipo 2) — mismo patrón que Carrefour, distinto vendor pero mismo tipo de app:**
- Página: `https://www.masonline.com.ar/promociones-bancarias`, pestañas "POR DÍA" / "POR BANCO-TARJETA".
- App responsable: `valtech.gdn-banks-promotions` (mismo prefijo "valtech" que la de Carrefour — probablemente la misma casa desarrolladora ofreciendo un template similar a distintos retailers VTEX, aunque son instancias/hashes independientes).
- Tres operaciones GraphQL persistidas contra `https://www.masonline.com.ar/_v/public/graphql/v1`:
  - `GetPromos` (hash `1a071ebc5dc407a3f65e687b0f4c0a3b8d12a0c45d8d11370075c3b2a505251c`), `account: masonlineprod`.
  - `GetBanks` (hash `968d464317be357766de0e3beb313a55e0ebf7f45f2ef4a02c99fdf4ebca0876`).
  - `GetCards` (hash `b3aa47c5a259fd0c6ea4b9d29d553170da26dfcead2be3acafa026b9b9084b3a`).
- Schema (nombres de campo ligeramente distintos a Carrefour pero mismo concepto): `title`, `sub_title`, `discount_percentage`, `discounts_amount_installments`, `discount_text_info`, `active_from`/`active_to`, `active`, `validText`, booleanos por día, flags de canal (`market`, `ecommerce`, `express`, `hyper`, `maxi`), `legal`, `idBank`, `idCard`, **`isMasClub`** (booleano propio, no visto en Vea/Carrefour).
- **34 promociones activas confirmadas al 2026-07-01**, incluyendo:
  - **MasClub**: 15% miércoles, 20% jueves, sin tope, `idCard: null` (no requiere tarjeta física).
  - **Banco Provincia - Cuenta DNI**: title/texto "SIN TOPE DE REINTEGRO", 20% jueves, vigente 01/03 al 01/08/2026. (Nota: acá SÍ aparece la entidad como "Banco Provincia - Cuenta DNI", junto en un solo nombre — distinto de Vea, donde solo aparece "Cuenta DNI" sin "Banco Provincia", y de Carrefour, donde aparecen separados en el catálogo pero unidos en la promo real.)
  - **Mercado Pago**: 2 y 3 cuotas sin interés vía QR, según monto de compra ($50.000-149.000 → 2 cuotas; desde $150.000 → 3 cuotas).
  - **Santander**: existe como entidad en `GetBanks` (`Santander`, `Santander MODO`, `Santander Women`) pero sin promo activa en el snapshot del 2026-07-01.
  - Adicionales encontrados sin pedirlos explícitamente: Banco Nación (35% miércoles vía MODO BNA+, tope $15.000/semana), ANSES (10%, tope doble transacción+mensual), Naranja X (4 CSI, solo interior del país, excluye CABA/GBA), Bancor, empleados públicos/municipales (10%, **excluye explícitamente la sucursal de Luján** — dato relevante para este proyecto específicamente), Banco Patagonia 365 (20% miércoles).
- **Diferencia estructural importante vs. Vea/Carrefour**: no se encontró ningún campo tipo `productClusterIds` en este feed — las 34 promos son homogéneamente "por ticket completo", no hay ninguna variante "por producto" mezclada como sí pasa en Vea (que tiene ambos sistemas).

---

## 3. Tabla resumen — bancos pedidos por el usuario

| Entidad | Vea | Carrefour | Chango Más |
|---|---|---|---|
| Santander (Río) | Catalogado, con promo activa (3 CSI, no acumulable) | Catalogado, sin promo activa hoy | Catalogado como "Santander"/"Santander MODO", sin promo activa hoy |
| Banco Provincia / Cuenta DNI | Solo como "Cuenta DNI"; última promo encontrada vencida (dic-2024) | Catalogado como "Banco_Provincia" y "Cuenta Dni" por separado; promo activa hoy (10%, acumulable — confirmado en texto) | Catalogado junto como "Banco Provincia - Cuenta DNI"; promo activa hoy (20% jueves, sin tope) |
| Mercado Pago | Catalogado, promos puntuales vencidas hoy (no acumulativas) | Catalogado, 3 promos activas hoy (cuotas + 2 de % con distintas condiciones) | Catalogado, 2 promos activas hoy (cuotas por QR) |
| Otras billeteras (a futuro) | El feed ya trae ~15-20 bancos más sin que el usuario los pidiera | El catálogo `GetBanks` trae 32 entidades | Catálogo de bancos amplio, no cuantificado exactamente |

Ojo: **"vigente hoy" es un dato que va a cambiar solo** — las promos activas rotan mensual o semanalmente. Cualquier ejemplo concreto de este documento sirve para entender el formato, no como dato a hardcodear.

---

## 4. Decisiones de diseño

Estas preguntas ya se las hice al usuario y las resolvió — quedan acá como decisiones tomadas, no como preguntas abiertas. Cada una incluye la respuesta tal cual la dio, más notas técnicas de implementación que agrego yo para que quien programe no tenga que volver a interpretarlas.

### 4.1 Cómo sabe la herramienta qué tarjetas tiene el usuario

**Decisión**: archivo de configuración (pensado para poder cambiarlo a futuro sin tocar código). Las promos de bancos/tarjetas que el usuario **no tiene** no se traen ni se calculan — no es un tema de ocultarlas en el output, directamente no hay que pedirlas. Las promos de tipo financiación (cuotas/CSI) **se ignoran siempre**, sin importar la tarjeta — el usuario no está evaluando forma de pago en cuotas, solo precio final.

**Nota técnica**: sugiero un archivo `mis-tarjetas.json` en `AllPromos/` (mismo patrón que `catalogo-*.json`, pero éste no se regenera con un scraper, lo edita el usuario a mano) con algo como:
```json
{
  "tarjetas": ["Santander", "MODO", "Mercado Pago", "Cuenta DNI", "Banco Provincia", "Cencopay", "Mi Carrefour", "MasClub"]
}
```
Ojo con la normalización de nombres: cada super nombra las entidades distinto (Vea: `"Santander"`; Carrefour: `"Santander_Rio"`; Chango Más: `"Santander"`/`"Santander MODO"`; "Banco Provincia" en Vea solo existe como `"Cuenta DNI"`, en Chango Más como `"Banco Provincia - Cuenta DNI"` junto, en Carrefour como dos entidades separadas `"Banco_Provincia"` y `"Cuenta Dni"`). Hace falta una tabla de alias/mapeo por super, no un match de string directo contra el nombre en `mis-tarjetas.json`. Filtrar promos de financiación: descartar cualquier entrada donde el campo de cuotas/instalments esté poblado y no haya un `discount_percentage`/`discount` de precio real (ver sección 2 para los nombres de campo exactos por super).

### 4.2 Cómo se integra la promo de tipo 2 (por ticket) sin romper lo existente

**Decisión**: agregar una sección nueva, bien desglosada (para poder testear cada parte), sin tocar las funcionalidades existentes.

**Es posible, confirmado.** Como la promo de ticket no depende de ningún producto puntual, se puede calcular en un módulo completamente aparte que:
1. Lee `mis-tarjetas.json`.
2. Trae las promos de tipo 2 vigentes de los 3 supers (fetch independiente, sin tocar `parsearProductosVea`/`Carrefour`/`ChangoMas`).
3. Al final de `mostrarComparativo` (modo individual) y `mostrarResumenFinal` (modo lista), imprime una sección nueva y separada, sin modificar ninguna de las funciones de cálculo por ítem (`calcularCosto`, `mejorOpcion`, etc. quedan intactas).

Para que sea "bien desglosado para testing", estructurar como funciones puras separadas: una que devuelve la lista de promos de ticket aplicables (día + tarjeta + super → lista filtrada), otra que calcula el descuento/tope sobre un total dado, y una última que solo imprime — así cada una se puede probar independiente de la llamada en vivo a la API.

### 4.3 Recomendación de qué día conviene comprar

**Decisión**: la herramienta debe poder decir qué día conviene comprar, mirando ofertas del super + bancos, para los próximos 7 días (incluyendo hoy), combinando ambos tipos de promo (no listarlas sueltas). Ejemplo dado: si dentro de 3 días sigue vigente el 2x1 del super Y ese mismo día se activa un 10% de Mercado Pago, la recomendación debe ser "andá en 3 días".

**Ampliación posterior del usuario**: no hace falta que la recomendación sea un único día para todos los supers. Como cada super se compra por separado (y ni siquiera hace falta que sea online para esto — ir físicamente a Vea el jueves y a Carrefour el sábado es igual de válido), la recomendación puede ser **por super**: "Vea: comprá el jueves / Carrefour: comprá el sábado", cada uno con su propio mejor día.

**Alcance decidido para esto (discutido y confirmado)**: versión simple — día independiente por super, sin re-optimizar qué le compro a cada uno.
- La asignación ítem→super (qué producto se compra en qué super) es la que la app ya calcula hoy (4.2) y **no se toca ni se recalcula por día**. Esto es válido porque ya sabemos (ver más abajo) que las promos de producto no rotan por día de la semana — la asignación ítem→super de hoy sigue siendo válida cualquier día de esta semana, mientras la promo no haya vencido.
- Una vez fija esa asignación, para **cada super por separado** se calcula, de los próximos 7 días, cuál es el mejor día según las promos bancarias de ticket que aplican a lo que ese super le vendería (día de la semana + vigencia). No hay que buscar coincidencia ni alineación entre supers — cada uno se optimiza de forma independiente, lo cual es más simple que calcular un único día global.
- **Explícitamente fuera de alcance** (quedó identificado en la discusión, no se pidió): re-evaluar si convendría mover un ítem a otro super porque ese super tiene mejor promo de ticket en un día distinto (ej. un producto $5 más barato en Carrefour por promo de producto, pero que convendría comprar en Vea el jueves por el 10% de ticket de Santander). Esto requeriría evaluar cada ítem contra las 21 combinaciones (super × día) en vez de contra la asignación ya fija, es un problema combinatorio genuinamente más grande, y cae en la misma familia que la Fase 4 (opcional, no pedida) de la sección 5.

**Datos que lo hacen posible:**
- **Las promos bancarias (tipo 2) sí tienen granularidad por día de la semana** (`days`/`monday`...`sunday` en los 3 supers) más una ventana de vigencia (`dateStart`/`dateEnd` o `active_from`/`active_to`) — con esto se puede calcular, para cada super y cada uno de los próximos 7 días, qué promos de banco están vigentes ese día específico para ese super.
- **Las promos genéricas del super por producto (no de tarjeta) NO tienen patrón por día de la semana** — en los ejemplos que vimos (Vea `/_v/search-promotions`, Carrefour Price/ListPrice, teasers) el campo de días viene vacío (`"days": {}`) o no existe; solo tienen fecha de inicio/fin, sin rotar por día dentro de esa ventana. Es decir: si una promo de producto vence el miércoles, comprar el martes o el lunes da lo mismo — lo único que cambia día a día es si ya venció o no, no el descuento en sí. Esto es lo que justifica no recalcular la asignación ítem→super por día.
- **Cómo se calcula el mejor día de cada super**: para el subtotal ya asignado a ese super (según la asignación ítem→super fija), y para cada uno de los próximos 7 días, se aplica la promo de ticket de banco que corresponda a ese día de la semana (con su tope si tiene) y se recalcula el total de ese super para cada día. El día recomendado para ese super es el que da el total más bajo. No requiere volver a pedir precios en vivo: el precio de producto no cambia por día (ya lo tenemos), lo único que varía día a día es qué promo de banco entra.
- **No confirmado**: si el precio o las promos de producto en sí (no las de banco) pueden cambiar de un día para el otro dentro de la ventana de 7 días sin que lo sepamos de antemano (ej. una promo nueva que arranca el jueves que hoy, lunes, no existe todavía). La recomendación de "mejor día" con los datos de hoy es una proyección basada en lo que ya está publicado ahora — no una garantía, puede quedar desactualizada si el super publica algo nuevo a mitad de semana.

### 4.4 Comparar canal online vs. físico, no elegir uno fijo

**Decisión**: la herramienta no asume un canal — calcula ambos (online y físico) y decide. Si hay 10% comprando online pero 20% yendo al local, tiene que hacer la cuenta de las dos formas y decirte cuál conviene por producto/super.

**Es posible, con un supuesto que dejo explícito porque no lo pude confirmar al 100%:**
- Las promos de tipo 2 (banco) sí tienen flags de canal (`ecommerce`, `hyper`, `market`, `express`, `maxi`) en los 3 supers — con eso se puede filtrar correctamente qué promo de banco aplica en cada canal.
- **Intenté confirmar si el precio *base* del producto (antes de cualquier promo) también cambia entre comprar online y ir al local físico**, usando "Precios Claros" (el portal oficial argentino de transparencia de precios por sucursal) como fuente independiente. No lo pude verificar: la clave de API pública documentada por la comunidad está dada de baja, y el flujo de búsqueda por dirección del sitio oficial depende de Google Maps, que no cargó en el entorno donde probé. Sí confirmé que Carrefour devuelve el mismo precio en los 3 canales de venta (`sc`) válidos que probé en su propia API.
- **Por lo tanto, la implementación debe asumir** (no es un hecho 100% confirmado) que el precio de lista es el mismo en ambos canales, y que la única diferencia entre "comprar online" y "comprar en el local" es **qué promos de banco/tarjeta aplican**, no el precio base. Si en algún momento el usuario detecta una diferencia real de precio de lista entre canales (comparando el ticket físico contra la herramienta), hay que revisar este supuesto — no descartarlo silenciosamente.
- Con ese supuesto, el cálculo por ítem/super se duplica: para cada producto y cada super, calcular el total "si pagás online" y el total "si pagás en el local", tomando en cada caso las promos de banco que correspondan a ese canal, y mostrar la mejor combinación (podría ser: este producto en Vea local, ese otro en Carrefour online).

### 4.5 Acumulabilidad ambigua

**Decisión**: si el texto dice "no acumulable con otras promociones" (o similar, sin especificar con qué exactamente), asumir que no es acumulable con nada — postura conservadora. Si el texto no es claro, mostrárselo al usuario. El usuario mismo marcó la duda: si esto pasa producto por producto, puede ser demasiado ruido.

**Nota técnica que resuelve esa duda**: como las promos ambiguas de acumulabilidad son casi todas de **tipo 2 (por ticket)** — Cencopay, bancos — y el tipo 2 se calcula UNA VEZ por compra completa (sección 4.2), no por producto, el texto legal ambiguo también se mostraría una sola vez por promo de banco relevante en la sección nueva, no repetido por cada ítem de la lista. El único caso donde sí podría repetirse por producto es en las promos de tipo 1 con acumulabilidad ambigua (Cencopay por cluster, Tarjeta Carrefour) — pero ahí no encontramos ningún caso ambiguo en la investigación (no se encontró texto de acumulabilidad asociado a esos clusters específicos, más allá del legal genérico de Cencopay). Si aparece en la práctica, tratarlo caso por caso en vez de asumir que va a ser un patrón frecuente.

### 4.6 Aviso si la integración de GraphQL se rompe

**Decisión**: sí, quiere un aviso si esto pasa.

**Es posible.** Las queries GraphQL persistidas de VTEX devuelven un error reconocible cuando el `sha256Hash` ya no es válido (típicamente `PersistedQueryNotFound` o un código de error explícito en la respuesta, no un 200 con datos vacíos). El fetcher de Carrefour/Chango Más debe chequear explícitamente ese caso (no solo "response.ok") y, si lo detecta, imprimir un aviso claro tipo `⚠️ La consulta de promos bancarias de Carrefour dejó de funcionar (hash de GraphQL desactualizado) — hay que recapturarlo con el navegador`, en vez de fallar en silencio o mostrar "sin promos" (que se vería igual que "no hay promos hoy" y el usuario no se enteraría de la diferencia).

### 4.7 Alcance de tarjetas/billeteras

**Decisión**: solo traer las que el usuario mencionó explícitamente — Santander, MODO, Mercado Pago, Cuenta DNI, Banco Provincia, y las tarjetas propias de cada super (Cencopay, Mi Carrefour, MasClub). Sujeto a cambios a futuro.

**Nota técnica**: esto ya queda cubierto por el archivo de configuración de 4.1 — agregar o sacar una tarjeta es editar esa lista, no tocar código. "MODO" es una app de pagos (no un banco en sí), aparece como entidad propia en el catálogo de bancos de los 3 supers, así que se trata igual que cualquier otra entidad de la lista.

---

## 5. Plan de implementación sugerido (fases)

Actualizado según las decisiones de la sección 4. No es obligatorio seguir este orden exacto, pero minimiza riesgo de romper lo que ya funciona.

**Fase 0 — infraestructura de configuración**: crear `mis-tarjetas.json` (4.1) y la tabla de alias de nombres de banco por super (Vea/Carrefour/Chango Más nombran las mismas entidades distinto — ver 4.1). Sin esto, ninguna fase siguiente puede filtrar correctamente.

**Fase 1 — promos por ticket (tipo 2), un día fijo (hoy), un canal fijo**: la versión más simple que ya es útil. No toca `promo-engine.js` ni el flujo de comparación por ítem existente (4.2 confirma que es posible mantenerlos intactos). Alcance:
- Módulo nuevo (ej. `promos-bancarias.js`) con un fetcher por super: Vea vía Master Data (`dataentities/JN/documents/bankDiscount`), Carrefour y Chango Más vía GraphQL (con manejo explícito de "hash roto" — ver 4.6).
- Normalizar los 3 formatos a una estructura común: `{ banco, super, dias[], formatos[], descuentoPct, tope, montoMinimo, acumulable: boolean|null, vigenciaDesde, vigenciaHasta, textoLegal }`. Descartar en esta normalización cualquier entrada de financiación/cuotas (4.1) y cualquier banco que no esté en `mis-tarjetas.json`.
- Funciones puras y separadas para poder testear cada paso (4.2): resolver promos aplicables hoy → calcular descuento/tope sobre un total → imprimir. No mezclar las tres en una sola función.
- Sección nueva, separada, al final de `mostrarComparativo` y `mostrarResumenFinal`: "con tus tarjetas, hoy podrías ahorrar hasta $X pagando con [banco] en [super]".

**Fase 2 — multi-día (7 días, por super de forma independiente) y multi-canal (online/físico)**: extender la Fase 1 en dos ejes, ambos ya confirmados como posibles (4.3, 4.4):
- Para cada super por separado (no un único día global — ver 4.3), repetir el cálculo de "promos de ticket aplicables" para cada uno de los próximos 7 días (día de la semana + vigencia) sobre el subtotal que ya le corresponde a ese super según la asignación ítem→super existente (que no se recalcula por día). El día recomendado de cada super es el que da el total más bajo para ese super. No hay que buscar coincidencia de día entre supers.
- Duplicar el cálculo por canal (online vs. físico) usando los flags de formato/canal de cada promo de banco, bajo el supuesto documentado en 4.4 de que el precio base no cambia por canal (solo la promo).
- Estas dos cosas se pueden hacer en paralelo o en cualquier orden entre sí, pero ambas dependen de que la Fase 1 ya esté andando con un caso simple (hoy, un canal) para no depurar todo junto.

**Fase 3 — promos por producto (tipo 1)**: Cencopay (clusters de Vea) y Tarjeta Carrefour (Teasers con RestrictionsBins). A diferencia de las fases anteriores, esto sí toca `promo-engine.js` (nuevo campo `requiereTarjeta` en la estructura de promo) y `buscar-promos.js` (mostrar la promo condicionada junto a las demás, marcada de forma equivalente al 🌐 actual). Se deja para el final porque es la parte que el usuario pidió con menor prioridad implícita (mencionó "es esto posible" refiriéndose sobre todo a no tocar lo existente, que aplica más a las promos de ticket).

**Fase 4 (opcional, no pedida todavía)**: cruzar tipo 1 y tipo 2 cuando ambos existen para el mismo super/tarjeta (ej. Cencopay con 2x1 en un producto Y con cashback de ticket simultáneo). Requiere resolver acumulabilidad (4.5) caso por caso primero. No hay evidencia de que esto sea común hoy — no priorizar sin necesidad concreta. En esta misma fase entraría también, si alguna vez se pide, re-optimizar la asignación ítem→super considerando el día (evaluar cada ítem contra las 21 combinaciones super×día en vez de contra la asignación fija) — discutido y explícitamente descartado por ahora en 4.3 por ser un problema combinatorio mayor sin necesidad concreta hoy.

---

## 6. Apéndice — snippets de referencia

**Vea, bank discounts:**
```bash
curl "https://www.vea.com.ar/api/dataentities/JN/documents/bankDiscount?_fields=value,id&an=jumboargentina"
```

**Vea, cluster de producto (ya usado en el proyecto, mismo mecanismo):**
```bash
curl "https://www.vea.com.ar/api/catalog_system/pub/products/search?fq=productClusterIds:61742&sc=34" \
  -H "Cookie: vtex_segment=<VEA_SEGMENT de buscar-promos.js>"
```

**Carrefour, GraphQL (hashes vigentes al momento de esta investigación — pueden cambiar, ver 4.6):**
```
GET https://www.carrefour.com.ar/_v/public/graphql/v1
  ?operationName=GetPromotions
  &extensions={"persistedQuery":{"version":1,"sha256Hash":"e3aa1d96402d80dbca5c2c9dbcb7ff859970db0ccfdb64e583fb8a9b1bbff49e"},"variables":"<base64 de {"where":"active=true AND (active_from < <ISO>) AND (active_to > <ISO>)","account":"carrefourar"}>"}
```
`GetBanks` hash: `a17d0a4ae5248a8007075eb0c871b327be760c90f8ef994193758e4914e68c33`.
`GetCards` hash: `b0268b02cfc0021bcd0d0373f54e590bb71111cbcef4dcc62bf381a3a0abfa15`.

**Chango Más, GraphQL (mismo patrón, distinto account/hash):**
```
GET https://www.masonline.com.ar/_v/public/graphql/v1
  ?operationName=GetPromos
  &extensions={"persistedQuery":{"version":1,"sha256Hash":"1a071ebc5dc407a3f65e687b0f4c0a3b8d12a0c45d8d11370075c3b2a505251c"},"variables":"<base64 de {"where":"active=true AND (active_from < <ISO>) AND (active_to > <ISO>)","account":"masonlineprod"}>"}
```
`GetBanks` hash: `968d464317be357766de0e3beb313a55e0ebf7f45f2ef4a02c99fdf4ebca0876`.
`GetCards` hash: `b3aa47c5a259fd0c6ea4b9d29d553170da26dfcead2be3acafa026b9b9084b3a`.

Para reconstruir el parámetro `variables` completo (sender/provider exactos) de Carrefour o Chango Más si estos snippets no alcanzan, hay que volver a capturarlo navegando la página real (`/descuentos-bancarios` en Carrefour, `/promociones-bancarias` en Chango Más) e inspeccionando la pestaña Network — así fue como se encontraron originalmente.

**Carrefour, teaser de tarjeta propia en el catálogo (ya semi-soportado, solo hay que dejar de descartarlo):**
```json
{
  "<Name>k__BackingField": "Tarjeta Carrefour 15%",
  "<Conditions>k__BackingField": {
    "<Parameters>k__BackingField": [
      { "<Name>k__BackingField": "RestrictionsBins", "<Value>k__BackingField": "507858,858110,..." }
    ]
  },
  "<Effects>k__BackingField": {
    "<Parameters>k__BackingField": [
      { "<Name>k__BackingField": "PercentualDiscount", "<Value>k__BackingField": "15" }
    ]
  }
}
```
