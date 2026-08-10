# Cómo funciona AllPromos

Una explicación en lenguaje simple de lo que pasa desde que escribís "coca cola 2.25" hasta que ves el resumen de precios y promos.

---

## El problema que resuelve

Querés comprar productos del super. Vea, Carrefour y Chango Más tienen precios distintos, y encima cada uno tiene sus propias promociones que cambian cada semana: 25% de descuento, 2x1, 3x2, "2do al 80% off". Sin la app, tendrías que ir a los tres sitios, buscar cada producto, entender la promo, hacer las cuentas a mano, y recién entonces saber cuál conviene.

(El proyecto arrancó pensado para Luján, Buenos Aires, porque ahí es donde vive el usuario — pero los tres supers muestran el mismo precio en toda la Argentina, ver "Qué no puede hacer" más abajo. No hace falta estar en Luján para que esto te sirva.)

AllPromos hace todo eso automáticamente.

---

## El recorrido completo, paso a paso

### Ejemplo: pedís "coca cola 2.25" × 2 unidades

**1. Normalizás el texto**

El script limpia lo que escribiste: todo en minúsculas, sin tildes, separado en palabras: `["coca", "cola", "2.25"]`. Así funciona aunque escribas "Coca-Cola" o "coca cola" con mayúsculas.

**2. Busca en el catálogo local**

Tenemos tres archivos guardados en la computadora: `catalogo-vea.json`, `catalogo-carrefour.json` y `catalogo-changomas.json`. Son como diccionarios con todos los productos de cada super. Cada entrada tiene el nombre del producto, su **EAN** (el código de barras, por ejemplo `7790895000122`) y, en el caso de Vea, un ID interno llamado **skuId**.

El script revisa estos archivos y busca un producto cuyo nombre contenga **todas** las palabras que escribiste. Encuentra: "Coca Cola Regular 2.25 Lts" con EAN `7790895000122` y skuId `12345`.

Importante: **no usa los precios del catálogo local**. Los precios cambian todo el tiempo y los del catálogo pueden estar desactualizados. Solo usa el catálogo para saber el EAN y el skuId.

**Si la búsqueda no es clara, te pregunta antes de seguir** — no intenta adivinar por vos:
- Si escribiste algo con un error de tipeo (por ejemplo "arun" en vez de "atún") y no encuentra nada parecido, te avisa y te da la opción de escribir de nuevo, de buscar igual en vivo (menos preciso), o de saltear ese producto.
- Si tu búsqueda matchea varios productos distintos (por ejemplo "pepitos 357 gr" puede encontrar 3 variantes distintas entre los tres supers), te muestra la lista y te pregunta cuál es el que querés, en vez de compararte los tres.

**3. Consulta precios en vivo — en paralelo**

Con el EAN y el skuId en mano, hace tres consultas al mismo tiempo:

- **A Vea:** Le pregunta "dame el precio actual del producto con este skuId". La respuesta incluye el precio. Después hace una segunda consulta para preguntar "¿tiene alguna promoción activa?". Vea devuelve, por ejemplo: sin promo, precio $5.647.

- **A Carrefour:** Le pregunta "dame el producto con este EAN". La respuesta ya incluye el precio Y la promo en el mismo paquete. Por ejemplo: precio lista $5.650, precio actual $5.650, sin promo especial.

- **A Chango Más:** Le pregunta lo mismo que a Carrefour ("dame el producto con este EAN"), con el mismo tipo de respuesta (precio + promo en un solo paquete).

Los tres parecen devolver el mismo precio en toda la Argentina, no algo específico de una sucursal — lo confirmamos probando distintas regiones (ver "Qué no puede hacer" al final).

Las tres consultas hablan directo con los servidores de los supermercados, igual que cuando entrás al sitio web desde el browser.

**4. Interpreta la promoción**

El "motor de promos" (`promo-engine.js`) toma la información cruda de cada super y la entiende. Por ejemplo:

- Vea dice `"3x2 GALLETAS | Ofertas Trafico"` → entiende: llevás 3, pagás 2
- Carrefour dice precio = $3.300 con precio lista = $4.400 → entiende: 25% de descuento directo
- Vea dice `"2do al 80% | Ofertas Trafico"` → entiende: la 2da unidad cuesta solo el 20% del precio (80% de descuento sobre esa unidad)
- Chango Más funciona igual que Carrefour para el descuento directo (precio vs. precio de lista). Hasta ahora no vimos ningún producto de Chango Más con promo tipo "3x2" o "2do al X%" — puede que simplemente no tenga ese tipo de promo activa hoy.

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

**¿Y si dos supers necesitan cantidades distintas?** Por ejemplo, Carrefour tiene "2x1" (necesitás 2) pero Vea tiene "3x2" (necesitás 3) para el mismo producto. En vez de preguntarte dos veces, te muestra de una sola vez cómo quedaría el precio en los tres supers para cada cantidad posible:

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

Para cada super, muestra el producto encontrado, el precio unitario, la promo activa, el detalle del cálculo y el total. Al final compara los tres, ordenados del más barato al más caro:

