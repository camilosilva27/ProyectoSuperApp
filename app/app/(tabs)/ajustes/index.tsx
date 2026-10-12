/**
 * Pantalla Ajustes.
 *
 * Reestructurada (diseño 20d, Claude Design turno 20, 2026-09-10) en 3 grupos:
 * - TU ACTIVIDAD: "Mis ahorros", mudada acá desde su propia pestaña de la barra inferior (le
 *   cedió el lugar a "Alertas", ver (tabs)/_layout.tsx) — chip "NUEVO ACÁ" mientras dure la
 *   mudanza. Debajo, "Invitá amigos" (referidos, diseño 22a de Claude Design, 2026-10-12): el
 *   chip amarillo es el premio y solo aparece mientras se pueda ganar.
 * - PREFERENCIAS: "Supers cerca tuyo", anunciada como próxima (sin pantalla real todavía).
 * - CUENTA: "Datos personales" (mail + cerrar sesión, antes inline acá) y "Ayuda" (tutorial +
 *   contacto, antes sueltos en el cuerpo) pasan a ser sus propias pantallas; "Suscripción" es
 *   la fila de plan/pago que ya existía (antes bajo su propio bloque "TU PLAN").
 *
 * El toggle de notificaciones/push que vivía acá ("recordatorio semanal") se sacó: el permiso de
 * notificaciones ahora es uno solo, pedido desde el interruptor "Recibir notificaciones" de la
 * pestaña Alertas (ver `alertas.tsx` / `src/alertas.ts`).
 *
 * La cuenta ya no es opcional (Fase 2, `GateSesion.tsx`): sin sesión no se llega a este tab
 * (ni a ningún otro) — por eso acá abajo no hace falta un branch para el caso sin sesión.
 */

