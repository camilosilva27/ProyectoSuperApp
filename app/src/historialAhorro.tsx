/**
 * Historial de ahorro (fase A de PANTALLAS-ahorros-y-paywall.md): cuánto fue "ahorrando" el
 * usuario al repartir la compra en vez de comprar todo en un solo super.
 *
 * Vive solo en el teléfono (AsyncStorage), igual que `carrito.tsx` y `carritosGuardados.tsx` —
 * sync entre dispositivos depende de que exista Fase 1 de Plan_Usuarios_y_cobros.md (cuentas
 * Supabase), que todavía no está implementada.
 *
 * Regla de transparencia (no negociable, ver PANTALLAS-ahorros-y-paywall.md): el ahorro se
 * calcula sobre cada comparación que el usuario vio, no sobre compras confirmadas. Por eso cada
 * evento cuenta como una "comparación" aunque su monto sea $0 — la cantidad de comparaciones
 * siempre viaja junto al monto en la UI para que el usuario pueda juzgar si el número refleja
 * uso real o solo curiosear la app.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useContext, useEffect, useMemo, useReducer } from 'react';

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
  const [estado, despachar] = useReducer(reducir, INICIAL);

  useEffect(() => {
    AsyncStorage.getItem(CLAVE)
      .then(crudo => {
        const eventos = crudo ? JSON.parse(crudo) : [];
        despachar({ tipo: 'hidratar', eventos: Array.isArray(eventos) ? eventos : [] });
      })
      .catch(() => despachar({ tipo: 'hidratar', eventos: [] }));
  }, []);

  useEffect(() => {
    if (!estado.cargado) return; // no sobreescribir lo guardado antes de hidratar
    AsyncStorage.setItem(CLAVE, JSON.stringify(estado.eventos)).catch(() => {});
  }, [estado.eventos, estado.cargado]);

  const valor = useMemo<Contexto>(() => ({
    eventos: estado.eventos,
    registrar: monto => {
      despachar({ tipo: 'registrar', evento: { fecha: new Date().toISOString(), monto } });
    },
  }), [estado.eventos]);

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
