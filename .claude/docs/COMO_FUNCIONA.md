# Cómo funciona AllPromos

Una explicación en lenguaje simple de lo que pasa desde que escribís "coca cola 2.25" hasta que ves el resumen de precios y promos. AllPromos es el motor: la misma lógica de acá corre tanto en la CLI (`buscar-promos.js`) como detrás de la app (Super App, `app/` + `backend/`) — lo que cambia es cómo se te muestra, no cómo se calcula.

---

## El problema que resuelve

Querés comprar productos del super. Vea, Carrefour, Chango Más, Día, Coto, Jumbo y Disco tienen precios distintos, y encima cada uno tiene sus propias promociones que cambian cada semana: 25% de descuento, 2x1, 3x2, "2do al 80% off". Sin la app, tendrías que ir a los siete sitios, buscar cada producto, entender la promo, hacer las cuentas a mano, y recién entonces saber cuál conviene.

(El proyecto arrancó pensado para Luján, Buenos Aires, porque ahí es donde vive el usuario — pero 6 de los 7 supers muestran el mismo precio en toda la Argentina, ver "Qué no puede hacer" más abajo.)

AllPromos hace todo eso automáticamente.

---

## El recorrido completo, paso a paso

### Ejemplo: pedís "coca cola 2.25" × 2 unidades

**1. Normalizás el texto**

El script limpia lo que escribiste: todo en minúsculas, sin tildes, separado en palabras: `["coca", "cola", "2.25"]`. Así funciona aunque escribas "Coca-Cola" o "coca cola" con mayúsculas.

**2. Busca en el catálogo local**

Tenemos siete archivos guardados en la computadora: `catalogo-vea.json`, `catalogo-carrefour.json`, `catalogo-changomas.json`, `catalogo-dia.json`, `catalogo-coto.json`, `catalogo-jumbo.json` y `catalogo-disco.json`. Son como diccionarios con todos los productos de cada super. Cada entrada tiene el nombre del producto, su **EAN** (el código de barras, por ejemplo `7790895000122`) y, en el caso de Vea, un ID interno llamado **skuId**.

El script revisa estos archivos y busca un producto cuyo nombre contenga **todas** las palabras que escribiste. Encuentra: "Coca Cola Regular 2.25 Lts" con EAN `7790895000122` y skuId `12345`.

Importante: **no usa los precios del catálogo local**. Los precios cambian todo el tiempo y los del catálogo pueden estar desactualizados. Solo usa el catálogo para saber el EAN y el skuId.

**Si la búsqueda no es clara, te pregunta antes de seguir** — no intenta adivinar por vos:
- Si escribiste algo con un error de tipeo (por ejemplo "arun" en vez de "atún") y no encuentra nada parecido, te avisa y te da la opción de escribir de nuevo, de buscar igual en vivo (menos preciso), o de saltear ese producto.
- Si tu búsqueda matchea varios productos distintos (por ejemplo "pepitos 357 gr" puede encontrar variantes distintas entre los supers), te muestra la lista y te pregunta cuál es el que querés, en vez de compararte todas.

(En la app esto no hace falta preguntarlo: elegís el producto de una lista, así que la ambigüedad no llega a existir.)

**3. Consulta precios en vivo — en paralelo**

Con el EAN y el skuId en mano, hace varias consultas al mismo tiempo:

- **A Vea:** Le pregunta "dame el precio actual del producto con este skuId". La respuesta incluye el precio. Después hace una segunda consulta para preguntar "¿tiene alguna promoción activa?". Vea devuelve, por ejemplo: sin promo, precio $5.647.

- **A Carrefour:** Le pregunta "dame el producto con este EAN". La respuesta ya incluye el precio Y la promo en el mismo paquete. Por ejemplo: precio lista $5.650, precio actual $5.650, sin promo especial.

