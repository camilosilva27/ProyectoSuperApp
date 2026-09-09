# 14b · Landing y creación de cuenta

Diseño elegido para la entrada a la app. Dos pantallas, un dato por pantalla. La primera pide solo el mail; el resto se pide después de verificarlo. La cuenta se crea antes de usar la app, porque el tutorial arranca al entrar.

Ancho de referencia: 390px (iPhone). Todo el layout es flex con `gap`, nunca márgenes entre hermanos.

---

## Tipografías

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700&family=Barlow+Condensed:wght@600;700&display=swap" rel="stylesheet">
```

- **Archivo** — toda la UI: títulos de sentencia, cuerpo, labels, botones secundarios.
- **Barlow Condensed** — solo titulares de impacto y botones principales, en mayúsculas con `letter-spacing`.
- **Nada de IBM Plex Mono.**

## Paleta

| Rol | Valor |
|---|---|
| Texto principal | `#14161A` |
| Texto secundario | `#3C444D` |
| Labels y notas | `#565E67` |
| Placeholder | `#8C949D` |
| Borde de tarjeta | `#C6CCD3` |
| Divisoria interna | `#DFE3E7` |
| Fondo de aviso neutro | `#F7F8F9` |
| Amarillo (hero y CTA) | `#FFD400` |
| Blanco | `#FFFFFF` |

El amarillo se usa acá para el hero y el botón principal. En el resto de la app está reservado a promos y ahorro; esta es la excepción deliberada de la landing, donde no hay precios con los que competir.

## Piezas compartidas

**Tarjeta de pantalla**

```html
<div style="width:390px;box-sizing:border-box;background:#FFFFFF;border:1px solid #C6CCD3;border-radius:16px;padding:26px 24px 28px;display:flex;flex-direction:column;gap:22px">
```

**Label de sección** — `font:600 11px/14px Archivo;letter-spacing:1.2px;color:#565E67`, en mayúsculas.

**Campo de texto (52px)**

```html
<!-- vacío -->
<div style="height:52px;box-sizing:border-box;border-radius:10px;box-shadow:inset 0 0 0 1px #C6CCD3;display:flex;align-items:center;padding:0 14px;font:500 16px/22px Archivo;color:#8C949D">Al menos 8 caracteres</div>

<!-- con foco: borde de 2px y caret -->
<div style="height:52px;box-sizing:border-box;border-radius:10px;box-shadow:inset 0 0 0 2px #14161A;display:flex;align-items:center;padding:0 14px;gap:2px">
  <div style="font:500 16px/22px Archivo;color:#14161A">sofia.moreno@gmail.com</div>
  <div style="width:2px;height:22px;background:#14161A"></div>
</div>
```

El borde va en `box-shadow: inset`, no en `border`, para que el foco de 2px no mueva el layout. Alto fijo 52px.

**Botón principal**

```html
<div style="background:#FFD400;border-radius:10px;min-height:58px;display:flex;align-items:center;justify-content:center">
  <div style="font:700 24px/26px 'Barlow Condensed';letter-spacing:1px;color:#14161A">SEGUIR</div>
</div>
```

**Botón secundario** — mismo alto pero `min-height:44px`, `box-shadow:inset 0 0 0 1px #C6CCD3`, texto `font:500 15px/21px Archivo;color:#14161A`.

**Link de texto** — `min-height:44px` centrado, `font:500 15px/21px Archivo;color:#14161A;text-decoration:underline`. El alto mínimo de 44px es el área tocable, no decoración.

---

## Pantalla 1 · Tu mail

Tarjeta con `overflow:hidden` y `padding:0`, porque el hero amarillo llega a los bordes.

```html
<div style="width:390px;box-sizing:border-box;background:#FFFFFF;border:1px solid #C6CCD3;border-radius:16px;overflow:hidden;display:flex;flex-direction:column">

  <!-- hero -->
  <div style="background:#FFD400;padding:26px 24px;display:flex;flex-direction:column;gap:6px">
    <div style="font:700 40px/38px 'Barlow Condensed';letter-spacing:.5px;color:#14161A">TU CARRITO,<br>EN TODOS LOS SUPERS</div>
    <div style="font:500 14px/20px Archivo;color:#14161A;text-wrap:pretty">Un solo carrito. Los precios y las promos de cada super, al lado.</div>
  </div>

  <!-- cuerpo -->
  <div style="padding:26px 24px 28px;display:flex;flex-direction:column;gap:20px">

    <div style="display:flex;flex-direction:column;gap:8px">
      <div style="font:600 11px/14px Archivo;letter-spacing:1.2px;color:#565E67">PASO 1 DE 3 · TU MAIL</div>
      <!-- campo con foco -->
      <div style="font:400 13px/18px Archivo;color:#565E67">Te lo pedimos para guardar tu carrito y tus listas.</div>
    </div>

    <!-- botón principal: SEGUIR -->

    <!-- beneficios -->
    <div style="display:flex;flex-direction:column;gap:10px;padding-top:18px;border-top:1px solid #DFE3E7">
      <div style="display:flex;align-items:baseline;gap:10px">
        <div style="width:8px;height:8px;border-radius:999px;background:#FFD400;margin-top:6px"></div>
        <div style="flex:1;font:400 14px/20px Archivo;color:#3C444D">30 días gratis, sin poner tarjeta</div>
      </div>
      <!-- + "Promos de tus tarjetas aplicadas al total" -->
      <!-- + "Listas guardadas para volver a comprar" -->
    </div>

    <!-- link: Ya tengo cuenta -->
  </div>
</div>
```

