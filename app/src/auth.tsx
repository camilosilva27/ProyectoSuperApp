/**
 * Sesión de Supabase (Fase 1, Plan_Usuarios_y_cobros.md).
 *
 * Los providers de datos que van a poder sincronizar con Supabase (carrito.tsx,
 * carritosGuardados.tsx, filtrosSupers.tsx) necesitan saber si hay sesión antes de decidir de
 * dónde hidratar/persistir — AsyncStorage si es anónimo, Supabase si está logueado. Por eso
 * este provider envuelve a los demás en _layout.tsx, no al revés.
 *
 * Todavía no expone signUp/signIn/signOut — eso se agrega junto con la UI de login en
 * ajustes.tsx (turno siguiente). Este paso solo deja el estado de sesión disponible.
 */

import type { Session } from '@supabase/supabase-js';
import React, { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from './supabase';

type Contexto = {
  session: Session | null;
  /** true hasta que se resuelve la sesión guardada la primera vez (AsyncStorage → Supabase). */
  cargando: boolean;
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

    return () => suscripcion.subscription.unsubscribe();
  }, []);

  return <AuthContext.Provider value={{ session, cargando }}>{children}</AuthContext.Provider>;
}

export function useAuth(): Contexto {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth tiene que usarse dentro de <AuthProvider>');
  return ctx;
}
