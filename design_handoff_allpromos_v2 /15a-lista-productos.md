# 15a · Separación de productos en el plan de compra

Cambio acotado a la lista de productos dentro de cada tarjeta de supermercado en la pantalla de resultado ("PLAN DE COMPRA"). No toca el header del super, los avisos, el botón de exportar ni nada más.

## Qué cambia

Antes cada producto era un solo renglón (`nombre ×cantidad` + precio), separados solo por `gap:12px`. Dos productos seguidos se leían como un bloque de texto.

Ahora cada producto es una fila de dos líneas cerrada por una divisoria:

- **Línea 1:** nombre del producto, sin la cantidad pegada al final.
- **Línea 2:** cantidad y precio unitario (`2 un · $5.647 c/u`).
- **Derecha:** subtotal del producto, alineado arriba.
- **Divisoria** `1px solid #E7EAEE` debajo de cada fila; la última fila no la lleva.

## Estructura

Contenedor de la lista (reemplaza el `gap:12px` por padding vertical propio de cada fila):

```html
<div style="padding:4px 14px 14px;display:flex;flex-direction:column">
  <!-- filas -->
</div>
```

Fila de producto (todas menos la última):

```html
<div style="padding:12px 0;border-bottom:1px solid #E7EAEE;display:flex;align-items:flex-start;justify-content:space-between;gap:12px">
  <div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:3px">
    <div style="font:500 14px/18px Archivo;color:#14161A">Coca Cola Regular 2.25 Lts</div>
    <div style="font:500 12px/16px Archivo;letter-spacing:.2px;color:#565E67">2 un · $5.647 c/u</div>
  </div>
  <div style="font:600 17px/18px 'Barlow Condensed';color:#14161A;flex:none">$11.294</div>
</div>
```

Última fila: idéntica pero sin `border-bottom`.

Lo que venga después de la lista (aviso de compra online, divisoria del footer) necesita `margin-top` propio, porque el contenedor ya no tiene `gap`:

```html
<div style="background:#FDF3E0;border-radius:6px;padding:8px 10px;font:500 11px/14px Archivo;letter-spacing:.7px;color:#9A5B08;margin-top:4px">REQUIERE COMPRAR ONLINE</div>
<div style="border-top:1px solid #DFE3E7;margin-top:12px;padding-top:12px;display:flex;flex-direction:column;gap:6px">
  <!-- botón Exportar + leyenda -->
</div>
```

## Tokens usados

| Rol | Valor |
|---|---|
| Nombre de producto | Archivo 500 · 14/18 · `#14161A` |
| Cantidad + precio unitario | Archivo 500 · 12/16 · `letter-spacing:.2px` · `#565E67` |
| Subtotal | Barlow Condensed 600 · 17/18 · `#14161A` |
| Divisoria entre productos | `1px solid #E7EAEE` |
| Divisoria del footer de la tarjeta | `1px solid #DFE3E7` (sin cambios) |
| Padding vertical por fila | `12px 0` |

Notas:

- La segunda línea es Archivo, no IBM Plex Mono. El mono se reserva para datos técnicos y leyendas; acá competía con el nombre del producto por ser gris y fino.
- `#E7EAEE` es más claro que el borde de tarjeta `#DFE3E7` a propósito: separa sin dividir la tarjeta en cajas.
- `align-items:flex-start` en la fila para que el subtotal quede alineado con el nombre, no centrado entre las dos líneas.
- La cantidad sale del nombre. `Yerba Playadito 1 Kg ×1` pasa a ser nombre `Yerba Playadito 1 Kg` + `1 un · $37.016 c/u`; el `1 Kg` es parte del nombre del producto y se queda ahí.
- Sin cantidades editables en esta pantalla: es un plan de compra, la edición vive en el carrito.
