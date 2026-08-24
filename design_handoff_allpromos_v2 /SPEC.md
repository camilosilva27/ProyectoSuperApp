# SPEC — AllPromos v2

Especificación de implementación. Referencia visual: `AllPromos v2.dc.html`.

---

## 1. Tokens

Casi todo ya existe en `app/src/theme.ts`. Lo que sigue documenta el uso, no propone reemplazarlo.

### Color

| Rol | Valor | Uso |
| --- | --- | --- |
| Fondo app | `#FFFFFF` | El rediseño va a fondo blanco, no gris. El gris `#EEF0F2` deja de ser el fondo de pantalla. |
| Tinta | `#14161A` | Texto principal, header negro, botones primarios |
| Tinta secundaria | `#565E67` | Descripciones, precios no ganadores |
| Tinta terciaria | `#8A929B` | Labels en mayúscula, datos mono, inactivos |
| Borde | `#DFE3E7` | Separadores y bordes de tarjeta |
| Borde fuerte | `#C6CCD3` | Borde de Día, bordes de botón secundario |
| Superficie | `#F6F7F9` | Filas de producto en Carrito, bloques informativos |
| Superficie 2 | `#E4E7EA` | Barra "no disponible", pistas de progreso |
| **Ahorro** | `#FFD400` | **Solo ahorro.** Ver regla abajo. |
| Ahorro suave | `#FFF6C9` | Pie de un bloque de promo |
| Aviso | `#FDF3E0` / `#9A5B08` | "Requiere comprar online" |
| Header oscuro alt | `#20242B` | Aviso de promos sin aplicar dentro del header negro |
| Borde sobre oscuro | `#3C444D` | Bordes dentro del header negro |

**Supermercados** (`theme.supers`): Vea `#12874A`, Carrefour `#1B5FD9`, Chango Más `#7A3FB8`, Día `#FFFFFF` con borde `#C6CCD3`, Coto `#D6293E`.

**Regla del amarillo.** `#FFD400` es ahorro y nada más. No es un super, no es "seleccionado", no es "atención", no es acento de marca. Si un elemento amarillo no representa plata que el usuario se ahorra, está mal. Corolario: el bloque de una promo que todavía no arrancó va en gris (`#F6F7F9`), no en amarillo — ver § 4.6.

**Regla del color de super.** El color siempre identifica al supermercado. Nunca se usa un color de super para otra cosa. Día es blanco y necesita `box-shadow: inset 0 0 0 1px #C6CCD3` (o borde equivalente) para distinguirse del "no disponible" gris.

### Tipografía

Tres familias, ya en uso:

- **Archivo** — UI: títulos, labels, botones, cuerpo. Pesos 400/500/600/700.
- **Barlow Condensed** — solo números grandes: totales, precios, cantidades. 600/700.
- **IBM Plex Mono** — datos crudos: EANs, fechas, letra chica de una promo, condiciones. 400.

Escala usada:

| Uso | Valor |
| --- | --- |
| Título de pantalla (header negro) | Barlow Condensed 700 34/34, `letter-spacing: 1px`, MAYÚSCULA |
| Título de hoja / sección grande | Archivo 700 24-26 / 28 |
| Total principal | Barlow Condensed 700 52-60 / 48-54 |
| Total secundario (comparación) | Barlow Condensed 700 28/28 |
| Precio de bloque de super | Barlow Condensed 700 26/26 |
| Monto de ahorro en bloque de promo | Barlow Condensed 700 34/32 |
| Nombre de producto | Archivo 500-600 15/20-21 |
| Cuerpo | Archivo 400 15/21 |
| Label de sección | Archivo 500 11/14, `letter-spacing: 1.2px`, MAYÚSCULA, color `#8A929B` |
| Dato mono | IBM Plex Mono 400 12/16 |

### Espaciado, radio, sombra

- Padding de pantalla: **20px** horizontal. (El actual usa 16 — cambia.)
- Gap entre secciones: 20px. Entre elementos de una sección: 8-12px.
- Radio: 16 pantalla/hoja · 12 tarjeta · 10 bloque interno · 8 botón/chip · 999 pastilla.
- Sombra de tarjeta: `0 2px 10px rgba(11,18,32,.07)`. Sobre fondo blanco casi no se usa; el borde alcanza.

