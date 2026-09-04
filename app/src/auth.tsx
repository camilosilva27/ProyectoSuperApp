/**
 * Sesión de Supabase (Fase 1, Plan_Usuarios_y_cobros.md).
 *
 * Los providers de datos que van a poder sincronizar con Supabase (carrito.tsx,
 * carritosGuardados.tsx, filtrosSupers.tsx) necesitan saber si hay sesión antes de decidir de
 * dónde hidratar/persistir — AsyncStorage si es anónimo, Supabase si está logueado. Por eso
 * este provider envuelve a los demás en _layout.tsx, no al revés.
 *
 * Expone signUp/signIn/signOut (turno del prompt de cuenta + Ajustes) — el resto de la app
 * nunca llama a `supabase.auth` directo, pasa siempre por acá.
 *
 * También resuelve el link de confirmación de mail: la plantilla "Confirm signup" de Supabase
 * (dashboard → Auth → Email Templates) se cambia para armar el link con `{{ .TokenHash }}` en
 * vez de `{{ .ConfirmationURL }}` tal cual — así no depende de tocar el Site URL global (que
 * tiene que seguir siendo el del sitio real), y de paso deja logueado directo en vez de
 * "confirmado pero hay que volver a loguearse a mano".
 *
 * Google (2026-09-04, solo web): `iniciarSesionConGoogle` redirige a Google vía
 * `signInWithOAuth` — necesita el provider Google habilitado en Supabase (Authentication >
 * Providers, con un OAuth Client ID/Secret de Google Cloud Console) y `detectSessionInUrl`
 * en `true` en web (ver supabase.ts) para que el `?code=...` con el que Google/Supabase
 * redirigen de vuelta se canjee solo por una sesión.
 */

