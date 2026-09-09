/**
 * Grilla de promos por super×día (turno 17, estado inicial de Buscar — ver
 * design_handoff_allpromos_v2/PROMPT-claude-code-turno-17-grilla-promos.md).
 *
 * 7 supers en filas (columna de logos fija a la izquierda, no participa del scroll horizontal
 * — por eso no hace falta position:sticky, que RN nativo no soporta) × 7 días en columnas (fila
 * de letras L M M J V S D, misma repetida para miércoles que usa el mockup). Celda con promo:
 * hasta 3 filas mini (logo + %), una por banco — ver el comentario de por qué en
 * backend/src/routes/promosBancariasGrilla.js. Celda sin promo: guion, nunca vacía. La columna
 * del día de hoy se resalta con un fondo sutil (decisión abierta en el mockup, resuelta acá a
 * pedido del usuario).
 *
 * Reactivada 2026-09-09 (había quedado parkeada el 2026-09-08 por mostrar UNA sola promo por
 * celda cuando puede haber hasta ~18 vigentes el mismo día — le pareció engañoso al usuario).
 * Ahora cada celda muestra hasta 3, priorizando las tarjetas propias del usuario (`tarjetas`,
 * ver carrito.tsx) y completando con las de mayor % hasta llegar a 3.
 *
 * Solo un fetch al entrar a Buscar (useQuery sin refetch por keystroke) — se muestra nada más
 * en el estado sin texto buscado, ver EstadoInicial en app/(tabs)/index.tsx.
 */

import { useQuery } from '@tanstack/react-query';
import React, { useEffect, useRef } from 'react';
import { ActivityIndicator, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { type CeldaGrilla, type FilaGrilla, promosBancariasGrilla } from '../api';
import { espacio, fuentes, radio, texto } from '../theme';
import { useTema } from '../useTema';
import { NOMBRE_SUPER, ORDEN_SUPERS } from './comunes';
import { LogoBanco } from './LogoBanco';
import { PlacaLogoSuper } from './LogoSuper';

const ABREV_DIA = ['LUN', 'MAR', 'MIÉ', 'JUE', 'VIE', 'SÁB', 'DOM'];
const NOMBRES_DIA = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];

// Misma convención que diaISO() en AllPromos/promos-bancarias.js (1=lunes...7=domingo), acá en
// base 0 para indexar directo el array `celdas` (índice 0 = lunes).
function indiceDiaDeHoy(): number {
  return (new Date().getDay() + 6) % 7;
}

/** Las 7 fechas reales de la semana actual (lunes a domingo) — el header del turno 17 en Claude
 *  Design (ver t17/17a) muestra el número real del día del mes, no un genérico "L M M J V S D". */
function fechasDeLaSemana(): Date[] {
  const hoy = new Date();
  const lunes = new Date(hoy);
  lunes.setDate(hoy.getDate() - indiceDiaDeHoy());
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(lunes);
    d.setDate(lunes.getDate() + i);
    return d;
  });
}

const ALTO_HEADER = 48;
const ANCHO_SUPER = 56;
const ANCHO_DIA = 92;
// 3 promos apiladas: (logo 18 + gap 1 + chip % con paddingVertical 1×2 + lineHeight 12) × 3 +
// 2 gaps entre filas (4 c/u) + padding vertical de la celda (4+4) = 115 — 122 deja un colchón
// para no repetir el bug de contenido más alto que la celda (se solapaba con la fila de arriba,
// sin overflow:hidden).
const ALTO_FILA = 122;
const ANCHO_LOGO = 72;
const ALTO_LOGO = 18;

function etiquetaCelda(celda: CeldaGrilla): string {
  if (!celda.promos.length) return 'sin promo';
  return celda.promos.map(p => `${p.banco} ${Math.round(p.pct * 100)}%`).join(', ');
}

function CeldaPromo({ celda, esHoy }: { celda: CeldaGrilla; esHoy: boolean }) {
  const { paleta } = useTema();
  return (
    <View
      style={[
        styles.celda,
        { borderColor: paleta.bordeSuave },
        esHoy ? { backgroundColor: paleta.superficieAlt } : null,
      ]}
      accessibilityLabel={etiquetaCelda(celda)}
    >
      {celda.tiene ? (
        celda.promos.map(p => (
          <View key={p.banco} style={styles.filaPromo}>
            <LogoBanco banco={p.banco} ancho={ANCHO_LOGO} alto={ALTO_LOGO} />
            <View style={[styles.chipPct, { backgroundColor: paleta.oferta }]}>
              <Text style={[texto.microSuper, styles.pct, { color: paleta.ofertaTinta }]}>
                {Math.round(p.pct * 100)}%
              </Text>
            </View>
          </View>
        ))
      ) : (
        <View style={[styles.guion, { backgroundColor: paleta.borde }]} />
      )}
    </View>
  );
}

