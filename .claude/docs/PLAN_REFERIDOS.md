# Plan: referidos ("invitá a 3 y llevate 2 meses gratis")

**Estado (2026-10-12): backend, base y captura del link IMPLEMENTADOS, verificados contra la base real y deployados; falta la UI (pantalla de referidos + fila en Ajustes), el texto legal y los avisos.** Detalle en § "Implementado" y § "Pendiente". El diseño de la pantalla está en Claude Design (proyecto SuperApp, `Referidos.dc.html`, turno 22): https://claude.ai/design/p/9ed550fb-8171-4826-838d-dbaaa3fc4847?file=Referidos.dc.html

**Objetivo del usuario (12/10): darse a conocer.** La promo es una herramienta de crecimiento, no algo de duración acotada — por eso la intención es que siga indefinidamente y el antiabuso se mantiene liviano (el costo máximo de un fraude es ingreso no percibido, no infra).

## Qué es

Promo de crecimiento (sin fecha de fin planeada, ver § Ventana): un usuario que invita a 3 personas que se registran con su link, confirman el mail y hacen al menos 1 comparación, recibe **2 meses de premium gratis**. La invitada es un usuario normal: tiene su propio link y su propia oportunidad de invitar a 3 (sin beneficio extra para ella, ya tiene sus 30 días de trial).

## Decisiones tomadas (2026-10-01, ajustadas y cerradas 2026-10-12)

- **Quién recibe el premio:** quien invita, solo si no tiene suscripción activa. El usuario espera que casi nadie con suscripción lo use; los suscriptores quedan fuera (no se posterga ningún cobro de Mercado Pago — evita la parte más compleja y riesgosa, ver más abajo). **Re-preguntado el 12/10 y confirmado: suscriptores afuera** (por qué, en § "Descartado: premio para suscriptores pagos").
- **Premio:** 2 meses = **60 días**.
  - Quien está en trial (el caso casi universal): `trial_termina_en += 60 días`. Decisión explícita: se suma al trial vigente, sin distinguir cuánto le quedaba.
  - Quien ya cayó a `plan='gratis'` esperando a su tercera invitada: hay que reactivarlo. **Ojo:** setear solo `acceso_premium_hasta` no alcanza — esa columna (migración 0020) solo tiene efecto con `plan='premium'`, y `bajar_planes_vencidos()` lo baja a `'gratis'` cuando la fecha pasa. La función de premio tiene que poner `plan='premium'` **y** `acceso_premium_hasta = hoy + 60 días`, y no tocar `premium_manual`/`tipo_plan='permanente'`. Verificar con `GatePaywallFinTrial.tsx` y `plan.ts` que `premium` + `acceso_premium_hasta` futuro deja pasar el gate.
- **Cuándo cuenta una invitada:** mail confirmado **y** al menos **1 comparación** (decisión del usuario; se discutió exigir 2 en días distintos y se prefirió 1 para no meter fricción). Ya existe `emailConfirmado` en `backend/src/usuariosAuth.js`.
  - **La comparación del tutorial cuenta (decisión 2026-10-12).** No hace falta nada especial para lograrlo: el tour arranca solo en el primer login (`allpromos:tourVisto:v1`), no tiene botón de salir hasta el último paso, y su comparación final es una comparación real — `resultado.tsx` llama a `POST /api/comparar` con la sesión del usuario (`requiereSesion` deja `req.usuarioId`) y además registra el evento en `ahorro_registro`, sin excluir el tour. En la práctica: registro → confirma mail → primer login → tutorial = invitada válida, en minutos.
  - **Dónde detectarla:** en el backend, dentro de `POST /api/comparar` (`backend/src/routes/comparar.js`), marcando `primera_comparacion_en` de la fila `referido` de ese usuario si está `pendiente`. `ahorro_registro` (lo inserta el cliente) se usa solo como **respaldo al asociar**: si la invitada ya había comparado antes de quedar asociada (ej. el pedido de asociar falló y se reintentó), esa comparación cuenta. Falsificarlo no le da a nadie nada que no consiga haciendo el tutorial.
