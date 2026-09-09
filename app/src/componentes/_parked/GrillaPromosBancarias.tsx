/**
 * PARKEADO 2026-09-08 — NO importado desde ningún lado de la app (antes reemplazaba el bloque
 * "CADA SUPER TIENE SU COLOR" del estado inicial de Buscar; ese bloque no se restauró, el
 * espacio queda vacío por ahora). Motivo: un super puede tener hasta ~18 promos bancarias
 * vigentes el mismo día (confirmado con el cache real) y esta grilla elegía UNA sola (la de
 * mayor %) para mostrar en la celda — al usuario le resultó confuso y potencialmente engañoso
 * mostrar "la" promo del día cuando en realidad hay muchas más. Antes de reactivar esto hace
 * falta resolver esa decisión de UX/producto (¿lista de promos por celda?, ¿"+N más"?, ¿ordenar
 * por otro criterio?) — el router del backend (`backend/src/routes/_parked/promosBancariasGrilla.js`)
 * tiene el mismo problema y está parkeado junto con esto, sin montar en server.js.
 *
 * Grilla de promos por super×día (turno 17, estado inicial de Buscar — ver
 * design_handoff_allpromos_v2/PROMPT-claude-code-turno-17-grilla-promos.md).
 *
 * 7 supers en filas (columna de logos fija a la izquierda, no participa del scroll horizontal
 * — por eso no hace falta position:sticky, que RN nativo no soporta) × 7 días en columnas (fila
 * de letras L M M J V S D, misma repetida para miércoles que usa el mockup). Celda con promo:
 * variante 17b elegida por el usuario — chip amarillo con el %, no la celda entera pintada — más
 * el logo del banco. Celda sin promo: guion, nunca vacía. La columna del día de hoy se resalta
 * con un fondo sutil (decisión abierta en el mockup, resuelta acá a pedido del usuario).
 *
 * Solo un fetch al entrar a Buscar (useQuery sin refetch por keystroke) — se muestra nada más
 * en el estado sin texto buscado, ver EstadoInicial en app/(tabs)/index.tsx.
 */

import { useQuery } from '@tanstack/react-query';
import React from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ErrorApi, type SuperKey } from '../../api';
import { espacio, radio, texto } from '../../theme';
import { useTema } from '../../useTema';
import { NOMBRE_SUPER, ORDEN_SUPERS } from '../comunes';
import { PlacaLogoSuper } from '../LogoSuper';
import { LogoBanco } from './LogoBanco';

/** Una celda de la grilla: `tiene: false` es "sin promo ese día" (guion, no vacío). */
type CeldaGrilla = { tiene: boolean; banco: string | null; pct: number | null };
type FilaGrilla = { superKey: SuperKey; celdas: CeldaGrilla[] };

// Copia mínima y autocontenida del cliente de api.ts (pedir/conSesion no están exportados, y
// este archivo está parkeado — no vale la pena tocar api.ts por código que no corre).
async function promosBancariasGrilla(urlBase: string, accessToken: string) {
  const respuesta = await fetch(`${urlBase}/api/promos-bancarias/grilla`, {
    headers: { Accept: 'application/json', Authorization: `Bearer ${accessToken}` },
  });
  if (!respuesta.ok) throw new ErrorApi(`Error ${respuesta.status}`, respuesta.status);
  return respuesta.json() as Promise<{ filas: FilaGrilla[]; generadoEl: string | null }>;
}

const LETRAS_DIA = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];
const NOMBRES_DIA = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];

// Misma convención que diaISO() en AllPromos/promos-bancarias.js (1=lunes...7=domingo), acá en
// base 0 para indexar directo el array `celdas` (índice 0 = lunes).
function indiceDiaDeHoy(): number {
  return (new Date().getDay() + 6) % 7;
}

const ALTO_HEADER = 32;
const ANCHO_SUPER = 56;
const ANCHO_DIA = 60;
const ALTO_FILA = 60;

