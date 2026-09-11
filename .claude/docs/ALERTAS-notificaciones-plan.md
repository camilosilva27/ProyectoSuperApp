# Alertas (notificaciones de productos/categorías seguidos) — estado y continuación

Feature nueva construida el 2026-09-10: seguir productos puntuales (y, en un modo separado
todavía sin lógica, categorías) para recibir aviso por mail + push apenas les aparece una
promoción. Reemplaza a "Ahorros" en la nav bar de 5 pestañas; "Ahorros" se mudó a ser una fila
dentro de Ajustes. Este doc es el punto de entrada para retomar el trabajo en una sesión futura
— para el detalle mecánico línea por línea, los otros dos docs siguen siendo la referencia:

- `.claude/docs/CONTEXTO_TECNICO.md` § "Aviso de promo nueva en productos seguidos" — mecanismo de detección/aviso del backend, explicado a fondo.
- `.claude/docs/mails_y_notificaciones.md` tipo #8 — dónde encaja este mail/push en el inventario general de notificaciones de la app.

Ninguno de los cambios de esta sesión se pusheó a git todavía (a pedido explícito del usuario:
"no lo quiero en producción todavía") — todo vive sin commitear en el working tree. Las
migraciones de Supabase **sí se corrieron** contra el proyecto real (autorizado explícitamente
por el usuario), así que la base de datos ya tiene las tablas nuevas aunque el código que las
usa no esté deployado.

## Origen: diseño en Claude Design

Proyecto "SuperApp" en Claude Design (`https://claude.ai/design/p/9ed550fb-8171-4826-838d-dbaaa3fc4847`),
archivo `AllPromos v2.dc.html`, turno 20 (pantallas `20a`-`20g`). El `CLAUDE.md` de ESE proyecto
(no confundir con el de este repo) tiene ahora una sección completa de sistema de diseño real
(tipografías, escala de texto, espaciado, radios, colores) volcada desde `app/src/theme.ts`, más
la aclaración de que IBM Plex Mono está cargada pero sin usar en ninguna pantalla real todavía
— se agregó ahí a raíz de esta misma sesión, para que los próximos mockups no inventen valores.

Decisiones de diseño ya cerradas (no volver a preguntarlas):
- **Solo producto puntual por EAN en esta fase**, no categoría — el árbol de categorías no es
  el mismo entre los 7 supers (mismo estilo de texto, distinta granularidad/nombres), habría que
  resolver ese mapeo antes de que categoría dispare avisos de verdad.