- **Plazo de actividad:** la comparación tiene que ocurrir dentro de **30 días desde el registro de la invitada** (= lo que dura su trial). Si no, la invitada pasa a `expirada` y quien invita necesita sumar otra. Recomendación mía aceptada por el usuario: evita revisar eternamente invitadas inactivas y premios tardíos cuando la promo ya cerró.
- **Frecuencia:** **un premio por cuenta**, nunca se repite (confirmado de nuevo el 12/10, aun con el objetivo de darse a conocer). Si más adelante se quiere "cada 3 invitadas", poner un máximo total (ej. 6 meses).
- **Ventana de la promo:** fecha de corte como **variable de entorno del backend** `REFERIDOS_FECHA_CORTE=2027-01-01` (decisión 2026-10-12, mismo patrón que `MERCADOPAGO_PRECIO_*` en `backend/src/config.js`). **La intención del usuario es que la promo siga indefinidamente**: la fecha es un interruptor de apagado, no un fin planeado — hay que correrla antes del 01/01/2027 si se quiere seguir (si no, se apaga sola). Consecuencias:
  - El ToS **no** debe nombrar la fecha: "vigente hasta que SuperAhorro la modifique o la dé de baja; lo ya ganado se respeta". Así correr la fecha no obliga a tocar el texto legal.
  - Propuesta: cuenta toda invitada que se registró **antes** del corte, aunque se valide después (no castigar a quien estaba a mitad de camino).
  - Lo ya otorgado se respeta siempre.
- **Premio instantáneo, sin retención (decisión 2026-10-12):** se otorga en el mismo momento en que la tercera invitada queda válida (registro + mail confirmado + comparación del tutorial). Se descartó retenerlo unos días para poder revertir antes de que se use; la reversión por fraude sigue existiendo, pero a posteriori.
- **Constantes configurables:** días de premio (60), invitadas necesarias (3), plazo de actividad (30), fecha de corte (`2027-01-01`), tope de premios (1).

## Antiabuso (capas acordadas, cerrado 12/10)

**Decisión del usuario (12/10): antiabuso mínimo, se acepta que alguien "truche" el sistema.** Costo máximo de un fraude exitoso: 2 meses (~$16.000 ARS al precio mensual de $8.000) de ingreso no percibido, cero costo de infra — no justifica guardar datos del dispositivo ni de la red.

1. Mail confirmado (obligatorio) + actividad real (1 comparación, la del tutorial alcanza).
2. Bloquear dominios de mail descartable (lista pública tipo mailinator/tempmail) y **normalizar Gmail** (`a.b@gmail.com`, `ab+1@gmail.com` y `ab@gmail.com` son la misma casilla) para detectar duplicados.
3. Tope: un premio por cuenta.
4. Premio **revertible**: la tabla de histórico guarda estado; si se descubre fraude después, se marca `revertido` y se resta el premio, sin borrar nada.
5. Revisión manual opcional solo con lo que ya se guarda igual (ej. 3 invitadas registradas en pocos minutos, por `registrada_en`). Sin bloqueo automático.

**Descartado (12/10) — no guardar IP, ni huella de dispositivo, ni ID de navegador:**
- **IP:** técnicamente estaba al alcance (`app.set('trust proxy', 'loopback')` en `backend/src/server.js` ya hace que `req.ip` sea la IP real detrás de Caddy, y se iba a guardar como hash). Se descartó porque es una señal débil: las telcos móviles en Argentina usan CGNAT (muchos desconocidos comparten IP pública) y una familia invitándose desde el mismo WiFi es legítima — solo hubiera servido para revisión manual, no para bloquear. El usuario prefirió no guardarla.
- **Huella de dispositivo (device fingerprinting, ej. FingerprintJS):** invasiva (hay que declararla), falsos positivos en iPhones (muchos idénticos), Safari/Brave la bloquean a propósito.
- **ID aleatorio en el storage del navegador:** propuesto como alternativa liviana a la huella, también queda afuera con el criterio de antiabuso mínimo.
- **Verificación por SMS:** costo por mensaje + fricción.
- Consecuencia: **no hace falta tocar `POLITICA_DE_PRIVACIDAD.md`** por este feature (no se guarda ningún dato nuevo de la persona más allá de quién invitó a quién).

## Implementado (2026-10-12)