- **A Chango Más y a Día:** Le pregunta lo mismo que a Carrefour ("dame el producto con este EAN"), con el mismo tipo de respuesta (precio + promo en un solo paquete) — los tres corren sobre la misma plataforma (VTEX).

- **A Jumbo y Disco:** Son la MISMA cuenta VTEX que Vea ("Jumbo Argentina IO") — mismo catálogo, mismo skuId/EAN por producto, solo cambia el storefront (dominio). El mecanismo de promo por producto también es el de Vea (`_v/search-promotions`), no el de Teasers que usan Carrefour/Chango Más/Día. Puede haber diferencia de precio *base* entre los tres banners para el mismo producto (ej. $5.800 en Jumbo/Disco vs $5.790 en Vea el mismo día), así que sí vale la pena consultarlos por separado.

- **A Coto:** No tiene una búsqueda exacta por EAN, así que se busca por texto y se queda con el resultado que coincide exactamente. A diferencia de los otros, Coto expone un precio por sucursal — se usa el precio más repetido entre sucursales (ver "Qué no puede hacer" más abajo).

Seis de los siete (Vea, Carrefour, Chango Más, Día, Jumbo y Disco) devuelven el mismo precio en toda la Argentina, no algo específico de una sucursal — lo confirmamos probando distintas regiones (ver "Qué no puede hacer" al final). Coto es la excepción real: su precio sí varía por sucursal.

Las consultas hablan directo con los servidores de los supermercados, igual que cuando entrás al sitio web desde el browser.

**4. Interpreta la promoción**

El "motor de promos" (`promo-engine.js`) toma la información cruda de cada super y la entiende. Por ejemplo:

- Vea dice `"3x2 GALLETAS | Ofertas Trafico"` → entiende: llevás 3, pagás 2
- Carrefour dice precio = $3.300 con precio lista = $4.400 → entiende: 25% de descuento directo
- Vea dice `"2do al 80% | Ofertas Trafico"` → entiende: la 2da unidad cuesta solo el 20% del precio (80% de descuento sobre esa unidad)
- Chango Más y Día funcionan igual que Carrefour para el descuento directo (precio vs. precio de lista) y para promos tipo 2x1/3x2/"2do al X%". Chango Más, hasta ahora, no mostró ningún ejemplo real de estas últimas — puede que simplemente no tenga ese tipo de promo activa hoy.
- Coto dice `"20% DE DESCUENTO"` → entiende: 20% de descuento directo, con su propio formato de texto.

**5. Calcula el costo real para TU cantidad**

Acá está una de las cosas más útiles: el cálculo tiene en cuenta exactamente cuántas unidades querés comprar.

Ejemplo con 2 unidades y promo 3x2:
- La promo requiere 3 unidades para activarse
- Comprando 2 unidades no podés aprovecharla
- El sistema te avisa: "necesitás 3 para activar la promo"
- Calcula igual el total sin promo: 2 × $5.819 = $11.638

Ejemplo con 4 unidades y promo 3x2:
- 1 grupo completo de 3 (pagás 2) + 1 unidad al precio lleno
- Total: 2 × $5.819 + 1 × $5.819 = $17.457 (en vez de $23.276)
- Te muestra el ahorro

**Además, si hay una promo que no llega a activarse con la cantidad que pediste, te pregunta si querés cambiarla.** Por ejemplo, pedís 1 Coca Cola y Carrefour tiene "2do al 50%" (necesita 2 unidades): te avisa "con 1 unidad no aprovechás esto — ¿cambiar la cantidad a 2?". Si decís que sí, recalcula todo de nuevo con la cantidad nueva, sin volver a consultar los supermercados (ya tiene el precio unitario y la promo, solo cambia la cuenta).

**¿Y si dos supers necesitan cantidades distintas?** Por ejemplo, Carrefour tiene "2x1" (necesitás 2) pero Vea tiene "3x2" (necesitás 3) para el mismo producto. En vez de preguntarte dos veces, te muestra de una sola vez cómo quedaría el precio en todos los supers para cada cantidad posible:

