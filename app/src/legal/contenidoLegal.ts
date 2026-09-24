/**
 * Contenido de Términos de Servicio y Política de Privacidad, compartido entre la pantalla de
 * ruta (app/terminos.tsx, app/privacidad.tsx — alcanzables desde Ajustes con sesión) y el modal
 * pre-login (ModalLegal.tsx, usado por el checkbox de registro en FormularioAuth.tsx, que corre
 * ANTES de que exista sesión — ahí no hay ningún Stack de Expo Router montado, ver GateSesion.tsx,
 * así que `router.push` no sirve y hace falta un Modal nativo en vez de navegación).
 *
 * Espejo de .claude/docs/TERMINOS_DE_SERVICIO.md y .claude/docs/POLITICA_DE_PRIVACIDAD.md — no
 * hay renderer de markdown en el proyecto, así que el texto vive hardcodeado acá. Si se edita un
 * lado, actualizar el otro.
 */

export type SeccionLegal = { titulo: string; cuerpo: string };

export const SECCIONES_TERMINOS: SeccionLegal[] = [
  {
    titulo: '1. Aceptación de los términos',
    cuerpo: 'Al crear una cuenta o usar SuperAhorro ("la App"), aceptás estos Términos de Servicio y la Política de Privacidad. Si no estás de acuerdo, no uses la App.\n\nLa App es operada por Camilo Silva, persona física (no hay una empresa/razón social detrás), con contacto en contacto@mi-superapp.com.ar.',
  },
  {
    titulo: '2. Qué es SuperAhorro',
    cuerpo: 'SuperAhorro es un comparador de precios de supermercados: junta y compara precios, promociones y descuentos bancarios publicados por distintas cadenas para ayudarte a armar tu compra más barata.\n\nSuperAhorro no vende productos, no procesa compras de supermercado ni es parte de ninguna transacción entre vos y el supermercado. Los precios y promos pueden tener errores, demoras o quedar desactualizados — siempre confirmá el precio final en el supermercado antes de pagar. No nos hacemos responsables por diferencias entre el precio mostrado en la App y el precio real en caja.',
  },
  {
    titulo: '3. Cuenta de usuario',
    cuerpo: 'Para usar la App necesitás crear una cuenta. Sos responsable de mantener la confidencialidad de tu contraseña y de toda actividad que ocurra en tu cuenta. Tiene que ser una cuenta real tuya, no compartida ni de otra persona sin su consentimiento.',
  },
  {
    titulo: '4. Planes, precios y período de prueba',
    cuerpo: 'Todo usuario nuevo arranca con un período de prueba gratuito con acceso completo. Al finalizar, para seguir usando la App hace falta un plan pago: mensual, anual o permanente (pago único). Los precios vigentes se muestran en la pantalla de selección de plan dentro de la App y pueden cambiar — el precio que pagás en el momento de suscribirte queda fijo mientras esa suscripción siga activa. No ofrecemos un plan gratuito permanente: sin un plan pago activo o un período de prueba vigente, la App no está disponible.',
  },
  {
    titulo: '5. Pagos y facturación',
    cuerpo: 'Los pagos se procesan a través de Mercado Pago. Nosotros no vemos ni almacenamos los datos de tu tarjeta. El plan mensual/anual es una suscripción recurrente que se cobra automáticamente hasta que la canceles. El plan permanente es un pago único, sin cobros recurrentes.',
  },
  {
    titulo: '6. Cancelación',
    cuerpo: 'Podés cancelar tu suscripción en cualquier momento desde Ajustes → Plan y pago. Al cancelar, no se te va a cobrar el próximo período, pero conservás el acceso hasta el final del período ya pagado (sin reembolso de lo ya transcurrido). El plan permanente no tiene cancelación: una vez comprado, el acceso no vence.',
  },
  {
    titulo: '7. Derecho de arrepentimiento',
    cuerpo: 'Conforme a la Ley de Defensa del Consumidor (Ley 24.240) de Argentina, si compraste un plan de forma remota tenés derecho a arrepentirte dentro de los 10 días corridos desde la contratación, sin justificar el motivo, y a que se te reintegre lo pagado. Escribinos a contacto@mi-superapp.com.ar dentro de ese plazo para ejercerlo.',
  },
  {
    titulo: '8. Uso aceptable',
    cuerpo: 'No está permitido scrapear, revender o redistribuir masivamente los datos de precios/promos, intentar vulnerar la seguridad de la App o acceder a cuentas de otros usuarios, ni usarla con fines ilegales. Nos reservamos el derecho de suspender cuentas que violen esto.',
  },
  {
    titulo: '9. Propiedad intelectual',
    cuerpo: 'El diseño, marca, logo y código de SuperAhorro nos pertenecen (o están licenciados para nuestro uso). Los logos de los supermercados pertenecen a sus respectivas cadenas y se usan solo con fines identificatorios.',
  },
  {
    titulo: '10. Exactitud de la información',
    cuerpo: 'La información de precios y promociones se ofrece "tal cual", sin garantía de exactitud, disponibilidad o actualización en tiempo real. No garantizamos que la App esté libre de errores o interrupciones.',
  },
  {
    titulo: '11. Limitación de responsabilidad',
    cuerpo: 'En la máxima medida permitida por la ley, no somos responsables por daños indirectos ni pérdidas derivadas de decisiones de compra tomadas en base a la App. Nuestra responsabilidad total se limita al monto pagado por tu plan en los últimos 12 meses.',
  },
  {
    titulo: '12. Modificaciones',
    cuerpo: 'Podemos modificar estos Términos en cualquier momento. Si el cambio es significativo, te avisaremos por mail o dentro de la App. Usar la App después de un cambio implica aceptarlo.',
  },
  {
    titulo: '13. Terminación',
    cuerpo: 'Podemos suspender o cerrar tu cuenta si violás estos Términos. Vos podés dejar de usar la App y pedir la baja de tu cuenta cuando quieras, escribiendo a contacto@mi-superapp.com.ar.',
  },
  {
    titulo: '14. Ley aplicable',
    cuerpo: 'Estos Términos se rigen por las leyes de la República Argentina. Conforme a la Ley de Defensa del Consumidor, cualquier disputa se resuelve ante los tribunales correspondientes al domicilio del usuario/consumidor.',
  },
  {
    titulo: '15. Contacto',
    cuerpo: 'Dudas, reclamos o soporte: contacto@mi-superapp.com.ar',
  },
];

