/**
 * Código de referido que trae el link de invitación (`superahorro.com.ar/?ref=CODIGO`, ver
 * .claude/docs/PLAN_REFERIDOS.md). Se guarda apenas se abre la app, antes de que exista la
 * cuenta, y se usa en dos momentos:
 * - al registrarse con mail+contraseña viaja en `user_metadata.ref` (auth.tsx), así no se pierde
 *   si la persona confirma el mail desde otro dispositivo o navegador;
 * - ya con sesión, `AsociadorReferido` se lo manda al backend una vez.
 *
 * Sin React a propósito: lo importan tanto auth.tsx como el asociador, que depende de auth.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

const CLAVE = 'superahorro:codigoReferido:v1';
// Mismo formato que acepta el backend (normalizarCodigo en backend/src/referidos.js).
const FORMATO = /^[A-Z0-9]{4,12}$/;

export function normalizarCodigoReferido(codigo: unknown): string | null {
  if (typeof codigo !== 'string') return null;
  const normal = codigo.trim().toUpperCase();
  return FORMATO.test(normal) ? normal : null;
}

/**
 * Web: si la URL trae `?ref=`, lo guarda. Un link nuevo pisa uno anterior: vale el último que
 * abrió. En nativo no hace nada (todavía no hay deep links). Sacarlo de la barra de direcciones
 * no se puede desde acá: expo-router lo vuelve a escribir desde su estado al hidratar — eso lo
 * hace `AsociadorReferido` con `router.setParams`, ya con la navegación montada.
 */
export async function capturarCodigoReferidoDeUrl(): Promise<void> {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return;
  try {
    const crudo = new URLSearchParams(window.location.search).get('ref');
    if (crudo === null) return;
    const codigo = normalizarCodigoReferido(crudo);
    if (codigo) await AsyncStorage.setItem(CLAVE, codigo);
  } catch {
    // Storage bloqueado (modo privado, etc.): sin código guardado, la invitación no cuenta.
  }
}

export async function leerCodigoReferidoGuardado(): Promise<string | null> {
  try {
    return normalizarCodigoReferido(await AsyncStorage.getItem(CLAVE));
  } catch {
    return null;
  }
}

export async function olvidarCodigoReferido(): Promise<void> {
  try {
    await AsyncStorage.removeItem(CLAVE);
  } catch {
    /* nada que hacer */
  }
}
