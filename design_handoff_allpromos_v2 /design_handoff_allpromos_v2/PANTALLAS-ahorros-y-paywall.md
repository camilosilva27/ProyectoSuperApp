# Dos pantallas nuevas: Mis ahorros y fin del período de prueba

App: AllPromos (Expo / expo-router, React Native). Seguí las convenciones que ya existen en el proyecto: tokens del theme, tipografías Archivo / Barlow Condensed / IBM Plex Mono, header oscuro `#14161A` con título en Barlow Condensed 700 34/34 mayúsculas y `letterSpacing 1`, tarjetas blancas con borde `#DFE3E7` y radio 12.

Aplican los tokens de gris ya definidos: `#14161A` texto principal, `#3C444D` prosa explicativa, `#565E67` metadatos y labels, `#767E88` solo íconos apagados. No usar `#8A929B` para texto sobre blanco.

Regla del color, que ya rige en la app: cada color es un super, y el amarillo `#FFD400` es ahorro. Estas dos pantallas son las únicas donde el amarillo puede ocupar el número más grande, porque el ahorro es el contenido.

**Regla de transparencia, no negociable en ninguna de las dos pantallas.** El ahorro se calcula sobre cada comparación que el usuario vio, no sobre compras confirmadas. Por eso la cantidad de comparaciones va siempre pegada al monto, en Archivo 14-15px, en el mismo bloque visual. No en un tooltip, no en mono 12px gris, no en un pie de pantalla.

---

## Pantalla 1 — Mis ahorros (nueva tab)

Pantalla libre, no bloquea nada. Tono informativo, sin felicitaciones ni exclamaciones.

### Tab bar

Pasa de 3 a 4 items: Buscar · Carrito · **Ahorros** · Ajustes. Ícono de Ahorros: tres barras verticales de 4px de ancho y radio 1, alturas 9 / 15 / 20, alineadas abajo con `gap: 3`. Activo `#14161A` con label Archivo 600; inactivo `#767E88` con label `#565E67` Archivo 500. Las alturas del ícono no cambian entre estados.

### Header oscuro (`#14161A`, padding 32 20 22, columna, gap 14)

- Título `MIS AHORROS`.
- Bloque del total, gap 6:
  - `DESDE QUE USÁS ALLPROMOS` — Archivo 600 11/14, `letterSpacing .7`, `#FFD400`.
  - Monto total — Barlow Condensed 700 **60/54**, `#FFD400`. Es el número más grande de la pantalla.
  - `en 47 comparaciones, desde marzo` — Archivo 500 15/21, `#FFFFFF`. El mes es el de la primera comparación registrada.

### Cuerpo (padding 22 20, columna, gap 24)

**a) Este mes y el anterior.** Label de sección `ESTE MES Y EL ANTERIOR` (Archivo 600 11/14, `letterSpacing 1.2`, `#565E67`). Debajo, dos tarjetas `flex: 1` con `gap: 10`, padding 14, radio 12:

- Mes actual: borde **2px `#FFD400`**. Nombre del mes Archivo 600 11/14 `letterSpacing .7` `#14161A`; monto Barlow Condensed 700 34/32 `#14161A`; `en 12 comparaciones` Archivo 500 14/19 `#14161A`.
- Mes anterior: borde 1px `#DFE3E7`. Nombre del mes en `#565E67`; monto **mismo tamaño** Barlow 700 34/32 `#14161A`; conteo Archivo 500 14/19 `#3C444D`.

Los dos montos tienen el mismo tamaño a propósito: son comparables entre sí, y el borde amarillo es lo único que marca cuál es el mes en curso.

**b) Mes a mes.** Label `MES A MES`. Una fila por mes, `gap: 12`, últimos 6 meses con datos. Cada fila es `flexDirection: row`, `alignItems: center`, `gap: 12`:

- Sigla del mes en 3 letras mayúsculas, ancho fijo 34, Archivo 600 11/14, `letterSpacing .5`, `#565E67`.
- Columna `flex: 1`, gap 5:
  - Fila con monto a la izquierda (Barlow Condensed 600 15/16, `#14161A`) y conteo a la derecha (`4 comp.`, IBM Plex Mono 400 12/16, `#565E67`), `justifyContent: space-between`.
  - Barra: pista de 8px de alto, radio 999, fondo `#F0F2F4`; relleno del mismo alto y radio, ancho porcentual = monto del mes / monto del mes más alto de los 6.

