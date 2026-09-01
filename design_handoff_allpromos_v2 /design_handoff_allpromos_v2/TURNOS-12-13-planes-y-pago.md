# Turnos 12 y 13 — Suscripción y pago

Handoff completo y autocontenido. Reemplaza a `PANTALLA-12-eleccion-de-plan.md`.
Comps de referencia en `AllPromos v2.dc.html`, secciones `t12` y `t13`.

| id | qué es |
|---|---|
| `12a` | Elegir plan — mobile, sin plan activo (trial vencido) |
| `12b` | Elegir plan — mobile, con plan activo (Mensual) |
| `12c` | Elegir plan — abriendo el checkout |
| `12d` | Elegir plan — web, 3 columnas |
| `13a` | Hoja de mail de Mercado Pago, prellenada |
| `13b` | Hoja editando + validación de formato |
| `13c` | No se pudo abrir el checkout |
| `13d` | Ajustes con plan Mensual (entrada a la 12) |
| `13e` | Ajustes con plan Permanente |

---

## 1. Flujo

```
Ajustes (13d / 13e) ──┐
8b PaywallFinTrial ───┴→ 12 PlanSelect → 13a MercadoPagoEmailSheet → 12c loading → checkout MP
                                                                   ↘ 13c error al abrir
```

Dos entradas a la 12: el paywall bloqueante de fin de trial (sin salida) y Ajustes (con X).
La 12 **no** redirige directo: siempre pasa por la hoja de mail. El loading (12c) se dispara al
tocar `IR A PAGAR` en la hoja, no al elegir plan.

---

## 2. Los tres planes

| id | nombre | precio | período | $/mes mostrado | barra |
|---|---|---|---|---|---|
| `mensual` | Mensual | $8.000 | `/mes` | $8.000 por mes | 100 % |
| `anual` | Anual | $80.000 | `/año` | $6.667 por mes | 83 % |
| `permanente` | Permanente | $160.000 | `una vez` | — (`sin mensualidad`) | vacía |

Todo derivado, nada hardcodeado:

```ts
const porMes = plan.periodo === "año" ? Math.round(plan.precio / 12) : plan.precio  // 6667
const ancho  = porMes / precioMensual                                               // 0.83
const mesesQueSePagan = precioAnual / precioMensual                                 // 10
const ahorroAnual = precioMensual * 12 - precioAnual                                // 16000
const mesesParaAmortizar = Math.round(precioPermanente / precioMensual)             // 20
```

Los tres planes dan **exactamente las mismas funciones**. No hay tabla comparativa de features,
no hay features por plan. Lo único que cambia es cuánto se paga y cada cuánto — y eso lo dice
el header: "Todos los planes son la app completa".

### Jerarquía (decisión de conversión, respetarla)

- **Anual = recomendado.** Única tarjeta oscura `#14161A` de la pantalla, badge `RECOMENDADO`
  amarillo, CTA primario, barra amarilla. En una app blanca invertir una sola tarjeta destaca
  más que agregar amarillo.
- **Permanente = ancla.** Badge `MEJOR A LARGO PLAZO` con contorno negro sobre blanco y **el
  mismo peso visual que el Mensual**. Su argumento es textual ("sale como 20 meses del mensual"),
  no visual. Si compite en jerarquía con el Anual, la pantalla pierde la respuesta obvia.
- **Mensual = piso.** Sin badge.
- El amarillo `#FFD400` aparece en tres lugares y en ninguno más: badge del recomendado, barra
  del anual, CTA.

---

## 3. Geometría

### Marco y pantalla (mobile)
- Frame `390 × min-height 844`, `border-radius 16`, `background #FFFFFF`,
  `border 1px solid #C6CCD3`, `overflow hidden`, `display flex; flex-direction column`.
- Header sin X (12a / 12c): `padding 36px 24px 0`, `gap 10`.
- Header con X (12b): `padding 22px 24px 0`, `gap 14`, ícono 26×26 (dos barras 17×2 `#14161A`
  rotadas ±45°), título `600 15/21`.
- Lista de tarjetas: `flex 1`, `padding 22px 24px 0`, `gap 12`.
- Footer/CTA: `padding 22px 24px 30px` (12a/12c) · `20px 24px 30px` (12b), `gap 8`.

