# Plan: features futuras de la app — AllPromos

**Estado: anotado, ninguna implementación empezada todavía.** El usuario está terminando de pensar el alcance completo antes de que se empiece a programar nada de esto — no asumir que esto ya es una decisión cerrada de diseño, es una lista viva. Leer primero `CONTEXTO_TECNICO.md` y `.claude/plans/twinkling-puzzling-brook.md` (el plan original de la app, ya ejecutado hasta Fase 1) para contexto de arquitectura.

---

## 0. Decisión pendiente que afecta a todo lo de abajo: ¿web o tienda?

Discutido el 2026-08-10: la app (React Native + Expo) ya corre en web sin cambios de código (`npx expo start --web`, probado toda la Fase 1). Distribuir por **link web** en vez de subir a App Store/Play Store evita por completo el riesgo de revisión de Apple (Guideline 5.2.1, ver `CONTEXTO_TECNICO.md`/conversación sobre viabilidad de tienda) y los costos de cuenta de desarrollador (US$99/año Apple + US$25 único Google). No es excluyente con ir a la tienda más adelante — es el mismo código en los dos casos.

**Implicancia concreta para las features de abajo:** si se elige web-first, "login" no necesita "Sign in with Apple" (ese requisito es de Guideline 4.8 de la App Store, no aplica a un sitio web), y la geolocalización se resuelve con la API de geolocalización del browser en vez de una API nativa — mismo resultado, sin diferencia funcional para el usuario.

**Evidencia real que baja el nivel de alarma sobre el riesgo de tienda (2026-08-10):** investigamos "Mirá Precios", una app argentina que compara Vea/Carrefour/Chango Más/Coto/Jumbo/Disco/Día/Farmacity con carrito. Está **publicada y activa hoy en App Store y Google Play** (versión 2.1.9, actualizada 10/12/2025), y sus fundadores declararon explícitamente a iProUP: *"Mirá! no tiene convenio con ningún supermercado, ya que los datos están disponibles en sus tiendas web, cualquiera puede acceder a ellos"*. Sin partnership, mostrando nombres reales, más de un año en producción sin reclamos ni bajas reportadas. No es garantía de que a este proyecto no le pase nada distinto, pero es precedente real (no teórico) de que este modelo se tolera en la práctica. Sigue siendo razonable priorizar web-first por costo y velocidad de iteración, pero el argumento de "riesgo de rechazo/baja por 5.2.1" ya no debería ser el motivo principal para esa elección.

---

## 1. Modo claro

**Ya existe parcialmente.** `app/app.json` tiene `userInterfaceStyle: "automatic"` y todos los componentes leen la paleta vía `useTema()` (`app/src/useTema.ts`), que sigue el tema del sistema operativo (`useColorScheme()`). Si el celular/browser del usuario está en modo claro, la app ya se ve en modo claro — los screenshots que se compartieron en esta sesión salieron en oscuro porque el entorno de prueba (Chrome vía MCP) estaba en oscuro, no porque la app fuerce ese modo.

**Lo que falta, a confirmar con el usuario:** un selector DENTRO de la app para elegir modo claro/oscuro manualmente, independiente de la configuración del sistema (hoy no existe — solo se puede cambiar yendo a la configuración del teléfono). Si esto es lo que se pidió, es una feature chica: guardar una preferencia en `AsyncStorage` (mismo patrón que `carrito.tsx`) y que `useTema()` la lea antes de mirar `useColorScheme()`.

---

## 2. Login

**Motivo confirmado por el usuario (2026-08-10):** que el usuario pueda setear en su cuenta qué tarjetas/promociones tiene, para que la app no le avise de una promo con una tarjeta que no tiene (ejemplo dado: "que no me avise que hay promos con Mi Carrefour si yo no lo tengo").

**Ojo — esta necesidad puntual ya está resuelta hoy, sin login.** `app/src/carrito.tsx` guarda `tarjetas` en `AsyncStorage` (local al teléfono), y el backend (`backend/src/routes/comparar.js`) nunca asume una tarjeta que no esté en esa lista — las promos de tarjeta se muestran como aviso pero no se cuentan en el total salvo que el usuario la haya activado (ver `BarraDiferencia.tsx`, `promo.tarjetaActiva`). Si el uso es de un solo teléfono, login no agrega nada sobre esto que no exista ya.

**Lo que login SÍ agregaría, si se concreta:** sincronizar esa preferencia entre varios dispositivos (ej. la familia comparte cuenta y todos ven las mismas tarjetas activadas sin configurarlas cada uno por separado), o identificar usuarios si en el futuro se suma algo compartido entre personas. Sin eso, es una feature sin motivo claro todavía.

Preguntas abiertas para cuando se concrete:
- ¿Con qué se loguea? (email/contraseña, Google, ambos)
- Si se va por **web** (ver sección 0), no hace falta pedir "Sign in with Apple" — ese es un requisito que solo aplica a apps nativas distribuidas por App Store.
- Arquitectura: el backend (`backend/`) no tiene ningún concepto de usuario ni base de datos más allá de archivos JSON generados por el cron — login implica sumar una base de datos real (hoy no hay ninguna). No decidir esto a la ligera cuando llegue el momento.

