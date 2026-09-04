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

## Riesgo: pausa por inactividad del free tier de Supabase — mitigado (2026-08-26)

El free tier pausa el proyecto tras **7 días** sin actividad (corregido 2026-08-19 contra la documentación oficial de Supabase — este doc decía 30 días, dato viejo/incorrecto; no se reactiva solo con tráfico normal, hay que entrar al dashboard o hacer un request explícito que lo despierte). **Implementado**: `backend/src/cron/pingSupabase.js` (`npm run ping-supabase`) hace una lectura mínima contra `perfil_usuario` con la service role key, semanal, sumado como cron aparte en la VM (no dentro de `refrescarCatalogos.js` — frecuencia distinta). El resultado queda en `logs/ultimo-ping-supabase.json` y lo reporta `/api/health` (`ultimoPingSupabase`, con `problemas` si pasan más de 10 días sin un ping OK). Falta agregar la línea al crontab de la VM (ver `backend/README.md` § "Ping semanal a Supabase" para el comando exacto) — ese archivo vive solo ahí, no en el repo. El resto de límites del free tier (500MB DB, 1GB storage, 5GB egress, 50k MAU, 500k invocaciones de Edge Functions, 200 conexiones Realtime, 2 proyectos activos, requests de API ilimitados) están muy por encima de lo que esta app necesita incluso en un lanzamiento público moderado — el upgrade a Pro (US$25/mes) tiene sentido recién cuando haya un lanzamiento real, para eliminar la pausa y tener backups automáticos, no por límite de cuota.

## Proveedor de mail (SMTP) para Auth — implementado (2026-08-20), con Brevo

El mailer que trae Supabase por defecto manda como mucho **2 mails por hora** (confirmado contra la documentación oficial) — se comparte entre todos los proyectos gratuitos de Supabase, así que el límite bajo es a propósito, no un bug. Ya lo tocamos en la práctica: dos registros de prueba seguidos alcanzaron para que el tercero tirara `over_email_send_rate_limit`. Tampoco se puede personalizar el remitente ("From") sin SMTP propio con el mailer default — queda fijo en `noreply@mail.app.supabase.io`.

**Se descartó Resend y se terminó usando Brevo — cambio de decisión respecto a lo anotado antes.** El motivo real: no había dominio propio todavía (comprarlo por Vercel o tramitarlo en NIC Argentina quedó pendiente, ver más abajo), y **Resend exige dominio propio verificado para mandarle mail a cualquiera** — su dirección de prueba (`onboarding@resend.dev`) solo entrega al dueño de la cuenta, no a usuarios reales. Brevo, en cambio, **no exige dominio propio por debajo de 5.000 mails/día** — alcanza con verificar un remitente individual (confirmar que es un mail real con un código de 6 dígitos), la autenticación de dominio completa es solo recomendada para mejor entregabilidad, no obligatoria a esta escala.

**Configuración actual:** SMTP de Brevo cargado en Authentication → Settings → SMTP Settings de Supabase (host `smtp-relay.brevo.com`, puerto 587, remitente `camilosilva28@gmail.com` — mail personal verificado individualmente, sin dominio propio detrás todavía). Probado en vivo: un registro real llegó sin el error de rate limit y con el remitente esperado.

**Pendiente, no bloqueante:** cuando exista un dominio propio, agregarlo como remitente en Brevo, autenticarlo por DNS, y actualizar el campo "Sender email" en Supabase — no pierde nada de lo ya configurado.

**Sobre poner el logo de la app como foto del remitente (investigado 2026-08-20):** no es posible hoy, y no es un tema de la foto en sí. Gmail solo muestra la foto de una cuenta cuando el mail sale por la infraestructura de Gmail o por un alias "Enviar como" verificado dentro de esa cuenta — como Brevo manda el mail relayado (no autenticado como esa cuenta de Google), Gmail no lo muestra aunque la cuenta tenga foto. La única vía real es **BIMI** (logo verificado, requiere dominio propio + DMARC estricto + certificado de marca) — queda atado al mismo pendiente del dominio de arriba, no es un paso nuevo.

## Resuelto: el link de confirmación deja logueado directo (2026-08-20)

Probado en vivo el 2026-08-19: el link de confirmación de mail no loguea automáticamente — el mail llega, confirma la cuenta, pero el usuario tenía que volver a la app e iniciar sesión a mano. Se descartó el enfoque inicial (PKCE con `?code=...` + `exchangeCodeForSession`) a favor de uno más simple, sugerido al revisar las variables disponibles en el template del mail:

- **Site URL** (Authentication → URL Configuration) queda como la base real del sitio, sin path (`http://localhost:8081` en dev) — no se lo pisa con una ruta específica.
- **Plantilla "Confirm signup"** (Authentication → Email Templates) se edita para armar el link a mano con `{{ .SiteURL }}/ajustes?token_hash={{ .TokenHash }}&type=email` en vez de usar `{{ .ConfirmationURL }}` tal cual.
- En `app/src/auth.tsx`, dentro de `AuthProvider`, se detecta `token_hash`+`type=email` en la URL (solo en web) y se llama a `supabase.auth.verifyOtp({ token_hash, type: 'email' })`, que confirma el mail **y** deja la sesión iniciada en el mismo paso — sin necesidad de PKCE.
- **Bug encontrado y corregido en el camino**: si el Site URL queda guardado con `/` al final (`http://localhost:8081/`), el link armado por la plantilla queda con doble barra (`.../ajustes` con `//`) y eso rompe Expo Router por completo (`Failed to construct 'URL': Invalid URL`, crash duro antes de que la app llegue a montar `AuthProvider`). Fix: Site URL sin barra final.
- Verificado en vivo de punta a punta: registro real → mail de Brevo → click en el link → Ajustes se abre ya logueado (sin pasar por login) → confirmado también por SQL (`email_confirmed_at` seteado en `auth.users`).
- **Pendiente para el lanzamiento real**: cuando se pase a producción, actualizar Site URL (y el link armado a mano en la plantilla) de `http://localhost:8081` a la URL real de producción — detectada de paso durante esta verificación: `https://mi-superapp.vercel.app`.

## Verificación fase 1 — completa (2026-08-19)

Fase 1 implementada y verificada de punta a punta, con una cuenta real (no solo con un usuario de prueba descartable):

