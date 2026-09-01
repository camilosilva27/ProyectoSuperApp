# Logos de supermercados — qué archivo conseguir

## Formato

- **SVG** es lo ideal (escala sin perder nitidez, un solo archivo para todos los tamaños).
- Si no hay SVG, **PNG con fondo transparente**, mínimo **160×160 px**. No JPG: no tiene transparencia y deja un cuadrado blanco.
- Solo el **isotipo** (el símbolo), no el logo completo con el nombre al lado. En la app el nombre ya va escrito al lado del logo, y los slots son cuadrados de 22 a 28px: un logo horizontal con texto queda ilegible.
- Sin márgenes internos grandes: el símbolo tiene que llegar casi al borde del lienzo.
- Sin fondo de color propio, salvo que la marca lo requiera (por ejemplo un círculo rojo que sea parte del isotipo).

## Dónde salen

En orden de preferencia:

1. **Press kit / brand center** de cada cadena. Es la fuente que corresponde legalmente y suele tener SVG.
2. **Área de prensa** del sitio corporativo (no el de e-commerce).
3. El **favicon** del sitio, que casi siempre es el isotipo cuadrado ya recortado. Está en `https://<dominio>/favicon.ico` o en el `<head>` de la home como `apple-touch-icon` (ese suele ser PNG de 180×180, que alcanza).

La opción 3 es la más rápida y ya te da el recorte cuadrado que necesitamos.

## Lista

Un archivo por cadena, nombrados así:

```
vea.svg
carrefour.svg
chango-mas.svg
dia.svg
coto.svg
jumbo.svg
disco.svg
josimar.svg
```

## Dónde se usan y en qué tamaño

| Lugar | Tamaño renderizado |
| --- | --- |
| Selector de supers (header) | 22–26px de alto, sobre placa blanca |
| Leyenda de colores (estado inicial y tutorial) | 24–28px, radio 6 |
| Cabecera de cada plan de compra (Resultado) | 24px sobre placa blanca de 28px |
| Lista "Qué supers comparar" | 26px, radio 5 |

Todos con `resizeMode: contain`. Ninguno se recolorea, se recorta ni se le cambia la proporción.

## Legales

Son marcas de terceros. Revisar el uso con legales junto con los botones de exportar al carrito de cada cadena, que es la misma conversación.

## Cuando los tengas

Arrastrá cada archivo sobre el recuadro vacío que le corresponde en `AllPromos v2.dc.html` y queda puesto, también al recargar. Si preferís, pasámelos y los coloco yo en los 27 slots, y ahí ajusto los tamaños según cómo se vean de verdad: con los logos reales se decide si en el selector el nombre al lado sigue haciendo falta.
