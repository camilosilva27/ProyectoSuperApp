/**
 * Notificaciones push web (recordatorio semanal, primer caso de uso — ver
 * backend/src/cron/recordatorioSemanal.js). Solo aplica a `Platform.OS === 'web'`: es la Push
 * API del navegador (service worker + VAPID), no `expo-notifications` (eso es para builds
 * nativos, que hoy no existen en este proyecto).
 *
 * En iOS, `soportaPush()` da `false` salvo que la web esté agregada a la pantalla de inicio
 * DESDE SAFARI. No es una limitación de "Safari" puntualmente sino de iOS en general: todo
 * navegador en iOS (Chrome, Firefox, Edge incluidos) corre sobre el motor de Safari por regla
 * de Apple, pero solo la instalación hecha desde la propia app de Safari obtiene el permiso de
 * push — agregar el sitio a la pantalla de inicio desde Chrome/Firefox en iOS no habilita nada,
 * es una restricción de Apple a nivel de sistema. Por eso el hint de Ajustes cuando no hay
 * soporte (`esperaInstalarEnIOS()`) nombra a Safari explícitamente en vez de decir "tu
 * navegador" — si no, en Chrome para iOS confunde: parece un problema de la app, no del SO.
 */

import { Platform } from 'react-native';
import { supabase } from '../supabase';

const VAPID_PUBLIC_KEY = process.env.EXPO_PUBLIC_VAPID_PUBLIC_KEY;

export function soportaPush(): boolean {
  return Platform.OS === 'web'
    && typeof navigator !== 'undefined'
    && 'serviceWorker' in navigator
    && 'PushManager' in window;
}

/** Para elegir el texto del hint cuando `soportaPush()` da `false` — en iOS hay que nombrar a
 *  Safari específicamente (ver nota de arriba); en cualquier otro caso (navegador embebido de
 *  WhatsApp/Instagram, navegador de escritorio viejo, etc.) el hint genérico alcanza. */
export function esIOS(): boolean {
  if (Platform.OS !== 'web' || typeof navigator === 'undefined') return false;
  if (/iPhone|iPad|iPod/.test(navigator.userAgent)) return true;
  // Con "Sitio de escritorio" activado (Chrome iOS: Configuración > Configuración de
  // contenido > Sitio de escritorio), el user-agent se disfraza de "Macintosh" y no dice
  // "iPhone" — un Mac de verdad no tiene pantalla táctil, así que Mac + táctil es iOS.
  return /Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1;
}

// applicationServerKey necesita un Uint8Array, no el string base64url que da `web-push
// generate-vapid-keys` — conversión estándar de la doc de Push API.
function claveVapidComoUint8Array(base64url: string): Uint8Array {
  const padding = '='.repeat((4 - (base64url.length % 4)) % 4);
  const base64 = (base64url + padding).replace(/-/g, '+').replace(/_/g, '/');
  const binario = atob(base64);
  return Uint8Array.from([...binario].map(c => c.charCodeAt(0)));
}

/** Pide permiso de notificaciones y, si se concede, suscribe al usuario. Devuelve `true` si
 *  quedó habilitado, `false` si el usuario rechazó el permiso o el navegador no soporta push —
 *  nunca tira: el caller (toggle de Ajustes, botón del tour) decide qué mostrar en cada caso. */
export async function pedirPermisoYSuscribir(usuarioId: string): Promise<boolean> {
  if (!soportaPush() || !VAPID_PUBLIC_KEY) return false;

  const permiso = await Notification.requestPermission();
  if (permiso !== 'granted') return false;

  // `register()` puede devolver antes de que el service worker esté activo — `subscribe`
  // necesita uno activo, así que hay que esperar a `.ready` (no al resultado de `register`).
  await navigator.serviceWorker.register('/sw.js');
  const registro = await navigator.serviceWorker.ready;
  const suscripcion = await registro.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: claveVapidComoUint8Array(VAPID_PUBLIC_KEY) as BufferSource,
  });

  const claves = suscripcion.toJSON().keys;
  const { error } = await supabase.from('push_suscripcion').insert({
    endpoint: suscripcion.endpoint,
    usuario_id: usuarioId,
    p256dh: claves?.p256dh ?? '',
    auth: claves?.auth ?? '',
  });
  // 23505 = unique_violation: ya estaba suscripto este mismo navegador, no es un error real.
  if (error && error.code !== '23505') {
    console.error('No se pudo guardar la suscripción push:', error.message);
    return false;
  }

  return true;
}

/** Da de baja la suscripción del navegador actual, tanto del lado del browser como en Supabase. */
export async function desuscribir(): Promise<void> {
  if (!soportaPush()) return;

  const registro = await navigator.serviceWorker.getRegistration('/sw.js');
  const suscripcion = await registro?.pushManager.getSubscription();
  if (!suscripcion) return;

  await supabase.from('push_suscripcion').delete().eq('endpoint', suscripcion.endpoint);
  await suscripcion.unsubscribe();
}

/** Para inicializar el estado del toggle de Ajustes: ¿el navegador actual ya está suscripto? */
export async function yaSuscripto(): Promise<boolean> {
  if (!soportaPush()) return false;
  const registro = await navigator.serviceWorker.getRegistration('/sw.js');
  const suscripcion = await registro?.pushManager.getSubscription();
  return !!suscripcion;
}
