/**
 * Código postal del usuario, específico de La Anónima — no es un dato general de ubicación de
 * la app, es un gate de cobertura para un solo super (ver AllPromos/core/laanonima-zona.js: el
 * precio es el mismo en toda zona con venta de supermercado, el CP solo confirma si esa zona
 * existe para el usuario). Por eso vive en un contexto separado de filtrosSupers.tsx, no
 * adentro: filtrosSupers es una preferencia genérica de "qué supers comparar" que no debería
 * saber nada de la lógica particular de un super puntual.
 *
 * `estado === null` significa "todavía no se preguntó nunca" — el disparador está en
 * app/(tabs)/index.tsx, la primera vez que el usuario activa La Anónima en BarraSupers.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { verificarCoberturaLaAnonima } from './api';

const CLAVE = 'allpromos:cpLaAnonima:v1';

export type EstadoCP = { codigoPostal: string | null; coberturaConfirmada: boolean };

type Contexto = {
  estado: EstadoCP | null;
  cargado: boolean;
  /** Verifica cobertura contra el backend, persiste el resultado, y lo devuelve — quien llama
   *  decide qué hacer según el booleano (ver ModalCodigoPostalLaAnonima). */
  guardar: (cp: string) => Promise<boolean>;
  /** El usuario prefirió no decir su CP: se guarda igual (para no volver a preguntar), sin
   *  cobertura — mismo trato que un CP sin cobertura real. */
  omitir: () => void;
};

const CodigoPostalContext = createContext<Contexto | null>(null);

export function ProveedorCodigoPostalLaAnonima({ children }: { children: React.ReactNode }) {
  const [estado, setEstado] = useState<EstadoCP | null>(null);
  const [cargado, setCargado] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(CLAVE)
      .then(crudo => {
        if (!crudo) return;
        const guardado = JSON.parse(crudo);
        if (guardado && typeof guardado.coberturaConfirmada === 'boolean') setEstado(guardado);
      })
      .catch(() => { /* si falla la lectura, se trata como "todavía no se preguntó" */ })
      .finally(() => setCargado(true));
  }, []);

  const valor = useMemo<Contexto>(() => ({
    estado,
    cargado,
    guardar: async cp => {
      const codigoPostal = cp.trim();
      const { coberturaConfirmada } = await verificarCoberturaLaAnonima(codigoPostal);
      const nuevo: EstadoCP = { codigoPostal, coberturaConfirmada };
      setEstado(nuevo);
      await AsyncStorage.setItem(CLAVE, JSON.stringify(nuevo)).catch(() => {});
      return coberturaConfirmada;
    },
    omitir: () => {
      const nuevo: EstadoCP = { codigoPostal: null, coberturaConfirmada: false };
      setEstado(nuevo);
      AsyncStorage.setItem(CLAVE, JSON.stringify(nuevo)).catch(() => {});
    },
  }), [estado, cargado]);

  return <CodigoPostalContext.Provider value={valor}>{children}</CodigoPostalContext.Provider>;
}

export function useCodigoPostalLaAnonima(): Contexto {
  const ctx = useContext(CodigoPostalContext);
  if (!ctx) throw new Error('useCodigoPostalLaAnonima tiene que usarse dentro de <ProveedorCodigoPostalLaAnonima>');
  return ctx;
}
