/**
 * Carritos guardados (turno 4, SPEC.md § 4.4): listas con nombre que el usuario puede volver
 * a cargar, separado del carrito activo (`carrito.tsx`) porque son cosas distintas — el
 * carrito activo se vacía seguido, esto es lo que se guarda a propósito para reusar.
 *
 * Guardar es una foto de los items en ese momento, no un link al carrito activo: cambiar el
 * carrito activo después no cambia lo que ya se guardó.
 *
 * Anónimo: AsyncStorage, un array entero. Logueado (Fase 1, Plan_Usuarios_y_cobros.md): cada
 * lista es una fila real en `carrito_guardado` — a diferencia de carrito.tsx/filtrosSupers.tsx
 * (un solo blob por usuario), esto es 0..N cosas independientes que se pueden borrar/renombrar
 * una por una, así que NO pasa por `useSincronizacionPersistente`: guardar hace un insert
 * puntual en vez de reescribir todo en cada cambio.
 */

import * as Crypto from 'expo-crypto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useContext, useEffect, useMemo, useReducer, useRef } from 'react';
import { useAuth } from './auth';
import type { ItemCarrito } from './carrito';
import { supabase } from './supabase';

export type CarritoGuardado = {
  id: string;
  nombre: string;
  items: ItemCarrito[];
  guardadoEn: string;
};

/** Forma de la fila en Supabase — nombres de columna, no los de `CarritoGuardado`. */
type FilaCarritoGuardado = {
  id: string;
  nombre: string;
  items: ItemCarrito[];
  guardado_en: string;
};

type Estado = { carritos: CarritoGuardado[]; cargado: boolean };

type Accion =
  | { tipo: 'hidratar'; carritos: CarritoGuardado[] }
  | { tipo: 'guardar'; carrito: CarritoGuardado };

const INICIAL: Estado = { carritos: [], cargado: false };
const CLAVE = 'allpromos:carritosGuardados:v1';

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
  const { session, cargando: authCargando } = useAuth();
  const userId = session?.user.id ?? null;
  const [estado, despachar] = useReducer(reducir, INICIAL);

  // Mismo patrón que useSincronizacionPersistente (no se reusa el hook porque esto es filas,
  // no un blob — ver comentario de arriba del archivo).
  const fuenteHidratadaRef = useRef<string | null>(null);
  const yaFueAnonimoRef = useRef(false);

  useEffect(() => {
    if (authCargando) return;
    const fuente = userId ?? 'anonimo';
    if (fuenteHidratadaRef.current === fuente) return;
    const esTransicionALogueado = yaFueAnonimoRef.current && userId !== null;

    (async () => {
      if (!userId) {
        yaFueAnonimoRef.current = true;
        try {
          const crudo = await AsyncStorage.getItem(CLAVE);
          const carritos = crudo ? JSON.parse(crudo) : [];
          despachar({ tipo: 'hidratar', carritos: Array.isArray(carritos) ? carritos : [] });
        } catch {
          despachar({ tipo: 'hidratar', carritos: [] });
        }
        fuenteHidratadaRef.current = fuente;
        return;
      }

      const { data, error } = await supabase
        .from('carrito_guardado')
        .select('id, nombre, items, guardado_en')
        .eq('usuario_id', userId)
        .order('guardado_en', { ascending: false });

      if (error) {
        fuenteHidratadaRef.current = fuente;
        return; // se queda con lo que ya había en memoria (típicamente [])
      }
      const filas = (data ?? []) as unknown as FilaCarritoGuardado[];

      if (esTransicionALogueado && filas.length === 0 && estado.carritos.length > 0) {
        // Primer login con listas guardadas localmente y el servidor sin ninguna todavía: sube
        // cada una como fila nueva. Id nuevo y real (uuid) para todas — las locales pueden
        // venir del generador viejo (`Date.now()-contador`), que no es un uuid válido.
        const nuevasFilas: FilaCarritoGuardado[] = estado.carritos.map(c => ({
          id: Crypto.randomUUID(),
          nombre: c.nombre,
          items: c.items,
          guardado_en: c.guardadoEn,
        }));
        await supabase
          .from('carrito_guardado')
          .insert(nuevasFilas.map(f => ({ ...f, usuario_id: userId })) as any);
        despachar({
          tipo: 'hidratar',
          carritos: nuevasFilas.map(f => (
            { id: f.id, nombre: f.nombre, items: f.items, guardadoEn: f.guardado_en }
          )),
        });
      } else {
        despachar({
          tipo: 'hidratar',
          carritos: filas.map(f => (
            { id: f.id, nombre: f.nombre, items: f.items, guardadoEn: f.guardado_en }
          )),
        });
      }
      fuenteHidratadaRef.current = fuente;
    })();
  }, [authCargando, userId]);

  useEffect(() => {
    if (!estado.cargado) return; // no sobreescribir lo guardado antes de hidratar
    if (fuenteHidratadaRef.current !== (userId ?? 'anonimo')) return;
    if (userId) return; // logueado: cada guardar() inserta su propia fila, no hay blob que reescribir
    AsyncStorage.setItem(CLAVE, JSON.stringify(estado.carritos)).catch(() => {});
  }, [estado.carritos, estado.cargado, userId]);

  const valor = useMemo<Contexto>(() => ({
    carritos: estado.carritos,
    guardar: (nombre, items) => {
      const carrito: CarritoGuardado = {
        id: Crypto.randomUUID(), nombre, items, guardadoEn: new Date().toISOString(),
      };
      despachar({ tipo: 'guardar', carrito });
      if (userId) {
        supabase
          .from('carrito_guardado')
          .insert({
            id: carrito.id, usuario_id: userId, nombre, items, guardado_en: carrito.guardadoEn,
          } as any)
          .then(() => {});
      }
      return carrito;
    },
  }), [estado.carritos, userId]);

  return (
    <CarritosGuardadosContext.Provider value={valor}>{children}</CarritosGuardadosContext.Provider>
  );
}

export function useCarritosGuardados(): Contexto {
  const ctx = useContext(CarritosGuardadosContext);
  if (!ctx) throw new Error('useCarritosGuardados tiene que usarse dentro de <ProveedorCarritosGuardados>');
  return ctx;
}