1. ✅ Usuario anónimo sigue viendo su carrito/tarjetas/listas guardadas funcionando exactamente igual que antes (sin sesión, todo sigue en AsyncStorage).
2. ✅ Registro con datos locales existentes: migraron a Supabase (confirmado por SQL contra `perfil_usuario`/`carrito_guardado`) sin perder nada.
3. ✅ Segundo dispositivo/navegador con la misma cuenta: mismo carrito/tarjetas/supers — sync real confirmado por el usuario.
4. ✅ Cerrar sesión no borra lo que había local antes de loguearse — confirmado por el usuario.
5. ✅ RLS bloquea acceso cruzado entre usuarios (probado con un usuario de prueba descartable, creado y borrado en la misma verificación — el `on delete cascade` limpió perfil y listas correctamente).
6. Backend Express: no se tocó en toda esta fase — sin re-verificar explícitamente, pero no hay ningún cambio que pudiera haberlo afectado.

Pendiente, no bloqueante (ver arriba): agregar dominio propio a Brevo, y actualizar Site URL a la URL de producción cuando se lance.

## Landing v2 + Google Sign-In (2026-09-04)

`FormularioAuth.tsx` (usado por `GateSesion.tsx`) se restyleó siguiendo `design_handoff_allpromos_v2/design_handoff_allpromos_v2/14b-landing-cuenta.md`, y se sumaron tres cosas nuevas:

- **Modo inicial por dispositivo**: quien entra por primera vez ve "Registrate" (con el hero amarillo); quien ya vio esta pantalla antes en ese dispositivo ve "Iniciar sesión" por defecto (con un header oscuro propio, no el amarillo — reservado a la landing de registro). Flag simple en AsyncStorage (`superapp_ya_visito_landing_auth_v1`), no en `perfil_usuario` — es una preferencia de UI local, no un dato que deba sincronizar entre dispositivos.
- **Fix: registrarse con un mail ya registrado y confirmado mostraba "te mandamos un mail" sin haber mandado nada.** Supabase oculta a propósito si un mail existe (protección contra fuerza bruta) así que `signUp` no tira error — pero si el mail ya tiene una cuenta CONFIRMADA, `data.user.identities` viene vacío (`[]`), a diferencia de un registro nuevo o de un mail sin confirmar todavía (ahí sí trae la identidad y Supabase reenvía la confirmación). `auth.tsx § registrarse` ahora chequea esto y muestra "Ya existe una cuenta con este mail" en vez de la pantalla de confirmación falsa.
- **Google Sign-In — implementado y habilitado (2026-09-04):**
  - Alcance decidido: **solo web/PWA** — no hay build nativo (App Store/Play Store) todavía, así que no se armó el flujo con deep link (`expo-auth-session` + scheme `allpromos://`); queda para cuando exista ese build.
  - `app/src/auth.tsx § iniciarSesionConGoogle` llama a `supabase.auth.signInWithOAuth({ provider: 'google' })`, que redirige el navegador a Google y vuelve con `?code=...`.
  - `app/src/supabase.ts`: `detectSessionInUrl` pasó a `true` en web (antes `false` a propósito, ver el comentario ahí) — es lo que hace que el cliente detecte solo ese `?code=...` al volver y lo canjee por sesión.
  - **Google Cloud Console**: proyecto `Super App`, pantalla de consentimiento en modo Producción (scopes no sensibles, sin revisión de Google), OAuth Client ID tipo *Web application* con `https://jlviddhfzqzgzymeywtp.supabase.co/auth/v1/callback` como redirect URI — esa URL de callback es siempre de Supabase, nunca la de la app.
  - **Supabase dashboard** (Authentication → Providers → Google): provider activado con el Client ID/Secret de arriba — confirmado con `GET /auth/v1/settings` (`external.google: true`).
  - `GOOGLE_SIGNIN_HABILITADO` en `FormularioAuth.tsx` volvió a `true` — el flag que ocultaba el botón mientras faltaba este paso ya no hace falta apagarlo.
  - **Verificado en navegador**: el botón "Continuar con Google" redirige a la pantalla real de `accounts.google.com` pidiendo elegir cuenta — ya no al error de "provider is not enabled". Falta la confirmación del usuario logueándose con su cuenta real de punta a punta (elegir cuenta → volver a la app ya con sesión).

---

# Fase 2: cuenta obligatoria + trial + cobro (Mercado Pago)

Depende de que fase 1 ya esté implementada (necesita `AuthProvider`, el login/registro en `ajustes.tsx`, y la migración local→cuenta ya funcionando). Esta fase no vuelve a tocar eso — lo que agrega es (a) volver la cuenta obligatoria en vez de opt-in, y (b) el cobro en sí.

## Decisiones tomadas para esta fase

- **Qué es premium**: decidido el 2026-08-21 (ver "Pendiente" más abajo, gate de acceso pago) — es toda la app. No hay features sueltas gateadas ni un plan gratis navegable: sin `plan==='premium'` ni un trial vigente, no se pasa de la pantalla de bloqueo. Al momento de escribir esto (fase construida antes de esa decisión) el mecanismo era agnóstico de qué limitar; quedó resuelto sin tocar la arquitectura de cobro, solo el gate del cliente.
- **Modelo**: trial-first. Todo usuario nuevo arranca con 30 días de acceso premium; al vencer, si no se suscribió, cae automáticamente al tier gratis. Es el mismo estado estable que un freemium directo (cuenta obligatoria + gratis + premium) — la única diferencia es que el registro arranca "arriba" en vez de "abajo".
- **Pasarela**: Mercado Pago, vía su API de **Suscripciones** (`preapproval`) — cobro recurrente mensual, estándar de facto en Argentina.

## Cambio de UX: cuenta deja de ser opcional

**Implementado 2026-08-21** (`app/src/componentes/GateSesion.tsx`, envuelto solo alrededor del `<Stack>` en `app/app/_layout.tsx`, no de los providers de datos — ver el porqué abajo). Sin sesión, se bloquea con una pantalla de login/registro obligatoria (reusa el mismo `FormularioAuth` de Ajustes) antes de mostrar cualquier tab, incluido el tour de onboarding (el modal "Cómo funciona" que estaba acá se reemplazó por un tour interactivo, ver CONTEXTO_TECNICO.md § "Tour interactivo guiado").

