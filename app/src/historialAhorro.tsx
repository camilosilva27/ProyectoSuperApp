/**
 * Historial de ahorro (fase A de PANTALLAS-ahorros-y-paywall.md): cuánto fue "ahorrando" el
 * usuario al repartir la compra en vez de comprar todo en un solo super.
 *
 * Anónimo: AsyncStorage, un array entero, igual que `carrito.tsx`. Logueado (fase B,
 * Plan_Usuarios_y_cobros.md): cada evento es una fila real en `ahorro_registro` — es un log que
 * solo crece (nunca se edita ni se borra desde el cliente), así que NO pasa por
 * `useSincronizacionPersistente` (eso es para blobs reescritos enteros) — mismo motivo y mismo
 * patrón que `carritosGuardados.tsx`. A diferencia de esas listas, un evento no tiene `id` en el
 * estado local: nunca se referencia individualmente después de creado, así que no hace falta.
 *
 * Regla de transparencia (no negociable, ver PANTALLAS-ahorros-y-paywall.md): el ahorro se
 * calcula sobre cada comparación que el usuario vio, no sobre compras confirmadas. Por eso cada
 * evento cuenta como una "comparación" aunque su monto sea $0 — la cantidad de comparaciones
 * siempre viaja junto al monto en la UI para que el usuario pueda juzgar si el número refleja
 * uso real o solo curiosear la app.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import React, {
  createContext, useContext, useEffect, useMemo, useReducer, useRef,
} from 'react';
import { useAuth } from './auth';
import { supabase } from './supabase';

export type EventoAhorro = {
  /** ISO string, momento en que se vio el resultado de la comparación. */
  fecha: string;
  /** Diferencia entre el plan repartido y comprar todo en el super más barato. Puede ser 0. */
  monto: number;
};

type Estado = { eventos: EventoAhorro[]; cargado: boolean };

type Accion =
  | { tipo: 'hidratar'; eventos: EventoAhorro[] }
  | { tipo: 'registrar'; evento: EventoAhorro };

const INICIAL: Estado = { eventos: [], cargado: false };
const CLAVE = 'allpromos:historialAhorro:v1';

function reducir(estado: Estado, accion: Accion): Estado {
  switch (accion.tipo) {
    case 'hidratar':
      return { eventos: accion.eventos, cargado: true };
    case 'registrar':
      return { ...estado, eventos: [...estado.eventos, accion.evento] };
    default:
      return estado;
  }
}

type Contexto = {
  eventos: EventoAhorro[];
  /** Agrega un evento con la fecha de ahora. Se llama una vez por comparación vista. */
  registrar: (monto: number) => void;
};

const HistorialAhorroContext = createContext<Contexto | null>(null);

export function ProveedorHistorialAhorro({ children }: { children: React.ReactNode }) {
  const { session, cargando: authCargando } = useAuth();
  const userId = session?.user.id ?? null;
  const [estado, despachar] = useReducer(reducir, INICIAL);

  // Mismo patrón que carritosGuardados.tsx (no useSincronizacionPersistente: ver comentario
  // de arriba del archivo).
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
          const eventos = crudo ? JSON.parse(crudo) : [];
          despachar({ tipo: 'hidratar', eventos: Array.isArray(eventos) ? eventos : [] });
        } catch {
          despachar({ tipo: 'hidratar', eventos: [] });
        }
        fuenteHidratadaRef.current = fuente;
        return;
      }

      const { data, error } = await supabase
        .from('ahorro_registro')
        .select('fecha, monto')
        .eq('usuario_id', userId)
        .order('fecha', { ascending: true });

      if (error) {
        fuenteHidratadaRef.current = fuente;
        return; // se queda con lo que ya había en memoria (típicamente [])
      }
      const filas = (data ?? []) as unknown as EventoAhorro[];

      if (esTransicionALogueado && filas.length === 0 && estado.eventos.length > 0) {
        // Primer login con historial local y el servidor sin ninguna fila todavía: sube cada
        // evento como fila nueva (mismo criterio que carrito_guardado — servidor vacío gana lo
        // local; servidor con datos gana el servidor, rama de abajo).
        await supabase
          .from('ahorro_registro')
          .insert(estado.eventos.map(e => ({ usuario_id: userId, fecha: e.fecha, monto: e.monto })) as any);
        despachar({ tipo: 'hidratar', eventos: estado.eventos });
      } else {
        despachar({ tipo: 'hidratar', eventos: filas });
      }
      fuenteHidratadaRef.current = fuente;
    })();
  }, [authCargando, userId]);

  useEffect(() => {
    if (!estado.cargado) return; // no sobreescribir lo guardado antes de hidratar
    if (fuenteHidratadaRef.current !== (userId ?? 'anonimo')) return;
    if (userId) return; // logueado: cada registrar() inserta su propia fila, no hay blob que reescribir
    AsyncStorage.setItem(CLAVE, JSON.stringify(estado.eventos)).catch(() => {});
  }, [estado.eventos, estado.cargado, userId]);

  const valor = useMemo<Contexto>(() => ({
    eventos: estado.eventos,
    registrar: monto => {
      const evento: EventoAhorro = { fecha: new Date().toISOString(), monto };
      despachar({ tipo: 'registrar', evento });
      if (userId) {
        supabase
          .from('ahorro_registro')
          .insert({ usuario_id: userId, fecha: evento.fecha, monto: evento.monto } as any)
          .then(() => {});
      }
    },
  }), [estado.eventos, userId]);

  return (
    <HistorialAhorroContext.Provider value={valor}>{children}</HistorialAhorroContext.Provider>
  );
}