```
💡 Con 1 unidad no aprovechás algunas promos. Vista previa:

   Comprando 2:
     Vea: $2.000 (sin promoción)
     Carrefour: $1.000 (2x1)

   Comprando 3:
     Vea: $2.000 (3x2)
     Carrefour: $2.000 (2x1)

¿Cambiar la cantidad a alguna de estas (2 / 3) o mantener 1?
```

Así ves las dos alternativas completas antes de decidir, en vez de tener que probar una, ver que la otra promo no se activó, y volver a correr todo de nuevo.

**6. Muestra el resultado**

Para cada super, muestra el producto encontrado, el precio unitario, la promo activa, el detalle del cálculo y el total. Al final compara todos los que tienen el producto, ordenados del más barato al más caro:

```
📊 MEJOR PRECIO:

  🥇 Carrefour: $8.550,00
  🥈 Vea: $11.294,00
  🥉 Chango Más: $11.298,00

  Comprando en Carrefour ahorrás $2.744,00 vs Vea y $2.748,00 vs Chango Más
```

(El ejemplo muestra 3 supers porque no todos los productos están en todos los catálogos — se compara contra los que sí lo tienen, nunca se penaliza a un super por no vender algo.)

---

## El modo lista: varios productos a la vez

Si le pasás un archivo de texto con tu lista de compras, el script procesa cada ítem, busca en los supermercados activos, y al final muestra un **resumen consolidado**. Las preguntas (nombre ambiguo, promo casi activable) también aparecen acá, ítem por ítem — si tu lista tiene 20 productos, puede que te pregunte varias veces antes de llegar al resumen final. No es "corré y mirá el resultado" como antes; ahora puede pausarse para pedirte una decisión. (En la app esto se resuelve distinto: la ambigüedad de nombre no existe porque elegís de una lista, y la sugerencia de cantidad aparece como un aviso que podés tocar, no como una pregunta que bloquea.)

```
🛒 RESUMEN FINAL DE COMPRA

  🟢 coca cola 2.25 ×2
       Vea:        $11.294,00  (sin promoción)
       Carrefour:  $11.300,00  (sin promoción)
       Chango Más: $11.298,00  (sin promoción)
       → mejor en Vea: $11.294,00

  🔵 fideos matarazzo ×4
       Vea:        $7.636,00  (sin promoción)
       Carrefour:  $5.439,99  (25% de descuento)
       → mejor en Carrefour: $5.439,99

  ...

────────────────────────────────────────────────────────
  🏆 Compra óptima (mezclando): $132.686,49
  🟢 Todo en Vea:        $139.550,79   (+$6.864,30 vs óptimo)
  🔵 Todo en Carrefour:  $154.037,86   (+$21.351,37 vs óptimo)
  🟣 Todo en Chango Más: $151.200,44   (+$18.514,00 vs óptimo)

  Plan de compra:
    🟢 Vea:        coca cola 2.25 | aquarius 2.25 | heineken 473 | ...
    🔵 Carrefour:  fideos matarazzo | oreo galletitas 3 | sensodyne | ...
    🟣 Chango Más: ...
```

De un vistazo sabés cuánto ahorrás mezclando supermercados versus ir solo a uno, y qué comprar en cada lugar. Si un producto no aparece en alguno de los supers, simplemente no se lo compara ahí — no te penaliza a favor ni en contra de ese super.

---

## Qué significa el 🌐

Cuando una promo tiene el símbolo 🌐, significa que ese descuento **solo existe si comprás online**. No lo vas a encontrar en la góndola física.

¿Cómo lo detecta? Vea nombra sus promos online con frases como "Ofertas Trafico" o "Ecommerce". El script lo reconoce y te avisa. La misma detección aplica igual en Carrefour, Chango Más, Día y Coto si su promo viene nombrada de esa forma.

Esto te permite decidir: para los productos con descuento presencial comprás en el super físico, y para los marcados con 🌐 hacés el pedido online.

