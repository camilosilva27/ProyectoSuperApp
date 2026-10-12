# Plan: referidos ("invitá a 3 y llevate 2 meses gratis")

**Estado (2026-10-12): backend, base, captura del link, UI (pantalla "Invitá amigos" + fila en Ajustes) y texto legal IMPLEMENTADOS, en producción y verificados de punta a punta en superahorro.com.ar. Aviso por mail (+ push) al ganar el premio implementado el mismo día (`mailPremioReferidos.js`, tipo #9 de `mails_y_notificaciones.md`).** Detalle en § "Implementado" y § "Pendiente". El diseño de la pantalla está en Claude Design (proyecto SuperApp, `Referidos.dc.html`, turno 22): https://claude.ai/design/p/9ed550fb-8171-4826-838d-dbaaa3fc4847?file=Referidos.dc.html

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
- `LimpiadorRefDeUrl` (mismo archivo, hermano del `<Stack>` dentro del paywall) saca `?ref=` de la barra de direcciones con `history.replaceState`. Hace falta porque expo-router reescribe la URL inicial cuando se monta el `<Stack>`, que en producción espera a que el paywall lea el plan. Por eso no sirve limpiar antes, ni `router.setParams`, porque `ref` no es parámetro de ninguna ruta. Mientras no hay sesión (formulario de registro), el `?ref=` sigue visible en la URL.

**Verificación (12/10):**
- `backend/test/referidos.test.js`: 22 tests.
- 3 tests nuevos en `procesarPagoMercadoPago.test.js`, para la gracia con premio.
- Script de punta a punta contra la base real con 14 cuentas temporales (borradas): trial +60, gratis → premium 60 días, suscripto → `no_aplica` con el plan intacto, idempotencia, reversión, y el flujo HTTP real login → asociar → `/api/comparar` → válida.
- Navegador real (Playwright): `?ref=` se guarda, después del login se asocia (`asociada`), se olvida, y la URL queda limpia.

## UI (2026-10-12)

**Decisiones del usuario (12/10) sobre el diseño del turno 22:**
- Pantalla: **22b**, la lista estándar.
- Las invitadas se muestran **con nombre de pila**: "si lo invitaste, lo conocés".
- **Sin** la banda "Te invitó X" en el registro (22g descartada).

**Implementado:**
- `app/(tabs)/ajustes/invitar.tsx`: pantalla "Invitá amigos". Tiene el link con un solo botón **"Copiar link"** y la lista "TUS INVITADOS", y sale de 22b + 22e. El botón Compartir del mock se sacó a pedido del usuario (12/10).
  - en curso: válida ✓, pendiente ◐ "quedan N días", expirada/descartada con chip `EXPIRÓ`/`NO CUENTA` (no ocupa lugar), y los lugares libres;
  - premio ganado: bloque amarillo "GANASTE · 2 MESES GRATIS" + "Tu prueba ahora vence el dd/mm" o "Tenés premium gratis hasta el dd/mm" (según `premio.planAntes`);
  - no aplica: tarjeta gris "Tenés una suscripción paga / el plan permanente / tu cuenta ya tiene premium";
  - casos raros: premio revertido y promo cerrada.
- Usa el mismo esqueleto que Mis ahorros (header nativo "‹ Ajustes" + banda negra), no la flecha dentro de la banda que dibujaba el mock.
- Copiar: usa `navigator.clipboard`, con `execCommand` de respaldo, llamado directo desde el toque por el bug de WebKit 222262. Copia solo el link, sin mensaje. En nativo no hay portapapeles: el aviso sugiere copiarlo a mano, porque el texto del link es seleccionable.
- `ajustes/index.tsx`: fila "Invitá amigos" debajo de Mis ahorros (22a).
  - El subtítulo cambia según el estado: "Invitá a 3 y llevate 2 meses gratis", "Ya se sumó 1 de 3", "Ganaste 2 meses gratis" o "Compartí SuperAhorro".
  - El chip amarillo "2 MESES GRATIS" solo aparece mientras el premio se pueda ganar.
  - La fila se oculta solo si la promo terminó y la persona nunca participó.
- Quien ganó el premio estando en gratis queda premium sin plan pago. Para ese caso:
  - la fila de Suscripción dice "Premium gratis por invitar amigos · hasta el dd/mm";
  - `plan-y-pago.tsx` lo dice al pie.
- `GET /api/referidos` devuelve `nombre`, que es solo el nombre de pila de `perfil_usuario.nombre` (nunca apellido ni mail), y `premio.planAntes`.

**Legal (12/10):**
- ToS: sección nueva "5. Programa 'Invitá amigos'"; las siguientes se renumeraron (6–16).
- Privacidad: datos de invitaciones, uso del programa, y que quien te invitó ve tu nombre de pila y si ya comparaste.
- Los dos espejados en `app/src/legal/contenidoLegal.ts`.
- **Queda escrito en el ToS** que si contratás un plan pago con días de premio pendientes, el plan se cobra desde ese momento y esos días no se acumulan (es el comportamiento actual).

**Verificación (12/10):**
- Playwright contra el backend local + base real, con cuentas temporales en tres estados (en curso con válida/pendiente/expirada, premio ganado, suscripta) y el caso de premium por premio en Ajustes y Plan y pago. Sin errores de consola.
- **Test de punta a punta por la interfaz** (`backend/src/scripts/e2eReferidosUI.js`, Playwright, base real, cuentas temporales borradas al final; ver el encabezado del script para correrlo en local o contra producción):
  1. Quien invita copia su link desde la pantalla.
  2. Tres personas abren el link, se registran con el formulario (los Términos del modal ya muestran la sección 5) y confirman el mail (por admin).
  3. Cada una inicia sesión: la 2da desde otro "dispositivo", sin código guardado, así que se asocia por `user_metadata.ref`.
  4. Cada una hace **el tutorial completo**. La pantalla de quien invita muestra su nombre de pila con ✓ y el progreso "1 de 3", "2 de 3".
  5. Con la tercera: "GANASTE 2 MESES GRATIS", la prueba sube +60 días (90 días en Ajustes) y Ajustes dice "Ganaste 2 meses gratis".
- **Corrido contra producción (superahorro.com.ar) el 12/10 después del deploy: TODO OK.** Cada asociación tarda entre 3 y 4,5 s desde que se toca ENTRAR.
- **Hecho estable descubierto en el test:** la invitada queda válida en el **paso del tope** del tutorial ("Poné un máximo de supermercados"), no recién en "Comparar precios". `HojaSupers` (`useCostoTope`) llama a `POST /api/comparar` para mostrar en vivo cuánto cuesta el tope elegido, y ese pedido ya cuenta como comparación. Sigue estando dentro del tutorial, que es el criterio del usuario. Fuera del tutorial, también cuenta elegir un tope con productos en el carrito.

## Aviso al ganar el premio (2026-10-12)

**Único aviso del programa**, por decisión del usuario: no se avisa cada invitada que se suma.
- `backend/src/mailPremioReferidos.js`: mail "¡Ganaste 2 meses gratis!" + push equivalente.
- Lo dispara `validarInvitada` en el mismo momento en que el premio queda `otorgado`.
- Queda constancia en `premio_referido.mail_enviado_en` (migración 0031). Si falla, queda null y no hay reintento automático.
- Se manda solo con el mail confirmado. Es un mail operativo, sin pie de baja.

## Pendiente

- **Fecha de corte:** correr `REFERIDOS_FECHA_CORTE` (en `backend/.env` de la VM) antes del 01/01/2027 si se quiere seguir.
- **Vista previa del link (og:image/og:title) de la landing:** 22f asume una imagen de vista previa. No se revisó qué muestra hoy WhatsApp al pegar el link.
- **Casos borde todavía sin prueba real:**
  - invitada que se registra con Google (el código viaja solo por storage);
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
