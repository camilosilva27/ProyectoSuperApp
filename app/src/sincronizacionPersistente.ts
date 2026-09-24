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
  /** Se llama cuando termina de hidratar, con `null` si no había nada que aplicar (AsyncStorage
   *  vacío) — el caller usa esto también para marcar su propio "ya cargó", no solo para aplicar
   *  un valor. Si falla la lectura de Supabase NO se llama (se reintenta con backoff): marcar
   *  "cargado" con el estado vacío habilitaría la escritura que pisa lo del servidor. */
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

  // Escrituras a Supabase serializadas con "última gana" (auditoría 2026-09-24): antes cada
  // cambio disparaba un `.update()` suelto sin esperar al anterior, así que con cambios rápidos
  // (tocar +/+/+ en el carrito) dos updates podían llegar al revés y quedar guardado un estado
  // viejo. Ahora hay a lo sumo un update en vuelo; si llegan cambios mientras tanto, se guarda
  // solo el último y se manda cuando termina el anterior. Sin debounce a propósito: una demora
  // artificial es una ventana más para perder el último cambio si se cierra la pestaña.
  const enviandoRef = useRef(false);
  const pendienteRef = useRef<{ userId: string; valor: Local } | null>(null);

  const drenarEscrituras = async () => {
    if (enviandoRef.current) return;
    enviandoRef.current = true;
    try {
      while (pendienteRef.current) {
        const { userId: idDestino, valor: aEnviar } = pendienteRef.current;
        pendienteRef.current = null;
        const { error } = await supabase
          .from('perfil_usuario').update(aFila(aEnviar) as any).eq('id', idDestino);
        if (error) console.warn(`[sincronizacion ${clave}] no se pudo guardar en Supabase`, error.message);
      }
    } finally {
      enviandoRef.current = false;
    }
  };

  useEffect(() => {
    if (authCargando) return;
    const fuente = userId ?? 'anonimo';
    if (fuenteHidratadaRef.current === fuente) return;

    const esTransicionALogueado = yaFueAnonimoRef.current && userId !== null;
    let cancelado = false;
    let reintento: ReturnType<typeof setTimeout> | null = null;

    const hidratar = async (intento: number) => {
      if (!userId) {
        yaFueAnonimoRef.current = true;
        let local: Local | null = null;
        try {
          const crudo = await AsyncStorage.getItem(clave);
          if (crudo) local = JSON.parse(crudo);
        } catch {
          // Datos corruptos en AsyncStorage: se ignoran, el caller se queda con su estado inicial.
        }
        if (cancelado) return;
        onHidratar(local);
        fuenteHidratadaRef.current = fuente;
        return;
      }

      const { data, error } = await supabase
        .from('perfil_usuario')
        .select(columnas.join(','))
        .eq('id', userId)
        .single();
      if (cancelado) return;

      if (error || !data) {
        // Auditoría 2026-09-24: antes esto llamaba `onHidratar(null)` y marcaba la fuente como
        // hidratada — el caller quedaba "cargado" con su estado vacío por defecto y el efecto de
        // escritura de abajo lo subía, pisando el carrito/tarjetas/supers reales del servidor
        // por un error de red. Ahora NO se hidrata ni se habilitan escrituras: se reintenta con
        // backoff (1s, 2s, 4s… tope 30s) mientras siga siendo el mismo usuario.
        console.warn(`[sincronizacion ${clave}] no se pudo leer perfil_usuario (intento ${intento + 1})`, error?.message);
        const espera = Math.min(30_000, 1000 * 2 ** intento);
        reintento = setTimeout(() => { hidratar(intento + 1); }, espera);
        return;
      }
      const fila = data as unknown as Fila;

      if (esTransicionALogueado && valor !== null && filaVacia(fila)) {
        // Primer login con datos locales y el servidor todavía vacío: sube lo local. El estado
        // del caller ya es `valor` — se re-afirma igual, así el caller también se marca "cargado".
        const { error: errorSubida } = await supabase
          .from('perfil_usuario').update(aFila(valor) as any).eq('id', userId);
        if (errorSubida) console.warn(`[sincronizacion ${clave}] no se pudo migrar lo local`, errorSubida.message);
        if (cancelado) return;
        onHidratar(valor);
      } else {
        onHidratar(deFila(fila));
      }
      fuenteHidratadaRef.current = fuente;
    };

    hidratar(0);
    return () => {
      cancelado = true;
      if (reintento) clearTimeout(reintento);
    };
  }, [authCargando, userId]);

  useEffect(() => {
    if (valor === null) return;
    const fuente = userId ?? 'anonimo';
    if (fuenteHidratadaRef.current !== fuente) return; // no pisar antes de hidratar esta fuente

    if (!userId) {
      AsyncStorage.setItem(clave, JSON.stringify(valor)).catch((err) => {
        console.warn(`[sincronizacion ${clave}] no se pudo guardar en AsyncStorage`, err);
      });
    } else {
      pendienteRef.current = { userId, valor };
      drenarEscrituras();
    }
  }, [valor, userId]);
}
