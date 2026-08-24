# Ediciones pedidas — contraste de texto y selector de supers

Dos cambios sobre lo ya implementado. No hay pantallas nuevas ni navegación nueva.
Referencia visual: `AllPromos v2.dc.html`, turnos 6 y 7 (arriba de todo). Los ids `6a`, `6c`, `6d`, `7a` son links dentro de ese archivo.

---

## 1. Contraste de texto: retirar el gris claro

**Problema.** El gris `#8A929B` sobre blanco da 3.2:1 de contraste. WCAG AA pide 4.5:1 para texto chico. Está usado en tres roles distintos (prosa explicativa, títulos de sección, filas apagadas) y falla en los tres.

**Solución: cuatro tokens con un rol cada uno.**

| Token | Valor | Contraste sobre blanco | Para qué |
| --- | --- | --- | --- |
| `ink1` | `#14161A` | 17.8:1 | Texto principal, títulos, nombres de producto, precios |
| `ink2` | `#3C444D` | 9.8:1 | **Prosa explicativa**: párrafos que enseñan o aclaran |
| `ink3` | `#565E67` | 5.9:1 | Metadatos, títulos de sección en mayúsculas, notas al pie, fechas |
| `ink4` | `#767E88` | 3.6:1 | **Solo** íconos y elementos gráficos apagados. **Nunca texto.** |

`#8A929B` y `#A6AEB8` salen del theme para texto sobre blanco. Si aparecen en el código sobre fondo oscuro (`#14161A`) están bien y no se tocan: ahí el contraste es 7:1 o más.

### 1.1 Títulos de sección en mayúsculas

Todos los labels tipo `PLAN DE COMPRA`, `SI COMPRÁS TODO EN UNO`, `EN ESTA COMPRA`, `CARRITOS GUARDADOS`, `NOMBRE`, `RESULTADOS EN N SUPERS`, `PROMOS SIN APLICAR`, `EMPIEZA EN LOS PRÓXIMOS 7 DÍAS`, `CADA SUPER TIENE SU COLOR`, `PASO N DE 3`:

```
antes:  fontSize 11, fontWeight 500, color #8A929B, letterSpacing 1.2
ahora:  fontSize 11, fontWeight 600, color #565E67, letterSpacing 1.2
```

Cambian dos cosas: el color a `ink3` y el peso de 500 a 600. El tamaño no cambia. Ver `6d`.

### 1.2 Prosa explicativa: además del color, cambia la fuente

Los textos que explican cómo funciona algo hoy están en IBM Plex Mono 12px. El mono es para datos (precios, topes, "×2", fechas), no para instrucciones: a 12px y en gris claro es el peor caso del archivo.

```
antes:  IBM Plex Mono 400, 12/16, color #8A929B
ahora:  Archivo 400, 14/20, color #3C444D
```

Aplica a, por lo menos:

- Onboarding / leyenda de colores: *"El color siempre dice de qué super es un precio. El amarillo, en cambio, siempre dice ahorro."* (ver `6a`)
- El texto de los 3 pasos de "Cómo funciona"
- Cualquier párrafo que explique una mecánica de la app

**No aplica** a los textos de datos, que se quedan en mono y solo cambian de color a `#565E67`:

- `25% los martes · tope $15.000`
- `5 productos · 11 unidades`
- `abre el sitio del super · iniciá sesión y el carrito se carga solo`
- La fecha del pie de Resultado (`14/8/2026, 09:19`)

### 1.3 Filas apagadas en Mis descuentos (ver `6c`)

Hoy una tarjeta desactivada se comunica bajando el texto a gris claro. Eso hace ilegible el nombre y duplica lo que ya dice el switch.

- El nombre de la tarjeta queda en `#14161A` **siempre**, activa o no.
- El subtítulo queda en `#565E67` siempre.
- El estado lo dicen el switch y un tag `SIN USAR` al lado del nombre.
- Switch apagado: fondo blanco, anillo interior de 1.5px `#14161A`, perilla `#14161A`. Encendido: fondo `#14161A`, perilla blanca. **Sin gris en ningún estado.**
- Tag `SIN USAR`: Archivo 600 10/14, `letterSpacing .6`, color `#14161A`, borde 1px `#14161A`, radio 4, padding horizontal 6.

---

## 2. Selector de supers: que se lea como control (ver `7a`)

