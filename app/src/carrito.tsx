/**
 * Estado del carrito de compra.
 *
 * Vive solo en el teléfono (AsyncStorage): sincronizar una lista familiar entre dispositivos
 * exigiría estado y autenticación en el backend, y no hace falta para la primera versión.
 *
 * Las tarjetas del usuario también se guardan acá porque viajan en cada comparación: el
 * backend no lee mis-tarjetas.json (eso es del CLI), las recibe por request.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useContext, useEffect, useMemo, useReducer } from 'react';
import type { ProductoCatalogo } from './api';

export type ItemCarrito = {
  ean: string;
  nombre: string;
  variante: string | null;
  cantidad: number;
  imagen: string | null;
};

type Estado = {
  items: ItemCarrito[];
  tarjetas: string[];
  cargado: boolean;
};

type Accion =
  | { tipo: 'hidratar'; estado: Partial<Estado> }
  | { tipo: 'agregar'; producto: ProductoCatalogo }
  | { tipo: 'quitar'; ean: string }
  | { tipo: 'cantidad'; ean: string; cantidad: number }
  | { tipo: 'vaciar' }
  | { tipo: 'reemplazarItems'; items: ItemCarrito[] }
  | { tipo: 'tarjetas'; tarjetas: string[] };

/** Las mismas que soporta promos-bancarias.js; el usuario marca las que tiene. */
export const TARJETAS_DISPONIBLES = [
  'Mi Carrefour', 'MasClub', 'Cencopay',
  'Santander', 'MODO', 'Mercado Pago', 'Cuenta DNI', 'Banco Provincia',
];

// Vacío a propósito: no hace falta elegir tarjetas para comparar. Las promos de tarjeta
// propia se muestran igual como aviso (ver BarraDiferencia) y se activan tocándolas ahí, o
// acá en Ajustes si el usuario prefiere dejarlas siempre prendidas.
const INICIAL: Estado = { items: [], tarjetas: [], cargado: false };
const CLAVE = 'allpromos:carrito:v1';

function reducir(estado: Estado, accion: Accion): Estado {
  switch (accion.tipo) {
    case 'hidratar':
      return { ...estado, ...accion.estado, cargado: true };

    case 'agregar': {
      const existe = estado.items.find(i => i.ean === accion.producto.ean);
      if (existe) {
        // Tocar un producto que ya está en la lista suma una unidad en vez de duplicarlo:
        // es lo que se espera al volver a tocarlo desde la búsqueda.
        return {
          ...estado,
          items: estado.items.map(i =>
            i.ean === accion.producto.ean ? { ...i, cantidad: Math.min(99, i.cantidad + 1) } : i
          ),
        };
      }
      return {
        ...estado,
        items: [
          ...estado.items,
          {
            ean: accion.producto.ean,
            nombre: accion.producto.nombre,
            variante: accion.producto.variante,
            cantidad: 1,
            imagen: accion.producto.imagen,
          },
        ],
      };
    }

    case 'quitar':
      return { ...estado, items: estado.items.filter(i => i.ean !== accion.ean) };

    case 'cantidad': {
      if (accion.cantidad < 1) {
        return { ...estado, items: estado.items.filter(i => i.ean !== accion.ean) };
      }
      return {
        ...estado,
        items: estado.items.map(i =>
          i.ean === accion.ean ? { ...i, cantidad: Math.min(99, accion.cantidad) } : i
        ),
      };
    }

    case 'vaciar':
      return { ...estado, items: [] };

    // Cargar un carrito guardado (turno 4): reemplaza la compra actual entera, no la mezcla
    // con lo que ya había — "cargar" es abrir esa lista, no sumarle a la de ahora.
    case 'reemplazarItems':
      return { ...estado, items: accion.items };

    case 'tarjetas':
      return { ...estado, tarjetas: accion.tarjetas };

    default:
      return estado;
  }
}

type Contexto = Estado & {
  agregar: (p: ProductoCatalogo) => void;
  quitar: (ean: string) => void;
  cambiarCantidad: (ean: string, cantidad: number) => void;
  vaciar: () => void;
  reemplazarItems: (items: ItemCarrito[]) => void;
  setTarjetas: (t: string[]) => void;
  cantidadDe: (ean: string) => number;
  totalUnidades: number;
};

const CarritoContext = createContext<Contexto | null>(null);

export function ProveedorCarrito({ children }: { children: React.ReactNode }) {
  const [estado, despachar] = useReducer(reducir, INICIAL);

  useEffect(() => {
    AsyncStorage.getItem(CLAVE)
      .then(crudo => {
        if (!crudo) return despachar({ tipo: 'hidratar', estado: {} });
        const guardado = JSON.parse(crudo);
        despachar({
          tipo: 'hidratar',
          estado: {
            items: Array.isArray(guardado.items) ? guardado.items : [],
            tarjetas: Array.isArray(guardado.tarjetas) ? guardado.tarjetas : INICIAL.tarjetas,
          },
        });
      })
      .catch(() => despachar({ tipo: 'hidratar', estado: {} }));
  }, []);

  useEffect(() => {
    if (!estado.cargado) return; // no sobreescribir lo guardado antes de hidratar
    AsyncStorage.setItem(
      CLAVE,
      JSON.stringify({ items: estado.items, tarjetas: estado.tarjetas })
    ).catch(() => { /* si falla el guardado no hay nada útil que hacer en la UI */ });
  }, [estado.items, estado.tarjetas, estado.cargado]);

  const valor = useMemo<Contexto>(() => ({
    ...estado,
    agregar: producto => despachar({ tipo: 'agregar', producto }),
    quitar: ean => despachar({ tipo: 'quitar', ean }),
    cambiarCantidad: (ean, cantidad) => despachar({ tipo: 'cantidad', ean, cantidad }),
    vaciar: () => despachar({ tipo: 'vaciar' }),
    reemplazarItems: items => despachar({ tipo: 'reemplazarItems', items }),
    setTarjetas: tarjetas => despachar({ tipo: 'tarjetas', tarjetas }),
    cantidadDe: ean => estado.items.find(i => i.ean === ean)?.cantidad ?? 0,
    totalUnidades: estado.items.reduce((n, i) => n + i.cantidad, 0),
  }), [estado]);

  return <CarritoContext.Provider value={valor}>{children}</CarritoContext.Provider>;
}

export function useCarrito(): Contexto {
  const ctx = useContext(CarritoContext);
  if (!ctx) throw new Error('useCarrito tiene que usarse dentro de <ProveedorCarrito>');
  return ctx;
}
