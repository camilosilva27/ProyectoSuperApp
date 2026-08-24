/**
 * Pantalla de elección de plan (turno 12, design_handoff_allpromos_v2/PANTALLA-
 * -eleccion-de-plan.md). Sigue a `PaywallFinTrial` (bloqueante, sin X) y también se abre desde
 * Ajustes (`plan-y-pago.tsx`, con X que vuelve).
 *
 * Los comps de este turno no llegaron a existir en `AllPromos v2.dc.html` (ese archivo solo
 * llega hasta el turno 5) — este componente se construye a partir del copy y los tokens de
 * color que sí están documentados en el .md, no de un pixel-compare contra un comp real.
 *
 * Jerarquía deliberada (no tocar sin releer el .md): el Anual es el único con tarjeta oscura
 * (es el recomendado); el Permanente lleva el mismo peso visual que el Mensual y convence con
 * texto ("se paga solo en N meses"), no con color. El amarillo `paleta.oferta` está reservado
 * para el badge del recomendado, la barra del anual y el CTA — no se usa para nada más acá.
 */

import React, { useState } from 'react';
import {
  ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View,
} from 'react-native';
import {
  ahorroAnual, costoPorMes, type EstadoSuscripcionPlan, type Plan, type PlanId,
} from '../plan';
import { espacio, pesosCorto, radio, texto } from '../theme';
import { useTema } from '../useTema';

// Tokens explícitos del turno 12, distintos de los de `theme.ts` (esa pantalla es un sistema
// aparte, fondo blanco puro con una sola tarjeta invertida) — se escriben literales a propósito,
// igual que ya hacen otros componentes nuevos (ver GuardarCarritoHoja.tsx).
const FONDO_TARJETA_ACTUAL = '#F7F8F9';
const BORDE_TARJETA_ACTUAL = '#C6CCD3';
const TARJETA_OSCURA = '#14161A';
const BARRA_MENSUAL_FONDO = '#EDF0F2';
const BARRA_ANUAL_FONDO = 'rgba(255,255,255,.18)';

const NOMBRE_PLAN: Record<PlanId, string> = {
  mensual: 'Mensual', anual: 'Anual', permanente: 'Permanente',
};

function formatearFecha(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('es-AR', { day: 'numeric', month: 'long', year: 'numeric' });
}

export type PreciosPlanes = { mensual: number; anual: number; permanente: number };

function planesDe(precios: PreciosPlanes): Plan[] {
  return [
    { id: 'mensual', precio: precios.mensual, periodo: 'mes' },
    { id: 'anual', precio: precios.anual, periodo: 'año' },
    { id: 'permanente', precio: precios.permanente, periodo: 'unico' },
  ];
}

function argumentoDe(plan: Plan, precioMensual: number): string {
  if (plan.id === 'mensual') return 'Sin compromiso: cancelás cuando quieras desde Ajustes.';
  if (plan.id === 'anual') {
    const mesesPagados = Math.round(plan.precio / precioMensual);
    const mesesGratis = 12 - mesesPagados;
    return mesesGratis > 0
      ? `Pagás ${mesesPagados} meses y usás los 12 — ${mesesGratis} no se cobran.`
      : 'El precio de todo el año, cobrado una sola vez.';
  }
  const meses = Math.round(plan.precio / precioMensual);
  return `Se paga solo en ${meses} meses. Después, para siempre y sin ningún cobro más.`;
}