En la práctica, todas las promos de Vea que detectamos son online (porque venimos de su API web). Las promos de Carrefour, Chango Más y Día sin 🌐 son descuentos directos (precio vs. precio de lista), que en Carrefour sabemos que aplican tanto en el local como en la web — para Chango Más y Día no confirmamos si es lo mismo. Coto sí varía por sucursal física, así que su comparación online/presencial funciona distinto (ver "Qué no puede hacer" abajo).

---

## Promos bancarias: aparte del precio del producto

Además del precio y la promo de cada producto, la herramienta calcula por separado los **descuentos por pagar con una tarjeta o billetera** (Mi Carrefour, MasClub, Santander, Mercado Pago, Cuenta DNI, Banco Provincia, MODO, Galicia, Galicia Modo, Banco Macro, HSBC, BBVA, ICBC, Comafi, Naranja X, Credicoop, Banco Ciudad, Supervielle, Banco Columbia, Banco Patagonia, Banco Nación, TCI, entre otros). A diferencia de las promos de arriba, estas no dependen de qué productos comprás: son un % sobre **todo el ticket**, atado a un día de la semana y a veces con un tope de reintegro.

Vos le decís a la herramienta qué tarjetas tenés (en la CLI, editando `mis-tarjetas.json`; en la app, marcándolas en el carrito o en "Mis descuentos"), y solo te muestra las promos de esas tarjetas — no te avisa de una promo de un banco que no tenés. Con esa info, la herramienta te puede decir además **qué día conviene ir a cada super** en los próximos 7 días, combinando la promo del producto con la mejor promo bancaria de ese día.

Esto es un cálculo aparte del precio del producto (`promos-bancarias.js`, no `promo-engine.js`) — nunca cambia cuál es "el precio" de un producto, solo agrega cuánto más ahorrás encima si pagás con la tarjeta correcta el día correcto.

---

## Los catálogos locales: para qué sirven y cuándo actualizarlos

Los archivos `catalogo-vea.json`, `catalogo-carrefour.json`, `catalogo-changomas.json`, `catalogo-dia.json`, `catalogo-jumbo.json`, `catalogo-disco.json` y `catalogo-coto.json` son una foto de todos los productos que tiene cada super en un momento dado. Sirven como directorio: cuando buscás "coca cola 2.25", el script no necesita preguntarle al servidor del super "¿tenés coca cola?"... ya sabe de antemano que existe y cuál es su EAN.

**Esto tiene dos ventajas:**
- La búsqueda es mucho más rápida
- La comparación entre supermercados es exacta porque usa el mismo EAN en todos

**Ojo con Vea, Carrefour, Chango Más, Día, Jumbo y Disco:** sus catálogos reales tienen decenas/cientos de miles de productos (Chango Más ~60.000, Vea ~378.000, Carrefour ~104.000, Jumbo ~325.000, Disco ~379.000), pero por una limitación técnica de la API solo pudimos guardar los primeros ~2.550 de cada uno (los más relevantes según el propio buscador del super). Esto significa que productos poco comunes pueden no estar en el catálogo local aunque sí existan en el super. **Coto funciona distinto desde el 2026-08-25:** en vez de recortar por categoría, se busca en Coto, uno por uno, cada EAN que ya se conoce de los otros 6 supers — hoy son ~3.298 SKUs reales encontrados así, todos con algo con qué compararlos por construcción (no es un catálogo completo de Coto, es la intersección útil para comparar).

**Cuándo actualizar:** Las promos cambian semanalmente pero los productos (EAN, nombres) cambian mucho menos seguido. Actualizalos si encontrás que un producto nuevo no aparece, o antes de una compra grande donde querés estar seguro de tener el catálogo fresco. El script avisa si el catálogo tiene más de 30 días. En producción, esto lo hace solo un cron cada 1-2 horas (ver `CONTEXTO_TECNICO.md`); a mano solo hace falta para debug local:

