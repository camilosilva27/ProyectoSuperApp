# Handoff — Tutorial guiado dentro de AllPromos

Para implementar con Claude Code sobre el código real de la app.

---

## 1. La idea, en una frase

El tutorial **no muestra** cómo funciona la app: hace que el usuario **haga** una compra completa, guiado, dentro de la app real. Al terminar el tutorial el usuario no vio una demo — tiene un carrito cargado, sus promos activadas y su primera comparación hecha.

Reemplaza el texto estático de "cómo funciona".

---

## 2. Regla principal: cero contenido nuevo

Esto es lo que más importa del handoff.

**El tutorial no dibuja pantallas.** Es una capa que se monta encima de las pantallas que ya existen: atenúa todo, deja visible y tocable un solo elemento real, y explica qué hacer con él. La navegación es la navegación real de la app. Los datos son los datos reales. Los botones son los botones reales.

Lo que **no** hay que crear:

- pantallas de tutorial, slides, carruseles ni onboarding aparte
- versiones "de mentira" de la búsqueda, el carrito o el resultado
- productos, supers o precios inventados para el tutorial
- botones "Siguiente" o "Anterior"

Lo único que el tutorial agrega a la pantalla son tres cosas: el oscurecido, el recorte alrededor del elemento del paso, y el cartel que dice qué hacer.

**El paso avanza solo cuando el usuario hace la acción.** Si el paso dice "tocá el buscador y escribí", el paso no avanza hasta que hay texto escrito. No hay forma de saltear haciendo tap en cualquier lado: todo lo que no es el elemento del paso está bloqueado.

Un corolario práctico: si un paso del tutorial necesita un elemento que la app todavía no tiene, **no se inventa el elemento en el tutorial** — o se construye en la app como funcionalidad real, o se saca ese paso del tutorial.

---

## 3. El flujo, paso a paso

| # | Pantalla real | Elemento enfocado | Acción que desbloquea |
|---|---|---|---|
| 1a | Buscar | Pestaña Descuentos, barra inferior | Tocarla → navega a Descuentos |
| 1b | Descuentos | Tarjeta Banco Nación | Activarla → vuelve a Buscar |
| 2 | Buscar | Campo de búsqueda | Escribir 3+ caracteres |
| 3a | Buscar | Celda `+3 otros` de la barra de supers | Tocarla → abre la hoja de supers |
| 3b | Hoja de supers | Lista de supers | Marcar Coto |
| 4 | Hoja de supers | Segmentado del tope | Elegir un tope → cierra la hoja |
| 5 | Buscar | Resultado de búsqueda | Tocar el producto |
| 6 | Buscar | Botón Ver carrito | Tocarlo |
| 7 | Carrito | Botón Comparar precios | Tocarlo |
| 8 | Dónde comprar | — sin foco, pantalla libre | Leer el resultado de su propia compra |

Los pasos 1 y 3 tienen dos partes: el foco se mueve dentro del mismo número de paso, primero al lugar donde vive la función y después al control. Eso es deliberado — la mitad del valor del tutorial es que el usuario aprenda **dónde están las cosas**.

El paso 8 no tiene foco ni bloqueo: es el premio. Se muestra el resultado real de la compra que el usuario acaba de armar, con el ahorro destacado. Si el resto del tutorial se hizo bien, esta pantalla no necesita explicación.

---

## 4. Dos huecos en la app

El flujo pasa por dos lugares que hoy no existen. Ninguno es del tutorial: son funcionalidad de la app que hay que construir primero, y ya están decididos.

**"Mis descuentos" como pestaña propia.** Barra inferior de tres: Buscar · Descuentos · Carrito. La pantalla lista las tarjetas y promos con estado activo/inactivo. Hoy las tarjetas cuelgan de una fila del carrito; el tutorial necesita que sean un lugar al que se pueda llegar.

**La hoja "Qué supers comparar" con el tope adentro.** Es el diseño `11a` de `AllPromos v2.dc.html`, y se abre desde el `+3` de la barra oscura de supers (`9b`). Las dos decisiones —cuáles comparar y a cuántos ir— viven juntas, y el segmentado del tope muestra cuánto ahorro resigna cada opción.

---

## 5. Dónde mirar cada cosa

| Qué | Archivo |
|---|---|
| Pantallas actuales: Buscar, Carrito, Dónde comprar | `AllPromos Actual.dc.html` |
| Barra oscura de supers con `+3` | `AllPromos v2.dc.html` → `9b` |
| Hoja de supers + tope | `AllPromos v2.dc.html` → `11a` |
| Pantalla de resultado | `AllPromos Rediseño.dc.html` → `1a`, bloque "1a Resultado" |
| Bloque de tarjetas y promos | `Tour en la app.dc.html`, vista `descuentos` |
| Mecánica del tutorial | `Tour en la app.dc.html`, clase `Component` |
| Logos de supers | `assets/logos/` |

