/**
 * Preferencia persistente de en qué supermercados buscar y comparar precios.
 *
 * A diferencia del carrito (que se vacía seguido), esto es una preferencia de fondo: alguien
 * en una zona sin Coto ni Día la apaga una vez y se mantiene entre sesiones, sin tener que
 * volver a tocarla cada vez que abre la app. Afecta tanto la búsqueda de catálogo como la
 * comparación de precios en vivo (ver buscarProductos/comparar/precios en api.ts) — un super
 * apagado acá no aparece en ninguna de las dos.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { SuperKey } from './api';
import { ORDEN_SUPERS } from './componentes/comunes';

const CLAVE = 'allpromos:supersActivos:v1';

// La Anónima no entra en el default: a diferencia del resto, activarla dispara una pregunta
// de código postal (ver ModalCodigoPostalLaAnonima en app/(tabs)/index.tsx) porque es un gate
// de cobertura, no una preferencia simple — no tiene sentido "activarla" silenciosamente para
// alguien que nunca pasó por esa pregunta. Se suma recién cuando el usuario la activa a mano.
const SUPERS_ACTIVOS_POR_DEFECTO = ORDEN_SUPERS.filter(k => k !== 'laanonima');

type Contexto = {
  supersActivos: SuperKey[];
  toggleSuper: (key: SuperKey) => void;
};

const FiltrosSupersContext = createContext<Contexto | null>(null);

export function ProveedorFiltrosSupers({ children }: { children: React.ReactNode }) {
  const [supersActivos, setSupersActivos] = useState<SuperKey[]>(SUPERS_ACTIVOS_POR_DEFECTO);
  const [cargado, setCargado] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(CLAVE)
      .then(crudo => {
        if (!crudo) return;
        const guardado = JSON.parse(crudo);
        const limpio = Array.isArray(guardado)
          ? guardado.filter((k: string) => ORDEN_SUPERS.includes(k as SuperKey))
          : [];
        if (limpio.length) setSupersActivos(limpio);
      })
      .catch(() => { /* si falla la lectura, se queda con los 5 activos por defecto */ })
      .finally(() => setCargado(true));
  }, []);

  useEffect(() => {
    if (!cargado) return; // no sobreescribir lo guardado antes de hidratar
    AsyncStorage.setItem(CLAVE, JSON.stringify(supersActivos)).catch(() => {});
  }, [supersActivos, cargado]);

  const valor = useMemo<Contexto>(() => ({
    supersActivos,
    toggleSuper: key => setSupersActivos(prev => {
      if (prev.includes(key)) {
        if (prev.length === 1) return prev; // siempre tiene que quedar al menos uno activo
        return prev.filter(k => k !== key);
      }
      return ORDEN_SUPERS.filter(k => k === key || prev.includes(k));
    }),
  }), [supersActivos]);

  return <FiltrosSupersContext.Provider value={valor}>{children}</FiltrosSupersContext.Provider>;
}

export function useFiltrosSupers(): Contexto {
  const ctx = useContext(FiltrosSupersContext);
  if (!ctx) throw new Error('useFiltrosSupers tiene que usarse dentro de <ProveedorFiltrosSupers>');
  return ctx;
}
