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
 * "NOTIFICACIONES" (recordatorio semanal genérico) es una feature aparte de "Alertas" — no la
 * tocó este rediseño, sigue en el cuerpo de esta pantalla tal cual estaba.
 *
 * La cuenta ya no es opcional (Fase 2, `GateSesion.tsx`): sin sesión no se llega a este tab
 * (ni a ningún otro) — por eso acá abajo no hace falta un branch para el caso sin sesión.
 */

import { useFocusEffect, useRouter } from 'expo-router';
import Head from 'expo-router/head';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { precioSuscripcion } from '../../src/api';
import { useAuth } from '../../src/auth';
import { FilaToggleAnimada, IconoChevron } from '../../src/componentes/comunes';
import { HeaderNegro, TituloHeader } from '../../src/componentes/HeaderNegro';
import { calcularResumenAhorro, useHistorialAhorro } from '../../src/historialAhorro';
import { desuscribir, pedirPermisoYSuscribir, soportaPush, yaSuscripto } from '../../src/push/push';
import { diasRestantesTrial, usePlanUsuario } from '../../src/plan';
import { espacio, pesosCorto, radio, texto } from '../../src/theme';
import { useTour } from '../../src/tour/TourContext';
import { useTema } from '../../src/useTema';

function formatearFecha(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('es-AR', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function PantallaAjustes() {
  const { paleta } = useTema();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { session } = useAuth();
  const { info: infoPlan, recargar: recargarPlan } = usePlanUsuario();
  const tour = useTour();
  const { eventos } = useHistorialAhorro();
  const totalAhorrado = useMemo(() => calcularResumenAhorro(eventos).totalMonto, [eventos]);
  const [precios, setPrecios] = useState<{ mensual: number; anual: number; permanente: number } | null>(null);
  const [notifsSoportadas, setNotifsSoportadas] = useState(false);
  const [notifsActivas, setNotifsActivas] = useState(false);
  const [notifsCargando, setNotifsCargando] = useState(false);

  // El tour se lanza desde la pantalla de Ayuda y su overlay se pinta encima sin desmontar
  // ninguna pantalla: el paso "notificaciones" pide el permiso y suscribe por su cuenta
  // (TourOverlay.tsx), así que acá hay que volver a consultar `yaSuscripto()` cuando el tour
  // termina, no solo al montar.
  useEffect(() => {
    if (tour.activo) return;
    setNotifsSoportadas(soportaPush());
    yaSuscripto().then(setNotifsActivas);
  }, [tour.activo]);

  const alCambiarNotifs = useCallback(async (activar: boolean) => {
    setNotifsCargando(true);
    if (activar) {
      const ok = await pedirPermisoYSuscribir(session!.user.id);
      setNotifsActivas(ok);
    } else {
      await desuscribir();
      setNotifsActivas(false);
    }
    setNotifsCargando(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `session` es estable mientras
    // hay sesión (GateSesion garantiza que no se llega a esta pantalla sin ella).
  }, []);

  // Al volver a esta pantalla (ej. después de ir y volver del checkout de Mercado Pago) se
  // refresca el plan — el webhook de MP ya pudo haber actualizado `perfil_usuario` mientras
  // el usuario estaba afuera.
  useFocusEffect(useCallback(() => { recargarPlan(); }, [recargarPlan]));

  // Solo para mostrar el precio del plan activo en la fila "Suscripción" — si falla, los
  // textos caen a la variante sin precio, no bloquea la pantalla.
  useEffect(() => {
    precioSuscripcion()
      .then(({ precioMensualArs, precioAnualArs, precioPermanenteArs }) => {
        setPrecios(precioMensualArs && precioAnualArs && precioPermanenteArs
          ? { mensual: precioMensualArs, anual: precioAnualArs, permanente: precioPermanenteArs }
          : null);
      })
      .catch(() => setPrecios(null));
  }, []);

  const diasTrial = diasRestantesTrial(infoPlan?.trialTerminaEn ?? null);
  const precioPlanActivo = infoPlan?.tipoPlan && precios ? precios[infoPlan.tipoPlan] : null;
  const nombrePlanActivo = infoPlan?.tipoPlan === 'anual' ? 'Anual' : infoPlan?.tipoPlan === 'mensual' ? 'Mensual' : null;

  const subtituloPlan = infoPlan?.plan === 'premium'
    ? infoPlan.tipoPlan === 'permanente'
      ? (precioPlanActivo != null
        ? `Permanente · pagaste ${pesosCorto(precioPlanActivo)} el ${formatearFecha(infoPlan.pagadoEl)}`
        : `Permanente · pagado el ${formatearFecha(infoPlan.pagadoEl)}`)
      : (precioPlanActivo != null
        ? `${nombrePlanActivo} · ${pesosCorto(precioPlanActivo)} — próximo cobro el ${formatearFecha(infoPlan.renuevaEl)}`
        : `${nombrePlanActivo} · próximo cobro ${formatearFecha(infoPlan.renuevaEl)}`)
    : infoPlan?.plan === 'trial'
      ? (diasTrial !== null
        ? `Prueba gratis · vence en ${diasTrial} día${diasTrial === 1 ? '' : 's'}`
        : 'Prueba gratis')
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
              onPress={() => router.push('/mis-ahorros')}
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
            <Pressable onPress={() => router.push('/datos-personales')} accessibilityRole="button" style={styles.fila}>
              <Text style={[texto.cuerpoMedio, { color: paleta.tinta, flex: 1 }]}>Datos personales</Text>
              <IconoChevron color={paleta.tintaTenue} />
            </Pressable>
            <View style={[styles.separador, { backgroundColor: paleta.borde }]} />
            <Pressable onPress={() => router.push('/plan-y-pago')} accessibilityRole="button" style={styles.fila}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={[texto.cuerpoMedio, { color: paleta.tinta }]}>Suscripción</Text>
                <Text style={[texto.etiqueta, { color: paleta.tintaSuave, letterSpacing: 0.2 }]}>{subtituloPlan}</Text>
              </View>
              <IconoChevron color={paleta.tintaTenue} />
            </Pressable>
            <View style={[styles.separador, { backgroundColor: paleta.borde }]} />
            <Pressable onPress={() => router.push('/ayuda')} accessibilityRole="button" style={styles.fila}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={[texto.cuerpoMedio, { color: paleta.tinta }]}>Ayuda</Text>
                <Text style={[texto.etiqueta, { color: paleta.tintaSuave, letterSpacing: 0.2 }]}>Contacto y tutoriales</Text>
              </View>
              <IconoChevron color={paleta.tintaTenue} />
            </Pressable>
          </View>
        </View>

        {notifsSoportadas ? (
          <View style={styles.seccion}>
            <Text style={[texto.tituloSeccion, { color: paleta.tintaSuave }]}>NOTIFICACIONES</Text>
            <FilaToggleAnimada
              paleta={paleta}
              nombre="Recordatorio semanal"
              activa={notifsActivas}
              deshabilitada={notifsCargando}
              onCambiar={alCambiarNotifs}
              accessibilityLabel={`Recordatorio semanal ${notifsActivas ? 'activado' : 'desactivado'}`}
            />
          </View>
        ) : null}
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