El prototipo `Tour en la app.dc.html` es una recreación en web, no la app. Sirve para entender la mecánica y el ritmo, no para copiar estilos: los estilos salen de los archivos de la app.

Sobre la pantalla de resultado: usé la dirección `1a` (Góndola) porque ninguna de las tres quedó cerrada formalmente y los turnos 9 a 11 usan logos, que `1c` no tiene, y fondo claro, que `1b` no tiene. Si quedó otra, es cambiar esa pantalla sola.

---

## 6. Tokens

```
Fondo app          #EEF0F2
Tarjeta            #FFFFFF, borde #DFE3E7, radio 14, sombra 0 2px 10px rgba(11,18,32,.07)
Tinta              #14161A   secundaria #565E67   terciaria #8A929B
Divisor            #DFE3E7   borde fuerte #C6CCD3
Amarillo acción    #FFD400   fondo promo #FFF6C9
Tipografía         Archivo (UI) · Barlow Condensed (precios) · IBM Plex Mono (datos, EAN, timestamps)
```

Colores de super sobre blanco: Vea `#12874A`, Carrefour `#1B5FD9`, Chango Más `#7A3FB8`, Día `#E30613`, Coto `#D6293E`, Jumbo `#F07C2E`, Disco `#35B8C4`. Sobre fondo oscuro se usan las versiones claras: `#2EA35C`, `#4C8DF6`, `#A66FE0`, `#FF4438`.

---

## 7. El spotlight

Es lo único no trivial. La lógica es la misma en web y en React Native:

1. Cada elemento enfocable tiene una ref.
2. Al cambiar de paso se mide ese elemento (`measureInWindow` en RN, `getBoundingClientRect` en web), relativo al contenedor de la pantalla.
3. Con ese rectángulo se dibuja el recorte: padding 8, radio 14, borde `#FFD400` de 2px, y el resto de la pantalla oscurecido a `rgba(11,18,32,.62)`. En web se resuelve con `box-shadow: 0 0 0 9999px`; en RN, con cuatro vistas opacas alrededor del rectángulo.
4. Cuatro bloqueadores transparentes alrededor del hueco capturan los toques. Solo el elemento del paso queda tocable.
5. El cartel se ubica del lado opuesto al hueco: si el foco está abajo, el cartel va arriba.

Tres cosas que ya costaron caro en el prototipo:

- **Medir puede dar 0×0** si el elemento todavía no está montado, por ejemplo dentro de una hoja que recién se abre. Hay que descartar esas lecturas y reintentar, nunca fijar la primera.
- **Re-medir después de cada transición**, no solo al cambiar de paso.
- **El cartel no puede tapar el hueco.** Con targets en la barra inferior es el error fácil, y deja el tutorial sin salida.

Y una salida siempre visible: el usuario tiene que poder abandonar o reiniciar el tutorial en cualquier paso.

---

## 8. Microanimaciones

Solo las que confirman progreso. Nada decorativo.

- Check de tarjeta activada, super marcado, tope elegido, `+` que pasa a `✓`: escala de 0.6 a 1 con rebote corto, ~300ms.
- El hueco viajando al siguiente elemento, ~340ms con desaceleración. Esto es lo que hace que el tutorial se sienta continuo y no una secuencia de pantallas.
- Puntos de progreso en el cartel: los pasos hechos quedan amarillos, el actual es una barrita.
- Resultado final: entra desde abajo con fade y el ahorro cuenta desde 0 hasta el total en ~1.1s.

En el prototipo las animaciones por keyframes están desactivadas porque el entorno de previsualización las congela. En la app se implementan normal.

---

## 9. El resultado del paso 8

El prototipo **calcula** el resultado en vez de tenerlo escrito, y conviene replicarlo: hace que el paso 4 tenga consecuencia visible.

1. Para cada subconjunto de supers seleccionados de tamaño ≤ tope, se calcula el total comprando cada producto donde salga más barato dentro de ese subconjunto.
2. Gana el subconjunto de menor total.
3. El "contra" es comprar todo en un solo super: se toma el más caro de los seleccionados.
4. Las promos se aplican por categoría: cada tarjeta activa descuenta un porcentaje en un super y solo en ciertas categorías.

El punto 4 no es un detalle. Si el descuento aplicara a todo el super, ese super gana todos los productos, el plan nunca se reparte, el tope queda sin efecto y la pantalla de resultado pierde el sentido.

---

## 10. Copy

Los textos están en el prototipo, en el objeto `coach` de `renderVals()`. Cortos, en segunda persona, sin signos de admiración. Cada uno dice qué tocar y para qué sirve, en ese orden. Nunca explican una función que el usuario no esté ejecutando en ese momento.
