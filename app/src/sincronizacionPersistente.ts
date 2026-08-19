/**
 * Sincroniza un "blob" de estado (columnas de perfil_usuario) entre AsyncStorage (anónimo) y
 * Supabase (logueado) — Plan_Usuarios_y_cobros.md, Fase 1.
 *
 * Los 3 dominios que usan esto (carrito, tarjetas propias, supers activos) ya se tratan como
 * blobs reescritos enteros — nunca se consultan por fila, así que no amerita tablas separadas
 * ni diff granular. `carrito_guardado` es distinto (una fila real por lista guardada) y por eso
 * NO usa este hook — tiene su propia lógica en carritosGuardados.tsx.
 *
 * Migración anónimo → logueado: corre una sola vez, al detectar la transición dentro de esta
 * misma sesión de la app (no en cada arranque con una sesión ya activa desde antes). Si la fila
 * del servidor todavía está en su default de creación, sube el valor local; si no, gana el
 * servidor y se descarta lo local — mismo criterio que describe el plan.
 *
 * Los `.update(... as any)`: no generamos los tipos de Supabase (`createClient<Database>`), y
 * sin eso el chequeo de "propiedades de más" de `.update()` no puede verificar `Fila` genérico
 * contra la tabla real — se cae al mismo nivel de confianza que ya tiene el resto del cliente.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useRef } from 'react';
import { useAuth } from './auth';
import { supabase } from './supabase';

type Opciones<Local, Fila extends Record<string, unknown>> = {
  /** Clave de AsyncStorage — mismo formato que ya se usa hoy, no cambia por esto. */
  clave: string;
  columnas: (keyof Fila & string)[];
  /** Estado local actual; null mientras el caller todavía no hidrató lo propio (evita pisar). */
  valor: Local | null;
  aFila: (local: Local) => Fila;
  deFila: (fila: Fila) => Local;
  /** La fila del servidor sigue en su default de creación (nunca se sincronizó todavía). */
  filaVacia: (fila: Fila) => boolean;
  /** Se llama siempre que termina un intento de hidratar, con `null` si no había nada que
   *  aplicar (AsyncStorage vacío, o error leyendo Supabase) — el caller usa esto también para
   *  marcar su propio "ya cargó", no solo para aplicar un valor. */
  onHidratar: (local: Local | null) => void;
};

export function useSincronizacionPersistente<Local, Fila extends Record<string, unknown>>({
  clave, columnas, valor, aFila, deFila, filaVacia, onHidratar,
}: Opciones<Local, Fila>) {
  const { session, cargando: authCargando } = useAuth();
  const userId = session?.user.id ?? null;

  // Último origen (userId, o 'anonimo') para el que ya se hidrató.
  const fuenteHidratadaRef = useRef<string | null>(null);
  // Si esta sesión de la app llegó a hidratar como anónimo antes de ver una sesión — distingue
  // "recién me logueo, migro lo local" de "abrí la app y ya estaba logueado de antes".
  const yaFueAnonimoRef = useRef(false);

  useEffect(() => {
    if (authCargando) return;
    const fuente = userId ?? 'anonimo';
    if (fuenteHidratadaRef.current === fuente) return;

    const esTransicionALogueado = yaFueAnonimoRef.current && userId !== null;

    (async () => {
      if (!userId) {
        yaFueAnonimoRef.current = true;
        let local: Local | null = null;
        try {
          const crudo = await AsyncStorage.getItem(clave);
          if (crudo) local = JSON.parse(crudo);
        } catch {
          // Datos corruptos en AsyncStorage: se ignoran, el caller se queda con su estado inicial.
        }
        onHidratar(local);
        fuenteHidratadaRef.current = fuente;
        return;
      }

      const { data, error } = await supabase
        .from('perfil_usuario')
        .select(columnas.join(','))
        .eq('id', userId)
        .single();

      if (error || !data) {
        onHidratar(null);
        fuenteHidratadaRef.current = fuente;
        return;
      }
      const fila = data as unknown as Fila;

      if (esTransicionALogueado && valor !== null && filaVacia(fila)) {
        // Primer login con datos locales y el servidor todavía vacío: sube lo local. El estado
        // del caller ya es `valor` — se re-afirma igual, así el caller también se marca "cargado".
        await supabase.from('perfil_usuario').update(aFila(valor) as any).eq('id', userId);
        onHidratar(valor);
      } else {
        onHidratar(deFila(fila));
      }
      fuenteHidratadaRef.current = fuente;
    })();
  }, [authCargando, userId]);

  useEffect(() => {
    if (valor === null) return;
    const fuente = userId ?? 'anonimo';
    if (fuenteHidratadaRef.current !== fuente) return; // no pisar antes de hidratar esta fuente

    if (!userId) {
      AsyncStorage.setItem(clave, JSON.stringify(valor)).catch(() => {});
    } else {
      supabase.from('perfil_usuario').update(aFila(valor) as any).eq('id', userId).then(() => {});
    }
  }, [valor, userId]);
}
