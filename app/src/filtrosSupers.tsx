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

import React, { createContext, useContext, useMemo, useState } from 'react';
import type { SuperKey } from './api';
import { ORDEN_SUPERS } from './componentes/comunes';
import { useSincronizacionPersistente } from './sincronizacionPersistente';

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

type FilaPerfil = { supers_activos: SuperKey[] };

export function ProveedorFiltrosSupers({ children }: { children: React.ReactNode }) {
  const [supersActivos, setSupersActivos] = useState<SuperKey[]>(SUPERS_ACTIVOS_POR_DEFECTO);
  const [cargado, setCargado] = useState(false);

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
      if (limpio.length) setSupersActivos(limpio);
      setCargado(true);
    },
  });

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