```
📊 MEJOR PRECIO:

  🥇 Carrefour: $8.550,00
  🥈 Vea: $11.294,00
  🥉 Chango Más: $11.298,00

  Comprando en Carrefour ahorrás $2.744,00 vs Vea y $2.748,00 vs Chango Más
```

---

## El modo lista: varios productos a la vez

Si le pasás un archivo de texto con tu lista de compras, el script procesa cada ítem, busca en los tres supermercados, y al final muestra un **resumen consolidado**. Las preguntas (nombre ambiguo, promo casi activable) también aparecen acá, ítem por ítem — si tu lista tiene 20 productos, puede que te pregunte varias veces antes de llegar al resumen final. No es "corré y mirá el resultado" como antes; ahora puede pausarse para pedirte una decisión.

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

De un vistazo sabés cuánto ahorrás mezclando supermercados versus ir solo a uno, y qué comprar en cada lugar. Si un producto no aparece en alguno de los tres, simplemente no se lo compara ahí — no te penaliza a favor ni en contra de ese super.

---

## Qué significa el 🌐

Cuando una promo tiene el símbolo 🌐, significa que ese descuento **solo existe si comprás online**. No lo vas a encontrar en la góndola física.

¿Cómo lo detecta? Vea nombra sus promos online con frases como "Ofertas Trafico" o "Ecommerce". El script lo reconoce y te avisa.

Esto te permite decidir: para los productos con descuento presencial comprás en el super físico, y para los marcados con 🌐 hacés el pedido online.

En la práctica, todas las promos de Vea que detectamos son online (porque venimos de su API web). Las promos de Carrefour y Chango Más sin 🌐 son descuentos directos (precio vs. precio de lista), que en Carrefour sabemos que aplican tanto en el local como en la web — para Chango Más no confirmamos si es lo mismo.

---

## Los catálogos locales: para qué sirven y cuándo actualizarlos

Los archivos `catalogo-vea.json`, `catalogo-carrefour.json` y `catalogo-changomas.json` son una foto de todos los productos que tiene cada super en un momento dado. Sirven como directorio: cuando buscás "coca cola 2.25", el script no necesita preguntarle al servidor del super "¿tenés coca cola?"... ya sabe de antemano que existe y cuál es su EAN.

**Esto tiene dos ventajas:**
- La búsqueda es mucho más rápida
- La comparación entre supermercados es exacta porque usa el mismo EAN en todos

**Ojo con Chango Más:** su catálogo real tiene cerca de 60.000 productos, pero por una limitación técnica de la API solo pudimos guardar los primeros ~2.600 (los más relevantes según el propio buscador del super). Esto significa que productos poco comunes pueden no estar en el catálogo local de Chango Más aunque sí existan en el super. La misma limitación técnica ya afectaba a Vea y Carrefour desde el principio (sus catálogos también son un recorte, no el 100%), simplemente no se había hecho tan visible como con Chango Más por ser catálogos más chicos en la fuente original.

**Cuándo actualizar:** Las promos cambian semanalmente pero los productos (EAN, nombres) cambian mucho menos seguido. Actualizalos si encontrás que un producto nuevo no aparece, o antes de una compra grande donde querés estar seguro de tener el catálogo fresco. El script avisa si el catálogo tiene más de 30 días.

```bash
node scraper-promos-vea.js           # demora ~5 minutos
node scraper-promos-carrefour.js     # demora ~10 minutos
node scraper-promos-changomas.js     # demora ~2 minutos
```

---

## Qué no puede hacer (limitaciones)

- **Los 3 supers parecen tener precio único a nivel país, no por sucursal.** Se creía que Vea era la excepción "hiperlocal" (Luján), pero se confirmó en vivo el 2026-08-10 que no lo es: probando el mismo producto con la sesión armada para Luján, para Córdoba (700 km de distancia) y para La Plata, el precio fue idéntico en los 5 casos probados. Sigue sin confirmarse que ese precio online coincida con el de góndola de una sucursal física puntual — lo que se descartó es que varíe entre sucursales dentro del canal online.
- **Solo productos con código de barras.** Queso al corte, fiambre, carne, frutas y verduras no tienen EAN estándar y no se pueden comparar.
- **No incluye descuentos bancarios.** Las promos con "Tarjeta Carrefour", "Cuenta DNI", "Banco Nación", etc. están excluidas porque dependen de si tenés esa tarjeta.
- **Los catálogos pueden desfasarse y son un recorte parcial**, no el 100% del catálogo real de cada super (ver arriba). Si un producto fue discontinuado, renombrado, o simplemente no entró en ese recorte, puede que no aparezca bien.
- **Las promos tipo "3x2" o "2do al X%" de Chango Más no están confirmadas** — el sistema sabe interpretarlas si aparecen, pero todavía no vimos ningún ejemplo real.

---

## Resumen en una frase

Escribís el nombre del producto, el script lo identifica por su EAN en el catálogo local, consulta los precios y promos en vivo en los tres supermercados, calcula el costo real para la cantidad que querés, y te dice exactamente dónde comprarlo y cuánto ahorrás.