export function useHistorialAhorro(): Contexto {
  const ctx = useContext(HistorialAhorroContext);
  if (!ctx) throw new Error('useHistorialAhorro tiene que usarse dentro de <ProveedorHistorialAhorro>');
  return ctx;
}

// --- Agregación para la pantalla "Mis ahorros" ---

export type ResumenMes = { anio: number; mes: number; monto: number; conteo: number };

export type ResumenAhorro = {
  totalMonto: number;
  totalConteo: number;
  /** Mes/año de la primera comparación registrada, para "desde marzo". Null si no hay ninguna. */
  primerMes: { anio: number; mes: number } | null;
  mesActual: ResumenMes;
  /** Null si hay menos de dos meses distintos con historial (ver `tieneHistorialSuficiente`). */
  mesAnterior: ResumenMes | null;
  /**
   * Últimos 6 meses calendario (incluye el actual), del más viejo al más nuevo. Solo tiene
   * sentido pintarla si `tieneHistorialSuficiente` — igual se calcula siempre, la pantalla
   * decide si la muestra.
   */
  ultimosMeses: ResumenMes[];
  /** Menos de 2 meses distintos con al menos una comparación: oculta "mes anterior" y "Mes a mes". */
  tieneHistorialSuficiente: boolean;
};

function claveMes(anio: number, mes: number): string {
  return `${anio}-${mes}`;
}

function mesVacio(anio: number, mes: number): ResumenMes {
  return { anio, mes, monto: 0, conteo: 0 };
}

export function calcularResumenAhorro(eventos: EventoAhorro[], ahora: Date = new Date()): ResumenAhorro {
  const porMes = new Map<string, ResumenMes>();
  let totalMonto = 0;
  let primerFecha: Date | null = null;

  for (const evento of eventos) {
    const fecha = new Date(evento.fecha);
    if (Number.isNaN(fecha.getTime())) continue;
    totalMonto += evento.monto;
    if (!primerFecha || fecha < primerFecha) primerFecha = fecha;

    const anio = fecha.getFullYear();
    const mes = fecha.getMonth();
    const clave = claveMes(anio, mes);
    const existente = porMes.get(clave) ?? mesVacio(anio, mes);
    porMes.set(clave, { ...existente, monto: existente.monto + evento.monto, conteo: existente.conteo + 1 });
  }

  const anioActual = ahora.getFullYear();
  const mesActualIdx = ahora.getMonth();
  const mesActual = porMes.get(claveMes(anioActual, mesActualIdx)) ?? mesVacio(anioActual, mesActualIdx);

  const ultimosMeses: ResumenMes[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(anioActual, mesActualIdx - i, 1);
    const anio = d.getFullYear();
    const mes = d.getMonth();
    ultimosMeses.push(porMes.get(claveMes(anio, mes)) ?? mesVacio(anio, mes));
  }

  const mesesConDatos = new Set(eventos.map(e => {
    const f = new Date(e.fecha);
    return claveMes(f.getFullYear(), f.getMonth());
  }));
  const tieneHistorialSuficiente = mesesConDatos.size >= 2;

  const mesAnteriorDate = new Date(anioActual, mesActualIdx - 1, 1);
  const mesAnterior = tieneHistorialSuficiente
    ? porMes.get(claveMes(mesAnteriorDate.getFullYear(), mesAnteriorDate.getMonth()))
      ?? mesVacio(mesAnteriorDate.getFullYear(), mesAnteriorDate.getMonth())
    : null;

  return {
    totalMonto,
    totalConteo: eventos.length,
    primerMes: primerFecha ? { anio: primerFecha.getFullYear(), mes: primerFecha.getMonth() } : null,
    mesActual,
    mesAnterior,
    ultimosMeses,
    tieneHistorialSuficiente,
  };
}
