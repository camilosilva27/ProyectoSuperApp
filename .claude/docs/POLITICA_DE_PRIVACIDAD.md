# Política de Privacidad — SuperAhorro

> Adaptado a los datos que la App realmente guarda (ver `.claude/docs/Plan_Usuarios_y_cobros.md`, `CONTEXTO_TECNICO.md`), no un template genérico. No reemplaza asesoramiento legal — para un lanzamiento con volumen real conviene que un abogado lo revise, pero cubre el piso mínimo razonable para un lanzamiento chico.

**Última actualización:** 2026-09-24

## 1. Quiénes somos

SuperAhorro es operada por Camilo Silva, persona física (no hay una empresa/razón social detrás). Contacto: contacto@mi-superapp.com.ar.

## 2. Qué datos recolectamos

- **Datos de cuenta**: mail y contraseña (o cuenta de Google si iniciás sesión así), nombre.
- **Datos de uso de la app**: carrito actual, tarjetas bancarias que marcás como propias (solo el nombre/tipo de tarjeta, **nunca** número de tarjeta ni datos de pago), supermercados activos, listas de carrito guardadas, historial de ahorro.
- **Alertas**: los productos y categorías que elegís seguir, y si tenés activado el interruptor "Recibir notificaciones".
- **Notificaciones push (web)**: si aceptás recibir notificaciones en el navegador, guardamos la suscripción push que genera tu navegador (una dirección técnica de envío y sus claves de cifrado), asociada a tu cuenta. No incluye tu ubicación ni otros datos del dispositivo.
- **Datos de pago**: cuando contratás un plan pago, guardamos el mail que usaste en Mercado Pago (`mail_mercado_pago`), el estado de tu suscripción, y las fechas de pago/renovación. **No almacenamos número de tarjeta ni ningún dato sensible de pago** — eso lo procesa y guarda Mercado Pago directamente, nunca pasa por nuestros servidores.
- **Datos técnicos**: cuando la App tiene un error, se genera un reporte técnico (qué falló y dónde, navegador/sistema operativo, y puede incluir tu dirección IP). También medimos de forma agregada el uso y el rendimiento de la versión web (páginas visitadas, tiempos de carga, tipo de dispositivo/navegador).

## 3. Cómo usamos tus datos

- Para darte acceso a la App y sincronizar tu carrito/listas entre tus dispositivos.
- Para gestionar tu plan (trial, suscripción, pagos) y saber si tenés acceso vigente.
- Para enviarte mails operativos: confirmación de cuenta, recibo de pago, aviso de fin del período de prueba y otros avisos de tu plan.
- Para enviarte, además, estos mails y notificaciones:
  - **Resumen semanal y mensual de ahorro** (cuánto ahorraste en ese período según tu historial).
  - **Aviso de inactividad**, si hace un tiempo que no entrás a la App.
  - **Alertas de promos** de los productos y categorías que seguís.
- Para calcular tu historial de ahorro dentro de la App.
- Para detectar y corregir errores y mejorar el rendimiento de la App (reportes de errores y métricas agregadas).

**Cómo darte de baja de estos avisos**: las alertas (por mail y push) se apagan desde la App con el interruptor "Recibir notificaciones"; las notificaciones push también se pueden bloquear desde la configuración de tu navegador. Para dejar de recibir los resúmenes de ahorro o el aviso de inactividad, escribinos a contacto@mi-superapp.com.ar con el asunto "baja". Los mails operativos (confirmación, recibos, avisos del plan) se siguen mandando mientras tengas cuenta, porque son parte del servicio.

No usamos tus datos para publicidad ni los vendemos a terceros.

## 4. Con quién compartimos tus datos

Usamos los siguientes proveedores (procesadores de datos) para operar la App:

- **Supabase** — aloja la base de datos y gestiona el login (autenticación).
- **Google Cloud Platform** — aloja el servidor (backend) que procesa los pedidos de la App (búsquedas, comparaciones, pagos, envío de mails y notificaciones).
- **Vercel** — aloja la versión web de la App. Además usamos Vercel Analytics y Vercel Speed Insights para métricas agregadas de uso y rendimiento de la web.
- **Sentry** — recibe los reportes de errores de la App y del servidor (datos técnicos del error, que pueden incluir tu dirección IP).
- **Mercado Pago** — procesa los pagos y suscripciones. Cuando pagás, Mercado Pago recibe los datos necesarios para procesar el cobro (esto lo maneja Mercado Pago según su propia política de privacidad).
- **Brevo** — envía los mails de la App (confirmación de cuenta, recibos, avisos del plan, resúmenes de ahorro, alertas).
- **ImprovMX** — reenvía los mails que nos mandás a contacto@mi-superapp.com.ar a nuestra casilla.
- **Google** (opcional) — si elegís iniciar sesión con Google, Google comparte con nosotros tu mail y nombre según los permisos que autorices.
- **Servicio de notificaciones de tu navegador** (por ejemplo, el de Google, Apple o Mozilla, según qué navegador uses) — si activás las notificaciones push, la notificación (cifrada) pasa por ese servicio para llegar a tu dispositivo.

No compartimos tus datos con nadie más, salvo que la ley nos obligue.

## 5. Datos guardados en tu dispositivo

Para usar la App necesitás una cuenta. Además de lo que guardamos en nuestros servidores, la App guarda en el almacenamiento local de tu navegador/teléfono tu sesión y una copia de tu carrito, tarjetas, supermercados activos y preferencias, para que funcione más rápido y no pierdas lo que estabas armando. Esos datos se sincronizan con tu cuenta; la copia local la podés borrar limpiando los datos del navegador o de la app.

## 6. Seguridad

Los datos en Supabase están protegidos con políticas de seguridad a nivel de fila (RLS): cada usuario solo puede leer y modificar sus propios datos. Toda la comunicación entre la App y nuestros servidores viaja cifrada (HTTPS).

## 7. Tus derechos

Conforme a la Ley de Protección de Datos Personales (Ley 25.326) de Argentina, tenés derecho a acceder, rectificar o solicitar la eliminación de tus datos personales. Para ejercer estos derechos, o para pedir la baja completa de tu cuenta (borrado de todos tus datos), escribinos a contacto@mi-superapp.com.ar.

La Agencia de Acceso a la Información Pública, en su carácter de Órgano de Control de la Ley 25.326, tiene la atribución de atender denuncias y reclamos que se interpongan por incumplimiento de las normas de protección de datos personales.

## 8. Retención de datos

Guardamos tus datos mientras tu cuenta esté activa. Si pedís la baja de tu cuenta, eliminamos tus datos personales, salvo la información que estemos obligados a conservar por ley (por ejemplo, registros de pagos, según normativa impositiva).

## 9. Cambios a esta política

Podemos actualizar esta Política de Privacidad. Si el cambio es significativo, te avisaremos por mail o dentro de la App.

## 10. Contacto

Dudas sobre tus datos o esta política: **contacto@mi-superapp.com.ar**
