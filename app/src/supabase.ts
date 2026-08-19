/**
 * Cliente de Supabase — cuentas y datos personales (Fase 1, Plan_Usuarios_y_cobros.md).
 *
 * Dominio separado del backend de AllPromos (api.ts): comparar/precios sigue siendo el
 * Express de la VM, esto habla directo con Supabase (auth + perfil_usuario + carrito_guardado),
 * sin que el Express intermedie — es el patrón idiomático de Supabase, y hoy no hay ninguna
 * razón de negocio para que el Express se meta en el medio de datos de cuenta.
 *
 * AsyncStorage como storage de sesión en nativo (no expo-sqlite/localStorage, que es lo que
 * sugiere el quickstart más nuevo de Supabase): ya es una dependencia del proyecto, ya probada
 * en esta misma app (carrito.tsx, filtrosSupers.tsx), y cumple exactamente la interfaz que
 * supabase-js espera de `storage` — no hay necesidad de sumar otra pieza.
 *
 * En web NO se pasa `storage` a propósito: el export de Expo Router pre-renderiza en Node
 * (sin `window`), y el shim web de AsyncStorage asume `window.localStorage` sin la guarda que
 * sí tiene @supabase/auth-js (`isBrowser()`, con fallback a un storage en memoria si no hay
 * `window`) — pasarle AsyncStorage ahí rompía el SSR con "window is not defined" y tiraba abajo
 * el server de Metro entero. Dejando `storage` sin definir en web, supabase-js usa ese default
 * seguro por su cuenta.
 */

import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Faltan EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY en app/.env'
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    ...(Platform.OS === 'web' ? {} : { storage: AsyncStorage }),
    autoRefreshToken: true,
    persistSession: true,
    // Sin flujo de redirect por URL (magic link por deep link, OAuth) todavía — cuando se
    // agregue login social hay que revisar esto.
    detectSessionInUrl: false,
  },
});
