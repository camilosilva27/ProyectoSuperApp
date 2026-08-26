/**
 * Estado del carrito de compra.
 *
 * Anónimo: vive solo en el teléfono (AsyncStorage). Logueado (Fase 1,
 * Plan_Usuarios_y_cobros.md): sincroniza con `perfil_usuario` en Supabase entre dispositivos —
 * ver `useSincronizacionPersistente`, que decide contra cuál de las dos hidratar/persistir.
 * El reducer de abajo no sabe nada de eso, es la misma fuente de verdad en los dos casos.
 *
 * Las tarjetas del usuario también se guardan acá porque viajan en cada comparación: el
 * backend no lee mis-tarjetas.json (eso es del CLI), las recibe por request.
 */

import React, { createContext, useContext, useMemo, useReducer } from 'react';
import type { ProductoCatalogo } from './api';
import { useSincronizacionPersistente } from './sincronizacionPersistente';

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
  'Galicia', 'Galicia Modo', 'Banco Macro', 'HSBC', 'BBVA', 'ICBC',
  'Comafi', 'Naranja X', 'Credicoop', 'Banco Ciudad', 'Supervielle',
  'Banco Columbia', 'Banco Patagonia', 'Banco Nación', 'TCI',
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

/** Forma que viaja por AsyncStorage — sin cambios, para no perder lo que ya tenga guardado
 *  cualquiera que use la app hoy. Distinta de la fila de Supabase (`carrito_items`/
 *  `carrito_tarjetas`), que se traduce en las funciones de abajo. */
type BlobLocal = { items: ItemCarrito[]; tarjetas: string[] };
type FilaPerfil = { carrito_items: ItemCarrito[]; carrito_tarjetas: string[] };

export function ProveedorCarrito({ children }: { children: React.ReactNode }) {
  const [estado, despachar] = useReducer(reducir, INICIAL);

  useSincronizacionPersistente<BlobLocal, FilaPerfil>({
    clave: CLAVE,
    columnas: ['carrito_items', 'carrito_tarjetas'],
    valor: estado.cargado ? { items: estado.items, tarjetas: estado.tarjetas } : null,
    aFila: local => ({ carrito_items: local.items, carrito_tarjetas: local.tarjetas }),
    deFila: fila => ({
      items: Array.isArray(fila.carrito_items) ? fila.carrito_items : [],
      tarjetas: Array.isArray(fila.carrito_tarjetas) ? fila.carrito_tarjetas : [],
    }),
    filaVacia: fila => fila.carrito_items.length === 0 && fila.carrito_tarjetas.length === 0,
    // `local` es null si no había nada guardado (usuario anónimo nuevo, o error leyendo el
    // perfil) — se despacha igual con `{}` para que el reducer marque `cargado: true` y
    // arranque a persistir, mismo criterio que el fallback que ya tenía esto antes.
    onHidratar: local => despachar({ tipo: 'hidratar', estado: local ?? {} }),
  });

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