El **mes en curso** se distingue: sigla Archivo 700 `#14161A`, monto Barlow 700 17/16, conteo en mono `#14161A`, y el relleno de la barra en `#FFD400`. Los otros cinco meses usan `#E4C74A` (el amarillo apagado, para que el mes actual se lea primero sin perder la escala de color).

Cierra con una línea explicativa: *"Cada comparación suma la diferencia entre el plan más barato y comprar todo en un solo super."* — Archivo 400 14/20, `#3C444D`, `text-wrap: pretty`.

### Estados a cubrir

- **Sin comparaciones todavía:** el header muestra `$0` y una línea que explica que el ahorro aparece después de la primera comparación. No inventes un gráfico vacío ni barras en cero: no mostrar la sección Mes a mes.
- **Menos de 2 meses de historial:** ocultar la sección Mes a mes y la tarjeta del mes anterior; el bloque del mes en curso queda a ancho completo.
- El monto total y el conteo son acumulados de siempre, no se resetean.

---

## Pantalla 2 — Fin del período de prueba (paywall bloqueante)

Se muestra automáticamente al terminar los 30 días. **Bloqueante:** sin botón de cerrar, sin X, sin tab bar, sin gesto de back (interceptá el back de Android), sin scroll. No se sale sin elegir una de las dos opciones.

Fondo completo `#14161A`. Tono: el dato ya mostrado es el argumento. Nada de cuenta regresiva, nada de "no pierdas", ninguna lista de features que se pierden.

### Estructura, de arriba a abajo

1. Padding 40 24 0: `TERMINÓ TU MES DE PRUEBA` — Archivo 600 11/14, `letterSpacing 1.2`, `#C6CCD3`.
2. Bloque central (`flex: 1`, padding 28 24, `justifyContent: center`, gap 26):
   - Grupo del ahorro, gap 10:
     - `Ahorraste` — Archivo 500 20/26, `#FFFFFF`.
     - Monto del trial — Barlow Condensed 700 **76/66**, `#FFD400`.
     - `en 12 comparaciones, este mes de prueba.` — Archivo 500 17/24, `#FFFFFF`. El conteo está en la misma frase que el monto, no en letra chica aparte.
   - Divisoria de 1px, `rgba(255,255,255,.18)`.
   - Grupo del precio, gap 6:
     - `Por $10.000 al mes podés seguir comparando y seguir ahorrándolo.` — Archivo 400 17/24, `#FFFFFF`; solo el precio en peso 600.
     - `Cancelás cuando quieras desde Ajustes.` — Archivo 400 14/20, `#C6CCD3`.
3. Pie (padding 0 24 34, gap 6):
   - **Botón principal:** fondo `#FFD400`, radio 10, `minHeight 58`, contenido centrado en columna con gap 2 — `SEGUIR AHORRANDO` en Barlow Condensed 700 24/26 `letterSpacing 1` `#14161A`, y debajo `$10.000 por mes` en Archivo 500 12/14 `#14161A`. Es el único elemento amarillo interactivo de la app, y acá el amarillo significa lo mismo que siempre.
   - **Salida secundaria:** `Continuar en el plan gratis` — Archivo 500 15/21, `#C6CCD3`, subrayado, sin fondo ni borde, contenedor de `minHeight 52` centrado. Encontrable de inmediato, sin competir con el botón.

El monto y el precio son placeholders: el monto viene del ahorro acumulado durante el trial y el precio del plan configurado.

### Comportamiento

- `SEGUIR AHORRANDO` abre el flujo de pago de la plataforma. Si el pago se cancela o falla, se vuelve a esta misma pantalla, sin mensaje de error agresivo.
- `Continuar en el plan gratis` cierra el bloqueo y deja al usuario en Buscar. Todavía **no está decidido qué se gatea en el plan gratis**: no armes lista de features, ni comparativa de planes, ni marques nada como bloqueado en el resto de la app. El único contraste que el diseño afirma es "seguís ahorrando" contra "plan gratis".
- La pantalla se muestra una sola vez al terminar el trial. Si el usuario eligió gratis, el acceso a suscribirse queda en Ajustes, no volviendo a bloquear.
- Accesibilidad: el monto y el conteo van en un solo `accessibilityLabel` ("Ahorraste 58.240 pesos en 12 comparaciones"), y las dos opciones son `role="button"` con área de toque de 44px mínimo.

---

## Fuera de alcance

No rediseñes pantallas existentes. Las dos únicas ediciones ya pedidas aparte son las de contraste de texto y el selector de supers.