Notas:

- El título va en dos líneas con `<br>` explícito, no por wrap. `line-height` 38px sobre 40px de tamaño: las dos líneas casi se tocan, es intencional.
- El campo de mail arranca con foco y teclado abierto. Es el único campo de la pantalla.
- La bala amarilla de 8px lleva `margin-top:6px` con `align-items:baseline` para alinearse con la primera línea del texto, no con el centro del bloque.
- El label dice el paso y qué se pide. Es lo que evita que la pantalla 2 se lea como un callejón sin salida.

## Pantalla 2 · Confirmá tu mail

```html
<div style="width:390px;box-sizing:border-box;background:#FFFFFF;border:1px solid #C6CCD3;border-radius:16px;padding:26px 24px 28px;display:flex;flex-direction:column;gap:22px">

  <div style="font:600 11px/14px Archivo;letter-spacing:1.2px;color:#565E67">PASO 2 DE 3 · CONFIRMÁ TU MAIL</div>

  <div style="display:flex;flex-direction:column;gap:8px">
    <div style="font:700 26px/30px Archivo;color:#14161A;letter-spacing:-.3px">Te mandamos un mail</div>
    <div style="font:400 15px/22px Archivo;color:#3C444D;text-wrap:pretty">Abrilo y tocá el botón para confirmar. Después terminás de crear la cuenta.</div>
  </div>

  <!-- recibo del mail enviado -->
  <div style="border:1px solid #C6CCD3;border-radius:12px;padding:14px 16px;display:flex;align-items:center;gap:12px">
    <div style="flex:1;display:flex;flex-direction:column;gap:2px">
      <div style="font:600 11px/14px Archivo;letter-spacing:1.2px;color:#565E67">ENVIADO A</div>
      <div style="font:500 15px/21px Archivo;color:#14161A">sofia.moreno@gmail.com</div>
    </div>
    <div style="font:500 13px/18px Archivo;color:#14161A;text-decoration:underline">Cambiar</div>
  </div>

  <div style="display:flex;flex-direction:column;gap:10px">
    <!-- botón principal: ABRIR MI CORREO -->
    <!-- botón secundario: Reenviar el mail -->
  </div>

  <div style="background:#F7F8F9;border-radius:10px;padding:12px 14px;font:400 13px/18px Archivo;color:#3C444D;text-wrap:pretty">Si no llega en un par de minutos, mirá en spam o correo no deseado.</div>
</div>
```

Notas:

- El título de esta pantalla es Archivo 700, no Barlow Condensed: es una frase, no un titular.
- El recibo con "ENVIADO A" y "Cambiar" existe para el caso más común de esta pantalla, que es haberse equivocado en una letra. Sin eso el usuario tiene que volver atrás y no sabe si pierde lo escrito.
- El aviso de spam va siempre visible, no detrás de un "no me llegó". Es la razón número uno de abandono en este paso.
- `ABRIR MI CORREO` abre la app de mail del sistema. Si no se puede resolver, el botón se cae a "Reenviar el mail" como principal.

## Pantalla 3 · Nombre y contraseña

No dibujada. Es el paso 3 de 3, después de que el link del mail vuelve a la app: nombre y contraseña, con el mail ya resuelto y mostrado como dato fijo. Reusa la tarjeta y los campos de acá. Al terminar, arranca el tutorial.

## Estados que faltan definir

- Mail mal escrito en el paso 1: mismo tratamiento que el error de checkout, borde `#8C1D18` de 2px y mensaje debajo en `#8C1D18`, botón principal en `opacity:.4`.
- Link de confirmación vencido: pantalla propia con reenvío, no un error en la pantalla 2.
- Volver a la app con la cuenta ya verificada desde otro dispositivo.
