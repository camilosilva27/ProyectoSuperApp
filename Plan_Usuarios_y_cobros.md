# Cuentas de usuario + DB (fase 1: sync entre dispositivos)

## Contexto

Hoy la app (Expo/React Native en `app/`, backend Express stateless en una VM de GCP) no tiene ningún concepto de usuario: carrito, tarjetas propias y listas guardadas viven 100% en `AsyncStorage` del dispositivo (`app/src/carrito.tsx`, `carritosGuardados.tsx`, `filtrosSupers.tsx`). Fue una decisión consciente al principio ("no hace falta para la primera versión", comentario en `carrito.tsx`), pero surgió de una conversación sobre seguridad: al pensar en abrir la app más allá del círculo familiar y eventualmente cobrarla, quedó claro que hace falta backend de usuarios antes de poder hacer cualquiera de las dos cosas.

Esta fase se limita a **sync entre dispositivos** (llevar carrito/tarjetas/listas guardadas entre el celular y la web) para quien decida crear una cuenta. Nadie está obligado a registrarse: el modo anónimo actual sigue funcionando exactamente igual para quien no lo haga. El gating (cuenta obligatoria, tiers de pago) es una fase futura, deliberadamente **no implementada ahora** — se documenta al final para que el diseño de esta fase no quede reñido con eso después.

Decisiones ya tomadas (no reabrir): Supabase como proveedor de auth+DB (Postgres + Auth integrados, evita sumar un ORM/DB propio al Express que hoy no tiene ninguno), y frontend hablando **directo** con Supabase (no proxeado por el Express existente) — es el patrón idiomático de Supabase, y el Express no tiene hoy ninguna razón de negocio para intermediar datos de cuenta.

## Arquitectura

**Dos backends con responsabilidades separadas, sin fricción entre sí:**
- Express (VM GCP, sin cambios de infra) sigue resolviendo comparar/precios/catálogo — no se toca para esta fase.
- Supabase (nuevo, servicio gestionado) resuelve auth + los 3 dominios de datos personales, hablado directo desde `app/` vía `supabase-js`.

El frontend termina con dos clientes HTTP distintos, cada uno para su dominio: `app/src/api.ts` (ya existe, sin cambios) para comparar/precios, y un `app/src/supabase.ts` nuevo para cuentas y datos personales.

### Esquema Postgres (Supabase)

- **`perfil_usuario`** — 1 fila por usuario (`id` = `auth.users.id`): `carrito_items jsonb`, `carrito_tarjetas text[]`, `supers_activos text[]`. Refleja que estos 3 campos ya se tratan como blobs reescritos enteros (igual que hoy en AsyncStorage) — no amerita tablas separadas por dominio.
- **`carrito_guardado`** — 1 fila por lista guardada: `id uuid default gen_random_uuid()`, `usuario_id uuid` (FK a `auth.users`), `nombre text`, `items jsonb`, `guardado_en timestamptz`. Filas reales (no un array en una sola columna) porque se necesita poder borrar/renombrar una lista sin reescribir todo el array — mapea 1:1 con el tipo `CarritoGuardado` que ya existe en `carritosGuardados.tsx`.
- **RLS** en ambas tablas: política estándar `usuario_id = auth.uid()` (o `id = auth.uid()` en `perfil_usuario`) para select/insert/update/delete. Este es el único perímetro de seguridad — no hay backend propio revisando permisos.

### Migración de datos locales → cuenta

Al crear cuenta o loguearse por primera vez con datos locales no vacíos: si el servidor no tiene nada todavía (`perfil_usuario` recién creado, sin filas en `carrito_guardado`), subir el contenido de AsyncStorage entero como estado inicial, sin preguntar — es el caso obvio (usuario existente de la familia que recién se registra) y evita pérdida de datos sin agregar UI de conflicto. Si el servidor ya tenía datos (el usuario ya se había sincronizado antes desde otro dispositivo), el servidor gana y el local se descarta — ese caso de conflicto real (dos dispositivos con datos distintos) se deja para más adelante si aparece en la práctica; no vale la pena resolverlo de antemano a esta escala.

