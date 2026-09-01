# Prompt para Claude Code — Turnos 12 y 13 (suscripción y pago)

Copiá todo lo que sigue como prompt inicial. El detalle visual completo está en
`design_handoff_allpromos_v2/PANTALLA-12-eleccion-de-plan.md` y los comps en
`AllPromos v2.dc.html` (secciones `t12` y `t13`) — leelos antes de escribir código.

---

## Contexto

App mobile-first (React Native / React web) que compara precios de supermercados argentinos.
Hoy existe `PaywallFinTrial.tsx`, la pantalla bloqueante que ve el usuario cuando se le vence el
trial de 30 días y que muestra cuánto ahorró como gancho. Lo que falta es todo el paso siguiente:
elegir plan, confirmar el mail de Mercado Pago y salir al checkout.

Los pagos son 100% hosteados en Mercado Pago. **No hay formulario de tarjeta en la app** y no se
guardan datos de tarjeta en ningún momento.

## Qué construir

### 1. `PlanSelect` — elección de plan (turno 12)

Tres planes, siempre en este orden: Mensual, Anual, Permanente.

| id | precio | período | $/mes | barra |
|---|---|---|---|---|
| `mensual` | 8000 | mes | $8.000 | 100%, gris |
| `anual` | 80000 | año | $6.667 | 83%, amarillo |
| `permanente` | 160000 | pago único | — | vacía, "sin mensualidad" |

La comparación se apoya en una sola métrica normalizada: **costo por mes**, con una barra por
tarjeta. Es lo único que se compara de un vistazo; el resto es letra chica. Derivá los valores
de los precios, no los hardcodees:

```ts
const porMes = plan.periodo === "año" ? Math.round(plan.precio / 12) : plan.precio
const mesesGratis = plan.precio / precioMensual  // 10 → "pagás 10 meses y usás 12"
const ahorroAnual = precioMensual * 12 - precioAnual  // 16000
```

**Jerarquía (respetala, es una decisión de conversión):** el Anual es el recomendado y es la única
tarjeta oscura (`#14161A`) sobre una pantalla blanca — en una app blanca, invertir una sola tarjeta
destaca más que agregar amarillo. El Permanente lleva badge de ancla `MEJOR A LARGO PLAZO` con
contorno negro sobre blanco y **el mismo peso visual que el Mensual**: su argumento es textual
("se paga solo en 20 meses"), no visual. Si el Permanente compite en jerarquía con el Anual, la
pantalla deja de tener una respuesta obvia. El amarillo `#FFD400` queda reservado para tres cosas:
badge del recomendado, barra del anual y CTA.

Estados de la pantalla:

- **Sin plan activo (12a).** Tres tarjetas elegibles, ninguna marcada. Sin botón de cerrar: es
  bloqueante, se llega desde `PaywallFinTrial`. CTA fijo abajo, refleja el plan seleccionado
  (default: Anual).
- **Con plan activo (12b).** La tarjeta del plan actual colapsa a una fila inerte: fondo `#F7F8F9`,
  borde `1px dashed #C6CCD3`, sin precio grande, sin barra, `pointer-events: none`, pill
  `TU PLAN ACTUAL` + fecha de renovación. Header con X (vuelve a Ajustes). El badge del Anual pasa
  a `AHORRÁS $16.000 POR AÑO` y su subtexto compara contra lo que paga hoy. El aviso de no
  prorrateo va **debajo del CTA**, no dentro de la tarjeta.
- **Plan Permanente.** La pantalla se abre igual desde Ajustes, pero las tres tarjetas se muestran
  como ya compradas y no hay CTA — no hay nada que venderle a ese usuario.
- **Loading (12c).** Sin overlay ni spinner centrado: el CTA pasa a `#F2CB00` con spinner +
  `ABRIENDO MERCADO PAGO…`, y el header y las tarjetas no seleccionadas bajan a `opacity:.4`. La
  tarjeta que se está comprando queda a opacidad plena. Debajo, la línea de recuperación: el
  usuario está a punto de irse a otra app y tiene que poder volver.
- **Web (12d).** Grid de 3 columnas `1fr`, gap 16, con las cinco filas alineadas entre tarjetas
  (nombre, precio, barra + $/mes, argumento con `flex:1`, botón). CTA por tarjeta en lugar de uno
  fijo; el aviso de prorrateo va al pie. Mismo contenido que mobile, cero funciones extra.

### 2. `MercadoPagoEmailSheet` — confirmar mail (turno 13)

**Este es el paso que hoy no existe y sin el cual los cobros fallan.** El mail de la cuenta de
Mercado Pago puede no ser el mismo que el de la app; si no coincide, el cobro no entra. Se pide
en una hoja intermedia, después de elegir el plan y antes de redirigir:

```
Ajustes ─────────┐
PaywallFinTrial ─┴→ PlanSelect → MercadoPagoEmailSheet → loading → checkout MP
                                                       ↘ error al abrir
```

- Prellenado con el mail de la app: para la mayoría es el mismo, así que el trabajo del usuario es
  **confirmar, no escribir**. Campo con acción "Cambiar" al costado.
- La hoja repite plan y precio para que no haya que recordarlos del paso anterior, y aclara que no
  se guardan datos de tarjeta.
- **Mail distinto al de la app:** aviso informativo sobre `#F7F8F9`, **no** un error, y no bloquea.
  Tener otro mail en Mercado Pago es perfectamente legítimo.
- **Mail mal formado:** borde `2px #8C1D18`, mensaje concreto ("Falta el final del mail (.com,
  .com.ar)"), CTA a `opacity:.4` e inerte. Solo validación de formato: no se puede verificar si la
  cuenta existe antes del checkout.

### 3. Error al abrir el checkout

Cuando `POST /checkout` falla o no devuelve `initPoint`. El mensaje **arranca con "No se te cobró
nada"** — es lo que el usuario necesita saber antes de decidir si reintenta. La hoja no se cierra y
no pierde el mail escrito. Dos salidas: "Probar de nuevo" (primario) y "Elegir otro plan" (texto).

### 4. Entrada desde Ajustes

Fila "Plan y pago" arriba de la lista de Ajustes, con el plan actual y el próximo cobro en el
subtítulo, que navega a `PlanSelect`. El subtexto aclara que ahí se cambia o se cancela, así que
**no** agregues una fila "Cancelar suscripción" aparte.

Con plan Permanente: misma posición y mismo chevron (la pantalla se alcanza igual), pero la fila no
promete cambiar nada — tarjeta oscura con badge `ACTIVO`, fecha del pago único y "no hay
renovaciones ni cobros futuros", sin próximo cobro. Sumá "Comprobante de pago" a la lista: es lo
único que este usuario puede necesitar.

## Modelo de datos

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
  pagadoEl: string | null         // ISO; solo permanente, para Ajustes
  mailMercadoPago: string | null  // null → prellenar con el mail de la app
}
```

`POST /checkout` recibe `{ planId, email }` y devuelve `{ initPoint }`; la app abre esa URL. El
`email` se persiste como `mailMercadoPago` para prellenar la próxima vez.

**Sin prorrateo:** cambiar de plan cobra el nuevo completo y no se descuenta lo que quede del
actual. Decilo en la UI donde está indicado; no lo implementes distinto.

## Tokens

| uso | valor |
|---|---|
| fondo pantalla | `#FFFFFF` |
| tarjeta normal | `#FFFFFF` + borde 1px `#C6CCD3` |
| tarjeta destacada (Anual) | `#14161A` + borde 2px `#14161A` |
| plan actual (inerte) | `#F7F8F9` + borde 1px dashed `#C6CCD3` |
| texto principal | `#14161A` |
| prosa explicativa | `#3C444D` |
| metadato / label | `#565E67` |
| bordes e iconos deshabilitados | `#767E88` — **nunca texto** |
| sobre tarjeta oscura | `#FFFFFF` / secundario `#C6CCD3` |
| acento (badge, barra anual, CTA) | `#FFD400`, pressed `#F2CB00` |
| error | fondo `#FDECEA`, borde `#F0C2BC`, texto `#8C1D18` |
| divisores | `#DFE3E7` |

Tipografía: `Archivo` para UI y prosa, `Barlow Condensed` 700 para precios y labels de CTA.
Radios: 12 tarjeta, 10 CTA mobile / input, 8 CTA web, 5 badge, 999px pills.

Los grises pasaron por una corrección de contraste WCAG en un turno anterior — respetá la tabla y
no reintroduzcas `#767E88` en texto.

## Restricciones

- Ningún dato de tarjeta en la app. Todo el pago ocurre en el checkout hosteado.
- Los tres planes dan **exactamente** las mismas funciones; lo único que cambia es cuánto se paga y
  cada cuánto. No inventes features por plan ni tablas comparativas de features.
- No agregues descuentos, cupones, contadores de urgencia ni pruebas sociales: no están diseñados.
- Mantené la copy tal como está en los comps. Está escrita en español rioplatense (voseo) y
  revisada.
- Hit targets mínimo 44px.

## Orden sugerido

1. Modelo de datos + `PlanSelect` sin estados (12a) — la base visual y el cálculo de $/mes.
2. Estados de plan actual y permanente (12b) + entrada desde Ajustes.
3. `MercadoPagoEmailSheet` con validación (13a/13b).
4. Loading (12c) y error de apertura (13c).
5. Layout web (12d).