### Hit targets

**Mínimo 44px de alto en todo lo tocable.** Esto incluye los links de texto ("Cargar", "Vaciar carrito", "Saltar", "Producto por producto", el selector de orden). Cuando el texto es visualmente chico, se le da alto con padding y se compensa con margen negativo para que el texto quede alineado al borde del contenedor:

```
height: 44, paddingHorizontal: 12, marginRight: -12
```

Los +/− de cantidad son de 32-34px dentro de un control cuyo alto total supera 44px, lo cual es aceptable porque están agrupados; los botones sueltos no.

---

## 2. Navegación

Tres tabs: **Buscar · Carrito · Ajustes**. Hoy hay dos.

- Los carritos guardados viven dentro de Carrito, no en un tab propio.
- Mis descuentos es una pantalla que se abre desde Carrito y desde Ajustes.
- "Cómo funciona" se abre desde el estado inicial de Buscar y desde Ajustes.
- Resultado sigue siendo una pantalla apilada sobre Carrito.

El badge del carrito en el tab es amarillo con el número de unidades.

---

## 3. Componentes

### 3.1 Header negro

Bloque `#14161A` a sangre en el tope de cada pantalla principal. Contiene el título en Barlow Condensed mayúscula y, según la pantalla, el buscador, la barra de supers o los totales. Reemplaza al título sobre fondo gris del diseño anterior.

### 3.2 Barra de supers (filtro)

Cinco columnas de igual ancho. Cada una: una barra de 6px de alto con el color del super, y debajo el nombre en Archivo 500 11/14.

- Activo: barra en el color del super, nombre en blanco (dentro del header) o `#14161A`.
- Inactivo: barra `#3C444D` sobre oscuro / `#E4E7EA` sobre claro, nombre en gris.
- Día activo dentro del header negro es blanco puro; sobre fondo claro necesita el borde interno.

Cumple dos funciones: filtra, y enseña el código de color. Por eso va antes de los resultados y no en un menú.

### 3.3 Banda de disponibilidad

Columna de 8px de ancho pegada al borde izquierdo de cada resultado de búsqueda, dividida en 5 segmentos iguales en orden fijo (Vea, Carrefour, Chango Más, Día, Coto). Segmento con color = disponible ahí. Segmento `#E4E7EA` = no disponible. El segmento de Día usa blanco con borde interno.

El orden de los 5 segmentos **nunca cambia**, es lo que lo hace legible de un vistazo.

### 3.4 Bloque de supermercado (plan de compra)

Tarjeta con borde `#DFE3E7`, radio 12, `overflow: hidden`.

- **Cabecera**: fondo del color del super, nombre en Barlow Condensed 700 26 mayúscula blanco a la izquierda, total del super a la derecha en el mismo estilo.
- **Cuerpo**: fondo blanco, una fila por producto (`nombre ×cantidad` a la izquierda, subtotal en Barlow Condensed 15 gris a la derecha).
- Avisos (online, descuento ya aplicado) van al final del cuerpo.
- Cierra con el botón de exportar.

Con Carrefour azul y Coto rojo el texto blanco sobre la cabecera tiene contraste suficiente; con Día habría que invertir a texto oscuro (no aparece en los mockups porque Día nunca gana en el ejemplo, pero hay que manejarlo).

### 3.5 Bloque de promo sin aplicar

Borde amarillo, radio 12, dos partes:

- **Arriba**, fondo `#FFD400`: label del producto y super en Archivo 600 11 mayúscula con `opacity: .65`; debajo el **ahorro** en Barlow Condensed 700 34 con signo menos (`−$1.360,00`); a la derecha, alineado abajo, "queda en $X" en mono 12.
- **Abajo**, fondo `#FFF6C9`: la condición en mono 12 a la izquierda, el botón negro pastilla de 44px a la derecha.

**El número grande es el ahorro, no el precio final.** Esto es deliberado: en el caso de promos por cantidad el total nuevo puede ser mayor que el actual (llevás más unidades), y mostrar ese número hace que la promo parezca un aumento.

### 3.6 Fila de estado (compacta)