**Problema.** La barra del header de Buscar son cinco barritas de color con el nombre debajo. Eso es la forma de una leyenda, no de cinco botones, y los usuarios no descubren que se puede tocar para sacar un super de la comparación.

**Solución (opción mínima, mantiene el layout actual).** Cada super pasa de barrita suelta a celda tocable, y una línea arriba dice qué hace el toque.

### 2.1 Línea de encabezado, nueva

Va inmediatamente arriba de la barra, dentro del header oscuro. Tres partes en una fila, `alignItems: center`, `gap: 10`:

1. `COMPARANDO {n} DE 5 SUPERS` — Archivo 600 11/14, `letterSpacing 1.2`, `#FFFFFF`. El número es la cuenta de supers activos y es dinámico.
2. Una línea divisoria de 1px que ocupa el espacio libre (`flex: 1`), color `rgba(255,255,255,.18)`.
3. `tocá para sacar uno` — Archivo 400 12/16, `#C6CCD3`.

### 2.2 Celdas

Cada super es un `Pressable` con `flex: 1`, `gap: 6` entre celdas, `borderRadius: 8`, `padding: 8 4 7`, contenido en columna centrada con `gap: 7`.

**Activo:** fondo `rgba(255,255,255,.1)`; barra de color de 6px de alto, `borderRadius 999`, ancho 100%, en el color del super; nombre Archivo 600 11/14 `#FFFFFF`.

**Apagado:** sin fondo, borde 1px **dashed** `rgba(255,255,255,.35)`; la barra pierde el relleno y queda como contorno de 1px `rgba(255,255,255,.4)`; nombre Archivo 500 11/14, color `#C6CCD3`, con `textDecorationLine: 'line-through'`.

Los colores de los supers sobre fondo oscuro son las variantes claras, no las de fondo blanco: Vea `#2EA35C`, Carrefour `#4C8DF6`, Chango Más `#A66FE0`, Día `#FFFFFF`, Coto `#F0576A`. Sobre blanco siguen siendo los de `theme.supers`.

### 2.3 Comportamiento

- Tocar un super activo lo saca de la comparación; tocarlo de nuevo lo devuelve. Ya existe el estado, solo cambia la presentación.
- Área de toque de 44px mínimo. La celda visible es más baja, así que extendé el área con `hitSlop` vertical.
- Un super apagado no aparece en resultados, ni en el plan de compra, ni en las barras de comparación.
- No se puede apagar el último super activo: si queda uno solo, ese toque no hace nada.
- El nombre tachado necesita `accessibilityState={{ selected: false }}` y un `accessibilityLabel` que diga el estado en palabras ("Coto, sin comparar"), porque el tachado no lo comunica a un lector de pantalla.

---

## 3. Logos de los supermercados

Los logos van **antes del nombre** en toda la app: el logo identifica y el nombre confirma. Si va después, se lee la palabra primero y el logo queda decorativo.

Orden en las filas de leyenda: **barra de color → logo → nombre**. Ese es también el orden en que la app quiere que se aprenda el código de color.

Dónde:

- **Leyenda de colores** (estado inicial de Buscar, y paso 3 del tutorial): logo de 28×28 (24×24 en el tutorial), radio 6, `resizeMode: contain`, entre la barra de color y el nombre, `gap: 12`.
- **Cabecera de cada plan de compra** (Resultado): logo de 28×28 sobre placa blanca de radio 6, a la izquierda del wordmark, `gap: 10`. La cabecera pasa de `alignItems: baseline` a `center`.
- **Selector de supers (7a)**: la celda mide unos 66px, no entra nada en horizontal. El logo va **sobre una placa blanca** de 22px de alto y ancho completo, entre la barra de color y el nombre. En la celda apagada la placa baja a 45% de opacidad y el fondo pasa a `rgba(255,255,255,.22)`, así el tachado no sostiene el estado solo.

Los assets los provee el equipo: son marcas de terceros, se usan tal cual las entrega cada cadena, sin recolorear ni recortar. Revisar con legales el uso de cada logo, igual que con los botones de exportar.

---

## Fuera de alcance

El selector 7a reemplaza la barra de colores en **todas** las pantallas donde aparece, incluida la de resultados.

No toques nada más de layout, espaciados, tamaños ni copy. Estas dos ediciones son de color, peso, fuente de un tipo de texto, y presentación del selector.

Sigue pendiente de diseño, como antes: Ajustes (tema claro/oscuro), confirmación antes de vaciar el carrito, y topes de gasto mensual.