### Tarjeta de plan (mobile)
- `border-radius 12`, `padding 14px 16px 16px` (14px 16px si no tiene línea de argumento), `gap 10`,
  `position relative` cuando lleva badge.
- Normal: `background #FFFFFF`, `border 1px solid #C6CCD3`.
- Destacada (Anual): `background #14161A`, `border 2px solid #14161A`.
- Fila de título: `display flex; align-items baseline; gap 8`, spacer `flex 1`, y a la derecha
  precio + período. Con badge, la fila lleva `margin-top 2px`.
- Nombre del plan `600 16/22 Archivo`. Precio `700 26/26 'Barlow Condensed'`. Período `400 12/16`.
- Barra: fila `display flex; align-items center; gap 10`; pista `flex 1; height 6;
  border-radius 999`; relleno mismo alto y radio; a la derecha el texto `$/mes` con
  `width 96; text-align right`.
- Argumento: `400 13/18`, `text-wrap pretty`.

### Badges y pills
- Badge: `position absolute; top -9px; left 14px`, `border-radius 5`, `padding 2px 8px`,
  `600 10/14 Archivo`, `letter-spacing 1px`.
  - Recomendado / ahorro: `background #FFD400`, texto `#14161A`.
  - Ancla: `background #FFFFFF`, `border 1px solid #14161A`, texto `#14161A`.
  - Sobre tarjeta oscura en Ajustes (`ACTIVO`): `background #FFD400`, sin posición absoluta.
- Pill `TU PLAN ACTUAL`: `border 1px solid #767E88`, `border-radius 999`, `padding 4px 10px`,
  `600 10/14`, `letter-spacing .8px`, texto `#3C444D`.

### CTA (mobile)
- `background #FFD400`, `border-radius 10`, `min-height 58`, centrado, `gap 2`.
- Línea 1: `700 24/26 'Barlow Condensed'`, `letter-spacing 1px`, `#14161A`.
- Línea 2: `500 12/14 Archivo`, `#14161A`.
- Pressed / loading: `#F2CB00`. Inerte: `opacity .4`.
- Acción secundaria de texto: `min-height 44`, `500 14/20`, subrayada, `#14161A`.

### Hoja (13a / 13b / 13c)
- `width 390`, `background #FFFFFF`, `border 1px solid #C6CCD3`, `border-radius 16`,
  `padding 18px 20px 24px`, `gap 18`.
- Grabber: `38 × 4`, `border-radius 999`, `background #C6CCD3`, `align-self center`.
- Título `700 20/24`. Prosa `400 14/20 #3C444D`, `text-wrap pretty`.
- Label de campo: `600 11/14`, `letter-spacing 1.2px`, `#565E67`, en mayúsculas.
- Input: `height 52`, `border-radius 10`, `padding 0 14px`, borde como `box-shadow inset 0 0 0`:
  1px `#14161A` en reposo, 2px `#14161A` en foco, 2px `#8C1D18` inválido. Valor `500 16/22 #14161A`.
  Acción "Cambiar" a la derecha: `500 13/18`, subrayada. Caret simulado: `2 × 22` `#14161A`.
- Ayuda debajo del campo: `400 13/18 #565E67`.
- Divisor: `height 1; background #DFE3E7`.
- Resumen de plan: fila baseline, izquierda `600 15/21` + `400 13/18 #3C444D`, derecha
  `700 26/26 'Barlow Condensed'`.

### Ajustes (13d / 13e)
- Header: `padding 22px 20px 0`, `gap 14`, chevron-back 26×26 (dos barras 14×2 rotadas ±45°),
  título `600 15/21`.
- Cuerpo: `padding 24px 20px 26px`, `gap 22`.
- Bloque `TU PLAN`: label `600 11/14 ls 1.2px #565E67`, tarjeta `border-radius 12`, `padding 16`,
  `align-items center`, `gap 12`, chevron `›` `400 17px`. Nota al pie del bloque `400 13/18 #565E67`.
- Filas de lista: `min-height 52`, `gap 12`, label `500 15/21 #14161A`, chevron `›` `400 15px
  #565E67`, divisores `1px #DFE3E7` entre filas, contenedor `gap 2`.

### Web (12d)
- Contenedor `900`, `background #FFFFFF`, `border 1px solid #C6CCD3`, `border-radius 16`,
  `padding 44px 48px 48px`, `gap 32`.