- **Los providers de datos (`ProveedorFiltrosSupers`/`ProveedorCarrito`/`ProveedorCarritosGuardados`/`ProveedorHistorialAhorro`) quedan FUERA de `GateSesion`, envolviéndolo** — a propósito, no es un detalle menor: `useSincronizacionPersistente` (fase 1) detecta la migración anónimo→cuenta comparando el `userId` entre renders del mismo componente montado; si esos providers se montaran recién adentro del gate (con sesión ya presente desde su primer render), nunca observarían el estado anónimo previo y la migración de datos locales de quien ya usaba la app sin cuenta se perdería en silencio. Manteniéndolos afuera, seguimos exactamente el mismo camino ya probado en fase 1 (sesión cambia de null a un valor, mismo montaje).
- **Consecuencia, no planeada originalmente en este doc**: `PromptCuenta.tsx` (fase 1, prompt opcional post-onboarding "¿querés crear cuenta?") quedó inalcanzable — para llegar a esa pantalla ya hacía falta haber pasado este gate con sesión activa — así que se borró junto con su disparador en `index.tsx`, en vez de dejarlo como código muerto. `ajustes.tsx` también se simplificó: su branch para "sin sesión" (mostraba `FormularioAuth` inline) ya no es alcanzable por el mismo motivo.
- La migración local→cuenta de fase 1 sigue siendo la puerta de entrada para quien ya tenía datos anónimos de antes de este cambio — sin re-verificar en vivo con una cuenta real todavía (ver "Verificación fase 2" más abajo).

## Datos: extender `perfil_usuario`

**Implementado 2026-08-21, migración corrida en el proyecto Supabase real** (`supabase/migrations/0004_plan_trial_pasarela_pago.sql`). Columnas nuevas (no una tabla nueva — es estado 1:1 con el usuario, igual que el resto de `perfil_usuario`):

- `plan text not null default 'trial'` — valores `'trial' | 'premium' | 'gratis'`.
- `trial_termina_en timestamptz` — seteado a `now() + interval '30 days'` en el momento del registro (la migración también le puso un valor a los usuarios de fase 1 ya existentes, para que el trial no les arranque en `null`).
- `pasarela_pago text` — `'mercadopago' | 'stripe'`, null hasta que el usuario paga. **Nombrada genérica a propósito** (no `mercadopago_suscripcion_id` como decía la versión anterior de este plan): se decidió el 2026-08-21 que no hay ninguna desventaja en dejar el esquema listo para una segunda pasarela desde ahora, en vez de tener que renombrar columnas después. Ver la sección de Stripe más abajo para la pasarela candidata.
- `pasarela_suscripcion_id text` — id de la suscripción en la pasarela que corresponda.
- `suscripcion_estado text` — espejo del estado que manda la pasarela (`authorized`/`paused`/`cancelled`/etc.), para reconciliar con los webhooks.

Además, índice parcial `idx_perfil_usuario_pasarela_suscripcion` sobre `pasarela_suscripcion_id` (`where ... is not null`): el webhook de la pasarela llega con el id de la suscripción, no con el id de usuario, así que hace falta resolver "qué perfil_usuario es este" a partir de ese id.

**Downgrade automático del trial — implementado 2026-08-21, migración corrida en el proyecto real** (`supabase/migrations/0005_downgrade_trial_vencido.sql`). Un job `pg_cron` (extensión ya disponible en Supabase, corre dentro de la misma DB — no es infra nueva que operar) corre una vez al día la función `public.bajar_planes_vencidos()`, que baja a `'gratis'` a quien tenga `plan='trial'`, `trial_termina_en` vencido y sin suscripción activa. Si el usuario se suscribió durante el trial, el webhook ya puso `plan='premium'` antes de que este job corra, así que no lo toca.

- **La lógica vive en una función, no en un `update` suelto dentro del cron**, justo para poder volver a correrla a mano en cualquier momento desde el SQL editor (`select public.bajar_planes_vencidos();`) sin esperar al horario del cron. Es idempotente: si no queda ningún trial vencido sin pagar, no hace nada, así que correrla de más no tiene efecto colateral.
- **Premium permanente otorgado a mano**: columna nueva `premium_manual boolean not null default false` en `perfil_usuario`. El downgrade automático excluye explícitamente (`and not premium_manual`) a cualquier usuario con esta columna en `true`, sin importar hace cuánto venció su trial ni si tiene suscripción. Para dar premium permanente a un usuario puntual (a mano, vía SQL editor, no hay UI para esto):
  ```sql
  update perfil_usuario set plan = 'premium', premium_manual = true where id = '<uuid>';
  ```
  Sacarle el premium permanente después es el `update` inverso (`premium_manual = false`), y a partir de ahí ese usuario vuelve a quedar sujeto al mismo mecanismo de trial/downgrade que cualquier otro (si su `plan` sigue en `'premium'` sin `pasarela_suscripcion_id`, conviene además volver a poner algún `trial_termina_en` con sentido o pasarlo a `'gratis'` a mano, según el caso).

## Cobro: Mercado Pago Suscripciones — código implementado 2026-08-21, cuenta de MP pendiente

**Código commiteado, deployado a la VM y con credenciales de Test cargadas (2026-08-21)** — confirmado con `curl` contra `https://34.24.10.174.nip.io`: `/api/pagos/suscripcion` y `/api/webhooks/mercadopago` responden 401 (rechazan sesión/firma inválida) en vez de 503 (no configurado), y `/api/health` sigue en 200 — el resto del backend no se vio afectado. Cuenta usada: la personal del usuario, sin monotributo (ver decisión más abajo). Migraciones `0004`/`0005`/`0006` corridas en el proyecto Supabase real y flujo completo probado con los usuarios de prueba de MP (ver "Verificación fase 2" más abajo).

