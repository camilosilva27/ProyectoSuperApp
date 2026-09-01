# Pantalla 12 — Elección de plan (`PlanSelect`)

Sigue a `PaywallFinTrial.tsx` (8b) y también se abre desde Ajustes cuando un premium quiere cambiar. Cuatro comps en `AllPromos v2.dc.html`: `12a` mobile sin plan, `12b` mobile con plan actual, `12c` loading de checkout, `12d` web.

## Decisión de jerarquía

- **Anual = recomendado** (tarjeta **oscura** `#14161A` sobre pantalla blanca, badge `RECOMENDADO` amarillo, CTA primario). Es el objetivo de conversión. La pantalla es blanca como el resto de la app; invertir una sola tarjeta destaca más que agregar amarillo, y deja el `#FFD400` reservado para badge, barra del anual y CTA.
- **Permanente = ancla** (badge `MEJOR A LARGO PLAZO`, mismo peso visual que Mensual). Su argumento es textual ("se paga solo en 20 meses"), no visual.
- **Mensual = piso**. Sin badge.

## Eje de comparación

Los tres precios miden períodos distintos, así que la comparación se normaliza a **costo por mes** con una barra:

| Plan | Precio | $/mes | Barra |
|---|---|---|---|
| Mensual | $8.000 /mes | $8.000 | 100%, `#767E88` sobre `#EDF0F2` |
| Anual | $80.000 /año | $6.667 | 83%, `#FFD400` sobre `rgba(255,255,255,.18)` (dentro de la tarjeta oscura) |
| Permanente | $160.000 una vez | — | vacía + "sin mensualidad" |

`$/mes` del anual = `precioAnual / 12` redondeado. El texto "dos meses no se cobran" se deriva de `precioAnual / precioMensual === 10`.

## Estados

**Sin plan activo (12a).** Tres tarjetas elegibles, ninguna marcada. Header sin X: bloqueante, igual que 8b. CTA fijo abajo con el plan seleccionado (default: Anual).

**Con plan activo (12b).** La tarjeta del plan actual:
- fondo `#F7F8F9`, borde `1px dashed #C6CCD3`
- sin precio grande, sin barra, sin CTA — colapsa a una fila
- pill `TU PLAN ACTUAL` + fecha de renovación, ambos en `#C6CCD3` (la fecha es información que hay que poder leer; lo inerte lo carga el borde punteado y la ausencia de precio/barra/CTA, no un gris ilegible)
- `pointer-events: none`

Header con X (vuelve a Ajustes). El badge del Anual cambia a `AHORRÁS $16.000 POR AÑO` (= `precioMensual*12 - precioAnual`) y el subtexto compara contra lo que paga hoy. El aviso de no prorrateo va debajo del CTA, no en la tarjeta.

Si el plan actual es Permanente la pantalla igual se abre (13e), pero las tres tarjetas se muestran como ya compradas y no hay CTA — no hay nada que vender a ese usuario.

**Loading (12c).** No hay overlay ni spinner centrado. El botón pasa a `#F2CB00` con spinner + `ABRIENDO MERCADO PAGO…`, las tarjetas no seleccionadas bajan a `opacity:.4`, el header también. La tarjeta oscura del Anual queda a opacidad plena — es la que se está comprando. Debajo, texto de recuperación: "Si no vuelve solo, tocá atrás y probá de nuevo: no se cobró nada todavía." Necesario porque el checkout es externo y el retorno no es garantizado.

**Error de apertura (13c).** Diseñado en el turno 13 — ver más abajo.

## Web (12d)

Grid de 3 columnas, `1fr` cada una, gap 16. Las cuatro filas se alinean entre tarjetas: nombre, precio, barra + $/mes, argumento (`flex:1`), botón. CTA por tarjeta en lugar de uno fijo. El aviso de prorrateo va como línea al pie. Sin funciones extra respecto a mobile.

## Tokens usados

Fondo pantalla `#FFFFFF` · tarjeta normal `#FFFFFF` borde 1px `#C6CCD3` · tarjeta destacada (Anual) `#14161A` borde 2px `#14161A` · plan actual `#F7F8F9` borde 1px dashed `#C6CCD3` · texto sobre blanco `#14161A` / prosa `#3C444D` / metadato `#565E67` · texto sobre la tarjeta oscura `#FFFFFF` / secundario `#C6CCD3` · `#767E88` solo bordes e iconos, nunca texto · amarillo `#FFD400` solo en badge del recomendado, barra del anual y CTA · radios 12 (tarjeta) / 10 (CTA mobile) / 8 (CTA web) / 5 (badge) · precios en `Barlow Condensed` 700, resto `Archivo`.