export function GrillaPromosBancarias({
  accessToken, tarjetas,
}: {
  accessToken: string | null;
  /** Tarjetas propias del usuario (carrito.tarjetas) — priorizan qué promos mostrar en cada
   *  celda cuando hay más de 3 vigentes ese día. */
  tarjetas: string[];
}) {
  const { paleta } = useTema();
  const hoy = indiceDiaDeHoy();
  const fechas = fechasDeLaSemana();
  const refScroll = useRef<ScrollView>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['promos-bancarias-grilla', tarjetas],
    queryFn: () => promosBancariasGrilla(tarjetas, accessToken as string),
    enabled: !!accessToken,
  });

  const filas = data?.filas ?? [];
  // Mismo orden que el resto de la app (ORDEN_SUPERS) en vez del orden en que vino del backend
  // (depende de Object.entries sobre el cache) — un super sin cache todavía (recién agregado,
  // ver el bug de Jumbo/Disco documentado en promosBancariasCache.js) simplemente no aparece.
  const filasOrdenadas = ORDEN_SUPERS
    .map(key => filas.find(f => f.superKey === key))
    .filter((f): f is FilaGrilla => f != null);

  // `contentOffset` no está implementado en react-native-web (se ignora en silencio) — hay que
  // scrollear a mano una vez montado. Sin animar: es la posición inicial, no una transición. El
  // guard de `filasOrdenadas.length` adentro (no arriba, antes del hook) es a propósito: los
  // hooks no pueden ser condicionales, y hay dos early returns (isLoading, error) después de
  // este punto.
  useEffect(() => {
    if (!filasOrdenadas.length) return;
    refScroll.current?.scrollTo({ x: hoy * ANCHO_DIA, y: 0, animated: false });
  }, [hoy, filasOrdenadas.length]);

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
            <PlacaLogoSuper superKey={f.superKey} ancho="100%" alto={34} padding={3} radio={radio.sm} />
          </View>
        ))}
      </View>

      <ScrollView
        ref={refScroll}
        horizontal
        showsHorizontalScrollIndicator={false}
        // Pan libre en los dos ejes, pero nunca pinch-zoom: en web, un pinch sobre esta grilla
        // disparaba "Cannot find active touch" del sistema de touch responder de RN Web (no
        // soporta bien multi-touch) y el error quedaba visible en pantalla. `touchAction` es CSS
        // puro (RN Web lo pasa derecho al DOM, no es un estilo de RN nativo). OJO: usar solo
        // 'pan-x' acá (como en un primer intento) rompe el scroll vertical de la PÁGINA cuando el
        // gesto arranca sobre la grilla — 'pan-x' le dice al browser "esta zona solo hace scroll
        // horizontal", bloqueando el vertical en vez de dejarlo pasar. 'pan-x pan-y' permite
        // scrollear la grilla en los dos ejes (y que la página siga scrolleando verticalmente
        // normal) sin habilitar el gesto de pinch, que es el único que causaba el crash.
        style={Platform.OS === 'web' ? ({ touchAction: 'pan-x pan-y' } as { touchAction: string }) : undefined}
      >
        <View>
          <View style={styles.filaHeader}>
            {fechas.map((fecha, i) => (
              <View
                key={i}
                style={[
                  styles.celdaHeader,
                  { borderColor: paleta.bordeSuave },
                  i === hoy ? { backgroundColor: paleta.superficieAlt } : null,
                ]}
                accessibilityLabel={NOMBRES_DIA[i]}
              >
                <Text
                  style={[
                    styles.abrevDia,
                    { color: i === hoy ? paleta.tinta : paleta.tintaSuave },
                  ]}
                >
                  {ABREV_DIA[i]}
                </Text>
                <View style={[styles.numeroDia, i === hoy ? { backgroundColor: paleta.tinta } : null]}>
                  <Text
                    style={{
                      fontFamily: fuentes.precioMedio, fontSize: 15, lineHeight: 15,
                      color: i === hoy ? paleta.fondo : paleta.tintaProsa,
                    }}
                  >
                    {fecha.getDate()}
                  </Text>
                </View>
              </View>
            ))}
          </View>
          {filasOrdenadas.map(f => (
            <View key={f.superKey} style={styles.filaCeldas} accessibilityLabel={NOMBRE_SUPER[f.superKey]}>
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
    // Menos padding que espacio.xs (4) a propósito: logo de super más grande sin agrandar la
    // celda (ANCHO_SUPER/ALTO_FILA quedan igual, se le saca aire al margen interno).
    paddingHorizontal: 2, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  filaHeader: { flexDirection: 'row' },
  celdaHeader: {
    width: ANCHO_DIA, height: ALTO_HEADER, alignItems: 'center', justifyContent: 'center', gap: 3,
    borderBottomWidth: StyleSheet.hairlineWidth, borderRightWidth: StyleSheet.hairlineWidth,
  },
  // Abreviatura de 3 letras (LUN, MAR...) arriba del número real del día del mes — turno 17 en
  // Claude Design (t17/17a): antes era solo una letra genérica (L M M J V S D).
  abrevDia: { fontFamily: fuentes.semi, fontSize: 9.5, lineHeight: 11, letterSpacing: 1.1 },
  numeroDia: { width: 24, height: 24, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  filaCeldas: { flexDirection: 'row' },
  celda: {
    width: ANCHO_DIA, height: ALTO_FILA, alignItems: 'center', justifyContent: 'center', gap: 4,
    paddingVertical: 4, overflow: 'hidden',
    borderBottomWidth: StyleSheet.hairlineWidth, borderRightWidth: StyleSheet.hairlineWidth,
  },
  // Logo arriba, % abajo — apilado para que el logo pueda ser más grande (18 de alto en vez de
  // los 11 de la versión en fila, donde el logo competía por ancho con el texto del %).
  filaPromo: { alignItems: 'center', gap: 1, width: '100%' },
  chipPct: { borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1 },
  pct: { fontSize: 10, lineHeight: 12 },
  guion: { width: 10, height: 2, borderRadius: 1 },
  centrado: { paddingVertical: espacio.lg, alignItems: 'center' },
});