```bash
node scraper-promos-vea.js           # demora ~5 minutos
node scraper-promos-carrefour.js     # demora ~10 minutos
node scraper-promos-changomas.js     # demora ~2 minutos
node scraper-promos-dia.js           # demora ~2 minutos
node scraper-promos-jumbo.js         # misma cuenta VTEX que Vea
node scraper-promos-disco.js         # misma cuenta VTEX que Vea
node scraper-coto-por-ean.js         # ~9 minutos, busca por EAN los productos ya conocidos de los otros 6 supers — correr último
```

---

## Qué no puede hacer (limitaciones)

- **6 de los 7 supers VTEX (Vea, Carrefour, Chango Más, Día, Jumbo, Disco) parecen tener precio único a nivel país, no por sucursal.** Se creía que Vea era la excepción "hiperlocal" (Luján), pero se confirmó en vivo el 2026-08-10 que no lo es: probando el mismo producto con la sesión armada para Luján, para Córdoba (700 km de distancia) y para La Plata, el precio fue idéntico en todos los casos probados. Sigue sin confirmarse que ese precio online coincida con el de góndola de una sucursal física puntual — lo que se descartó es que varíe entre sucursales dentro del canal online.
- **Coto es la excepción: su precio SÍ varía por sucursal.** En una muestra de 50 productos comunes, el 98% tuvo un precio distinto según la sucursal — con dos sucursales de Capital Federal (Flores y Once) casi siempre más baratas que el resto. La herramienta usa el precio más repetido entre sucursales como aproximación, no el de tu sucursal específica.
- **Solo productos con código de barras.** Queso al corte, fiambre, carne, frutas y verduras no tienen EAN estándar y no se pueden comparar.
- **Las promos bancarias por producto están casi todas excluidas** — solo Mi Carrefour (Carrefour) está implementada hoy. Cencopay (Vea) fue investigada a fondo y **descartada** (2026-08-19): es una fuente que Vea ya no usa (0 ofertas vigentes hace 9 meses), no algo pendiente de implementar (ver `CONTEXTO_TECNICO.md`). Las promos bancarias "por ticket" sí están cubiertas (ver sección de arriba).
- **Los catálogos pueden desfasarse y son un recorte parcial** en los 6 supers VTEX (ver arriba); Coto depende de que el EAN ya se conozca de alguno de los otros 6. Si un producto fue discontinuado, renombrado, o simplemente no entró en ese recorte, puede que no aparezca bien.
- **Las promos tipo "3x2" o "2do al X%" de Chango Más no están confirmadas** — el sistema sabe interpretarlas si aparecen, pero todavía no vimos ningún ejemplo real.
- **El formato "2x$2500" (precio fijo, no %) de Día** todavía no lo calcula la herramienta — lo guarda pero no lo interpreta.

---

## Lo que hace la app además del motor de comparación

Este documento describe el motor core (`AllPromos/`), que es igual en la CLI y en la app. La app (`app/`) suma encima, ya en producción:

- **Cuenta y login** con Supabase Auth (registro, mail de confirmación, sesión persistente).
- **Planes pagos con MercadoPago** (mensual, anual, permanente) — sin plan activo (ni trial vigente) no se puede usar la app.
- **Historial de ahorro** guardado en Supabase, visible en la pestaña "Ahorros".
- **Tope de cantidad de supers a comparar**, configurable por el usuario.

El detalle de cada una está en `Plan_Usuarios_y_cobros.md`, `opciones_planes.md` y `CONTEXTO_TECNICO.md`, no acá.

---

## Resumen en una frase

Escribís el nombre del producto, el script lo identifica por su EAN en el catálogo local, consulta los precios y promos en vivo en los supermercados activos, calcula el costo real para la cantidad que querés (sumando también las promos bancarias si le contaste qué tarjetas tenés), y te dice exactamente dónde comprarlo y cuánto ahorrás.