### Integración en el frontend

Nuevo `AuthProvider` en `app/app/_layout.tsx`, **envolviendo** a los tres providers existentes (necesitan saber si hay sesión antes de decidir su fuente de datos):

```
<QueryClientProvider>
  <SafeAreaProvider>
    <AuthProvider>                    {/* nuevo */}
      <ProveedorFiltrosSupers>
        <ProveedorCarrito>
          <ProveedorCarritosGuardados>
            ...
```

Los 3 providers existentes **no se reescriben** — conservan el mismo `useReducer`/estado interno que ya tienen. Se factoriza únicamente la hidratación/persistencia (hoy hablan solo con `AsyncStorage`) en un hook compartido nuevo, algo como `useSincronizacionPersistente(clave, estado, despachar, { anonimo, logueado })`, que decide con `if (session) ... else ...` (leyendo `useAuth()` del nuevo `AuthProvider`) contra qué fuente hidratar/persistir. Esto evita duplicar lógica de reducción en los 3 archivos, y concentra el "AsyncStorage vs Supabase" en un solo lugar reusable. La migración del punto anterior corre una sola vez dentro de ese hook, al detectar la transición anónimo→logueado.

`app/app/(tabs)/ajustes.tsx` (hoy placeholder explícito, sin diseñar) es el lugar natural para login/registro/logout — cero fricción para insertar el flujo de auth ahí.

## Archivos a tocar

- `app/app/_layout.tsx` — agregar `AuthProvider` envolviendo a los 3 providers existentes.
- `app/src/supabase.ts` (nuevo) — cliente de Supabase, inicialización con URL/anon key.
- `app/src/carrito.tsx`, `carritosGuardados.tsx`, `filtrosSupers.tsx` — reemplazar los `useEffect` de hidratación/persistencia por el hook compartido nuevo; el reducer/estado interno no cambia.
- `app/app/(tabs)/ajustes.tsx` — UI de login/registro/logout.
- Backend Express: **sin cambios** en esta fase.
- Supabase (fuera del repo, vía dashboard/migraciones SQL): tablas `perfil_usuario` y `carrito_guardado` + políticas RLS.

## Riesgo a anotar: pausa por inactividad del free tier de Supabase

El free tier pausa el proyecto tras **7 días** sin actividad (corregido 2026-08-19 contra la documentación oficial de Supabase — este doc decía 30 días, dato viejo/incorrecto; no se reactiva solo con tráfico normal, hay que entrar al dashboard o hacer un request explícito que lo despierte). Mitigante simple: un ping periódico externo (ej. un cron de GitHub Actions, o sumarlo al cron que ya corre en la VM de GCP) que golpee Supabase **al menos una vez por semana**, con margen, para mantenerla activa. El resto de límites del free tier (500MB DB, 1GB storage, 5GB egress, 50k MAU, 500k invocaciones de Edge Functions, 200 conexiones Realtime, 2 proyectos activos, requests de API ilimitados) están muy por encima de lo que esta app necesita incluso en un lanzamiento público moderado — el upgrade a Pro (US$25/mes) tiene sentido recién cuando haya un lanzamiento real, para eliminar la pausa y tener backups automáticos, no por límite de cuota.

## Proveedor de mail (SMTP) para Auth — decidido, no configurado todavía

El mailer que trae Supabase por defecto manda como mucho **2 mails por hora** (confirmado contra la documentación oficial, 2026-08-19) — se comparte entre todos los proyectos gratuitos de Supabase, así que el límite bajo es a propósito, no un bug. Ya lo tocamos en la práctica: dos registros de prueba seguidos alcanzaron para que el tercero tirara `over_email_send_rate_limit`.

