/**
 * Preferencia persistente de en qué supermercados buscar y comparar precios.
 *
 * A diferencia del carrito (que se vacía seguido), esto es una preferencia de fondo: alguien
 * en una zona sin Coto ni Día la apaga una vez y se mantiene entre sesiones, sin tener que
 * volver a tocarla cada vez que abre la app. Afecta tanto la búsqueda de catálogo como la
 * comparación de precios en vivo (ver buscarProductos/comparar/precios en api.ts) — un super
 * apagado acá no aparece en ninguna de las dos.
 *
 * Anónimo: AsyncStorage. Logueado (Fase 1, Plan_Usuarios_y_cobros.md): sincroniza con
 * `perfil_usuario.supers_activos` en Supabase — ver `useSincronizacionPersistente`. Es la
 * misma razón por la que esto sincroniza entre dispositivos: qué supers te sirven es un dato
 * sobre la persona, no sobre el aparato que tiene en la mano.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { SuperKey } from './api';
import { ORDEN_SUPERS } from './componentes/comunes';
import { useSincronizacionPersistente } from './sincronizacionPersistente';

const CLAVE = 'allpromos:supersActivos:v1';

// Cuántas veces participó cada super en una comparación vista (resultado.tsx). Solo alimenta
// el orden del selector (Parte 1 del turno "selector + hoja de selección": los más usados van
// primero en la fila de celdas) — no es una preferencia como `supersActivos`, así que vive
// solo en el dispositivo (AsyncStorage), sin sincronizar entre sesión/Supabase.
const CLAVE_USO = 'allpromos:usoPorSuper:v1';

const SUPERS_ACTIVOS_POR_DEFECTO = ORDEN_SUPERS;

type UsoPorSuper = Partial<Record<SuperKey, number>>;

/** Normaliza un tope contra la cantidad de supers elegidos: 0 es el sentinel de "sin tope
 *  explícito / Los N" — se usa en vez de guardar el número N literal porque ese número queda
 *  obsoleto en cuanto `supersActivos` cambia (ver regla de clamping abajo). Cualquier tope
 *  guardado que ya no restrinja nada (>= cantidad elegida) se trata como 0. */
function normalizarTope(tope: number, cantidadElegidos: number): number {
  return tope > 0 && tope < cantidadElegidos ? tope : 0;
}

type Contexto = {
  supersActivos: SuperKey[];
  toggleSuper: (key: SuperKey) => void;
  /** Cantidad máxima de supers a visitar — preferencia persistente, no algo por búsqueda. `0`
   *  = sin tope explícito ("Los N"). Cambia el resultado del cálculo (ver comparar() en
   *  api.ts), no es una preferencia de vista. */
  topeSupers: number;
  /** Aplica selección de supers y tope juntos (así se cierran los cambios en la hoja "Qué
   *  supers comparar" — el spec los trata como un solo commit atómico). */
  setSupersYTope: (keys: SuperKey[], tope: number) => void;
  usoPorSuper: UsoPorSuper;
  /** Se llama una vez por comparación vista (resultado.tsx), con los supers que participaron. */
  registrarUso: (keys: SuperKey[]) => void;
};

const FiltrosSupersContext = createContext<Contexto | null>(null);

type FilaPerfil = { supers_activos: SuperKey[]; tope_supers: number };
type LocalPersistido = { activos: SuperKey[]; tope: number };

export function ProveedorFiltrosSupers({ children }: { children: React.ReactNode }) {
  const [supersActivos, aplicarSupersActivos] = useState<SuperKey[]>(SUPERS_ACTIVOS_POR_DEFECTO);
  const [topeSupers, aplicarTopeSupers] = useState(0);
  const [cargado, setCargado] = useState(false);
  const [usoPorSuper, setUsoPorSuper] = useState<UsoPorSuper>({});

  useSincronizacionPersistente<LocalPersistido, FilaPerfil>({
    clave: CLAVE,
    columnas: ['supers_activos', 'tope_supers'],
    valor: cargado ? { activos: supersActivos, tope: topeSupers } : null,
    aFila: local => ({ supers_activos: local.activos, tope_supers: local.tope }),
    deFila: fila => ({ activos: fila.supers_activos, tope: fila.tope_supers }),
    filaVacia: fila => fila.supers_activos.length === 0,
    onHidratar: local => {
      const limpio = Array.isArray(local?.activos)
        ? local.activos.filter((k: string) => ORDEN_SUPERS.includes(k as SuperKey))
        : [];
      if (limpio.length) {
        aplicarSupersActivos(limpio);
        aplicarTopeSupers(normalizarTope(local?.tope ?? 0, limpio.length));
      }
      setCargado(true);
    },
  });

  useEffect(() => {
    AsyncStorage.getItem(CLAVE_USO).then(crudo => {
      if (!crudo) return;
      try {
        setUsoPorSuper(JSON.parse(crudo));
      } catch {
        // corrupto: se ignora, arranca de cero
      }
    });
  }, []);

  const registrarUso = useCallback((keys: SuperKey[]) => {
    setUsoPorSuper(prev => {
      const siguiente = { ...prev };
      for (const key of keys) siguiente[key] = (siguiente[key] ?? 0) + 1;
      AsyncStorage.setItem(CLAVE_USO, JSON.stringify(siguiente)).catch(() => {});
      return siguiente;
    });
  }, []);

  const valor = useMemo<Contexto>(() => ({
    supersActivos,
    // No usa la forma de updater (prev => ...): necesita disparar aplicarTopeSupers como
    // efecto del mismo toggle, y anidar un setState dentro del callback de otro es frágil
    // (puede reejecutarse más de una vez, ej. en StrictMode). `supersActivos` ya está fresco
    // en este closure porque es una dependencia del useMemo.
    toggleSuper: key => {
      const siguiente = supersActivos.includes(key)
        ? (supersActivos.length === 1 ? supersActivos : supersActivos.filter(k => k !== key))
        : ORDEN_SUPERS.filter(k => k === key || supersActivos.includes(k));
      aplicarSupersActivos(siguiente);
      aplicarTopeSupers(t => normalizarTope(t, siguiente.length));
    },
    topeSupers,
    setSupersYTope: (keys, tope) => {
      if (!keys.length) return; // siempre tiene que quedar al menos uno activo
      const limpio = ORDEN_SUPERS.filter(k => keys.includes(k));
      aplicarSupersActivos(limpio);
      aplicarTopeSupers(normalizarTope(tope, limpio.length));
    },
    usoPorSuper,
    registrarUso,
  }), [supersActivos, topeSupers, usoPorSuper, registrarUso]);

  return <FiltrosSupersContext.Provider value={valor}>{children}</FiltrosSupersContext.Provider>;
}

export function useFiltrosSupers(): Contexto {
  const ctx = useContext(FiltrosSupersContext);
  if (!ctx) throw new Error('useFiltrosSupers tiene que usarse dentro de <ProveedorFiltrosSupers>');
  return ctx;
}
