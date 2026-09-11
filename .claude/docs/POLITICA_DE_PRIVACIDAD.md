# Política de Privacidad — Super App

> Adaptado a los datos que la App realmente guarda (ver `.claude/docs/Plan_Usuarios_y_cobros.md`, `CONTEXTO_TECNICO.md`), no un template genérico. No reemplaza asesoramiento legal — para un lanzamiento con volumen real conviene que un abogado lo revise, pero cubre el piso mínimo razonable para el beta con amigos y un lanzamiento chico.

**Última actualización:** 2026-09-11

## 1. Quiénes somos

Super App es operada por Camilo Silva, persona física (no hay una empresa/razón social detrás). Contacto: contacto@mi-superapp.com.ar.

## 2. Qué datos recolectamos

- **Datos de cuenta**: mail y contraseña (o cuenta de Google si iniciás sesión así), nombre.
- **Datos de uso de la app**: carrito actual, tarjetas bancarias que marcás como propias (solo el nombre/tipo de tarjeta, **nunca** número de tarjeta ni datos de pago), supermercados activos, listas de carrito guardadas, historial de ahorro.
- **Datos de pago**: cuando contratás un plan pago, guardamos el mail que usaste en Mercado Pago (`mail_mercado_pago`), el estado de tu suscripción, y las fechas de pago/renovación. **No almacenamos número de tarjeta ni ningún dato sensible de pago** — eso lo procesa y guarda Mercado Pago directamente, nunca pasa por nuestros servidores.

## 3. Cómo usamos tus datos

- Para darte acceso a la App y sincronizar tu carrito/listas entre tus dispositivos.
- Para gestionar tu plan (trial, suscripción, pagos) y saber si tenés acceso vigente.
- Para enviarte mails operativos: confirmación de cuenta, recibo de pago, avisos de tu plan.
- Para calcular tu historial de ahorro dentro de la App.

No usamos tus datos para publicidad ni los vendemos a terceros.

## 4. Con quién compartimos tus datos

Usamos los siguientes proveedores (procesadores de datos) para operar la App:

- **Supabase** — aloja la base de datos y gestiona el login (autenticación).
- **Mercado Pago** — procesa los pagos y suscripciones. Cuando pagás, Mercado Pago recibe los datos necesarios para procesar el cobro (esto lo maneja Mercado Pago según su propia política de privacidad).
- **Brevo** — envía los mails transaccionales de la App (confirmación de cuenta, recibos).
- **Google** (opcional) — si elegís iniciar sesión con Google, Google comparte con nosotros tu mail y nombre según los permisos que autorices.

No compartimos tus datos con nadie más, salvo que la ley nos obligue.

## 5. Dónde se guardan los datos que usás sin cuenta

Si usás la App sin crear cuenta, tu carrito, tarjetas y listas guardadas quedan **solo en tu dispositivo** (almacenamiento local del navegador/teléfono), no en nuestros servidores. Al crear una cuenta, esos datos se suben para poder sincronizarlos entre dispositivos.

## 6. Seguridad

Los datos en Supabase están protegidos con políticas de seguridad a nivel de fila (RLS): cada usuario solo puede leer y modificar sus propios datos. Toda la comunicación entre la App y nuestros servidores viaja cifrada (HTTPS).

## 7. Tus derechos

Conforme a la Ley de Protección de Datos Personales (Ley 25.326) de Argentina, tenés derecho a acceder, rectificar o solicitar la eliminación de tus datos personales. Para ejercer estos derechos, o para pedir la baja completa de tu cuenta (borrado de todos tus datos), escribinos a contacto@mi-superapp.com.ar.

La Agencia de Acceso a la Información Pública, en su carácter de Órgano de Control de la Ley 25.326, tiene la atribución de atender denuncias y reclamos que se interpongan por incumplimiento de las normas de protección de datos personales.

## 8. Retención de datos

Guardamos tus datos mientras tu cuenta esté activa. Si pedís la baja de tu cuenta, eliminamos tus datos personales, salvo la información que estemos obligados a conservar por ley (por ejemplo, registros de pagos, según normativa impositiva).

## 9. Fase de pruebas (beta)

Mientras la App esté en fase de pruebas, puede haber ajustes en qué datos recolectamos o cómo los procesamos, a medida que agregamos o cambiamos funciones. Vamos a actualizar esta política si eso cambia de forma significativa.

## 10. Cambios a esta política

Podemos actualizar esta Política de Privacidad. Si el cambio es significativo, te avisaremos por mail o dentro de la App.

## 11. Contacto

Dudas sobre tus datos o esta política: **contacto@mi-superapp.com.ar**
