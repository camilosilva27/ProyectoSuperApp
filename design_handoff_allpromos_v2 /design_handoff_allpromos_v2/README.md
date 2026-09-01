# AllPromos v2 — paquete de handoff

Rediseño de la app mobile (Expo / expo-router, `app/`). Contiene el diseño aprobado, la recreación del estado anterior para comparar, y la especificación de implementación.

## Archivos

| Archivo | Qué es |
| --- | --- |
| `AllPromos v2.dc.html` | **El diseño aprobado.** Abrilo en un browser. Contiene 5 turnos, del más nuevo al más viejo. |
| `AllPromos Actual.dc.html` | Recreación fiel de las 3 pantallas ANTES del rediseño. Referencia para comparar, no para implementar. |
| `EDICIONES-contraste-y-selector.md` | **Empezá por acá si venís a implementar los últimos cambios.** Contraste de texto y selector de supers (turnos 6 y 7 del diseño). |
| `SPEC.md` | Especificación: tokens, componentes, pantallas, comportamiento, y qué falta en el backend. |
| `support.js` | Runtime necesario para que los `.dc.html` abran. No se implementa. |

## Cómo leer el diseño

`AllPromos v2.dc.html` está ordenado con lo más reciente arriba. De arriba hacia abajo:

- **Turno 7** — Selector de supers legible como control: 7a es la opción elegida, 7b y 7c son alternativas descartadas
- **Turno 6** — Contraste de texto: tokens (6a), leyenda de colores (6b, descartada), filas apagadas (6c), títulos de sección (6d)
- **Turno 5** — Mis descuentos (5a), día de compra (5b), promos que empiezan (5c)
- **Turno 4** — Guardar carrito: hoja (4a) y confirmación (4b)
- **Turno 3** — Estado inicial (3a), onboarding "Cómo funciona" (3b), header de Resultado con dos totales + exportar (3c), Mis descuentos en Carrito (3d)
- **Turno v2** — Las tres pantallas completas: Buscar, Carrito, Resultado

**Cuando el turno v2 y un turno posterior muestran lo mismo, gana el más nuevo.** El header de Resultado correcto es el de 3c/5b (dos totales), no el del turno v2 (un total). Mis descuentos es 5a, no los chips del turno v2.

## Qué NO copiar del HTML

El diseño está escrito con estilos inline y `<div>` porque es un artefacto de diseño en HTML. La app es React Native. Traducí:

- `div` → `View`, texto → `Text`, tocables → `Pressable`
- Los estilos inline son valores, no código a portar. Usá `src/theme.ts`, que ya tiene casi todo.
- Las flechas `‹` `⌄` y el `✓` son placeholders tipográficos. Usá los íconos que ya usa la app.
- Los cuadrados de color con una letra (`C`, `F`, `Y`) son el `FotoProducto` que ya existe.

## Lo primero que hay que saber

**El amarillo `#FFD400` significa ahorro, siempre.** Nunca es un supermercado, nunca es un estado de UI, nunca es decoración. Cada uso nuevo del amarillo tiene que ser plata que el usuario se ahorra. Esta es la regla que sostiene el resto del sistema visual.

**Cada supermercado tiene su color y no cambia.** Vea verde, Carrefour azul, Chango Más violeta, Día blanco con borde, Coto rojo. Ya están en `theme.ts` como `supers`. El color siempre dice de dónde es un precio.

## Bloqueante conocido

El selector de día de compra (5b) y la sección de promos que empiezan (5c) necesitan un campo de vigencia en `Promo` que hoy no existe. Ver SPEC.md § "Cambios de backend". Todo lo demás se puede implementar contra el API actual.