function TarjetaPlan({
  plan, precioMensual, estado, seleccionado, onElegir, botonPropio,
}: {
  plan: Plan;
  precioMensual: number;
  /** 'elegible' = se puede tocar/comprar. 'actual' = es el plan que el usuario ya paga (colapsa
   *  a fila inerte). 'incluido' = el usuario tiene permanente, este plan ya no aplica. */
  estado: 'elegible' | 'actual' | 'incluido';
  seleccionado: boolean;
  onElegir: () => void;
  /** Web (12d): cada tarjeta lleva su propio CTA en vez de depender del CTA fijo. */
  botonPropio?: boolean;
}) {
  const { paleta } = useTema();
  const esAnual = plan.id === 'anual';
  const esPermanente = plan.id === 'permanente';
  const inerte = estado !== 'elegible';
  const porMes = costoPorMes(plan);
  const textoSobreOscuro = esAnual && !inerte;

  const colorTexto = textoSobreOscuro ? '#FFFFFF' : paleta.tinta;
  const colorProsa = textoSobreOscuro ? '#C6CCD3' : paleta.tintaProsa;

  const badge = inerte
    ? null
    : esAnual
      ? { texto: 'RECOMENDADO', fondo: paleta.oferta, borde: paleta.oferta, textoColor: paleta.ofertaTinta }
      : esPermanente
        ? { texto: 'MEJOR A LARGO PLAZO', fondo: 'transparent', borde: paleta.tinta, textoColor: paleta.tinta }
        : null;

  if (inerte) {
    return (
      <View
        style={[
          styles.tarjeta, styles.tarjetaInerte,
          { backgroundColor: FONDO_TARJETA_ACTUAL, borderColor: BORDE_TARJETA_ACTUAL },
        ]}
        pointerEvents="none"
      >
        <View style={styles.filaNombre}>
          <Text style={[texto.subtitulo, { color: paleta.tintaSuave }]}>{NOMBRE_PLAN[plan.id]}</Text>
          {estado === 'actual' ? (
            <View style={[styles.pill, { borderColor: BORDE_TARJETA_ACTUAL }]}>
              <Text style={[texto.micro, { color: paleta.tintaSuave }]}>TU PLAN ACTUAL</Text>
            </View>
          ) : null}
        </View>
      </View>
    );
  }

  return (
    <Pressable
      onPress={onElegir}
      accessibilityRole="button"
      accessibilityState={{ selected: seleccionado }}
      style={[
        styles.tarjeta,
        {
          backgroundColor: esAnual ? TARJETA_OSCURA : paleta.superficie,
          borderColor: esAnual ? TARJETA_OSCURA : (seleccionado ? paleta.tinta : paleta.bordeFuerte),
          borderWidth: esAnual || seleccionado ? 2 : 1,
        },
      ]}
    >
      <View style={styles.filaNombre}>
        <Text style={[texto.subtitulo, { color: colorTexto }]}>{NOMBRE_PLAN[plan.id]}</Text>
        {badge ? (
          <View style={[styles.badge, { backgroundColor: badge.fondo, borderColor: badge.borde }]}>
            <Text style={[texto.micro, { color: badge.textoColor }]}>{badge.texto}</Text>
          </View>
        ) : null}
      </View>

      <Text style={[texto.precioGrande, { color: colorTexto, fontSize: 32, lineHeight: 34 }]}>
        {pesosCorto(plan.precio)}
        <Text style={[texto.cuerpo, { color: colorProsa }]}>
          {plan.periodo === 'unico' ? ' pago único' : plan.periodo === 'año' ? ' /año' : ' /mes'}
        </Text>
      </Text>

      <View style={{ gap: espacio.xs }}>
        <View
          style={[
            styles.barraFondo,
            { backgroundColor: esAnual ? BARRA_ANUAL_FONDO : BARRA_MENSUAL_FONDO },
          ]}
        >
          {porMes !== null ? (
            <View
              style={[
                styles.barraRelleno,
                {
                  width: `${Math.round((porMes / precioMensual) * 100)}%`,
                  backgroundColor: esAnual ? paleta.oferta : paleta.tintaTenue,
                },
              ]}
            />
          ) : null}
        </View>
        <Text style={[texto.dato, { color: colorProsa }]}>
          {porMes !== null ? `${pesosCorto(porMes)} / mes` : 'Sin mensualidad'}
        </Text>
      </View>

      <Text style={[texto.cuerpo, { color: colorProsa, flex: 1 }]}>{argumentoDe(plan, precioMensual)}</Text>

      {botonPropio ? (
        <View
          style={[
            styles.botonTarjeta,
            { backgroundColor: esAnual ? paleta.oferta : paleta.tinta },
          ]}
        >
          <Text style={[texto.cuerpoMedio, { color: esAnual ? paleta.ofertaTinta : '#FFFFFF' }]}>
            Elegir {NOMBRE_PLAN[plan.id]}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}

export function PlanSelect({
  precios, suscripcion, bloqueante, cargando = false, planEnCurso = null, error = null,
  onElegirPlan, onCerrar,
}: {
  precios: PreciosPlanes;
  suscripcion: EstadoSuscripcionPlan;
  bloqueante: boolean;
  /** true mientras se espera la respuesta de crear el pago, antes de abrir el checkout (12c). */
  cargando?: boolean;
  planEnCurso?: PlanId | null;
  error?: string | null;
  onElegirPlan: (planId: PlanId) => void;
  onCerrar?: () => void;
}) {
  const { paleta } = useTema();
  const { width } = useWindowDimensions();
  const esWeb = width >= 720;
  const [seleccionado, setSeleccionado] = useState<PlanId>(suscripcion.planId ?? 'anual');

  const planes = planesDe(precios);
  const esPermanenteActivo = suscripcion.planId === 'permanente';

  const estadoDe = (planId: PlanId): 'elegible' | 'actual' | 'incluido' => {
    if (esPermanenteActivo) return planId === 'permanente' ? 'actual' : 'incluido';
    if (suscripcion.planId === planId) return 'actual';
    return 'elegible';
  };

  const hayCTA = !esPermanenteActivo;
  const planParaCTA = planes.find(p => p.id === (cargando ? planEnCurso ?? seleccionado : seleccionado));

  return (
    <View style={[styles.pantalla, { backgroundColor: paleta.fondo }]}>
      <View style={[styles.header, { opacity: cargando ? 0.4 : 1 }]}>
        <Text style={[texto.titulo, { color: paleta.tinta }]}>Elegí tu plan</Text>
        {!bloqueante && onCerrar ? (
          <Pressable onPress={onCerrar} accessibilityRole="button" accessibilityLabel="Cerrar" hitSlop={8}>
            <Text style={[texto.titulo, { color: paleta.tintaSuave }]}>×</Text>
          </Pressable>
        ) : null}
      </View>

      {esPermanenteActivo && suscripcion.pagadoEl ? (
        <Text style={[texto.cuerpo, { color: paleta.tintaSuave, marginBottom: espacio.md }]}>
          Pagado el {formatearFecha(suscripcion.pagadoEl)} · no hay renovaciones ni cobros futuros.
        </Text>
      ) : null}

      {/* Las 3 tarjetas fácilmente superan el alto de un teléfono real (header + tarjeta +
          badge + barra + argumento × 3) — sin ScrollView el CTA fijo de abajo queda fuera de
          la pantalla y no se puede tocar, sin ningún error visible que lo delate. */}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={esWeb ? styles.gridWeb : styles.columnaMobile}
        showsVerticalScrollIndicator={false}
      >
        {planes.map(plan => {
          const estado = estadoDe(plan.id);
          const noSeleccionable = cargando && plan.id !== (planEnCurso ?? seleccionado);
          return (
            <View key={plan.id} style={[esWeb ? styles.celdaWeb : null, { opacity: noSeleccionable ? 0.4 : 1 }]}>
              <TarjetaPlan
                plan={plan}
                precioMensual={precios.mensual}
                estado={estado}
                seleccionado={!esWeb && estado === 'elegible' && seleccionado === plan.id}
                onElegir={() => (esWeb ? onElegirPlan(plan.id) : setSeleccionado(plan.id))}
                botonPropio={esWeb && estado === 'elegible'}
              />
            </View>
          );
        })}
      </ScrollView>

      {hayCTA && !esWeb ? (
        <View style={styles.pie}>
          {suscripcion.planId && estadoDe('anual') === 'elegible' && precios.mensual && precios.anual ? (
            <Text style={[texto.cuerpo, { color: paleta.tintaSuave }]}>
              Cambiar de plan cobra el nuevo completo — no se descuenta lo que quede del actual.
            </Text>
          ) : null}
          <Pressable
            onPress={() => planParaCTA && onElegirPlan(planParaCTA.id)}
            disabled={cargando || !planParaCTA}
            accessibilityRole="button"
            style={[
              styles.ctaFijo,
              { backgroundColor: cargando ? '#F2CB00' : paleta.oferta },
            ]}
          >
            {cargando ? (
              <View style={styles.ctaContenido}>
                <ActivityIndicator color={paleta.ofertaTinta} />
                <Text style={[texto.subtitulo, { color: paleta.ofertaTinta }]}>ABRIENDO MERCADO PAGO…</Text>
              </View>
            ) : (
              <Text style={[texto.subtitulo, { color: paleta.ofertaTinta }]}>
                Elegir {planParaCTA ? NOMBRE_PLAN[planParaCTA.id] : ''}
              </Text>
            )}
          </Pressable>
          {cargando ? (
            <Text style={[texto.dato, { color: paleta.tintaSuave, textAlign: 'center' }]}>
              Si no volvés solo, tocá atrás y probá de nuevo: no se cobró nada todavía.
            </Text>
          ) : null}
          {error ? (
            <Text style={[texto.cuerpo, { color: paleta.errorTexto, textAlign: 'center' }]}>{error}</Text>
          ) : null}
        </View>
      ) : null}

      {hayCTA && esWeb ? (
        <Text style={[texto.dato, { color: paleta.tintaSuave, textAlign: 'center', marginTop: espacio.lg }]}>
          Cambiar de plan cobra el nuevo completo — no se descuenta lo que quede del actual.
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  pantalla: { flex: 1, padding: espacio.pantalla, gap: espacio.lg },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  scroll: { flex: 1 },
  columnaMobile: { gap: espacio.md, paddingBottom: espacio.sm },
  gridWeb: { flexDirection: 'row', gap: espacio.md },
  celdaWeb: { flex: 1 },
  tarjeta: {
    borderRadius: radio.tarjeta, borderWidth: 1, padding: espacio.lg, gap: espacio.sm,
  },
  tarjetaInerte: { borderStyle: 'dashed', minHeight: 56, justifyContent: 'center' },
  filaNombre: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  pill: {
    borderWidth: 1, borderRadius: radio.pill, paddingHorizontal: espacio.sm, paddingVertical: 4,
  },
  badge: {
    borderWidth: 1, borderRadius: 5, paddingHorizontal: espacio.sm, paddingVertical: 3,
  },
  barraFondo: { height: 6, borderRadius: radio.pill, overflow: 'hidden' },
  barraRelleno: { height: 6, borderRadius: radio.pill },
  botonTarjeta: {
    borderRadius: radio.sm, minHeight: 44, alignItems: 'center', justifyContent: 'center',
  },
  pie: { gap: espacio.sm },
  ctaFijo: { borderRadius: radio.md, minHeight: 52, alignItems: 'center', justifyContent: 'center' },
  ctaContenido: { flexDirection: 'row', alignItems: 'center', gap: espacio.sm },
});