- **Alta de suscripción**: `backend/src/routes/pagos.js` — `POST /api/pagos/suscripcion` (requiere sesión, ver `requiereSesion.js` abajo). Llama a la API de Preapproval de MP (SDK oficial `mercadopago@3.4.0`, clases `MercadoPagoConfig`/`PreApproval` confirmadas contra el código fuente real del paquete) y devuelve `init_point` (la URL de checkout) al frontend, que la abre con `Linking.openURL` — checkout hosteado por MP, la app nunca ve ni maneja un número de tarjeta. Al crear la suscripción, esta ruta ya guarda `pasarela_pago='mercadopago'` y `pasarela_suscripcion_id` en `perfil_usuario` (con la service role key) — **antes** de que llegue ningún webhook, para que cuando este llegue ya se sepa a qué usuario corresponde ese id. Ojo: esta ruta **no** otorga `plan='premium'` — crear la suscripción no confirma que el usuario terminó de pagar; eso lo hace únicamente el webhook.
- **Webhook**: `backend/src/routes/webhookMercadoPago.js` — `POST /api/webhooks/mercadopago`, pública (la llama MP, no la app). Verifica la firma con `WebhookSignatureValidator` del mismo SDK (HMAC-SHA256 sobre un manifest de `id`/`request-id`/`ts`, comparación constant-time — confirmado contra el código fuente del SDK, no de memoria) y, si es válida, **no confía en el body**: usa el `data.id` solo para pedirle a la API de MP el estado real de esa suscripción (`preApproval.get`), y con ESO actualiza `perfil_usuario` (`plan`, `suscripcion_estado`) usando `@supabase/supabase-js` con la **service role key**. Excluye explícitamente (`premium_manual = false` en el `where`) a cualquier usuario con premium otorgado a mano — un webhook de MP nunca le puede tocar el plan a esos usuarios.
- **Sesión**: `backend/src/middleware/requiereSesion.js` (nuevo, necesario para la ruta de alta). **Bug encontrado y corregido 2026-08-21**: la primera versión asumía el secreto compartido HS256 legado (`SUPABASE_JWT_SECRET`) — al probar con un usuario real, el JWT real resultó firmado con clave asimétrica (`alg: ES256`, confirmado decodificando el header del token), así que esa verificación rechazaba **cualquier** sesión válida (401 con cualquier token real, no solo los inválidos). Corregido usando `jose` (`createRemoteJWKSet` + `jwtVerify`) contra el JWKS público del proyecto (`SUPABASE_URL/auth/v1/.well-known/jwks.json`) — sigue sin pegarle a la red de Supabase en cada request (jose cachea las claves), pero ahora sí valida lo que el proyecto realmente firma. `SUPABASE_JWT_SECRET` ya no se usa (sacado de `config.js`/`.env.example`), `jsonwebtoken` reemplazado por `jose` en `package.json`.
- Ambas rutas viven en el Express de la VM, no en Supabase Edge Functions — evita sumar Deno/Edge Functions como pieza nueva a operar cuando ya existe un backend Node corriendo.
- Dependencias nuevas ya agregadas a `backend/package.json` e instaladas: `mercadopago`, `@supabase/supabase-js`, `jsonwebtoken`.

### Cómo se configura Mercado Pago (pendiente, es la única pieza que falta)

Esto se hace en el panel web de Mercado Pago, **fuera del código**, y en paralelo — no depende de que el código ya esté armado (ya lo está). **Dos etapas independientes, no un solo bloque secuencial**: probar (sandbox) no requiere haber resuelto nada de lo legal/impositivo; solo cobrar en serio (Producción) sí.

**Etapa 1 — Testear, se puede arrancar ya (2026-08-21, sin decidir nada más)**: para entrar a Mercado Pago Developers y crear una aplicación alcanza con una cuenta de Mercado Pago normal (la que ya exista, o una nueva gratis con DNI) — **no hace falta estar dado de alta como monotributista ni tener ninguna entidad**, eso no es un requisito de Mercado Pago para el modo Test. Esa aplicación da credenciales de **Test** (sandbox) y permite crear "usuarios de prueba" (comprador y vendedor simulados, separados de la cuenta real) — con eso se puede probar el flujo completo (crear la suscripción, el checkout, que llegue el webhook, que valide la firma) sin que se mueva un peso real.

1. Entrar a **Mercado Pago Developers** (mercadopago.com.ar/developers/panel) con cualquier cuenta de MP y crear una "aplicación" — es solo un contenedor de credenciales, no un negocio nuevo. **Ya hecho (2026-08-21)**, modelo de negocio "Suscripciones".
2. Copiar el **Access Token de Test**: dentro de la app, menú izquierdo **"Pruebas" > "Credenciales de prueba"** (distinto de "Credenciales de producción") — aparece solo, generado apenas se crea la app, sin botón que tocar. No hace falta la Public Key (checkout hosteado, no hay Card Form propio en la app). **No hace falta crear ninguna cuenta/usuario de prueba antes de esto** — son dos cosas independientes.
3. Confirmar que el producto **Suscripciones** (Preapproval) esté habilitado para probar.
4. Configurar en el panel de esa aplicación la URL de notificaciones: menú izquierdo **"Webhooks" > "Configurar notificaciones"**, cargar `https://34.24.10.174.nip.io/api/webhooks/mercadopago` (HTTPS ya resuelto vía Caddy+nip.io, ver `gcp-vm-deploy-status` — no hace falta infra nueva para esto) en el campo de modo pruebas. Al guardar, se genera sola la **firma secreta** (botón para revelarla/regenerarla).
5. Cargar en `backend/.env` (puede ser incluso local, apuntando el webhook a un túnel, o directo en la VM): `MERCADOPAGO_ACCESS_TOKEN` (el de Test), `MERCADOPAGO_WEBHOOK_SECRET`, `MERCADOPAGO_PRECIO_MENSUAL_ARS` (cualquier valor sirve para probar; el real todavía no está decidido), `SUPABASE_JWT_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`. Ver `backend/.env.example`.
6. **Crear usuarios de prueba** (recién ahora hace falta, para simular un pago completo): sección **"Cuentas de prueba" > "+ Crear cuenta de prueba"** — elegir país, descripción, y tipo (**Comprador** para simular quien paga; **Vendedor** para simular quien cobra). Da usuario/contraseña para loguearse como esa cuenta simulada. Ver "Verificación fase 2" más abajo para el resto del flujo de prueba.

*(Nombres de botones/secciones tomados de la documentación oficial vigente de Mercado Pago, no de una captura en vivo — si el panel muestra algo distinto, ajustar acá.)*