**Decisión (2026-08-19, todavía no implementada):** cuando haga falta más volumen, el proveedor va a ser **Resend** — plan gratis, $0/mes, 3.000 mails/mes con tope de 100/día, dominio propio incluido (hasta 3). Se prefirió sobre Brevo (300/día, más volumen) por ser más simple de integrar y más usado en el ecosistema Supabase/Next.js — a la escala de esta app (confirmaciones de registro + algún reset de contraseña, nada de marketing masivo) 100/día alcanza sobrado.

Mientras tanto, se sigue probando con el mailer default de Supabase — el límite de 2/hora ya obliga a espaciar las pruebas de registro, pero no bloquea nada de lo que ya está construido.

**Nota aparte (mismo remitente):** el remitente ("From") de los mails de Auth no se puede personalizar sin SMTP propio — queda fijo en `noreply@mail.app.supabase.io` con el mailer default, pase lo que pase en Email Templates. Es otra razón más para configurar Resend cuando se decida hacerlo, además del volumen.

## Pendiente: que el link de confirmación deje logueado directo

Probado en vivo (2026-08-19): el link de confirmación de mail hoy **no** loguea automáticamente — el mail llega, confirma la cuenta, pero el usuario tiene que volver a la app e iniciar sesión a mano. Investigado cómo arreglarlo, decidido posponerlo:

- Supabase usa el flujo **PKCE** por default: al confirmar, redirige al Site URL configurado con un `?code=...` en la URL, pero no establece sesión solo.
- Para que sí quede logueado directo hace falta: (a) configurar Site URL / Redirect URLs en el dashboard para que apunten a la app real (`http://localhost:8081` en dev, el dominio de producción después), y (b) agregar código nuevo en la app que detecte ese `code` en la URL al cargar y llame a `supabase.auth.exchangeCodeForSession(code)` — no es un toggle del dashboard, es una feature chica para construir.
- El asunto y el cuerpo del mail sí se pueden personalizar ya, sin esto — Authentication → Email Templates en el dashboard, sin código de por medio.

## Verificación fase 1 — completa (2026-08-19)

Fase 1 implementada y verificada de punta a punta, con una cuenta real (no solo con un usuario de prueba descartable):

1. ✅ Usuario anónimo sigue viendo su carrito/tarjetas/listas guardadas funcionando exactamente igual que antes (sin sesión, todo sigue en AsyncStorage).
2. ✅ Registro con datos locales existentes: migraron a Supabase (confirmado por SQL contra `perfil_usuario`/`carrito_guardado`) sin perder nada.
3. ✅ Segundo dispositivo/navegador con la misma cuenta: mismo carrito/tarjetas/supers — sync real confirmado por el usuario.
4. ✅ Cerrar sesión no borra lo que había local antes de loguearse — confirmado por el usuario.
5. ✅ RLS bloquea acceso cruzado entre usuarios (probado con un usuario de prueba descartable, creado y borrado en la misma verificación — el `on delete cascade` limpió perfil y listas correctamente).
6. Backend Express: no se tocó en toda esta fase — sin re-verificar explícitamente, pero no hay ningún cambio que pudiera haberlo afectado.

Pendiente, no bloqueante (ver arriba): configurar Resend, y que el link de confirmación de mail deje logueado directo (PKCE).

---

# Fase 2: cuenta obligatoria + trial + cobro (Mercado Pago)

Depende de que fase 1 ya esté implementada (necesita `AuthProvider`, el login/registro en `ajustes.tsx`, y la migración local→cuenta ya funcionando). Esta fase no vuelve a tocar eso — lo que agrega es (a) volver la cuenta obligatoria en vez de opt-in, y (b) el cobro en sí.

## Decisiones tomadas para esta fase