- Encabezado `max-width 520`: eyebrow `600 11/14 ls 1.2px #565E67`, título `700 32/36`,
  subtítulo `400 15/22 #3C444D`.
- Grid `repeat(3, 1fr)`, `gap 16`, `align-items stretch`.
- Tarjeta: `padding 20`, `gap 16`, `border-radius 12`. Cinco filas en el mismo orden en las tres,
  para que la lectura sea horizontal:
  1. nombre `600 16/22`
  2. precio `700 40/38 'Barlow Condensed'` + período `400 13/18`
  3. barra (columna, `gap 6`) + `$/mes`
  4. argumento con `flex 1` (empuja el botón al piso y alinea los tres botones)
  5. botón `min-height 44`, `border-radius 8`, `600 14/20`
- Botón: destacado `background #FFD400` texto `#14161A`; los otros dos
  `border 1px solid #14161A` sobre blanco.
- Badge web: `top -10px; left 20px`, `padding 3px 9px`.
- Pie: `400 13/18 #3C444D` con el aviso de prorrateo.

---

## 4. Estados

### 12a — sin plan activo
Tres tarjetas elegibles, ninguna marcada. Sin X: es bloqueante, se llega desde 8b.
CTA fijo abajo reflejando el plan seleccionado; **default Anual**.
Al pie del CTA: `Se paga con Mercado Pago` (`400 12/16 #565E67`, centrado).

### 12b — con plan activo (upgrade)
La tarjeta del plan actual colapsa a una fila inerte:
- `background #F7F8F9`, `border 1px dashed #C6CCD3`, `border-radius 12`, `padding 14px 16px`
- `align-items center`, `gap 12`; a la izquierda nombre `600 16/22 #3C444D` y meta
  `400 12/16 #3C444D`; a la derecha la pill `TU PLAN ACTUAL`
- sin precio grande, sin barra, sin badge, sin CTA
- `pointer-events: none`

Header con X (vuelve a Ajustes). Bajo el header, `400 14/20 #3C444D`:
"Estás en el plan Mensual. Podés pasarte a cualquiera de los otros dos."

El badge del Anual cambia a `AHORRÁS $16.000 POR AÑO` y su argumento pasa a comparar contra lo
que paga hoy ("$1.333 menos por mes que lo que pagás hoy."). El Permanente agrega "Al ritmo de
hoy, se paga solo en 20 meses."

El aviso de no prorrateo va **debajo del CTA**, nunca dentro de una tarjeta:
"Se cobra el plan nuevo completo hoy. El Mensual se cancela y no se descuenta lo que te queda
del mes en curso."

### Plan Permanente entrando a la 12
La pantalla se abre igual desde 13e, pero las tres tarjetas se muestran como ya compradas y
**no hay CTA**. No hay nada que venderle a ese usuario.

### 12c — abriendo el checkout
Sin overlay ni spinner centrado: el usuario está a punto de irse a otra app y tiene que poder volver.
- CTA → `#F2CB00`, spinner 18×18 (`border 2px rgba(20,22,26,.25)`, `border-top-color #14161A`,
  `border-radius 999`) + `ABRIENDO MERCADO PAGO…`, en una sola línea con `gap 10`.
- Header y tarjetas **no** seleccionadas a `opacity .4`; las apagadas pierden barra y argumento
  (quedan solo nombre + precio).
- La tarjeta que se está comprando queda a opacidad plena.
- Debajo, `400 12/16 #3C444D` centrado: "Se va a abrir el checkout de Mercado Pago. Si no vuelve
  solo, tocá atrás y probá de nuevo: no se cobró nada todavía."

### 13a — hoja prellenada
Prellenada con el mail de la app: para la mayoría es el mismo, así que la acción esperada es
**confirmar, no escribir**. Repite plan y precio para no obligar a recordar el paso anterior.

### 13b — editando y validación
- **Mail distinto al de la app:** aviso informativo sobre `#F7F8F9`, `border-radius 8`,
  `padding 10px 12px`, `400 13/18 #3C444D`, con el mail de la app resaltado en `#14161A`.
  No es un error y **no bloquea**: tener otro mail en Mercado Pago es legítimo.
- **Mail mal formado:** borde `2px #8C1D18`, mensaje `400 13/18 #8C1D18` concreto
  ("Falta el final del mail (.com, .com.ar)."), CTA a `opacity .4` e inerte.