Para lo que ya está aplicado, no para lo que hay que decidir. Fondo `#F6F7F9`, borde, radio 8, min-height 44. Punto verde con ✓, dos líneas de texto, y una pastilla "Quitar" con borde a la derecha.

### 3.7 Bloque de exportar

Botón negro de 48px de ancho completo, `Exportar a {Super}`, y debajo una línea en mono 12 gris centrada: `abre {dominio} · iniciá sesión y el carrito se carga solo`.

La línea de abajo no es decorativa: avisa que el usuario sale de la app y que hace falta sesión. Sin eso el botón sorprende.

**Nota legal, sin resolver.** El deep-link que precarga el carrito depende de que cada cadena lo permita; hay que revisarlo cadena por cadena antes de construirlo. Camino de bajo riesgo mientras tanto: compartir/copiar la lista como texto, que no necesita integración. No usar logos de las cadenas para rotular el botón; el nombre en texto alcanza.

---

## 4. Pantallas

### 4.1 Buscar — estado inicial (3a)

Lo que se ve antes de escribir nada. Nunca se vio antes en la app y es donde el usuario entiende qué es esto.

1. Header negro con el título y el buscador vacío (placeholder `yerba, fideos, shampoo…`). **Sin barra de supers**: todavía no hay nada que filtrar.
2. Título "Un carrito, siete supermercados" y un párrafo con la promesa.
3. **CADA SUPER TIENE SU COLOR**: las 5 barras de 36×8 con el nombre al lado, en columna.
4. Una línea en mono: "El color siempre dice de qué super es un precio. El amarillo, en cambio, siempre dice ahorro."
5. Separador, y "Primera vez acá?" + botón `Cómo funciona`.

### 4.2 Buscar — con resultados

Header negro con buscador **y** barra de supers. Debajo: contador de resultados a la izquierda ("4 RESULTADOS EN 4 SUPERS"), selector de orden a la derecha como texto subrayado con chevron.

Cada resultado: banda de disponibilidad, `FotoProducto`, nombre, y debajo **el mejor precio con el nombre del super en su color**. Si tiene promo, un chip amarillo chico (ej. `2x1`). A la derecha, botón `+` amarillo de 36px, o el stepper si ya está en el carrito.

Barra inferior: "N unidades listas" + botón negro `Ver carrito`.

**Orden por precio**: no cambiar el comportamiento actual. Los productos se reordenan cuando llegan los precios; el spinner con "Cargando" queda como está.

### 4.3 Carrito

Header negro: "CARRITO" + "N productos · N u".

1. **CARRITOS GUARDADOS** con el botón amarillo `Guardar carrito` (44px) a la derecha del label. Debajo, tarjetas lado a lado: nombre en Barlow Condensed 20 mayúscula, cantidad en mono, y `Cargar` como link de 44px. El recién guardado va primero con borde amarillo de 2px.
2. **EN ESTA COMPRA**: filas `#F6F7F9` radio 10, foto + nombre + stepper. Sin EAN (es ruido para el usuario).
3. **MIS DESCUENTOS · N ACTIVOS**: bloque con cabecera amarilla; en el cuerpo los chips activos en negro y los inactivos con borde. Toca → pantalla de Mis descuentos.
4. `Vaciar carrito` centrado, 44px. **Debe pedir confirmación**; hoy borra directo.

Barra inferior: botón negro `COMPARAR PRECIOS` en Barlow Condensed 24 mayúscula con un punto amarillo al lado.

### 4.4 Guardar carrito (4a, 4b)

Se dispara desde `Guardar carrito`.

**Hoja** (bottom sheet sobre backdrop `rgba(20,22,26,.55)`, radio 16 arriba):
- Título "Guardar carrito" + una línea explicando para qué sirve.
- Label NOMBRE y un campo de 52px con borde negro (foco), **pre-llenado con "Compra de {mes}"** y el texto seleccionado, para que guardar sea un toque y escribir encima también.
- Debajo del campo, en mono: "N productos · N unidades".
- Fila de botones: `Cancelar` con borde, ancho fijo 110px, y `Guardar` negro ocupando el resto. Ambos 50px.

