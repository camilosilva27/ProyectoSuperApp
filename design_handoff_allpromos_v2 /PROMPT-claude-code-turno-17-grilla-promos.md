# Prompt para Claude Code — Turno 17 (grilla de promos por día y super)

Copiá todo lo que sigue como prompt inicial. El comp visual está en `AllPromos v2.dc.html`
(sección `t17`, versiones `17a` y `17b`) — abrilo antes de escribir código para ver las dos
variantes de celda (17a: celda pintada de amarillo; 17b: chip amarillo con el %). Ese archivo es
un mockup standalone (Claude Design), **no se toca ni se copia tal cual** — es solo referencia
visual. Esto va a la **app real**.

## Contexto

En la pestaña **Buscar**, estado inicial sin búsqueda (`3a` en el mockup), hoy hay un bloque de
texto/logo de super. Se reemplaza por una **grilla**: 7 supers en filas × 7 días de la semana en
columnas, mostrando en cada celda con promo el logo del banco/tarjeta y el % de descuento. Días y
supers quedan fijos (sticky), la grilla scrollea en horizontal (y vertical si no entran las 7
filas).

No existe ninguna versión previa de esto en la app real (ya se buscó: no hay componente de
grilla/calendario en `app/src`, ni endpoint que agrupe por super×día). Es una feature nueva de
punta a punta.

## Qué construir

### 1. Backend — nuevo endpoint

Agregar `GET /api/promos-bancarias/grilla` (mismo patrón de router que
`backend/src/routes/misDescuentos.js`, mismo import de `leerPromosBancariasCache()` de
`backend/src/promosBancariasCache.js` — **no** pegarle en vivo a los supers, ese cache ya lo
alimenta el cron de `refrescarCatalogos.js`).

A diferencia de `/api/mis-descuentos` (agrupa por tarjeta → lista de supers), acá se agrupa **al
revés**: por super → 7 celdas (una por día ISO 1=lunes…7=domingo, campo `dias` de cada promo ya
usa esa convención — ver `diaISO()` en `AllPromos/promos-bancarias.js`).

Cada promo cruda tiene esta forma (de `leerPromosBancariasCache()`):

```ts
type PromoBancariaCruda = {
  canonicosPosibles: string[];   // ej. ['Galicia'] — puede haber más de un alias que matchea
  dias: number[];                // 1=lunes...7=domingo
  descuentoPct: number;          // 0.2 = 20%
  tope: number | null;
  montoMinimo: number | null;
  vigenciaDesde: Date;
  vigenciaHasta: Date;
};
```

**Criterio para elegir un banco por celda cuando hay más de uno el mismo día** (pasa seguido,
ej. Vea trae 15-60 promos activas por día en algunos supers): igual criterio que ya usa la CLI
para "mejor promo" (`mejorPromoTicket` en `AllPromos/`) — la de mayor `descuentoPct` entre las
vigentes hoy (`vigenciaDesde <= ahora <= vigenciaHasta`). Si ninguna está vigente hoy pero hay
alguna con `dias.length` definido, mostrar esa igual (mismo criterio que
`calcularDescuentos()` en `misDescuentos.js` — "es un patrón que probablemente vuelva").

Respuesta sugerida:

```ts
type CeldaGrilla = {
  tiene: boolean;
  banco: string | null;       // canónico, ej. "Galicia" — null si tiene=false
  pct: number | null;         // 0.2, no formateado — el frontend decide "20%"
};

type FilaGrilla = {
  superKey: SuperKey;
  celdas: CeldaGrilla[];       // largo 7, índice 0 = lunes
};

type RespuestaGrilla = {
  filas: FilaGrilla[];
  generadoEl: string | null;   // de fechaGeneracionPromosBancarias(), para detectar cache vencido
};
```

Reusar `SuperKey` de `app/src/api.ts` y agregar el tipo de respuesta ahí mismo (mismo archivo
donde ya viven los tipos de `/api/mis-descuentos`).

### 2. Frontend — `LogoBanco.tsx`

Mismo patrón que `app/src/componentes/LogoSuper.tsx` (leelo primero): mapa `LOGOS_VECTOR`
indexado por el nombre **canónico** (no por archivo), con `react-native-svg-transformer`.

Los 7 SVG ya están en `app/assets/logos-bancos/`: `galicia.svg`, `bbva.svg`, `macro.svg`,
`banco-nacion.svg`, `santander.svg`, `hsbc.svg`, `banco-ciudad.svg` (bajados de Wikimedia
Commons — ver el apéndice al final de este doc para bajar más si hace falta).

Mapeo canónico → archivo (los nombres canónicos son los de `ALIAS_TARJETAS` en
`AllPromos/promos-bancarias.js`, **no** el slug del archivo):

| Canónico (`ALIAS_TARJETAS`) | Archivo |
|---|---|
| `Galicia` | `galicia.svg` |
| `BBVA` | `bbva.svg` |
| `Banco Macro` | `macro.svg` |
| `Banco Nación` | `banco-nacion.svg` |
| `Santander` | `santander.svg` |
| `HSBC` | `hsbc.svg` |
| `Banco Ciudad` | `banco-ciudad.svg` |