- **Modo "Categorías" sí existe en la UI** (se puede elegir y queda guardado, banner "EN
  CAMINO"), pero no dispara nada del backend — es persistencia pura a futuro.
- **Interruptor único "Recibir notificaciones"**: activa/corta push y mail juntos, sin split por
  canal. Vive en `perfil_usuario.alertas_activas`.
- **Tope de 20 productos seguidos** por usuario, mostrado como "N de 20" en la UI y reforzado
  con un trigger en la base (no solo del lado del cliente).
- **NO es un resumen diario de mail** — se planteó esa alternativa durante el diseño (un mail
  agrupado una vez por día a las 9hs) y el usuario la descartó en esta misma sesión: prefiere
  enterarse en la misma corrida del cron (cada 1-2hs) en la que la promo se prendió. El "agrupado"
  que sí queda es horizontal (un solo mail/push por usuario por corrida con todo lo que se
  prendió en esa corrida), no temporal.
- **Confirmación al dejar de seguir** (pantallas 20f/20g): hoja modal "¿Dejar de seguir X?" con
  "Dejar de seguir" (primario) / "Seguir siguiéndolo" (secundario, cancela), sin toast de deshacer.

## Backend — qué se construyó

### Tablas nuevas (migraciones ya corridas en producción)

- **`supabase/migrations/0016_producto_seguido.sql`**: `producto_seguido` (`usuario_id`, `ean`,
  `nombre` desnormalizado, `huella_promo_avisada`, `unique(usuario_id, ean)`). Mismo patrón RLS
  que `push_suscripcion`: la app escribe/borra su propia fila directo contra Supabase, sin
  endpoint Express — a diferencia de `push_suscripcion`, sí tiene policy de `select` porque el
  usuario necesita ver/editar la lista.
- **`supabase/migrations/0017_alertas_resumen_y_categorias.sql`**: columna
  `perfil_usuario.alertas_activas` (boolean, default true); tabla `categoria_seguida`
  (`usuario_id`, `categoria`, mismo patrón RLS); trigger `tope_producto_seguido` que impide
  superar 20 filas por usuario en `producto_seguido`.

### Detección y aviso (backend/src/cron/diffCatalogos.js, backend/src/avisoProductosSeguidos.js, backend/src/cron/refrescarCatalogos.js)

- `estadoPromoPorEan(catalogo, superNombre)` en `diffCatalogos.js`: expone el estado ACTUAL (no
  un diff) de qué EAN tienen promo de producto en la corrida, con una `huella` (mismo formato
  que `huellaPromoSku`, ya existente para `scraper_diffs`) que identifica esa promo puntual.
  A propósito no cuenta `promosBancarias` (es de tarjeta/banco, no del producto).
- `refrescarCatalogos.js` arma `estadoActualPromoPorEan` leyendo del disco el catálogo de los 7
  supers DESPUÉS de que todos los scrapers terminaron (no en memoria del loop de cada scraper) —
  así, si un scraper falla en una corrida puntual, se usa igual el catálogo vigente (el de la
  corrida anterior) en vez de saltearse ese super. Un mismo EAN con promo en más de un super se
  resuelve por orden de `SCRAPERS` (primero que aparece, gana).
- **`avisoProductosSeguidos.js`** — el corazón de la idempotencia, y la parte que tuvo un bug
  real corregido en esta sesión (ver abajo). Lee TODAS las filas de `producto_seguido`, compara
  `estadoActualPromoPorEan.get(fila.ean)?.huella` contra `fila.huella_promo_avisada`:
  - Si difieren y hay promo activa → se agrega a la lista de esa `usuario_id` para avisar, se
    actualiza la huella.
  - Si no hay promo activa pero la fila tenía huella guardada → se resetea a `null` (para que la
    próxima vez que se prenda, sea la misma promo u otra, vuelva a avisar).
  - El interruptor `alertas_activas` se chequea ACÁ: si está apagado, no se manda nada Y TAMPOCO
    se actualiza la huella — así, si el usuario lo reactiva después, la promo que siga vigente en
    ese momento todavía le llega.
  - Push inmediato (`clientePush.js`) y mail inmediato (`clienteBrevo.js` + `plantillaMail.js`),
    agrupados en un solo envío por usuario por corrida — no uno por producto.

### Bug real encontrado por el usuario y corregido (importante para no reintroducirlo)

La primera versión (`productosConPromoNueva()`, ya no existe en el código) hacía un diff GLOBAL
contra la corrida anterior: solo disparaba si una promo pasaba de no-existir a existir en ESA
corrida. Eso se perdía el caso de alguien que empieza a seguir un producto que YA tenía promo
activa desde antes — esa transición global ya había pasado, nunca iba a volver a ocurrir, y esa
persona se quedaba sin avisar para siempre. El fix mueve la idempotencia de "¿esta promo es
nueva a nivel del catálogo?" a "¿ya le avisé a ESTE usuario de ESTA promo puntual?" (la huella
por fila explicada arriba). Ver memoria del proyecto:
`feedback_idempotencia-avisos-por-usuario-no-global.md` — el principio generaliza a cualquier
feature de "seguir X y que me avise", no es específico de esta.

## App — qué se construyó

- **`app/app/(tabs)/_layout.tsx`**: tab "Alertas" (ícono de campana) en el lugar de "Ahorros".
- **`app/src/alertas.ts`**: hooks `useProductosSeguidos()`, `useCategoriasSeguidas()`,
  `useAlertasActivas()` — todos hablan directo con Supabase vía `supabase-js` (mismo patrón que
  `plan.ts`/`push.ts`), no hay endpoint Express nuevo. Cada uno expone su propio `recargar()`.