**Base — `supabase/migrations/0030_referidos.sql`** (corrida en el proyecto real con `supabase db push --linked`):
- `perfil_usuario.codigo_referido` (único, `^[A-Z0-9]{4,12}$`). Lo genera el backend la primera vez que se pide el estado (6 caracteres sin I/L/O/0/1). **No se tocó `manejar_usuario_nuevo()`.**
- `referido`: `invitador_id`, `invitada_id` (única), `registrada_en` (= `auth.users.created_at` de la invitada), `asociada_en`, `mail_confirmado_en`, `primera_comparacion_en`, `estado` (`pendiente | valida | expirada | descartada`), `motivo_descarte` (`mail_descartable | mismo_mail_que_invitador | mail_repetido`), `mail_normalizado`.
- `premio_referido`: PK `usuario_id` (un premio por cuenta para siempre), `estado` (`otorgado | no_aplica | revertido`), `motivo`, `dias`, foto del plan anterior (`plan_antes`, `trial_termina_en_antes`, `acceso_premium_hasta_antes`), `hasta`, `revertido_en`.
- Las dos tablas: RLS sin policies, solo el backend (service role) lee y escribe.
- `otorgar_premio_referido(usuario, necesarias, dias)`: atómica (lock por usuario) e idempotente. Devuelve `otorgado | no_aplica | faltan | ya_tenia`. Reglas en el comentario de la migración: trial → `trial_termina_en += 60`; gratis → `plan='premium'` + `acceso_premium_hasta = ahora + 60`; premium en gracia → `acceso_premium_hasta += 60`; suscripción activa (premium sin `acceso_premium_hasta`), permanente o `premium_manual` → fila `no_aplica`.
- `revertir_premio_referido(usuario, motivo)`: a mano desde el SQL editor (`select public.revertir_premio_referido('<uuid>', 'motivo');`). Resta los días de la columna a la que se sumaron y marca `revertido`.

**Backend:**
- `backend/src/referidos.js`: `estadoDelUsuario`, `asociarInvitada`, `registrarComparacion` y helpers (normalizar mail/código, mails descartables).
- `backend/src/routes/referidos.js`: `GET /api/referidos` (código, link, progreso, invitadas sin nombre ni mail, premio, `motivoNoAplica`) y `POST /api/referidos/asociar { codigo }` (siempre 200 con `resultado`).
- `routes/comparar.js`: después de responder, sin await, llama a `registrarComparacion`. Hay un cache en memoria de "no tiene referido pendiente" (6 hs) para no consultar la base en cada comparación.
- Config: `REFERIDOS_FECHA_CORTE` (default `2027-01-01T00:00:00-03:00`) y el resto de las constantes en `config.js § referidos` / `.env.example`.
- Reglas de asociación:
  - la cuenta de la invitada tiene que tener ≤ 30 días (si no, `cuenta_vieja`);
  - tiene que haberse registrado antes del corte (si no, `promo_cerrada`);
  - no puede usar su propio código (`propio`);
  - una invitada tiene un solo invitador para siempre (`ya_asociada`).
- **Cambio de paso en pagos:** `procesarSuscripcion` (`procesarPagoMercadoPago.js`), en la gracia por cancelación, ahora usa la fecha más lejana entre `siguiente_cobro_en` y el `acceso_premium_hasta` que ya tuviera la fila. Antes la pisaba con `siguiente_cobro_en`, y un webhook atrasado o repetido de una suscripción cancelada le hubiera borrado el premio a quien lo ganó estando en gracia o en gratis.

**App:**
- `app/src/codigoReferido.ts`: guarda `?ref=` en AsyncStorage al cargar (`_layout.tsx`, antes del render).
- `auth.tsx § registrarse`: manda el código en `user_metadata.ref`, para que no se pierda si la persona confirma el mail desde otro dispositivo.
- `componentes/AsociadorReferido.tsx` (sin UI, dentro de `GateSesion`, fuera del paywall): ya con sesión, manda el código una vez (del storage o de `user_metadata.ref`) y lo olvida.
- El mismo componente saca `?ref=` de la barra de direcciones con `history.replaceState` y reintenta un rato. Hace falta porque expo-router reescribe la URL inicial cuando se monta el `<Stack>`, y `router.setParams` no sirve porque `ref` no es parámetro de ninguna ruta. Mientras no hay sesión (formulario de registro), el `?ref=` sigue visible en la URL.

**Verificación (12/10):**
- `backend/test/referidos.test.js`: 22 tests.
- 3 tests nuevos en `procesarPagoMercadoPago.test.js`, para la gracia con premio.
- Script de punta a punta contra la base real con 14 cuentas temporales (borradas): trial +60, gratis → premium 60 días, suscripto → `no_aplica` con el plan intacto, idempotencia, reversión, y el flujo HTTP real login → asociar → `/api/comparar` → válida.
- Navegador real (Playwright): `?ref=` se guarda, después del login se asocia (`asociada`), se olvida, y la URL queda limpia.