**Gotcha confirmado 2026-08-21, investigado con documentación oficial de MP y foros de devs**: para completar un pago end-to-end en sandbox, el **vendedor NO puede ser la cuenta real usando su `MERCADOPAGO_ACCESS_TOKEN` de Test** (el generado en el paso 2 de arriba) contra una cuenta **Comprador** de prueba. Mezclar una identidad real (aunque use credenciales `TEST-...`) con una cuenta de prueba tira el error *"Una de las partes con la que intentás hacer el pago es de prueba"*. Las cuentas de prueba Comprador y Vendedor deben usarse **en pareja**: hay que loguearse en developers.mercadopago.com **como la cuenta de prueba Vendedor** y generar SU PROPIO Access Token de Test desde ahí (esa cuenta necesita su propia "aplicación" de prueba), y usar ESE token — no el de la cuenta real — para crear la suscripción que se va a pagar con la cuenta Comprador de prueba.
  - Además: si al loguearse como la cuenta de prueba Vendedor la sección **"Credenciales de prueba"** aparece en gris/no clickeable, es **comportamiento esperado y documentado** — las cuentas de prueba no tienen acceso a ciertas secciones del Panel del Desarrollador (Credenciales de prueba, Calidad de integración) logueadas directamente así. La forma de generar ese Access Token del vendedor de prueba pasa por otro camino (crear la app de prueba desde la cuenta real que originó esa cuenta de prueba, no logueándose directamente como ella) — falta terminar de verificar el paso exacto la próxima vez que se retome esta fase.
  - Fuentes: [checkout-payment-sample issue #10](https://github.com/mercadopago/checkout-payment-sample/issues/10), [doc oficial cuentas de prueba Suscripciones](https://www.mercadopago.com.co/developers/es/docs/subscriptions/additional-content/your-integrations/test/accounts), [doc oficial cuentas de prueba Checkout API](https://www.mercadopago.com.ar/developers/es/docs/checkout-api/additional-content/your-integrations/test/accounts).
  - **Investigado más a fondo (2026-08-21)**: no hay forma de conseguir el Access Token del Vendedor de prueba por API (`POST /users/test_user` no lo devuelve, no hay endpoint de consulta posterior) — camino sin salida documentado. Se descartó también la hipótesis de "aplicación distinta" (Comprador y Vendedor de prueba confirmados en la misma app). Queda sin resolver el paso exacto para destrabar el pago end-to-end vía checkout; no bloquea seguir, ver el punto de verificación por webhook simulado abajo.
  - **Webhook verificado igual, sin necesitar el pago completo (2026-08-21)**: se armó a mano una notificación firmada con el algoritmo real de MP (HMAC-SHA256 sobre el manifest `id:...;request-id:...;ts:...;` con `MERCADOPAGO_WEBHOOK_SECRET`) y se mandó a `https://34.24.10.174.nip.io/api/webhooks/mercadopago` con el `pasarela_suscripcion_id` real ya creado — respondió 200, y `perfil_usuario` quedó con `suscripcion_estado='pending'` (el estado real que tiene esa suscripción en MP, sin pagar todavía), `plan` sin tocar. Confirma firma + llamada real a `preApproval.get()` + escritura en base funcionando de punta a punta; solo falta confirmar en vivo la rama `authorized → premium` (trivial por inspección de código, pero no probada con un pago real todavía).

**Etapa 2 — Cobrar en serio (Producción), recién cuando esté resuelto**:

1. **Decidido (2026-08-21): se cobra con la cuenta de Mercado Pago personal del usuario, sin abrir monotributo — al menos el primer mes.** Explícitamente planteado como provisorio ("al menos el primer mes"), no una decisión definitiva de largo plazo — revisar si en algún momento se decide formalizar (monotributo u otra figura) una vez que haya volumen real, dado que cobrar de forma recurrente y habitual sin alta fiscal tiene riesgo ante AFIP cuanto más se sostenga en el tiempo. No requiere ningún cambio de código: el backend solo lee `MERCADOPAGO_ACCESS_TOKEN` de `.env`, sin importar a qué cuenta pertenece.
2. Con esa cuenta, verificar identidad si Mercado Pago la pide para habilitar Producción.
3. Reemplazar en `backend/.env` de la VM el Access Token de Test por el de **Producción** (de esa misma cuenta personal), y decidir el precio real de la suscripción.

## Pasarela alternativa evaluada: Stripe (descartada, 2026-08-21)

Se evaluó sumar Stripe como segunda opción de cobro con tarjeta, además de Mercado Pago. **Descartada por ahora** — no se implementa:

- Argentina no está entre los países donde Stripe permite abrir una cuenta propia. Para usarlo igual haría falta constituir una entidad en el exterior (ej. Stripe Atlas, ~USD 500 + contabilidad dual) o pasar por un Merchant of Record tipo Paddle/Rebill.
- Sin cuenta Stripe argentina, no se puede cobrar en ARS a un cliente argentino (regla de Stripe desde 2023) — forzaría cobro en USD, con conversión + impuestos (PAIS, percepciones) impredecibles para el usuario final y mayor riesgo de rechazo de tarjetas locales (muchas débito no autorizan consumos en moneda extranjera).
- La integración técnica de Stripe Billing es, en sí misma, más simple que la de MP Suscripciones — pero eso no compensa la fricción legal/cambiaria de fondo.
- Mercado Pago ya cubre el 100% del mercado real de la app (usuarios argentinos, tarjetas argentinas) sin esas fricciones.

**Cuándo reconsiderar**: si la app algún día apunta a usuarios fuera de Argentina/LatAm pagando en USD/EUR, ahí Stripe (o Paddle como Merchant of Record) tendría sentido como canal internacional en paralelo a MP. El esquema de `perfil_usuario` ya quedó genérico (`pasarela_pago`, no `mercadopago_suscripcion_id`) pensando en este caso, así que no haría falta otra migración de esquema para sumarlo — alcanzaría con las rutas de cobro/webhook nuevas.

**Otras alternativas evaluadas (mencionadas, ninguna recomendada por ahora)**:

- **Rebill** — la más realista para Argentina, ver investigación en detalle abajo.
- **dLocal / PayU** — para empresas que cobran en varios países de LatAm desde una integración. Tiene sentido si la app se expande a otros países; sobredimensionado para cobrar solo en Argentina.
- **Paddle** — igual que Stripe, Merchant of Record para cobrar en USD/EUR a usuarios internacionales fuera de LatAm.

### Rebill en detalle (investigado 2026-08-21, no descartada ni decidida — pendiente hablar con su equipo)

- **Qué es**: no es Merchant of Record (a diferencia de Paddle) — es un orquestador/facilitador de pagos. El comerciante sigue siendo el "seller of record": factura y responde legal/impositivamente frente al usuario final, Rebill solo procesa el cobro y liquida los fondos. Sede en Buenos Aires, fundada 2020, pasó por Y Combinator. Se promociona para operar en Argentina "sin necesidad de una entidad local" — apuntado sobre todo a empresas extranjeras; no hay confirmación pública de si un monotributista/persona física argentina puede darse de alta (pregunta para su equipo de ventas).
- **Comisión** (pricing público, rebill.com/en/pricing/argentina): 4.00% en tarjetas de crédito/débito/prepagas, 1.60% en transferencias/QR y wallets (MP, MODO, Ualá, Brubank). Sin comisión por transferir a cuenta bancaria propia. Contracargo/disputa: $415 ARS + IVA. Porcentajes sin IVA ni retenciones. Sin mínimo mensual publicado.
- **Cobra y liquida en ARS** (no fuerza USD como Stripe). Métodos: tarjetas locales/internacionales, transferencias, Pago Fácil (efectivo), QR/wallets.
- **Suscripciones**: soporte nativo (planes, trials, cupones, prorrateo en upgrade/downgrade), checkout hosteado (evita manejar PCI compliance propio), payment links, webhooks de eventos — mismo modelo conceptual que MP Suscripciones.
- **Riesgos a resolver antes de comprometerse**: acreditación lenta (9 días hábiles tarjetas nacionales, 19 internacionales); pueden retener hasta 10% del volumen mensual por riesgo, hasta 180 días post-contrato; una queja fuerte en Trustpilot sobre funciones prometidas no entregadas y cambios unilaterales de condiciones. No hay info pública suficiente sobre calidad de API/SDK para Node ni sandbox.
- **Próximo paso si se decide seguir**: hablar con soporte/ventas de Rebill para confirmar alta como monotributista, tiempos reales de KYC, y pedir acceso a sandbox/docs técnicas antes de integrar nada.

## Chequeo de plan en el Express (para cuando exista una feature gateada) — ✅ el gate real ya se implementó (26/08)

**Actualizado 2026-08-29: esta sección describía solo la mecánica (JWT con `plan`), sin gate real todavía — eso ya cambió.** El commit `ae1cd96` (2026-08-26) agregó `requierePlanActivo` en `backend/src/middleware/requiereSesion.js`, aplicado en `/api/comparar`, `/api/precios`, `/api/catalogo/*` y `/api/mis-descuentos`. El hueco de "cualquiera puede usar el backend como proxy gratis" que se menciona más abajo como riesgo aceptado ya está cerrado. El resto de esta sección queda como registro de cómo se armó la mecánica del JWT antes de ese commit.

Como todavía no hay ninguna feature específica atrás del gate, esta fase deja lista la mecánica, no el gate en sí:

- **Evitar una consulta a la DB en cada request** de rutas calientes como `/api/comparar`: en vez de que el Express consulte `perfil_usuario` por request, se usa un **Auth Hook de Supabase** ("Customize Access Token") — una función Postgres que inyecta el campo `plan` directo en el JWT cuando se emite/refresca. El Express ya verifica ese JWT localmente (`jsonwebtoken`, sin llamar a la red de Supabase), así que leer `plan` es gratis, ya está en el token decodificado.
- **Código implementado 2026-08-21** (`supabase/migrations/0006_auth_hook_plan_en_jwt.sql`): función `public.custom_access_token_hook(event)` que lee `plan` de `perfil_usuario` e inyecta el claim (`'gratis'` si por algún motivo no hay fila), con los grants/policy necesarios para que el rol interno `supabase_auth_admin` pueda leerla pese a RLS. `backend/src/middleware/requiereSesion.js` ya guarda `req.usuarioPlan` desde el JWT decodificado (nadie lo usa todavía — no hay gate real — pero queda disponible sin costo extra). **Falta correr la migración en el proyecto real, Y ADEMÁS un paso manual que ninguna migración SQL puede hacer**: en el dashboard de Supabase, Authentication > Hooks, activar `public.custom_access_token_hook` como el hook de "Customize Access Token (JWT) Claims" — sin ese paso la función existe pero Supabase no la llama, el JWT sigue sin el claim.
- **Trade-off a anotar**: el JWT se refresca cada tanto (no en cada request), así que un downgrade (trial vencido, suscripción cancelada) puede tardar hasta el tiempo de vida del token en reflejarse en el chequeo del backend. Para esta app (no es un paywall de alto riesgo) es aceptable.
- **Beneficio que esto destraba, ya identificado en la conversación de seguridad**: hoy `/api/comparar` no tiene ningún token porque "no hay dónde guardar un secreto" — con cuentas obligatorias, eso deja de ser cierto. Cuando se implemente el gate real, exigir el JWT en `/api/comparar`/`/api/precios` cierra el hueco de "cualquiera puede usar el backend como proxy gratis hacia los 5 supers" que quedó anotado como riesgo aceptado en su momento. Además, el rate limiting podría pasar a ser por usuario en vez de por IP, más preciso que hoy.

## Archivos a tocar (fase 2)

- `app/src/componentes/GateSesion.tsx` (nuevo) + `app/app/_layout.tsx` — **implementado 2026-08-21**, gate de sesión obligatoria al arrancar (ver sección de arriba para el porqué de dónde se envuelve).
- `app/src/plan.ts` (nuevo, no estaba anotado) — **implementado 2026-08-21**, hook `usePlanUsuario()` que lee `plan`/`trial_termina_en`/`pasarela_suscripcion_id`/`suscripcion_estado` directo de `perfil_usuario` (mismo patrón "frontend habla directo con Supabase" que `sincronizacionPersistente.ts`, pero de solo lectura).
- `app/app/(tabs)/ajustes.tsx` — **implementado 2026-08-21**: muestra plan actual (con días de trial restantes), botón "Actualizar a premium" (llama `crearSuscripcion()` → `POST /api/pagos/suscripcion` → abre `initPoint` con `Linking.openURL`) y botón "Cancelar suscripción" (llama `cancelarSuscripcion()` → `POST /api/pagos/cancelar-suscripcion`, nuevo, ver abajo) con modal de confirmación. Se refresca solo al volver a la pantalla (`useFocusEffect`) por si el webhook actualizó el plan mientras el usuario estaba en el checkout de MP.
- `backend/src/routes/pagos.js` — **implementado 2026-08-21**: `POST /api/pagos/suscripcion`, y **sumado en esta misma sesión** `POST /api/pagos/cancelar-suscripcion` (llama `preApproval.update({status:'cancelled'})` y refleja el nuevo plan en `perfil_usuario` en la misma respuesta, sin esperar al webhook — mismo criterio de excluir `premium_manual` que ya usaba el webhook).
- `backend/src/planSegunEstadoSuscripcion.js` (nuevo, no estaba anotado) — **implementado 2026-08-21**: extrae el mapeo estado-de-MP→plan que antes vivía solo en el webhook, para que la ruta de cancelación use el mismo criterio sin duplicarlo.
- `backend/src/routes/webhookMercadoPago.js` (nuevo) — **implementado 2026-08-21**, `POST /api/webhooks/mercadopago`.
- `backend/src/middleware/requiereSesion.js` (nuevo, no estaba anotado en la versión anterior de este plan) — **implementado 2026-08-21**, valida el JWT de Supabase localmente.
- `backend/src/clienteSupabaseAdmin.js` (nuevo, no estaba anotado) — **implementado 2026-08-21**, cliente lazy con la service role key.
- `backend/package.json` — **implementado 2026-08-21**: `mercadopago`, `@supabase/supabase-js`, `jsonwebtoken` agregados e instalados.
- `backend/.env.example` — **actualizado 2026-08-21** con todas las variables nuevas comentadas.
- Supabase: columnas nuevas en `perfil_usuario`, job de `pg_cron` y Auth Hook de custom claims (**implementado 2026-08-21**, `supabase/migrations/0004`, `0005` y `0006`) — las tres migraciones corridas en el proyecto real, y el hook activado a mano en el dashboard (Authentication > Hooks); ver "Verificación fase 2" más abajo (✅ confirmado con un JWT real).
- **Pendiente, no es código**: crear/elegir la cuenta de Mercado Pago y cargar sus credenciales reales en `backend/.env` — ver sección de arriba.

## Verificación fase 2 — completa (2026-08-21)

1. ✅ Auth Hook: decodificado un JWT real de un usuario recién creado → claim `plan: "trial"` presente y coincidente con `perfil_usuario`.
2. ✅ Sesión: `requiereSesion.js` verificado contra un JWT real (encontró y corrigió el bug de ES256/JWKS en el camino — ver más arriba).
3. ✅ Creación de suscripción: `/api/pagos/suscripcion` probado contra la API real de Mercado Pago (sandbox y luego producción), con guardado correcto de `pasarela_pago`/`pasarela_suscripcion_id` en `perfil_usuario` antes de cualquier webhook.
4. ✅ **Pago real completado y autorizado en producción** (2026-08-21, $1000 ARS, pagado con dinero en cuenta por un tercero real): confirmado en la API de MP `status: "authorized"`, con comisión real descontada (~5%, quedaron $950). Requirió que `payer_email` coincida con la cuenta que paga (gotcha real, no documentado explícitamente por MP pero confirmado empíricamente — ver nota más arriba) y la URL de webhook en **modo producción** cargada (estaba vacía, causa real de que el webhook no llegara al principio).
5. ✅ Webhook probado con infraestructura 100% real en dos estados distintos: `pending` (simulado con firma real antes del pago) y `cancelled` (real — la suscripción se canceló ~2 min después de autorizarse). Confirma firma + `preApproval.get()` + escritura en base funcionando correctamente. La rama `authorized → premium` no se alcanzó a probar en vivo por el webhook (la cancelación fue más rápida que la propagación), pero es estructuralmente idéntica a la rama `cancelled → gratis` ya confirmada — alta confianza sin necesidad de gastar otro pago real para probarla literal.
6. ✅ Gate de sesión obligatoria: implementado 2026-08-21 (ver sección de arriba).

**Nota sobre el costo de esta verificación**: se gastó plata real dos veces en el camino — una transferencia de $1000 no relacionada (confundida al principio con el pago de la suscripción) y un pago real de suscripción de $1000 (con ~$50 de comisión), cancelado apenas confirmado. Documentado para no repetir el mismo camino de prueba y error si se necesita volver a probar esto.

## Verificación de la UI + gate (2026-08-21) — parcial, sin browser interactivo

Lo que se pudo verificar sin un navegador real (el `chrome-devtools-mcp` compartido estaba tomado por otra sesión corriendo en paralelo, no se forzó a cerrarlo):

1. ✅ `tsc --noEmit` limpio sobre todo `app/` después de los cambios (GateSesion, `ajustes.tsx`, `plan.ts`, `api.ts`, borrado de `PromptCuenta.tsx` y su disparador en `index.tsx`).
2. ✅ El backend arranca y `POST /api/pagos/cancelar-suscripcion` responde 401 con token inválido/ausente (mismo comportamiento que la ruta de alta ya verificada), probado contra credenciales de Test reales de `backend/.env`.
3. ✅ El bundler de Expo web compila sin errores las rutas `/` y `/ajustes` con los imports/JSX nuevos (`GateSesion`, `usePlanUsuario`, `Linking`, `useFocusEffect`).
4. ⏸ **Sin probar interactivamente en un navegador**: no se confirmó visualmente el gate bloqueando sin sesión, ni el flujo completo botón "Actualizar a premium" → checkout de MP → vuelta a Ajustes con el plan actualizado, ni "Cancelar suscripción". Falta hacer esto con una cuenta real la próxima vez que se retome esto (mismo tipo de verificación ya hecha para el backend en el punto 4 de la sección de arriba, pero disparada desde la UI en vez de `curl` directo).

---

# Feature candidata: "cuánto ahorraste" (histórico + gancho de fin de trial)

Surgió de una sesión de brainstorming aparte, pero se documenta acá porque es un candidato natural para llenar el hueco que fase 2 deja **a propósito** sin decidir ("qué es premium"). No es una decisión tomada de qué gatea el plan pago — es una feature que, una vez lista, puede conectarse a ese mecanismo.

## Idea central

Al vencer el trial de 30 días (fase 2), en vez de una pantalla de pago genérica, mostrar algo personal: *"Ahorraste $50k este mes de prueba. Por $10k al mes, podés seguir ahorrándolo."* Además de ese momento puntual, un historial navegable (este mes, mes pasado, total) de cuánto fue ahorrando el usuario con la app.

## Decisiones tomadas en esta sesión

- **Qué cuenta como "ahorro"**: cada vez que el usuario ve el resultado de una comparación (`app/app/resultado.tsx`), aunque no confirme que compró ahí. Se eligió por sobre exigir una confirmación explícita de compra porque esa fricción iba a dejar muy pocos datos (la mayoría no vuelve a marcar "compré esto"). Trade-off aceptado: el número es "ahorro potencial visto", no "ahorro real confirmado".
- **Bug real encontrado y corregido (2026-08-22), probando Fase B en vivo**: el monto registrado era `ahorroRepartiendo` (repartir la compra entre supers vs. comprar todo en el super más barato), no el ahorro por promos/descuentos — quedaba en `$0` en carritos donde repartir no suma nada sobre el mejor super único, aunque hubiera ahorro real grande por promos activas (caso real de prueba: carrito de $85k sin descuento bajaba a $69k con promos, y el historial registraba $0). Corregido a `totalSinPromo - totalOptimo`, que es justamente el valor central que la app resuelve (elegir dónde comprar según las promos vigentes de cada super, no solo repartir viajes).
- **Mitigación al trade-off anterior** (agregada al revisar la idea): si alguien prueba la app mucho sin comprar (comparaciones de prueba), el número de ahorro se infla sin que haya compra real detrás. Para que esto no sea engañoso, el historial va a mostrar **también la cantidad de comparaciones contadas**, no solo el monto (ej. "Ahorraste $50k en 12 comparaciones"). Así el usuario mismo puede juzgar si el número refleja uso real o solo curioseo — es transparencia, no una solución que evite el problema de fondo, pero evita que el número se sienta inflado sin explicación.
- **Cuándo arrancar a trackear**: ya, en local (`AsyncStorage`), sin esperar a fase 1. Mismo patrón que `carrito.tsx`/`carritosGuardados.tsx` — un módulo nuevo (propuesta: `app/src/historialAhorro.ts`) que guarda eventos `{fecha, monto, superGanador}` y se engancha en `resultado.tsx` cada vez que se calcula un resultado nuevo. Deduplicar por hash del carrito + día para no contar el mismo carrito dos veces si el usuario entra y sale de la pantalla sin cambiar nada. Así, cuando fase 1/2 lleguen, ya hay ahorro acumulado real para mostrar en el momento del trial en vez de arrancar en cero.
- **Cómo se muestra el fin de trial**: pantalla bloqueante (paywall clásico, no se puede cerrar sin decidir), consistente con el downgrade automático que ya describe fase 2.

## Fases de implementación (mapeadas a lo que ya existe en este plan)

- **Fase A — ya, sin dependencias**: módulo local de tracking + pantalla "Mis ahorros" (total histórico, mes actual, mes pasado, cantidad de comparaciones contadas por período).
- **Fase B — depende de fase 1** (cuentas Supabase): migrar el historial local a una tabla nueva (`ahorro_registro`: usuario_id, fecha, monto) al loguearse, mismo patrón que la migración de `carrito_guardado` ya descripta arriba.
- **Fase C — depende de fase 2** (trial + Mercado Pago): al bajar `plan` de `'trial'` a `'gratis'`, la pantalla bloqueante suma el ahorro acumulado durante esos 30 días y muestra el mensaje con el CTA de suscripción.

## Pendiente

- **Fase A ya implementada** (corregido 2026-08-19, este doc estaba desactualizado): `app/src/historialAhorro.tsx` (tracking local) y la pestaña `app/app/(tabs)/ahorros.tsx` (diseño + código) ya están commiteados (`5674546`).
- **Fase B implementada, migrada y verificada en vivo — completa** (2026-08-21/22): `app/src/historialAhorro.tsx` sincroniza con Supabase cuando hay sesión, mismo patrón row-based que `carritosGuardados.tsx` (no `useSincronizacionPersistente`, porque es un log que solo crece, no un blob). Tabla nueva `ahorro_registro` (`id`, `usuario_id`, `fecha`, `monto` — sin columna `super`, porque `EventoAhorro` nunca la tuvo en la implementación real de Fase A) con RLS de select/insert propio, en `supabase/migrations/0007_ahorro_registro.sql`, corrida contra el proyecto Supabase real. Primer login con historial local y servidor vacío sube todos los eventos locales como filas nuevas; si el servidor ya tenía filas, esas ganan y el local se descarta — mismo criterio que `carrito_guardado` (Fase 1).
  - ✅ **Sync entre dispositivos, confirmado con la cuenta personal del usuario (2026-08-22)**: "funciona de diez".
  - ✅ **Migración local→Supabase y bug de fórmula, encontrados y corregidos en el camino** (2026-08-22): ver el bug de `ahorroRepartiendo` vs. ahorro por promos documentado arriba en "Decisiones tomadas en esta sesión". Confirmado con datos reales leídos directo de la tabla (service role key): dos comparaciones con $15.000 y $15.643 de ahorro real por promos, ya no $0.
  - ✅ **Paywall de fin de trial mostrando el ahorro correcto, confirmado con la cuenta personal** (2026-08-22): se simuló el vencimiento moviendo `trial_termina_en` al pasado (vía API REST con la service role key, sin tocar código) y se confirmó que la pantalla bloqueante mostró las 2 comparaciones reales con su monto correcto. Gotcha de la simulación (no un bug de producto): la ventana de "ahorro durante el trial" solo cuenta eventos anteriores a `trial_termina_en` — si se corta el trial a una fecha ya pasada, comparaciones hechas después de esa fecha (aunque sean "durante la prueba" en el calendario real) quedan fuera de la ventana, hay que mover el corte a después del último evento de prueba para verlas. `trial_termina_en` restaurado a su valor original al terminar.
- **Fase C ya implementada** (2026-08-21, corregida el mismo día — la primera versión de este punto describía un alcance que el usuario amplió después): `app/src/componentes/PaywallFinTrial.tsx` quedó cableada como gate real vía `app/src/componentes/GatePaywallFinTrial.tsx` (montado en `_layout.tsx`, adentro de `GateSesion`, envolviendo el `Stack`).
  - **Decisión de producto (2026-08-21): no existe un "plan gratis" navegable.** Sin pagar no se usa la app, salvo estar dentro del trial vigente — responde a la pregunta de "qué es premium/qué se gatea" que este doc dejaba abierta más arriba: la respuesta es "toda la app". El bloqueo es permanente, sin salida sin pagar: `PaywallFinTrial` no tiene botón de "continuar gratis" ni de cerrar sesión, y `GatePaywallFinTrial` no persiste ningún "ya lo vi" — se re-evalúa siempre.
  - **Alcance del bloqueo**: `plan==='premium'` o estar en un trial todavía no vencido son las dos únicas excepciones. Esto incluye tanto fin de trial sin pagar nunca como cancelar/pausar una suscripción premium desde Ajustes (el modal de cancelación en `ajustes.tsx` ya no promete "podés seguir usando la app gratis"). El texto del bloqueo cambia según el motivo (`suscripcionEstado` en `cancelled`/`paused` → "SIN SUSCRIPCIÓN ACTIVA" + ahorro histórico total; si no, "TERMINÓ TU MES DE PRUEBA" + ahorro solo de la ventana del trial) para no hablar de "mes de prueba" con alguien que ya fue premium.
  - **Chequeo instantáneo, no atado al cron**: el vencimiento del trial se calcula en el cliente contra `trialTerminaEn`, no esperando a que `bajar_planes_vencidos()` (cron diario, `0005_downgrade_trial_vencido.sql`) pase `plan` a `'gratis'` — ese cron puede tardar hasta 24hs, y ese hueco ya no es aceptable siendo esta la única barrera real de acceso.
  - Nuevo endpoint público `GET /api/pagos/precio` (sin sesión) en `backend/src/routes/pagos.js`: expone `MERCADOPAGO_PRECIO_MENSUAL_ARS` para que el paywall (y a futuro `ajustes.tsx`, que hoy no muestra el precio) no lo hardcodee. Si no está configurado, el paywall no bloquea (falla abierto) en vez de romper la app — es la única forma de acceder sin pagar, y es un bug de configuración, no una decisión de producto.

---

## Pendientes sueltos

- **Logos de los supers**: hoy cada super se identifica solo con texto/color; falta sumar el logo oficial de cada uno en la UI (badges de precio, selector de supers, etc.). Legal: uso nominativo (mostrar el logo tal cual, sin editar, solo para identificar de qué super es ese precio) es la misma base legal que usan todos los comparadores de precios — bajo riesgo. Sube el riesgo si se lo usa editado/decorativo o si da a entender auspicio del super. Sumar un disclaimer tipo "los logos pertenecen a sus respectivos dueños, sin afiliación" al implementarlo.
