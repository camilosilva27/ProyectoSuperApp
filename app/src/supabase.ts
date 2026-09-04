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
    // Login con Google (web, ver auth.tsx § iniciarSesionConGoogle): Supabase redirige de
    // vuelta con `?code=...` en la URL (PKCE), y esto es lo que hace que el cliente lo
    // detecte solo y lo canjee por sesión al cargar la página, sin código manual. Solo en
    // web: en nativo no hay flujo OAuth armado todavía (ver la nota de alcance en
    // FormularioAuth.tsx), así que se deja en false para no interferir con nada ahí. No pisa
    // el manejo manual del link de confirmación de mail (`token_hash`+`type=email`, en
    // auth.tsx): son parámetros de URL distintos a `code`.
    detectSessionInUrl: Platform.OS === 'web',
  },
});