- Solo validación de **formato**. No se puede verificar si la cuenta de Mercado Pago existe
  antes del checkout — eso lo resuelve Mercado Pago.

### 13c — no se pudo abrir el checkout
Banner de error: `background #FDECEA`, `border 1px solid #F0C2BC`, `border-radius 10`,
`padding 12px 14px`, `gap 4`. Título `600 15/21 #8C1D18` = **"No se te cobró nada"** — es lo
primero que el usuario necesita saber antes de decidir si reintenta. Prosa `400 13/18 #3C444D`.

La hoja no se cierra y **no pierde el mail escrito**. Dos salidas: `PROBAR DE NUEVO` (primario,
con plan y precio en la segunda línea) y `Elegir otro plan` (texto subrayado).

Se usa cuando `POST /checkout` falla o no devuelve `initPoint`.

### 13d — Ajustes con plan Mensual o Anual
Fila "Plan y pago" arriba de la lista, con plan y próximo cobro en el subtítulo
("Mensual · $8.000 — próximo cobro el 12 de septiembre"), chevron, navega a 12b.
Nota al pie del bloque: "Acá cambiás de plan o cancelás." — por eso **no** hay fila
"Cancelar suscripción" aparte.

### 13e — Ajustes con plan Permanente
Misma posición y mismo chevron (la 12 se alcanza igual), pero la fila no promete cambiar nada:
tarjeta oscura `#14161A`, nombre + badge `ACTIVO`, y
"Pagaste $160.000 el 4 de marzo de 2026. No hay renovaciones ni cobros futuros." — sin próximo
cobro. Nota al pie: "Tenés la app completa para siempre."
La lista suma **"Comprobante de pago"**, que es lo único que este usuario puede necesitar.

---

## 5. Copy (verbatim, español rioplatense)

No reescribir. Está revisada.

| lugar | texto |
|---|---|
| eyebrow 12 | `ELEGÍ CÓMO SEGUIR` |
| título 12 | `Todos los planes son la app completa` |
| subtítulo 12 | `Cambia cuánto pagás y cada cuánto. Las funciones son las mismas en los tres.` |
| título 12b | `Cambiar de plan` |
| intro 12b | `Estás en el plan Mensual. Podés pasarte a cualquiera de los otros dos.` |
| badges | `RECOMENDADO` · `MEJOR A LARGO PLAZO` · `AHORRÁS $16.000 POR AÑO` · `ACTIVO` · `TU PLAN ACTUAL` |
| argumento anual | `Pagás 10 meses y usás 12: dos meses no se cobran.` |
| argumento anual (12b) | `$1.333 menos por mes que lo que pagás hoy.` |
| argumento permanente | `Pagás una vez y no volvés a pagar nunca. Sale como 20 meses del mensual.` |
| argumento permanente (12b) | `Pagás una vez y no volvés a pagar nunca. Al ritmo de hoy, se paga solo en 20 meses.` |
| argumento mensual (web) | `Se renueva cada mes. Cancelás cuando quieras desde Ajustes.` |
| CTA 12a | `PAGAR EL ANUAL` / `$80.000 por año — un solo cobro` |
| CTA 12b | `PASARME AL ANUAL` / `$80.000 por año — un solo cobro` |
| pie 12a | `Se paga con Mercado Pago` |
| prorrateo | `Se cobra el plan nuevo completo hoy. El Mensual se cancela y no se descuenta lo que te queda del mes en curso.` |
| loading | `ABRIENDO MERCADO PAGO…` |
| pie loading | `Se va a abrir el checkout de Mercado Pago. Si no vuelve solo, tocá atrás y probá de nuevo: no se cobró nada todavía.` |
| título hoja | `Tu mail de Mercado Pago` |
| prosa hoja | `El cobro se hace sobre la cuenta de Mercado Pago que tenga este mail. Si tu cuenta de Mercado Pago usa otro, cambialo acá.` |
| ayuda campo | `Es el mail con el que entrás a la app.` |
| aviso mail distinto | `Distinto al mail de la app (sofia.moreno@gmail.com). Está bien si tu cuenta de Mercado Pago es esa.` |
| error formato | `Falta el final del mail (.com, .com.ar).` |
| CTA hoja | `IR A PAGAR` / `Se abre Mercado Pago` · `Plan Anual · $80.000` |
| pie hoja | `No guardamos datos de tarjeta. El pago se completa en Mercado Pago.` |
| error checkout | `No se te cobró nada` / `No pudimos abrir Mercado Pago. Puede ser la conexión o que Mercado Pago esté con problemas. Probá de nuevo en un minuto.` |
| CTA error | `PROBAR DE NUEVO` · `Elegir otro plan` |
| Ajustes 13d | `Plan y pago` / `Mensual · $8.000 — próximo cobro el 12 de septiembre` / `Acá cambiás de plan o cancelás.` |
| Ajustes 13e | `Permanente` / `Pagaste $160.000 el 4 de marzo de 2026. No hay renovaciones ni cobros futuros.` / `Tenés la app completa para siempre.` |
| filas Ajustes | `Mis descuentos` · `Comprobante de pago` · `Qué supers comparar` · `Cómo funciona` |