import type { Session } from '@supabase/supabase-js';
import React, { createContext, useContext, useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { supabase } from './supabase';

/** Mismo texto en los dos lugares donde puede aparecer: el error real que manda Supabase
 *  cuando SÍ lo dice (mensajeError) y la detección por `identities` de más abajo (registrarse,
 *  para el caso — mucho más común en la práctica — en que Supabase no lo dice explícito). */
const MENSAJE_MAIL_YA_EXISTE = 'Ya existe una cuenta con este mail — probá iniciar sesión en vez de registrarte.';

/** Mapea los errores más comunes de Supabase Auth a un mensaje en español, entendible sin
 *  jerga. Supabase oculta a propósito si un mail ya existe (para no revelar cuentas por fuerza
 *  bruta) — por eso el mensaje de "ya existe" es un fallback genérico, no una detección segura. */
function mensajeError(error: unknown): string {
  const codigo = (error as { code?: string } | null)?.code;
  const bruto = error instanceof Error ? error.message : '';

  if (codigo === 'over_email_send_rate_limit') {
    return 'Se mandaron demasiados mails en poco tiempo — esperá unos minutos y probá de nuevo.';
  }
  if (codigo === 'user_already_exists' || /already registered/i.test(bruto)) {
    return MENSAJE_MAIL_YA_EXISTE;
  }
  if (codigo === 'invalid_credentials' || /invalid login credentials/i.test(bruto)) {
    return 'Mail o contraseña incorrectos.';
  }
  if (codigo === 'weak_password' || /password/i.test(bruto)) {
    return 'La contraseña tiene que tener al menos 6 caracteres.';
  }
  if (codigo === 'email_address_invalid') {
    return 'Ese mail no es válido.';
  }
  return bruto || 'Ocurrió un error — probá de nuevo.';
}

type Contexto = {
  session: Session | null;
  /** true hasta que se resuelve la sesión guardada la primera vez (AsyncStorage → Supabase). */
  cargando: boolean;
  /** `necesitaConfirmarMail`: true si Supabase no devolvió sesión (confirmación de mail
   *  activada) — no significa que el registro haya fallado. */
  registrarse: (
    email: string, password: string, nombre: string
  ) => Promise<{ error: string | null; necesitaConfirmarMail: boolean }>;
  iniciarSesion: (email: string, password: string) => Promise<{ error: string | null }>;
  cerrarSesion: () => Promise<void>;
  /** Reenvía el mail de confirmación (pantalla "confirmá tu mail" del registro, botón
   *  "Reenviar el mail" — ver design_handoff_allpromos_v2/14b-landing-cuenta.md). */
  reenviarConfirmacion: (email: string) => Promise<{ error: string | null }>;
  /** Login con Google (solo web por ahora, ver FormularioAuth.tsx). Redirige el navegador —
   *  no hay nada que hacer con el resultado más que mostrar el error si Google/Supabase no
   *  llegan a redirigir (provider mal configurado, sin red, etc). */
  iniciarSesionConGoogle: () => Promise<{ error: string | null }>;
};

const AuthContext = createContext<Contexto | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setCargando(false);
    });

    // Cubre login/logout/refresh de token, en cualquier pestaña o pantalla — no solo el
    // primer getSession() de arriba.
    const { data: suscripcion } = supabase.auth.onAuthStateChange((_evento, nuevaSession) => {
      setSession(nuevaSession);
    });

    // Link de confirmación de mail: llega como ?token_hash=...&type=email en la URL (armado
    // a mano en la plantilla del mail, ver comentario de arriba del archivo). Solo tiene
    // sentido en web — en nativo esto sería un deep link, que no está armado todavía.
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const tokenHash = params.get('token_hash');
      const tipo = params.get('type');
      if (tokenHash && tipo === 'email') {
        supabase.auth.verifyOtp({ token_hash: tokenHash, type: 'email' }).then(({ error }) => {
          // Se limpia la URL haya salido bien o mal, para que un refresh no reintente
          // verificar un token que ya se usó (o que ya falló).
          if (!error) window.history.replaceState({}, '', window.location.pathname);
        });
      }
    }

    return () => suscripcion.subscription.unsubscribe();
  }, []);

  const valor: Contexto = {
    session,
    cargando,
    registrarse: async (email, password, nombre) => {
      // `nombre` viaja en user_metadata (raw_user_meta_data) — el trigger de la base lo copia
      // a perfil_usuario.nombre al crear la fila, ver supabase/migrations/0003_nombre_en_perfil.sql.
      const { data, error } = await supabase.auth.signUp({
        email, password, options: { data: { nombre } },
      });
      if (error) return { error: mensajeError(error), necesitaConfirmarMail: false };
      // Bug real (2026-09-04): registrarse con un mail que YA tiene una cuenta CONFIRMADA no
      // tira error (Supabase lo oculta a propósito, ver mensajeError) y devolvía
      // `necesitaConfirmarMail: true` igual, así que la pantalla "te mandamos un mail" se
      // mostraba sin que se haya mandado nada — mentira por omisión, no solo un mensaje
      // ambiguo. La forma documentada de distinguir este caso sin romper la protección contra
      // fuerza bruta: `data.user.identities` viene vacío (`[]`) solo cuando el mail ya tenía
      // una cuenta confirmada de antes; en un registro nuevo o en un mail ya registrado pero
      // TODAVÍA sin confirmar (ahí Supabase sí reenvía la confirmación), trae la identidad.
      if (data.user && data.user.identities && data.user.identities.length === 0) {
        return { error: MENSAJE_MAIL_YA_EXISTE, necesitaConfirmarMail: false };
      }
      return { error: null, necesitaConfirmarMail: !data.session };
    },
    iniciarSesion: async (email, password) => {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      return { error: error ? mensajeError(error) : null };
    },
    cerrarSesion: async () => {
      await supabase.auth.signOut();
    },
    reenviarConfirmacion: async (email) => {
      const { error } = await supabase.auth.resend({ type: 'signup', email });
      return { error: error ? mensajeError(error) : null };
    },
    iniciarSesionConGoogle: async () => {
      const redirectTo = Platform.OS === 'web' && typeof window !== 'undefined'
        ? window.location.origin
        : undefined;
      const { error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo } });
      return { error: error ? mensajeError(error) : null };
    },
  };

  return <AuthContext.Provider value={valor}>{children}</AuthContext.Provider>;
}

export function useAuth(): Contexto {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth tiene que usarse dentro de <AuthProvider>');
  return ctx;
}