## Pendiente

- **UI** según el diseño del turno 22 (Claude Design, `Referidos.dc.html`): fila en Ajustes (22a), pantalla "Invitá amigos" (elegir entre 22b/22c/22d), estados (22e), mensaje al compartir (22f) y banda "Te invitó X" en el registro (22g, necesitaría exponer el nombre de pila del invitador por código: endpoint público nuevo, a decidir).
- **Decisión pendiente del usuario:** mostrar las invitadas anónimas (22b/22d) o con nombre de pila (22c). Hoy `GET /api/referidos` no devuelve nombres.
- **Legal:** actualizar `TERMINOS_DE_SERVICIO.md` + `app/src/legal/contenidoLegal.ts` antes de mostrar la pantalla (mecánica, un premio por cuenta, no aplica a suscriptores, reversión por fraude, vigencia sin fecha). La Política de Privacidad no cambia.
- **Avisos (mail/push)** al validarse una invitada y al ganar el premio: abrir `mails_y_notificaciones.md` antes.
- **Copys de plan a revisar con la UI:** quien gana el premio estando en gratis queda `premium` con `tipo_plan = null` y `acceso_premium_hasta`. Ajustes muestra "Premium" y `plan-y-pago.tsx` puede decir "Suscripción cancelada · tenés acceso hasta…" si tenía una suscripción vieja cancelada. Conviene un texto propio ("2 meses gratis por invitar amigos · hasta el …"). Si se suscribe mientras le quedan días del premio, MP cobra igual desde el día uno (los días restantes se pierden): avisarlo en la UI o aceptarlo.
- **Fecha de corte:** correr `REFERIDOS_FECHA_CORTE` (en `backend/.env` de la VM) antes del 01/01/2027 si se quiere seguir.
- **Casos borde todavía sin prueba real:**
  - invitada que se registra con Google (el mail viene confirmado de entrada; el código viaja solo por storage porque Google no pasa por `signUp`);
  - invitada que confirma el mail desde otro dispositivo (camino `user_metadata.ref`).

## Descartado: premio para suscriptores pagos (re-evaluado y confirmado 12/10)

El usuario preguntó si se les podían sumar los 60 días a quienes ya pagan; tras ver los problemas decidió dejarlos afuera. Por qué, para no re-investigarlo:

- **Mensual y anual** son una `PreApproval` (débito automático) y su acceso lo gobierna `suscripcion_estado` vía webhook, no una fecha nuestra. Sumar 60 días en nuestra base no sirve de nada: MP les cobra igual en la fecha de siempre. Para que de verdad sean 2 meses gratis, MP tiene que dejar de cobrar, y MP no tiene "meses gratis" para una suscripción ya creada (el `free_trial` solo existe al crearla; el monto no puede ser $0). Caminos evaluados, todos con costo:
  - **Pausar la suscripción 60 días y reactivarla con un cron:** nuestro propio código trata `paused` como baja (`procesarSuscripcion` → gracia/`gratis`, el paywall muestra "SIN SUSCRIPCIÓN ACTIVA"), habría que excepcionarlo; no controlamos en qué fecha cobra MP al reactivar; si la tarjeta falla al reactivar, el usuario pierde la suscripción; y el usuario ve "pausada" en su cuenta de MP sin entender por qué.
  - **Cancelar y que vuelva a suscribirse después:** el usuario tendría que volver a cargar la tarjeta a mano (no guardamos tarjetas, el checkout es por redirección) — muchos no vuelven.
  - **Dejar que MP cobre y devolver los próximos cobros por API** (`POST /v1/payments/{id}/refunds` al llegar el webhook del pago): el más simple y no toca la lógica de acceso, pero el usuario ve un cobro y una devolución en el resumen de la tarjeta (con crédito puede tardar un resumen en verse), y había que confirmar si MP devuelve su comisión. Para el anual sería una devolución parcial (2/12 del pago).
  - Además, el anual todavía no tiene validado que MP agende el próximo cobro a 12 meses (ver `opciones_planes.md`).
- **Permanente:** no tiene sentido sumar días (ya es para siempre).

## Contexto de por qué es barato

Trial de 30 días, paywall sin plan gratis (`GatePaywallFinTrial`, ver `Plan_Usuarios_y_cobros.md`), `bajar_planes_vencidos()` diario (migración `0005`), `acceso_premium_hasta` ya existente (migración `0020`). El único costo real es ingreso no percibido, no infraestructura.