export const SECCIONES_PRIVACIDAD: SeccionLegal[] = [
  {
    titulo: '1. Quiénes somos',
    cuerpo: 'SuperAhorro es operada por Camilo Silva, persona física (no hay una empresa/razón social detrás). Contacto: contacto@mi-superapp.com.ar.',
  },
  {
    titulo: '2. Qué datos recolectamos',
    cuerpo: 'Datos de cuenta (mail, nombre, o tu cuenta de Google). Datos de uso: carrito, tarjetas bancarias marcadas como propias (solo nombre/tipo, nunca número de tarjeta), supers activos, listas guardadas, historial de ahorro. Alertas: los productos y categorías que seguís y si tenés activado "Recibir notificaciones". Notificaciones push (web): si las aceptás, la suscripción push que genera tu navegador (dirección técnica de envío y sus claves de cifrado). Datos de pago: el mail que usaste en Mercado Pago y el estado de tu suscripción — nunca el número de tarjeta, eso lo procesa y guarda Mercado Pago directamente. Datos técnicos: reportes de errores (qué falló, navegador/sistema operativo, y puede incluir tu dirección IP) y métricas agregadas de uso y rendimiento de la versión web.',
  },
  {
    titulo: '3. Cómo usamos tus datos',
    cuerpo: 'Para darte acceso a la App y sincronizar tu carrito entre dispositivos, gestionar tu plan y pagos, calcular tu historial de ahorro, y detectar errores y mejorar el rendimiento. Te mandamos mails operativos (confirmación de cuenta, recibos, aviso de fin del período de prueba y otros avisos de plan) y, además, resúmenes semanal y mensual de ahorro, un aviso si hace un tiempo que no entrás, y alertas de promos de lo que seguís (por mail y push).\n\nLas alertas se apagan desde la App con "Recibir notificaciones" (las push también desde tu navegador). Para dejar de recibir los resúmenes de ahorro, el aviso de inactividad o las alertas por mail, usá el link "date de baja acá" que viene al pie de cada uno de esos mails, o escribinos a contacto@mi-superapp.com.ar con el asunto "baja". Los mails operativos se siguen mandando mientras tengas cuenta. No usamos tus datos para publicidad ni los vendemos a terceros.',
  },
  {
    titulo: '4. Con quién compartimos tus datos',
    cuerpo: 'Supabase (base de datos y login), Google Cloud Platform (servidor que procesa los pedidos de la App), Vercel (hosting de la versión web, más Vercel Analytics y Speed Insights para métricas agregadas de uso y rendimiento), Sentry (reportes de errores, que pueden incluir tu IP), Mercado Pago (pagos y suscripciones), Brevo (envío de mails), ImprovMX (reenvío de los mails que nos mandás a contacto@mi-superapp.com.ar), el servicio de notificaciones de tu navegador si activás las push, y, si elegís ese método, Google (login). No compartimos tus datos con nadie más, salvo que la ley nos obligue.',
  },
  {
    titulo: '5. Datos guardados en tu dispositivo',
    cuerpo: 'Para usar la App necesitás una cuenta. Además, la App guarda en el almacenamiento local de tu navegador/teléfono tu sesión y una copia de tu carrito, tarjetas, supers activos y preferencias, para funcionar más rápido. Esos datos se sincronizan con tu cuenta; la copia local la podés borrar limpiando los datos del navegador o de la app.',
  },
  {
    titulo: '6. Seguridad',
    cuerpo: 'Los datos en Supabase están protegidos con políticas de seguridad a nivel de fila (RLS): cada usuario solo puede leer y modificar sus propios datos. Toda la comunicación viaja cifrada (HTTPS).',
  },
  {
    titulo: '7. Tus derechos',
    cuerpo: 'Conforme a la Ley 25.326 de Argentina, tenés derecho a acceder, rectificar o solicitar la eliminación de tus datos personales, o pedir la baja completa de tu cuenta, escribiendo a contacto@mi-superapp.com.ar. La Agencia de Acceso a la Información Pública es el Órgano de Control de esta ley.',
  },
  {
    titulo: '8. Retención de datos',
    cuerpo: 'Guardamos tus datos mientras tu cuenta esté activa. Si pedís la baja, eliminamos tus datos personales salvo lo que estemos obligados a conservar por ley (por ejemplo, registros de pagos).',
  },
  {
    titulo: '9. Cambios a esta política',
    cuerpo: 'Podemos actualizar esta Política de Privacidad. Si el cambio es significativo, te avisaremos por mail o dentro de la App.',
  },
  {
    titulo: '10. Contacto',
    cuerpo: 'Dudas sobre tus datos o esta política: contacto@mi-superapp.com.ar',
  },
];
