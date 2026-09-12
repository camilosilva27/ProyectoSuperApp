/**
 * Pantalla Ajustes.
 *
 * Reestructurada (diseño 20d, Claude Design turno 20, 2026-09-10) en 3 grupos:
 * - TU ACTIVIDAD: "Mis ahorros", mudada acá desde su propia pestaña de la barra inferior (le
 *   cedió el lugar a "Alertas", ver (tabs)/_layout.tsx) — chip "NUEVO ACÁ" mientras dure la
 *   mudanza.
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

import { useFocusEffect, useRouter } from 'expo-router';
import Head from 'expo-router/head';
import React, { useCallback, useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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

  // Al volver a esta pantalla (ej. después de ir y volver del checkout de Mercado Pago) se
  // refresca el plan — el webhook de MP ya pudo haber actualizado `perfil_usuario` mientras
  // el usuario estaba afuera.
  useFocusEffect(useCallback(() => { recargarPlan(); }, [recargarPlan]));

  const diasTrial = diasRestantesTrial(infoPlan?.trialTerminaEn ?? null);
  const nombrePlanActivo = infoPlan?.tipoPlan === 'anual' ? 'Anual' : infoPlan?.tipoPlan === 'mensual' ? 'Mensual' : null;

  const subtituloPlan = infoPlan?.plan === 'premium'
    ? infoPlan.tipoPlan === 'permanente'
      ? 'Permanente'
      // `nombrePlanActivo` puede venir null (premium otorgado a mano sin `tipo_plan` seteado
      // a 'anual'/'mensual'/'permanente') — sin este fallback se imprimía literal "null" en
      // esta fila. Cae acá también si el plan mensual/anual todavía no cargó `tipoPlan`.
      : nombrePlanActivo ?? 'Premium'
    : infoPlan?.plan === 'trial'
      // TODO(pausa trial fase de pruebas, ver Plan_Usuarios_y_cobros.md § "Pausa del trial
      // durante fase de pruebas"): mientras dure la pausa no tiene sentido mostrar "vence en
      // X días" (van a ser ~365, por la migración 0019). Volver a `Prueba gratis · vence en
      // ${diasTrial} día(s)` cuando se reactive el vencimiento normal.
      ? 'Período de prueba'
      : 'Elegí un plan';

  // GateSesion (_layout.tsx) ya garantiza que no se llega acá sin sesión.
  if (!session) return null;

  return (
    <View style={[styles.pantalla, { backgroundColor: paleta.fondo }]}>
      <Head><title>Ajustes - Super App</title></Head>
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
                  {pesosCorto(totalAhorrado)} desde que usás Super App
                </Text>
              </View>
              <View style={[styles.chip, { backgroundColor: paleta.oferta }]}>
                <Text style={[texto.micro, { color: paleta.ofertaTinta }]}>NUEVO ACÁ</Text>
              </View>
              <IconoChevron color={paleta.tintaTenue} />
            </Pressable>
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

const styles = StyleSheet.create({
  pantalla: { flex: 1 },
  cuerpo: { padding: espacio.pantalla, gap: espacio.pantalla },
  seccion: { gap: espacio.sm },
  grupo: { borderWidth: 1, borderRadius: radio.tarjeta, paddingHorizontal: espacio.md },
  fila: { flexDirection: 'row', alignItems: 'center', gap: espacio.sm, minHeight: 52 },
  separador: { height: StyleSheet.hairlineWidth },
  chip: { borderRadius: 6, paddingHorizontal: espacio.sm, paddingVertical: 3 },
});