**Al guardar**: la hoja se cierra, el carrito nuevo aparece primero en la fila con borde amarillo, y sale un toast negro sobre el CTA (no tapándolo) con ✓ amarillo y el texto **"Guardado como {nombre}"**. Confirma el nombre, que es lo único que el usuario acaba de decidir. Auto-dismiss ~3s.

Nombre duplicado: permitir, o sufijar. No bloquear el guardado.

### 4.5 Cómo funciona (3b)

Tres hojas secuenciales sobre backdrop, con "PASO N DE 3" y `Saltar` (44px) arriba, dots + botón abajo. Se puede reabrir siempre desde el estado inicial de Buscar y desde Ajustes. **No es un modal de una sola vez.**

1. **Armá un solo carrito** — buscás por nombre y tocás; no elegís supermercado, el producto se busca en los cinco a la vez. Ilustrado con una fila de resultado.
2. **Dónde comprar cada cosa** — al comparar, cada producto queda asignado al super donde sale más barato, con ofertas por cantidad y lo que tengas en Mis descuentos ya contado; vas a ver ese total y el de comprar todo en un solo lugar. Ilustrado con dos bloques de super en miniatura.
3. **Dos colores que importan** — las 5 barras de super, y separada abajo la barra amarilla = "Ahorro y promociones".

### 4.6 Resultado

**Header negro**, en este orden:

1. Volver + "DÓNDE COMPRAR".
2. **Día de compra** (ver § 5): tira de 7 días.
3. **Los dos totales, lado a lado.** Izquierda: label amarillo "REPARTIENDO EN 3 PARADAS", total en Barlow Condensed 52, y en mono los supers involucrados. Divisor vertical `#3C444D`. Derecha, ancho fijo ~118px: label gris "EN UN SOLO SUPER", total en Barlow Condensed 28 gris, y en mono cuál. **El contraste es lo que explica qué significa "repartir"** — no hay texto que lo defina, se entiende por comparación. Y de paso la opción de una sola parada deja de estar enterrada al final de la pantalla.
4. Bloque amarillo: "Repartiendo ahorrás" + el monto.
5. Si hay promos sin aplicar, bloque `#20242B`: punto amarillo, "N promociones sin aplicar", el monto en juego en amarillo mono, y pastilla `Ver` que baja a la sección. Sin monto no sirve — el usuario tiene que saber cuánto está dejando pasar.

**Cuerpo**:

1. **PLAN DE COMPRA**: un bloque de super (§ 3.4) por parada, ordenados por monto descendente.
2. **PROMOS SIN APLICAR · N**: los bloques amarillos (§ 3.5), agrupados acá y no repetidos dentro de cada producto. Así el amarillo es un momento de la pantalla y no una pared.
3. **EMPIEZA EN LOS PRÓXIMOS 7 DÍAS · N**: mismo bloque pero en gris `#F6F7F9` con borde `#DFE3E7`, texto en `#565E67`, "quedaría en" en condicional, y en vez de un botón de aplicar, `Ver el {día}` con borde. Una promo que no arrancó no puede parecer aplicable.
4. **SI COMPRÁS TODO EN UNO**: gráfico de 5 barras verticales con el sobrecosto de cada super. Alturas proporcionales, fijas, ancladas abajo; label del monto arriba y sigla del super abajo.
5. Fecha de consulta en mono + link `Producto por producto` (44px).

### 4.7 Mis descuentos (5a)

Reemplaza a "Tus tarjetas". Header negro: "MIS DESCUENTOS" + "Tarjetas, apps y clubes que tenés. Sus promos se suman al comparar."

El nombre viejo era incorrecto: Mi Carrefour es un programa, MODO una app, MasClub un club, Cuenta DNI una billetera. Lo que los une es que son cosas que el usuario ya tiene y que desbloquean descuentos.

Lista de filas separadas por línea. Cada una: nombre en Archivo 600 15, debajo en mono **qué desbloquea, qué día y con qué tope** ("25% los martes · tope $15.000"), y a la derecha un switch de 52×32. Las inactivas van con el texto en gris.

Cierra con un bloque `#F6F7F9`: "Marcá solo las que tenés de verdad. Las promos de las demás igual se muestran al comparar, avisando que no están contadas."