Formato de moneda: `$` + miles con punto, sin decimales, sin `ARS` en la UI.

---

## 6. Tokens

| uso | valor |
|---|---|
| fondo pantalla | `#FFFFFF` |
| tarjeta normal | `#FFFFFF` + borde 1px `#C6CCD3` |
| tarjeta destacada (Anual, y bloque plan en 13e) | `#14161A` + borde 2px `#14161A` |
| plan actual inerte | `#F7F8F9` + borde 1px dashed `#C6CCD3` |
| superficie informativa | `#F7F8F9` |
| texto principal | `#14161A` |
| prosa explicativa | `#3C444D` |
| metadato / label / chevron | `#565E67` |
| bordes e iconos deshabilitados | `#767E88` — **nunca texto** |
| sobre tarjeta oscura | `#FFFFFF` · secundario `#C6CCD3` |
| pista de barra | `#EDF0F2` (claro) · `rgba(255,255,255,.18)` (sobre oscuro) |
| relleno de barra | `#767E88` (mensual) · `#FFD400` (anual, sobre oscuro) |
| acento | `#FFD400`, pressed / loading `#F2CB00` |
| error | fondo `#FDECEA`, borde `#F0C2BC`, texto `#8C1D18` |
| divisores | `#DFE3E7` |

Los grises pasaron por una corrección de contraste WCAG en un turno anterior. `#767E88` quedó
restringido a bordes e iconos; no reintroducirlo en texto. `#8C1D18` da 7.0:1 sobre blanco.

**Tipografía:** `Archivo` para UI y prosa; `Barlow Condensed` 700 para precios y labels de CTA.
**Radios:** 16 hoja / frame · 12 tarjeta · 10 CTA mobile e input · 8 CTA web y aviso informativo ·
5 badge · 999 pills, barras y grabber.
**Hit targets:** mínimo 44px.

---

## 7. Modelo de datos

```ts
type PlanId = "mensual" | "anual" | "permanente"

type Plan = {
  id: PlanId
  precio: number                  // ARS
  periodo: "mes" | "año" | "unico"
}

type Suscripcion = {
  planId: PlanId | null           // null = trial vencido / sin plan
  renuevaEl: string | null        // ISO; null si permanente o sin plan
  pagadoEl: string | null         // ISO; solo permanente, para 13e
  mailMercadoPago: string | null  // null → prellenar con el mail de la app
}
```

`POST /checkout` recibe `{ planId, email }` y devuelve `{ initPoint }`; la app abre esa URL.
El `email` se persiste como `mailMercadoPago` para prellenar la próxima vez.

**Sin prorrateo:** cambiar de plan cobra el nuevo completo y no se descuenta lo que quede del
actual. Está dicho en la UI; no implementarlo distinto.

**Nada de datos de tarjeta en la app.** Todo el pago ocurre en el checkout hosteado.

---

## 8. Restricciones

- No agregar descuentos, cupones, contadores de urgencia ni pruebas sociales: no están diseñados.
- No inventar features por plan ni tablas comparativas de features.
- Web = mismo contenido que mobile, cero funciones extra.
- Mantener la copy de la tabla del punto 5 tal cual.

## 9. Orden sugerido de implementación

1. Modelo de datos + `PlanSelect` sin estados (12a): base visual y cálculo de `$/mes`.
2. Estado con plan activo (12b) + entrada desde Ajustes (13d / 13e).
3. `MercadoPagoEmailSheet` con validación (13a / 13b).
4. Loading (12c) y error de apertura (13c).
5. Layout web (12d).