function CeldaPromo({ celda, esHoy }: { celda: FilaGrilla['celdas'][number]; esHoy: boolean }) {
  const { paleta } = useTema();
  return (
    <View
      style={[
        styles.celda,
        { borderColor: paleta.bordeSuave },
        esHoy ? { backgroundColor: paleta.superficieAlt } : null,
      ]}
    >
      {celda.tiene && celda.banco != null && celda.pct != null ? (
        <>
          <View style={[styles.chipPct, { backgroundColor: paleta.oferta }]}>
            <Text style={[texto.microSuper, { color: paleta.ofertaTinta }]}>
              {Math.round(celda.pct * 100)}%
            </Text>
          </View>
          <LogoBanco banco={celda.banco} alto={16} />
        </>
      ) : (
        <View style={[styles.guion, { backgroundColor: paleta.borde }]} />
      )}
    </View>
  );
}

export function GrillaPromosBancarias({
  accessToken, urlBase,
}: {
  accessToken: string | null;
  /** Al parkear esto se sacó la dependencia de api.ts (pedir/conSesion no están exportados) —
   *  quien reactive este componente decide de dónde sale la URL base (ver URLS_BASE/api.ts). */
  urlBase: string;
}) {
  const { paleta } = useTema();
  const hoy = indiceDiaDeHoy();

  const { data, isLoading, error } = useQuery({
    queryKey: ['promos-bancarias-grilla'],
    queryFn: () => promosBancariasGrilla(urlBase, accessToken as string),
    enabled: !!accessToken,
  });

  const filas = data?.filas ?? [];
  // Mismo orden que el resto de la app (ORDEN_SUPERS) en vez del orden en que vino del backend
  // (depende de Object.entries sobre el cache) — un super sin cache todavía (recién agregado,
  // ver el bug de Jumbo/Disco documentado en promosBancariasCache.js) simplemente no aparece.
  const filasOrdenadas = ORDEN_SUPERS
    .map(key => filas.find(f => f.superKey === key))
    .filter((f): f is FilaGrilla => f != null);

  if (isLoading) {
    return (
      <View style={styles.centrado}>
        <ActivityIndicator size="small" color={paleta.tintaTenue} />
      </View>
    );
  }

  if (error || !filasOrdenadas.length) return null; // decorativo: si falla, no bloquea el resto del estado inicial

  return (
    <View style={styles.fila}>
      <View style={[styles.columnaSupers, { borderColor: paleta.bordeSuave }]}>
        <View style={[styles.esquina, { borderColor: paleta.bordeSuave }]} />
        {filasOrdenadas.map(f => (
          <View key={f.superKey} style={[styles.celdaSuper, { borderColor: paleta.bordeSuave }]}>
            <PlacaLogoSuper superKey={f.superKey} ancho="100%" alto={22} padding={3} radio={radio.sm} />
          </View>
        ))}
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View>
          <View style={styles.filaHeader}>
            {LETRAS_DIA.map((letra, i) => (
              <View
                key={i}
                style={[
                  styles.celdaHeader,
                  { borderColor: paleta.bordeSuave },
                  i === hoy ? { backgroundColor: paleta.superficieAlt } : null,
                ]}
                accessibilityLabel={NOMBRES_DIA[i]}
              >
                <Text style={[texto.microSuper, { color: paleta.tintaSuave }]}>{letra}</Text>
              </View>
            ))}
          </View>
          {filasOrdenadas.map(f => (
            <View key={f.superKey} style={styles.filaCeldas}>
              {f.celdas.map((celda, i) => (
                <CeldaPromo key={i} celda={celda} esHoy={i === hoy} />
              ))}
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  fila: { flexDirection: 'row' },
  columnaSupers: { width: ANCHO_SUPER, borderRightWidth: StyleSheet.hairlineWidth },
  esquina: { height: ALTO_HEADER, borderBottomWidth: StyleSheet.hairlineWidth },
  celdaSuper: {
    height: ALTO_FILA, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: espacio.xs, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  filaHeader: { flexDirection: 'row' },
  celdaHeader: {
    width: ANCHO_DIA, height: ALTO_HEADER, alignItems: 'center', justifyContent: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth, borderRightWidth: StyleSheet.hairlineWidth,
  },
  filaCeldas: { flexDirection: 'row' },
  celda: {
    width: ANCHO_DIA, height: ALTO_FILA, alignItems: 'center', justifyContent: 'center', gap: 3,
    borderBottomWidth: StyleSheet.hairlineWidth, borderRightWidth: StyleSheet.hairlineWidth,
  },
  chipPct: { borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 },
  guion: { width: 10, height: 2, borderRadius: 1 },
  centrado: { paddingVertical: espacio.lg, alignItems: 'center' },
});