**Idea futura relacionada, dejada asentada por el motivo (2026-08-10), sin decisión tomada:** guardar el domicilio del usuario en la cuenta. Tensión explícita que el usuario planteó: si la app va a ser web y puede pedir la ubicación en vivo cada vez (ver sección 3), ¿tiene sentido guardar un domicilio fijo? Motivo por el que igual podría valer la pena, para que quede registrado: la geolocalización en vivo solo sirve si el usuario está físicamente en su casa en el momento de usar la app — si quiere planear la compra desde el trabajo, viajando, o simplemente sin querer compartir su ubicación en ese momento puntual, un domicilio guardado como default cubre ese caso y la ubicación en vivo no. No son excluyentes entre sí (se podría usar ubicación en vivo cuando está disponible y caer al domicilio guardado si no) — pero no hay que asumir que hace falta uno u otro sin confirmarlo cuando se llegue a esta feature.

---

## 3. Límite de cantidad de supermercados a visitar (con geolocalización)

**La pieza más grande de este backlog — cambia el motor de cálculo, no solo la UI.**

**Confirmado por el usuario (2026-08-10):** esa es exactamente la idea — poder decidir en base a la distancia a cada super, no solo en base al precio.

### Qué pide el usuario

Poder decir "quiero ir a como máximo N supermercados" (ejemplo dado: 2 de los 3) y que la comparación recalcule la mejor asignación de productos **restringida a esa cantidad de supers**, no la óptima sin restricciones que calcula hoy `calcularResumenFinal()` en `AllPromos/core/comparador.js`.

### Por qué esto es más simple de lo que suena (dato clave de hoy, 2026-08-10)

Confirmamos en vivo que **Vea, Carrefour, Chango Más y Día tienen precio único a nivel país** (ver `CONTEXTO_TECNICO.md`, sección "Alcance y limitaciones") — no hay variación de precio por sucursal. Esto significa que:

**Excepción encontrada después (2026-08-10, misma fecha): Coto sí varía por sucursal de verdad** — 98% de una muestra de 50 productos comunes tuvo precio distinto entre sucursales, con dos sucursales de Capital Federal (Flores y Once) sistemáticamente más baratas que el resto (ver el detalle completo en `CONTEXTO_TECNICO.md`, sección "API de Coto"). Hoy Coto usa el precio dominante (moda) como aproximación — pero **el día que se implemente esta feature de distancia, Coto es el candidato natural para usar el precio real de la sucursal más cercana en vez de la moda**, ya que ahí sí hay una diferencia real que la geolocalización resolvería con precisión (a diferencia de los otros 4 supers, donde la geolocalización solo ayudaría con la distancia del viaje, nunca con el precio).

- **La geolocalización NO sirve para buscar un precio distinto según dónde estás** — el precio es el mismo en cualquier sucursal de un mismo super. No confundir esto con "buscar el precio de la sucursal más cercana": ese concepto no existe para estos 3 supers.
- **Lo que la geolocalización SÍ aporta** es puramente de **conveniencia/distancia física**: saber qué tan lejos está la sucursal más cercana de cada super desde donde estás, para poder decidir realistamente "¿vale la pena ir a los 2 supers más baratos, o están tan lejos que no compensa el viaje?". Es información de logística del viaje, no de precio.

### Cómo se resolvería el cálculo (boceto, no implementado)

Con solo 3 supers, restringir a K supers es un problema chico y resoluble por fuerza bruta, no hace falta ningún algoritmo sofisticado:

- K=3 (sin restricción): es lo que ya hace hoy `calcularResumenFinal()` — cada ítem al super más barato que lo tenga, sin condición.
- K=2: probar las 3 combinaciones posibles de "qué 2 supers" (Vea+Carrefour, Vea+ChangoMás, Carrefour+ChangoMás), y para cada combinación asignar cada ítem al más barato **entre esos 2** (ignorando el tercero aunque sea más barato). Devolver la combinación de 2 supers con el total más bajo.
- K=1: el total de "todo en un solo super" para cada uno de los 3 — dato que **ya se calcula hoy** (`totalesPorSuper` en `calcularResumenFinal`), no hay nada nuevo que hacer para este caso.

Esto probablemente vive como una función nueva en `core/comparador.js` (ej. `calcularResumenConLimite(resumen, maxSupers, supermercados)`), reusando `calcularResumenFinal` para K=3 y agregando la lógica de "probar combinaciones de K supers" para K<3. No debería tocar `calcularOpciones`/`mejorOpcion` — esas siguen resolviendo "el mejor precio de cada super para este ítem", solo cambia qué se hace con esos números al armar el plan final.

### Geolocalización — de dónde sale

- **Nativo (si se distribuye por tienda):** `expo-location`.
- **Web (si se distribuye por link, ver sección 0):** `navigator.geolocation` del browser, sin librería adicional.
- En ambos casos, el dato que hace falta no es "dónde estoy" en sí, sino "a qué distancia está la sucursal más cercana de cada super" — lo cual requiere tener guardada al menos una dirección por sucursal relevante (hoy el proyecto no tiene ninguna base de sucursales con coordenadas; `sucursales.csv` se menciona en `contexto_proyecto_superapp_v2_1.md` pero es de una etapa anterior del proyecto y no se usa en el código actual). Esto es un dato nuevo a conseguir antes de poder implementar la parte de distancia.

### Explícitamente fuera de alcance por ahora

No se pidió, y no hay que asumirlo: recalcular cuál sucursal específica de cada super conviene visitar (ya sabemos que el precio no cambia entre sucursales, así que "cuál sucursal" es una pregunta de distancia/horario, no de precio — round trip distinto al que resuelve el resto de la herramienta).

---

## 4. Pendiente: más features que el usuario todavía está pensando

El usuario explícitamente dijo que tiene más ideas en las que quiere pensar antes de definir el alcance completo. No cerrar este documento como definitivo — es un punto de partida para la próxima conversación, no una lista final. Actualizar esta sección (o agregar nuevas) cuando aparezcan.