- **Qué es premium**: todavía no está decidido, y **a propósito no se decide ahora**. Esta fase construye el mecanismo (trial, downgrade automático, chequeo de plan) sin atarlo a ninguna feature concreta — cuando se decida qué limitar (candidatos: topes de uso como cantidad de listas guardadas/historial, o features nuevas que nazcan directo como premium), se conecta al mecanismo ya existente sin tocar la arquitectura de cobro.
- **Modelo**: trial-first. Todo usuario nuevo arranca con 30 días de acceso premium; al vencer, si no se suscribió, cae automáticamente al tier gratis. Es el mismo estado estable que un freemium directo (cuenta obligatoria + gratis + premium) — la única diferencia es que el registro arranca "arriba" en vez de "abajo".
- **Pasarela**: Mercado Pago, vía su API de **Suscripciones** (`preapproval`) — cobro recurrente mensual, estándar de facto en Argentina.

## Cambio de UX: cuenta deja de ser opcional

Hoy (fase 1) cualquiera usa la app sin cuenta. En esta fase, al arrancar la app se chequea si hay sesión; si no hay, se bloquea con una pantalla de login/registro obligatoria (reutiliza el mismo `AuthProvider`/flujo de `ajustes.tsx` de fase 1 — solo cambia el punto donde se exige: de "opcional en Ajustes" a "gate en el arranque"). La migración local→cuenta de fase 1 sigue siendo la puerta de entrada para quien ya tenía datos anónimos.

## Datos: extender `perfil_usuario`

Nuevas columnas (no una tabla nueva — es estado 1:1 con el usuario, igual que el resto de `perfil_usuario`):

- `plan text not null default 'trial'` — valores `'trial' | 'premium' | 'gratis'`.
- `trial_termina_en timestamptz` — seteado a `now() + interval '30 days'` en el momento del registro.
- `mercadopago_suscripcion_id text` — id de la suscripción en MP, null hasta que el usuario paga.
- `suscripcion_estado text` — espejo del estado que manda MP (`authorized`/`paused`/`cancelled`/etc.), para reconciliar con los webhooks.

**Downgrade automático del trial**: un job `pg_cron` (extensión ya disponible en Supabase, corre dentro de la misma DB — no es infra nueva que operar) una vez al día: `update perfil_usuario set plan='gratis' where plan='trial' and trial_termina_en < now() and mercadopago_suscripcion_id is null`. Si el usuario se suscribió durante el trial, el webhook de MP ya puso `plan='premium'` antes de que este job corra, así que no lo toca.

## Cobro: Mercado Pago Suscripciones

- **Alta de suscripción**: nueva ruta `POST /api/pagos/suscripcion` en el Express existente (requiere sesión — ver validación de JWT abajo). Llama a la API de Preapproval de MP para crear la suscripción del usuario y devuelve la URL de checkout (`init_point`) al frontend, que la abre con `Linking.openURL` (es un checkout hosteado por MP, no se maneja ninguna tarjeta en la app — mismo principio de seguridad que ya hablamos: nunca tocar número de tarjeta propio).
- **Webhook**: nueva ruta pública `POST /api/webhooks/mercadopago` en el Express existente — MP le pega directo cuando cambia el estado de una suscripción (autorizada, pausada, cancelada). Verifica la firma del webhook (header que manda MP) y, si es válida, actualiza `perfil_usuario` (plan, `suscripcion_estado`, `mercadopago_suscripcion_id`) usando el cliente de Supabase con la **service role key** (server-side, bypasea RLS legítimamente porque es el propio backend actuando, no un usuario) — no hace falta sumar `pg` como dependencia nueva, se reusa `@supabase/supabase-js` con esa key.
- Ambas rutas nuevas viven en el Express de la VM, no en Supabase Edge Functions — evita sumar Deno/Edge Functions como pieza nueva a operar cuando ya existe un backend Node corriendo.

## Chequeo de plan en el Express (para cuando exista una feature gateada)

Como todavía no hay ninguna feature específica atrás del gate, esta fase deja lista la mecánica, no el gate en sí:

- **Evitar una consulta a la DB en cada request** de rutas calientes como `/api/comparar`: en vez de que el Express consulte `perfil_usuario` por request, se usa un **Auth Hook de Supabase** ("Customize Access Token") — una función Postgres que inyecta el campo `plan` directo en el JWT cuando se emite/refresca. El Express ya va a estar verificando ese JWT localmente (con `jsonwebtoken` o `jose`, sin llamar a la red de Supabase — ver nota de fase 1), así que leer `plan` es gratis, ya está en el token decodificado.
- **Trade-off a anotar**: el JWT se refresca cada tanto (no en cada request), así que un downgrade (trial vencido, suscripción cancelada) puede tardar hasta el tiempo de vida del token en reflejarse en el chequeo del backend. Para esta app (no es un paywall de alto riesgo) es aceptable.
- **Beneficio que esto destraba, ya identificado en la conversación de seguridad**: hoy `/api/comparar` no tiene ningún token porque "no hay dónde guardar un secreto" — con cuentas obligatorias, eso deja de ser cierto. Cuando se implemente el gate real, exigir el JWT en `/api/comparar`/`/api/precios` cierra el hueco de "cualquiera puede usar el backend como proxy gratis hacia los 5 supers" que quedó anotado como riesgo aceptado en su momento. Además, el rate limiting podría pasar a ser por usuario en vez de por IP, más preciso que hoy.

## Archivos a tocar (fase 2)

- `app/app/_layout.tsx` (o un wrapper nuevo) — gate de sesión obligatoria al arrancar.
- `app/app/(tabs)/ajustes.tsx` — mostrar plan actual / días de trial restantes, botón "actualizar a premium" (dispara `POST /api/pagos/suscripcion` y abre el checkout de MP), botón cancelar suscripción.
- `backend/src/routes/pagos.js` (nuevo) — `POST /api/pagos/suscripcion`.
- `backend/src/routes/webhookMercadoPago.js` (nuevo) — `POST /api/webhooks/mercadopago`.
- `backend/package.json` — sumar `mercadopago` (SDK oficial) y `@supabase/supabase-js` (para el cliente con service role key) como dependencias nuevas.
- Supabase: columnas nuevas en `perfil_usuario`, el Auth Hook de custom claims, y el job de `pg_cron`.

## Verificación fase 2 (para cuando se implemente)

1. Registrar un usuario nuevo → confirmar `plan='trial'` y `trial_termina_en` ~30 días adelante.
2. Simular vencimiento (adelantar `trial_termina_en` a mano en la DB) → correr el job de `pg_cron` manualmente → confirmar que pasa a `plan='gratis'`.
3. Completar un pago de prueba en el sandbox de Mercado Pago → confirmar que el webhook llega, la firma valida, y `plan` pasa a `'premium'` con `mercadopago_suscripcion_id` seteado.
4. Cancelar la suscripción de prueba en MP → confirmar que el webhook de cancelación baja el plan correctamente.
5. Decodificar el JWT que devuelve Supabase después del Auth Hook → confirmar que el claim `plan` está presente y coincide con la fila de `perfil_usuario`.
6. Intentar usar la app sin sesión (logout completo) → confirmar que el gate de login bloquea, sin excepciones.

---

# Feature candidata: "cuánto ahorraste" (histórico + gancho de fin de trial)

Surgió de una sesión de brainstorming aparte, pero se documenta acá porque es un candidato natural para llenar el hueco que fase 2 deja **a propósito** sin decidir ("qué es premium"). No es una decisión tomada de qué gatea el plan pago — es una feature que, una vez lista, puede conectarse a ese mecanismo.

## Idea central

Al vencer el trial de 30 días (fase 2), en vez de una pantalla de pago genérica, mostrar algo personal: *"Ahorraste $50k este mes de prueba. Por $10k al mes, podés seguir ahorrándolo."* Además de ese momento puntual, un historial navegable (este mes, mes pasado, total) de cuánto fue ahorrando el usuario con la app.

## Decisiones tomadas en esta sesión