**Copy de los CTA.** El botón que suma un descuento desde una promo dice **"Tengo {nombre}"** — "Tengo Mi Carrefour", "Tengo Santander". No "Activar": activar no dice qué le pasa al usuario y suena a contratar algo. El verbo tiene que ser una declaración del usuario, porque eso es exactamente lo que la app necesita saber.

**Pendiente, no diseñado**: los topes son mensuales. Si el usuario ya lo consumió, el ahorro que calcula la app no existe. Mínimo, mostrar el tope (ya está). Ideal, poder decir "ya lo usé este mes".

---

## 5. Día de compra (5b)

Muchas promos son por día de la semana. Hoy la comparación asume implícitamente el día en que el usuario está mirando; si va a comprar el sábado, el resultado puede estar mal.

**Control**: tira de 7 columnas iguales en el header negro, bajo el título. Cada celda 56px de alto: día abreviado arriba (`HOY`, `JUE`, `VIE`…), número del día en Barlow Condensed 16, y un punto de 5px abajo — amarillo si ese día hay alguna promo que aplique al carrito, transparente si no. El punto es lo que invita a explorar.

- Seleccionado: fondo blanco, texto negro.
- No seleccionado: borde `#3C444D`, texto `#A6AEB8`.

**Comportamiento**: al elegir un día se recalcula todo. El header pasa a "COMPRANDO EL {DÍA} {N}" con el total de ese día grande, y a la derecha queda **hoy** como comparación. El bloque amarillo dice "Esperando al jueves ahorrás $X". Se reusa exactamente el patrón de dos totales de § 4.6 — misma idea, otro eje.

Debajo, **QUÉ CAMBIA EL {DÍA}**: las promos que se activan ese día, con su monto. Si alguna requiere algo que el usuario no tiene, ahí mismo va el botón `Tengo {nombre}`.

Al volver a Buscar/Carrito el día elegido se descarta: es una exploración, no una preferencia.

---

## 6. Cambios de backend

### Bloqueante

**`Promo` necesita vigencia.** Hoy tiene `activa: boolean` pero no dice cuándo aplica. Sin eso no se pueden construir los puntos amarillos de la tira, el recálculo por día, ni la sección "empieza en los próximos 7 días".

```ts
type Promo = {
  // …lo que ya tiene
  dias?: number[];        // 0-6, domingo a sábado. Vacío/ausente = todos los días
  desde?: string;         // ISO, para promos con ventana
  hasta?: string;
};
```

Y el cálculo del plan tiene que poder recibir una fecha objetivo en vez de asumir hoy.

### No bloqueante

- **Tope de descuento**: si el monto de tope viene en la promo, mostrarlo (ya se muestra en el mockup como texto). Para "ya lo usé este mes" haría falta estado por usuario.
- **Deep-link de carrito por cadena**: ver la nota legal en § 3.7. Hasta que se resuelva, el botón puede caer a compartir/copiar la lista como texto.

---

## 7. Deuda de UX que quedó abierta

Cosas identificadas y no diseñadas todavía. En orden de impacto:

1. **`Vaciar carrito` no confirma.** Destructivo y de un toque.
2. **Topes mensuales.** El ahorro puede ser irreal si el usuario ya consumió el tope.
3. **"Requiere comprar online" llega tarde.** Es una restricción que puede invalidar un plan entero y aparece recién en el resultado. Debería ser una preferencia en Ajustes ("no me sirve la compra online"), no un filtro por compra: es un hecho estable del usuario.
4. **Ajustes no está diseñada.** Tiene que contener al menos: tema claro/oscuro, Mis descuentos, Cómo funciona, y la preferencia de compra online.
5. **Tema oscuro.** Pedido y no diseñado. La paleta de `AllPromos Rediseño.dc.html` opción 1b tiene una versión oscura de este sistema que sirve de punto de partida (fondos `#0F1114` / `#181B20`, bordes `#2B3138` / `#3C444D`, texto `#F1F3F5` / `#A6AEB8` / `#727B85`, y los colores de super aclarados: Vea `#2FBE7A`, Carrefour `#6A97F7`, Chango `#B085DE`, Coto `#F0555F`).