- **`app/app/(tabs)/alertas.tsx`**: pantalla con tabs internas Productos/Categorías, el
  interruptor único (reusa `FilaToggleAnimada`, el mismo componente que ya usa "Recordatorio
  semanal" en Ajustes, en vez de crear un switch tipo píldora nuevo solo para esto), lista de
  seguidos con tinte amarillo (`paleta.ofertaSuave`/`paleta.oferta`, no un amarillo inventado) y
  contador "N de 20", banner "EN CAMINO" en modo Categorías. Usa `useFocusEffect` para
  recargar los 3 hooks al ganar foco (ver bug corregido abajo).
- **`app/app/seguir-producto.tsx`**: reusa `buscarProductos` de `api.ts` (mismo buscador que la
  pantalla Buscar, sin precio). Selección múltiple local (`Set<string>` de EANs elegidos) y un
  solo botón "Guardar" que hace el diff contra lo que ya seguía y llama `seguir()`/`dejarDeSeguir()`
  por cada cambio antes de volver.
- **`app/src/componentes/DejarDeSeguirHoja.tsx`**: hoja de confirmación (20f/20g), mismo patrón
  de `Modal` + overlay + hoja que `GuardarCarritoHoja.tsx`.
- **Ajustes reestructurado** (`app/app/(tabs)/ajustes.tsx`) en 3 grupos: TU ACTIVIDAD (fila "Mis
  ahorros" con chip amarillo "NUEVO ACÁ" → `app/app/mis-ahorros.tsx`, la vieja pantalla de la tab
  "Ahorros" movida acá con back button agregado), PREFERENCIAS ("Supers cerca tuyo", deshabilitado,
  chip gris "PRÓXIMAMENTE"), CUENTA (Datos personales → `app/app/datos-personales.tsx`, mail +
  cerrar sesión, antes inline; Suscripción → ya existía, es la fila de plan/pago; Ayuda →
  `app/app/ayuda.tsx`, tutorial + contacto, antes sueltos en el cuerpo). La sección
  "NOTIFICACIONES" (recordatorio semanal genérico, feature aparte de Alertas) no se tocó, sigue
  en el cuerpo de Ajustes tal cual estaba.
- **`app/src/api.ts`**: se agregó `categoriasCatalogo(accessToken)` — expone
  `GET /api/catalogo/categorias`, que ya existía en el backend pero no estaba wireado en el
  cliente.

### Bugs de UI encontrados probando en navegador (ya corregidos)

1. **Recuadro azul de foco** en el input de "Seguir un producto" — faltaba
   `outlineWidth: 0, outlineStyle: 'none'` (mismo fix que ya tiene el buscador de "Buscar").
2. **La tab Alertas no se refrescaba al volver** de "Seguir un producto" — las tabs de
   expo-router no se desmontan al cambiar de pestaña, así que el `useEffect` de carga inicial de
   cada hook no volvía a correr. Se agregó `useFocusEffect` en `alertas.tsx` llamando a los 3
   `recargar()`.
3. **Valores de diseño inventados** en vez de reusar patrones ya existentes: la flecha "‹" de
   volver tenía `fontSize: 28` (el real es 22), el label debajo tenía un gris/tracking propio (el
   real es blanco `opacity: 0.6`, `letterSpacing: 1.2`), y la tilde ✓ del checkbox no tenía
   tipografía definida (el real es `fuentes.semi`, 13px). Corregido en
   `seguir-producto.tsx`/`mis-ahorros.tsx`/`ayuda.tsx`/`datos-personales.tsx`/`alertas.tsx`.

## Bug real encontrado y corregido en `seguir-producto.tsx` (2026-09-11)

Probando el flujo end-to-end (seguir productos en distintas visitas a la pantalla, después
disparar `avisoProductosSeguidos.js` a mano): al guardar una segunda tanda de productos, la
tanda anterior desaparecía de `producto_seguido`. Causa: el `useEffect` que siembra
`eansElegidos` a partir de lo ya seguido tenía `[]` de dependencias — corría una sola vez, en el
primer render, cuando `useProductosSeguidos()` todavía no había terminado su fetch asíncrono
(arranca en `productos=[]`). Como nunca se re-ejecutaba con los datos reales, `eansElegidos`
quedaba vacío pese a que sí había productos seguidos; el diff de `guardar()` interpretaba eso
como "el usuario destildó todo lo anterior" y llamaba `dejarDeSeguir()` para cada uno. Fix:
sembrar recién cuando `cargando` (ya expuesto por el hook) pasa a `false`, con un `useRef` para
que sea una sola vez y no cada `recargar()` intermedio. Verificado con `tsc --noEmit` limpio;
no se re-probó en navegador después del fix en esta sesión.

## Chip de % de descuento en Alertas (2026-09-11)

Pedido por el usuario después de probar el flujo real: en la pantalla Alertas, cada producto
seguido muestra un chip amarillo con el `-N%` si tiene promo activa AHORA MISMO (no lo último
que se avisó por mail/push).

- **`backend/src/routes/productosSeguidos.js`** (nuevo): `POST /api/productos-seguidos/estado`
  (body `{ eans: string[] }`, tope 20, mismo criterio que `TOPE_PRODUCTOS_SEGUIDOS`). Reusa
  `estadoPromoPorEan()` de `cron/diffCatalogos.js` — el mismo cálculo que arma el mail/push de
  "promo nueva", no una segunda fuente de verdad. NO pega en vivo a los supers: solo lee los
  `catalogo-*.json` ya cacheados en disco, medido en ~70-140ms por pedido (7 archivos, ~20MB
  total) — insignificante para el patrón de uso (una consulta al abrir/enfocar la pantalla, no
  por producto). Se actualiza solo con cada corrida de `refrescarCatalogos.js`: no hay cache
  intermedio que haya que invalidar a mano, cada pedido lee el archivo vigente en ese momento.
  Requiere sesión + plan activo, igual que el resto de `/api/catalogo/*`. Montado en
  `server.js` junto al resto de rutas sin el rate limit estricto de `/comparar`/`/precios`
  (no hace fetch en vivo a los supers, no hace falta protegerlo igual).
- **`app/src/api.ts`**: `estadoProductosSeguidos(eans, accessToken)`, mismo patrón que `precios()`.
- **`app/app/(tabs)/alertas.tsx`**: pide el estado cada vez que cambia la lista de seguidos,
  chip con el mismo patrón visual que "NUEVO ACÁ" de Ajustes (`paleta.oferta`/`ofertaTinta`,
  `texto.micro`, `radio.chip`).
- Probado por HTTP con sesión real de la cuenta de prueba (login vía `signInWithPassword`,
  `tsc --noEmit` limpio) — **no verificado todavía visualmente en el navegador**, falta abrir
  la pantalla Alertas y confirmar que el chip se ve bien.
- Si un EAN tiene promo en más de un super, gana el primero según el orden de `CATALOGOS`
  (mismo orden que `SCRAPERS` en `refrescarCatalogos.js`: Vea, Carrefour, Chango Más, Día,
  Jumbo, Disco, Coto) — mismo criterio ya documentado para el mail/push.

## Verificado en vivo (2026-09-10, cuenta de prueba, navegador real)

Con backend (`node src/server.js`) y Expo web corriendo local: seguir un producto desde la
búsqueda, verlo aparecer en Alertas con tinte amarillo, la hoja de confirmación al destildar,
modo Categorías (89 categorías raíz reales del catálogo — ver "Pendiente" abajo), y las 3
pantallas nuevas de Ajustes. Se probó `tsc --noEmit` sin errores en cada iteración. Los datos de
prueba se limpiaron al terminar (0 productos, 0 categorías en la cuenta de prueba).

**No probado todavía:** mail/push real disparándose desde `refrescarCatalogos.js` (necesitaría
esperar una corrida real de cron con un producto seguido que tenga promo, o forzarlo a mano);
notificación push nativa en un teléfono real (memoria: Huawei sin GMS no recibe push en
absoluto, Samsung/Xiaomi pueden demorarla).

## Pendiente para retomar

1. **Decidir si pushear.** El usuario dijo explícitamente que no lo quiere en producción
   todavía — antes de hacer `git add`/`commit`/`push`, confirmar con él.
2. **Confirmar `BREVO_*`/`VAPID_*` en el `.env` de la VM** — ya deberían estar cargadas desde los
   tipos 2-7 de mail, pero no se re-verificó en esta sesión específicamente para este flujo.
3. **Probar el envío real** de mail/push disparado por `refrescarCatalogos.js` con una promo real
   (no solo la UI de seguir/dejar de seguir).
4. **Fase futura, no bloqueante — activar categorías**: requiere resolver el mapeo entre los
   árboles de categoría de los 7 supers (hoy `categoriasCatalogo()` devuelve 89 categorías raíz
   sin deduplicar entre supers, ej. "Perfumería" y "Perfumería y farmacia" separadas — se probó
   en vivo y es una lista larga, esperable dado que no hay normalización todavía).
5. **Opcional, no pedido**: el push de ejemplo en el mockup 20e combinaba "35% off" (promo de
   producto) con "Banco Nación" (promo bancaria) en el mismo mensaje — se decidió A PROPÓSITO no
   implementar esa combinación (mostrar solo el % y precio del producto, sin cruzar con las
   tarjetas del usuario) porque es una pieza bastante más compleja aparte. Si en algún momento se
   quiere ese cruce, es trabajo nuevo, no un ajuste chico.

## Archivos tocados en esta sesión (para ubicarse rápido)

Backend: `backend/src/cron/diffCatalogos.js`, `backend/src/cron/refrescarCatalogos.js`,
`backend/src/avisoProductosSeguidos.js` (nuevo), `backend/src/cron/resumenMensualAhorro.js` y
`resumenSemanalAhorro.js` (solo el link `/ahorros` → `/mis-ahorros` en el CTA del mail),
`supabase/migrations/0016_producto_seguido.sql` y `0017_alertas_resumen_y_categorias.sql`
(nuevos, ya corridos).

App: `app/app/(tabs)/_layout.tsx`, `app/app/(tabs)/alertas.tsx` (nuevo), `app/app/(tabs)/ajustes.tsx`,
`app/app/seguir-producto.tsx` (nuevo), `app/app/mis-ahorros.tsx` (nuevo, reemplaza a
`app/app/(tabs)/ahorros.tsx`, borrado), `app/app/datos-personales.tsx` (nuevo),
`app/app/ayuda.tsx` (nuevo), `app/src/alertas.ts` (nuevo), `app/src/api.ts` (agregado
`categoriasCatalogo`), `app/src/componentes/DejarDeSeguirHoja.tsx` (nuevo).