## API

```ts
type Plan = {
  id: 'mensual' | 'anual' | 'permanente'
  precio: number            // ARS
  periodo: 'mes' | 'año' | 'unico'
}
type Suscripcion = {
  planId: Plan['id'] | null
  renuevaEl: string | null  // ISO, null si permanente o sin plan
}
```

El checkout es hosteado: `POST /checkout` devuelve `initPoint` y la app abre esa URL. No hay formulario de tarjeta en la app. Sin prorrateo: cambiar de plan cobra el nuevo completo.

---

# Turno 13 — Mail de Mercado Pago, error de checkout, entrada desde Ajustes

## Paso nuevo en el flujo

El mail de la cuenta de Mercado Pago **puede no ser el de la app**, y si no coincide el cobro no entra. Se pide en una hoja intermedia:

```
Ajustes (13d/13e) ─┐
8b trial vencido ──┴→ 12 elegir plan → 13a confirmar mail MP → 12c abriendo MP → checkout externo
                                                             ↘ 13c error al abrir
```

La 12c ya no se dispara desde la pantalla de planes: ahora ocurre después de la hoja.

**13a — hoja de confirmación.** Prellenada con el mail de la app; la acción esperada es confirmar, no escribir. Campo con acción "Cambiar" al costado. La hoja repite plan + precio para que el usuario no tenga que recordarlo del paso anterior, y aclara que no se guardan datos de tarjeta.

**13b — editando y validación.**
- Mail distinto al de la app: aviso **informativo** sobre `#F7F8F9`, no error. Tener otro mail en Mercado Pago es legítimo y no bloquea.
- Mail mal formado: borde `2px #8C1D18`, mensaje concreto ("Falta el final del mail"), CTA a `opacity:.4` e inerte. Solo validación de formato — no podemos verificar si la cuenta existe antes del checkout.

**13c — no se pudo abrir el checkout.** El mensaje arranca con "No se te cobró nada", que es lo que el usuario necesita saber antes de reintentar. La hoja no se cierra y no pierde el mail escrito. Dos salidas: "Probar de nuevo" (primario) y "Elegir otro plan" (texto). Se usa cuando `POST /checkout` falla o no devuelve `initPoint`.

**Superficie de error (token nuevo).** El diseño no tenía rojo semántico — el único rojo existente (`#D6293E`) es marca de Coto. Se agrega: fondo `#FDECEA`, borde `#F0C2BC`, título y borde de input inválido `#8C1D18` (7.0:1 sobre blanco). La prosa dentro del banner sigue en `#3C444D`.

## Entrada desde Ajustes

**13d — plan Mensual (o Anual).** Fila "Plan y pago" arriba de la lista, con plan actual y próximo cobro en el subtítulo. Navega a 12b. El subtexto aclara que ahí se cambia o se cancela, así que no hace falta una fila "Cancelar suscripción" aparte.

**13e — plan Permanente.** Misma posición y mismo chevron: la 12 se alcanza igual desde Ajustes. La diferencia es lo que promete la fila — tarjeta oscura con badge `ACTIVO`, fecha del pago único y "no hay renovaciones ni cobros futuros", sin próximo cobro. Al entrar a la 12 con este estado, las tres tarjetas se muestran como ya compradas y no hay CTA. Se agrega "Comprobante de pago" a la lista, que es lo único que este usuario puede necesitar.

## API adicional

```ts
type Suscripcion = {
  planId: 'mensual' | 'anual' | 'permanente' | null
  renuevaEl: string | null       // null si permanente o sin plan
  pagadoEl: string | null        // ISO — solo permanente, para Ajustes
  mailMercadoPago: string | null // null → prellenar con el mail de la app
}
```

`POST /checkout` pasa a recibir `{ planId, email }`. El `email` se persiste como `mailMercadoPago` para prellenar la próxima vez. Validación de formato en cliente; la existencia de la cuenta la resuelve Mercado Pago.