**Faltan bancos.** El backend real puede devolver cualquier canónico de `ALIAS_TARJETAS`
(Comafi, ICBC, Credicoop, Banco Columbia, Supervielle, Banco Patagonia, Naranja X, MODO,
Mercado Pago, Cuenta DNI, Mi Carrefour, etc. — son ~25 hoy). Con solo 7 logos, cualquier celda
con un banco sin logo va a caer en el `else` de `LogoBanco` — definir un fallback (ej. las
iniciales del banco en un chip, mismo estilo que el placeholder de super sin logo si existe uno,
o directo texto chico). No bloquear el turno por los logos que faltan; agregarlos incrementalmente
seguí el apéndice.

### 3. Componente de grilla en `3a` (Buscar, estado inicial)

- Encontrar el componente/pantalla real que hoy arma el estado inicial de Buscar (bloque de texto
  que se reemplaza) — no está mapeado en este doc, ubicarlo por el texto/estructura que hoy se ve
  ahí.
- Columna de logos de super **sticky left** (reusar `LogoSuper`/`PlacaLogoSuper` ya existente),
  fila de días **sticky top** con una sola letra (L M M J V S D — repetida para miércoles, es la
  misma que usa el mockup).
- Celda con promo: logo del banco (`LogoBanco`) + `%` (elegir 17a o 17b — pintada vs. chip — es
  una decisión de diseño que no está cerrada, mostrale las dos capturas al usuario o pedile que
  elija mirando el mockup antes de fijarla en código).
- Celda sin promo: guion, no vacía (así lo pide el mockup).
- Fetch a `GET /api/promos-bancarias/grilla` una sola vez al entrar a Buscar (no en cada
  keystroke de búsqueda — esto se muestra solo en el estado sin texto buscado).

## Decisiones abiertas (dejadas así en el mockup, resolver acá)

- **Día de hoy marcado o no en la grilla:** no se resolvió en el mockup. Sugerencia: sí, un
  borde o fondo sutil en la columna de hoy — ayuda a ubicarse en una grilla de 7 columnas.
- **Corte cuando cambia la semana (domingo → lunes):** los `dias` son fijos 1-7, no fechas — la
  grilla no necesita re-fetch por cambio de semana, el patrón semanal es el mismo. Si en algún
  momento se agregan promos por fecha puntual (no recurrentes), esto hay que revisarlo.

## Restricciones

- No tocar `AllPromos v2.dc.html` ni ningún archivo de `design_handoff_allpromos_v2 /` — son
  mockup, quedan como están.
- No pegarle en vivo a los supers desde este endpoint — solo `leerPromosBancariasCache()`.
- Los logos son marcas de terceros: mismo criterio que `LogoSuper` — `contain`, sin recolorear
  ni recortar, tal como vienen.

---

## Apéndice — cómo repetir la descarga de logos de bancos

Quedaron 7 bancos más ya identificados en `ALIAS_TARJETAS` sin logo (Comafi, ICBC, Credicoop,
Banco Ciudad ya está, Supervielle, Banco Patagonia, Naranja X, Banco Columbia) más los que se
agreguen. Proceso que ya funcionó para bajar los primeros 14 (de los cuales estos 7 se subieron a
la app):

1. **Buscar la fuente.** Preferí Wikimedia Commons (`commons.wikimedia.org`) — tiene licencia
   clara y buena calidad. Buscar `"Logo Banco <nombre>"` o `"<nombre> logo"` ahí primero; si no
   aparece, un buscador de logos general (ej. seeklogo.com) como último recurso, dejando
   anotado que esa fuente no tiene licencia explícita (pasó con Banco Columbia).
2. **Descargar con `curl`** a un directorio de trabajo (ver el skill/scratchpad de la sesión).
   Verificar con `file <archivo>` que sea realmente una imagen (SVG/PNG/JPEG) y no una página de
   error — Wikimedia devuelve 429 (too many requests) seguido si se pegan varias descargas
   rápido; esperar un poco y reintentar.
3. **Guardar el original tal cual** (preferentemente `.svg`, es el que se copia directo a
   `app/assets/logos-bancos/` para la app real — no hace falta procesarlo).
4. Si además se necesita subirlo a un proyecto de Claude Design (mockup, no la app real) y el
   archivo es grande, **rasterizarlo chico primero** con Quick Look de macOS antes de subirlo:
   ```
   qlmanage -t -s 160 -o <dir_salida> archivo.svg
   ```
   Esto genera un PNG chico (`archivo.svg.png`) — evita mandar un SVG de cientos de KB en
   base64 a una herramienta que solo acepta datos inline, que además es propenso a corromperse
   si el string es muy largo. **Esto solo aplica para subir al mockup de diseño**; para la app
   real siempre copiar el SVG original completo, no la miniatura rasterizada.
5. Mapear el nombre de archivo (slug simple, ej. `comafi.svg`) al nombre **canónico** real de
   `ALIAS_TARJETAS` en `AllPromos/promos-bancarias.js` (ojo: no siempre coinciden — ej. el
   archivo es `macro.svg` pero el canónico es `"Banco Macro"`, no `"Macro"`).
