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

type Contexto = {
  supersActivos: SuperKey[];
  toggleSuper: (key: SuperKey) => void;
  /** Reemplazo en bloque, para la hoja "Qué supers comparar": aplica todos los cambios de
   *  golpe al cerrar, en vez de un toggle por fila. Ignora el pedido si dejaría todo apagado. */
  setSupersActivos: (keys: SuperKey[]) => void;
  usoPorSuper: UsoPorSuper;
  /** Se llama una vez por comparación vista (resultado.tsx), con los supers que participaron. */
  registrarUso: (keys: SuperKey[]) => void;
};

const FiltrosSupersContext = createContext<Contexto | null>(null);

type FilaPerfil = { supers_activos: SuperKey[] };

export function ProveedorFiltrosSupers({ children }: { children: React.ReactNode }) {
  const [supersActivos, aplicarSupersActivos] = useState<SuperKey[]>(SUPERS_ACTIVOS_POR_DEFECTO);
  const [cargado, setCargado] = useState(false);
  const [usoPorSuper, setUsoPorSuper] = useState<UsoPorSuper>({});

  useSincronizacionPersistente<SuperKey[], FilaPerfil>({
    clave: CLAVE,
    columnas: ['supers_activos'],
    valor: cargado ? supersActivos : null,
    aFila: local => ({ supers_activos: local }),
    deFila: fila => fila.supers_activos,
    filaVacia: fila => fila.supers_activos.length === 0,
    onHidratar: local => {
      const limpio = Array.isArray(local)
        ? local.filter((k: string) => ORDEN_SUPERS.includes(k as SuperKey))
        : [];
      if (limpio.length) aplicarSupersActivos(limpio);
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
    toggleSuper: key => aplicarSupersActivos(prev => {
      if (prev.includes(key)) {
        if (prev.length === 1) return prev; // siempre tiene que quedar al menos uno activo
        return prev.filter(k => k !== key);
      }
      return ORDEN_SUPERS.filter(k => k === key || prev.includes(k));
    }),
    setSupersActivos: keys => {
      if (!keys.length) return; // siempre tiene que quedar al menos uno activo
      aplicarSupersActivos(ORDEN_SUPERS.filter(k => keys.includes(k)));
    },
    usoPorSuper,
    registrarUso,
  }), [supersActivos, usoPorSuper, registrarUso]);

  return <FiltrosSupersContext.Provider value={valor}>{children}</FiltrosSupersContext.Provider>;
}

export function useFiltrosSupers(): Contexto {
  const ctx = useContext(FiltrosSupersContext);
  if (!ctx) throw new Error('useFiltrosSupers tiene que usarse dentro de <ProveedorFiltrosSupers>');
  return ctx;
}
