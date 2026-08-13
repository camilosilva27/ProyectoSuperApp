/**
 * Carritos guardados (turno 4, SPEC.md § 4.4): listas con nombre que el usuario puede volver
 * a cargar, separado del carrito activo (`carrito.tsx`) porque son cosas distintas — el
 * carrito activo se vacía seguido, esto es lo que se guarda a propósito para reusar.
 *
 * Guardar es una foto de los items en ese momento, no un link al carrito activo: cambiar el
 * carrito activo después no cambia lo que ya se guardó.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useContext, useEffect, useMemo, useReducer } from 'react';
import type { ItemCarrito } from './carrito';

export type CarritoGuardado = {
  id: string;
  nombre: string;
  items: ItemCarrito[];
  guardadoEn: string;
};

type Estado = { carritos: CarritoGuardado[]; cargado: boolean };

type Accion =
  | { tipo: 'hidratar'; carritos: CarritoGuardado[] }
  | { tipo: 'guardar'; carrito: CarritoGuardado };

const INICIAL: Estado = { carritos: [], cargado: false };
const CLAVE = 'allpromos:carritosGuardados:v1';

let contadorId = 0;
/** No hace falta un UUID: alcanza con que no choque dentro de la misma sesión. */
function idUnico(): string {
  contadorId += 1;
  return `${Date.now()}-${contadorId}`;
}

function reducir(estado: Estado, accion: Accion): Estado {
  switch (accion.tipo) {
    case 'hidratar':
      return { carritos: accion.carritos, cargado: true };

    case 'guardar':
      // El recién guardado va primero — es lo que hace que la fila más nueva sea también la
      // que el usuario acaba de nombrar (ver borde amarillo en PantallaCarrito).
      return { ...estado, carritos: [accion.carrito, ...estado.carritos] };

    default:
      return estado;
  }
}

type Contexto = {
  carritos: CarritoGuardado[];
  /** Nombre duplicado: se permite, no bloquea el guardado (SPEC § 4.4). */
  guardar: (nombre: string, items: ItemCarrito[]) => CarritoGuardado;
};

const CarritosGuardadosContext = createContext<Contexto | null>(null);

export function ProveedorCarritosGuardados({ children }: { children: React.ReactNode }) {
  const [estado, despachar] = useReducer(reducir, INICIAL);

  useEffect(() => {
    AsyncStorage.getItem(CLAVE)
      .then(crudo => {
        const carritos = crudo ? JSON.parse(crudo) : [];
        despachar({ tipo: 'hidratar', carritos: Array.isArray(carritos) ? carritos : [] });
      })
      .catch(() => despachar({ tipo: 'hidratar', carritos: [] }));
  }, []);

  useEffect(() => {
    if (!estado.cargado) return; // no sobreescribir lo guardado antes de hidratar
    AsyncStorage.setItem(CLAVE, JSON.stringify(estado.carritos)).catch(() => {});
  }, [estado.carritos, estado.cargado]);

  const valor = useMemo<Contexto>(() => ({
    carritos: estado.carritos,
    guardar: (nombre, items) => {
      const carrito: CarritoGuardado = {
        id: idUnico(), nombre, items, guardadoEn: new Date().toISOString(),
      };
      despachar({ tipo: 'guardar', carrito });
      return carrito;
    },
  }), [estado.carritos]);

  return (
    <CarritosGuardadosContext.Provider value={valor}>{children}</CarritosGuardadosContext.Provider>
  );
}

export function useCarritosGuardados(): Contexto {
  const ctx = useContext(CarritosGuardadosContext);
  if (!ctx) throw new Error('useCarritosGuardados tiene que usarse dentro de <ProveedorCarritosGuardados>');
  return ctx;
}