- **Qué cuenta como "ahorro"**: cada vez que el usuario ve el resultado de una comparación (`app/app/resultado.tsx`), aunque no confirme que compró ahí. Se eligió por sobre exigir una confirmación explícita de compra porque esa fricción iba a dejar muy pocos datos (la mayoría no vuelve a marcar "compré esto"). Trade-off aceptado: el número es "ahorro potencial visto", no "ahorro real confirmado".
- **Mitigación al trade-off anterior** (agregada al revisar la idea): si alguien prueba la app mucho sin comprar (comparaciones de prueba), el número de ahorro se infla sin que haya compra real detrás. Para que esto no sea engañoso, el historial va a mostrar **también la cantidad de comparaciones contadas**, no solo el monto (ej. "Ahorraste $50k en 12 comparaciones"). Así el usuario mismo puede juzgar si el número refleja uso real o solo curioseo — es transparencia, no una solución que evite el problema de fondo, pero evita que el número se sienta inflado sin explicación.
- **Cuándo arrancar a trackear**: ya, en local (`AsyncStorage`), sin esperar a fase 1. Mismo patrón que `carrito.tsx`/`carritosGuardados.tsx` — un módulo nuevo (propuesta: `app/src/historialAhorro.ts`) que guarda eventos `{fecha, monto, superGanador}` y se engancha en `resultado.tsx` cada vez que se calcula un resultado nuevo. Deduplicar por hash del carrito + día para no contar el mismo carrito dos veces si el usuario entra y sale de la pantalla sin cambiar nada. Así, cuando fase 1/2 lleguen, ya hay ahorro acumulado real para mostrar en el momento del trial en vez de arrancar en cero.
- **Cómo se muestra el fin de trial**: pantalla bloqueante (paywall clásico, no se puede cerrar sin decidir), consistente con el downgrade automático que ya describe fase 2.

## Fases de implementación (mapeadas a lo que ya existe en este plan)

- **Fase A — ya, sin dependencias**: módulo local de tracking + pantalla "Mis ahorros" (total histórico, mes actual, mes pasado, cantidad de comparaciones contadas por período).
- **Fase B — depende de fase 1** (cuentas Supabase): migrar el historial local a una tabla nueva (`ahorro_registro`: usuario_id, fecha, monto, super) al loguearse, mismo patrón que la migración de `carrito_guardado` ya descripta arriba.
- **Fase C — depende de fase 2** (trial + Mercado Pago): al bajar `plan` de `'trial'` a `'gratis'`, la pantalla bloqueante suma el ahorro acumulado durante esos 30 días y muestra el mensaje con el CTA de suscripción.

## Pendiente

- **Fase A ya implementada** (corregido 2026-08-19, este doc estaba desactualizado): `app/src/historialAhorro.tsx` (tracking local) y la pestaña `app/app/(tabs)/ahorros.tsx` (diseño + código) ya están commiteados (`5674546`). También existe `app/src/componentes/PaywallFinTrial.tsx`, ya diseñada y codeada, pero **desactivada a propósito** — no está enrutada en ningún lado (sin `Stack.Screen`, nada la dispara) porque depende de que Fase 2 exista (`plan`/`trial_termina_en` en `perfil_usuario`). Lo único que falta de esta feature es la conexión real: cablear `PaywallFinTrial` como gate cuando Fase 2 esté lista.

---

## Pendientes sueltos

- **Logos de los supers**: hoy cada super se identifica solo con texto/color; falta sumar el logo oficial de cada uno en la UI (badges de precio, selector de supers, etc.). Legal: uso nominativo (mostrar el logo tal cual, sin editar, solo para identificar de qué super es ese precio) es la misma base legal que usan todos los comparadores de precios — bajo riesgo. Sube el riesgo si se lo usa editado/decorativo o si da a entender auspicio del super. Sumar un disclaimer tipo "los logos pertenecen a sus respectivos dueños, sin afiliación" al implementarlo.