import { useQuery } from '@tanstack/react-query';
import { useFocusEffect, useRouter } from 'expo-router';
import Head from 'expo-router/head';
import React, { useCallback, useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { estadoReferidos, type EstadoReferidos } from '../../../src/api';
import { useAuth } from '../../../src/auth';
import { IconoChevron } from '../../../src/componentes/comunes';
import { HeaderNegro, TituloHeader } from '../../../src/componentes/HeaderNegro';
import { calcularResumenAhorro, useHistorialAhorro } from '../../../src/historialAhorro';
import { diasRestantesTrial, usePlanUsuario } from '../../../src/plan';
import { espacio, pesosCorto, radio, texto } from '../../../src/theme';
import { useTema } from '../../../src/useTema';

export default function PantallaAjustes() {
  const { paleta } = useTema();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { session } = useAuth();
  const { info: infoPlan, recargar: recargarPlan } = usePlanUsuario();
  const { eventos } = useHistorialAhorro();
  const totalAhorrado = useMemo(() => calcularResumenAhorro(eventos).totalMonto, [eventos]);

  const { data: referidos, refetch: recargarReferidos } = useQuery({
    queryKey: ['referidos'],
    queryFn: () => estadoReferidos(session?.access_token as string),
    enabled: !!session?.access_token,
  });

  // Al volver a esta pantalla (ej. después de ir y volver del checkout de Mercado Pago) se
  // refresca el plan — el webhook de MP ya pudo haber actualizado `perfil_usuario` mientras
  // el usuario estaba afuera. Los referidos también: una invitada pudo haber comparado.
  useFocusEffect(useCallback(() => {
    recargarPlan();
    recargarReferidos();
  }, [recargarPlan, recargarReferidos]));

  const diasTrial = diasRestantesTrial(infoPlan?.trialTerminaEn ?? null);
  const nombrePlanActivo = infoPlan?.tipoPlan === 'anual' ? 'Anual' : infoPlan?.tipoPlan === 'mensual' ? 'Mensual' : null;

  // Premium sin suscripción ni plan pago, con fecha de fin: solo lo da el premio de referidos
  // (migración 0030; la gracia de una cancelación siempre deja una suscripción asociada).
  const premiumPorReferidos = infoPlan?.plan === 'premium' && !infoPlan.tipoPlan
    && !infoPlan.pasarelaSuscripcionId && !!infoPlan.accesoPremiumHasta;

  const subtituloPlan = infoPlan?.plan === 'premium'
    ? premiumPorReferidos
      ? `Premium gratis por invitar amigos · hasta el ${fechaCorta(infoPlan.accesoPremiumHasta as string)}`
      : infoPlan.tipoPlan === 'permanente'
      ? 'Permanente'
      // `nombrePlanActivo` puede venir null (premium otorgado a mano sin `tipo_plan` seteado
      // a 'anual'/'mensual'/'permanente') — sin este fallback se imprimía literal "null" en
      // esta fila. Cae acá también si el plan mensual/anual todavía no cargó `tipoPlan`.
      : nombrePlanActivo ?? 'Premium'
    : infoPlan?.plan === 'trial'
      ? `Prueba gratis · vence en ${diasTrial} día(s)`
      : 'Elegí un plan';

  // GateSesion (_layout.tsx) ya garantiza que no se llega acá sin sesión.
  if (!session) return null;

  return (
    <View style={[styles.pantalla, { backgroundColor: paleta.fondo }]}>
      <Head><title>Ajustes - SuperAhorro</title></Head>
      <HeaderNegro paddingTop={insets.top + espacio.xl}>
        <TituloHeader>Ajustes</TituloHeader>
      </HeaderNegro>
      <View style={styles.cuerpo}>
        <View style={styles.seccion}>
          <Text style={[texto.tituloSeccion, { color: paleta.tintaSuave }]}>TU ACTIVIDAD</Text>
          <View style={[styles.grupo, { borderColor: paleta.borde }]}>
            <Pressable
              onPress={() => router.push('/ajustes/mis-ahorros')}
              accessibilityRole="button"
              style={[styles.fila, { minHeight: 68 }]}
            >
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={[texto.cuerpoMedio, { color: paleta.tinta }]}>Mis ahorros</Text>
                <Text style={[texto.etiqueta, { color: paleta.tintaSuave, letterSpacing: 0.2 }]}>
                  {pesosCorto(totalAhorrado)} desde que usás SuperAhorro
                </Text>
              </View>
              <View style={[styles.chip, { backgroundColor: paleta.oferta }]}>
                <Text style={[texto.micro, { color: paleta.ofertaTinta }]}>NUEVO ACÁ</Text>
              </View>
              <IconoChevron color={paleta.tintaTenue} />
            </Pressable>
            {mostrarFilaReferidos(referidos) ? (
              <>
                <View style={[styles.separador, { backgroundColor: paleta.borde }]} />
                <Pressable
                  onPress={() => router.push('/ajustes/invitar')}
                  accessibilityRole="button"
                  style={[styles.fila, { minHeight: 68 }]}
                >
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={[texto.cuerpoMedio, { color: paleta.tinta }]}>Invitá amigos</Text>
                    <Text style={[texto.etiqueta, { color: paleta.tintaSuave, letterSpacing: 0.2 }]}>
                      {subtituloReferidos(referidos)}
                    </Text>
                  </View>
                  {premioAlAlcance(referidos) ? (
                    <View style={[styles.chip, { backgroundColor: paleta.oferta }]}>
                      <Text style={[texto.micro, { color: paleta.ofertaTinta }]}>
                        {textoPremio(referidos?.diasPremio ?? 60).toUpperCase()} GRATIS
                      </Text>
                    </View>
                  ) : null}
                  <IconoChevron color={paleta.tintaTenue} />
                </Pressable>
              </>
            ) : null}
          </View>
        </View>

        <View style={styles.seccion}>
          <Text style={[texto.tituloSeccion, { color: paleta.tintaSuave }]}>PREFERENCIAS</Text>
          <View style={[styles.grupo, { borderColor: paleta.borde }]}>
            <View style={[styles.fila, { minHeight: 68 }]}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={[texto.cuerpoMedio, { color: paleta.tintaSuave }]}>Supers cerca tuyo</Text>
                <Text style={[texto.etiqueta, { color: paleta.tintaSuave, letterSpacing: 0.2 }]}>
                  Elegís qué cadenas te muestra la app
                </Text>
              </View>
              <View style={[styles.chip, { backgroundColor: paleta.superficieAlt }]}>
                <Text style={[texto.micro, { color: paleta.tintaSuave }]}>PRÓXIMAMENTE</Text>
              </View>
            </View>
          </View>
        </View>

        <View style={styles.seccion}>
          <Text style={[texto.tituloSeccion, { color: paleta.tintaSuave }]}>CUENTA</Text>
          <View style={[styles.grupo, { borderColor: paleta.borde }]}>
            <Pressable onPress={() => router.push('/ajustes/datos-personales')} accessibilityRole="button" style={styles.fila}>
              <Text style={[texto.cuerpoMedio, { color: paleta.tinta, flex: 1 }]}>Datos personales</Text>
              <IconoChevron color={paleta.tintaTenue} />
            </Pressable>
            <View style={[styles.separador, { backgroundColor: paleta.borde }]} />
            <Pressable onPress={() => router.push('/ajustes/plan-y-pago')} accessibilityRole="button" style={styles.fila}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={[texto.cuerpoMedio, { color: paleta.tinta }]}>Suscripción</Text>
                <Text style={[texto.etiqueta, { color: paleta.tintaSuave, letterSpacing: 0.2 }]}>{subtituloPlan}</Text>
              </View>
              <IconoChevron color={paleta.tintaTenue} />
            </Pressable>
            <View style={[styles.separador, { backgroundColor: paleta.borde }]} />
            <Pressable onPress={() => router.push('/ajustes/ayuda')} accessibilityRole="button" style={styles.fila}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={[texto.cuerpoMedio, { color: paleta.tinta }]}>Ayuda</Text>
                <Text style={[texto.etiqueta, { color: paleta.tintaSuave, letterSpacing: 0.2 }]}>Contacto y tutoriales</Text>
              </View>
              <IconoChevron color={paleta.tintaTenue} />
            </Pressable>
          </View>
        </View>
      </View>
    </View>
  );
}

/** "14/02". A mano: `toLocaleDateString('es-AR', { month: '2-digit' })` da "14/2" en Chrome. */
function fechaCorta(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** "60" → "2 meses"; cualquier otro número de días, tal cual. */
function textoPremio(dias: number): string {
  return dias % 30 === 0 ? `${dias / 30} meses` : `${dias} días`;
}

/** Mientras carga (o si falla) la fila se muestra igual, con el texto genérico. Solo se oculta
 *  si la promo terminó y la persona nunca participó. */
function mostrarFilaReferidos(r: EstadoReferidos | undefined): boolean {
  if (!r) return true;
  return r.promoVigente || !!r.premio || r.invitadas.length > 0;
}

/** El premio todavía se puede ganar: sin premio previo, sin suscripción paga y promo vigente. */
function premioAlAlcance(r: EstadoReferidos | undefined): boolean {
  if (!r) return true;
  return r.promoVigente && !r.premio && !r.motivoNoAplica;
}

function subtituloReferidos(r: EstadoReferidos | undefined): string {
  if (!r) return 'Llevate 2 meses gratis';
  if (r.premio?.estado === 'otorgado') return `Ganaste ${textoPremio(r.diasPremio)} gratis`;
  if (r.premio || r.motivoNoAplica || !r.promoVigente) return 'Compartí SuperAhorro';
  if (r.validas === 0) return `Invitá a ${r.invitadasNecesarias} y llevate ${textoPremio(r.diasPremio)} gratis`;
  return `Ya se ${r.validas === 1 ? 'sumó' : 'sumaron'} ${r.validas} de ${r.invitadasNecesarias}`;
}

const styles = StyleSheet.create({
  pantalla: { flex: 1 },
  cuerpo: { padding: espacio.pantalla, gap: espacio.pantalla },
  seccion: { gap: espacio.sm },
  grupo: { borderWidth: 1, borderRadius: radio.tarjeta, paddingHorizontal: espacio.md },
  fila: { flexDirection: 'row', alignItems: 'center', gap: espacio.sm, minHeight: 52 },
  separador: { height: StyleSheet.hairlineWidth },
  chip: { borderRadius: 6, paddingHorizontal: espacio.sm, paddingVertical: 3 },
});
