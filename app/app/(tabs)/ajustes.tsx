/**
 * Pantalla Ajustes.
 *
 * El rediseño v2 agrega este tab (antes eran solo Buscar/Carrito) pero su contenido no está
 * diseñado del todo (ver design_handoff_allpromos_v2/SPEC.md § 7.4): tema claro/oscuro y la
 * preferencia de compra online llegan en próximas fases, no como relleno acá. "Cómo funciona"
 * y "Cuenta" (Fase 1, Plan_Usuarios_y_cobros.md) sí tienen su punto de entrada ya. "Mis
 * descuentos" tenía su fila acá pero pasó a ser su propia pestaña de la barra inferior.
 *
 * La cuenta ya no es opcional (Fase 2, `GateSesion.tsx`): sin sesión no se llega a este tab
 * (ni a ningún otro) — por eso acá abajo no hace falta un branch para el caso sin sesión.
 *
 * El bloque "TU PLAN" (turnos 12/13, TURNOS-12-13-planes-y-pago.md § 4) reemplaza a los tres
 * botones provisorios de elegir plan que había acá (opciones_planes.md, Fase 3) — la selección
 * real de plan vive en `PlanSelect`, alcanzada desde `/plan-y-pago`. Va separado del grupo
 * "CUENTA" y no como una fila más ahí adentro: el plan Permanente necesita su propio tratamiento
 * visual (tarjeta oscura + badge ACTIVO), y meterlo en el grupo de filas simples no lo permite.
 * La nota al pie de ese bloque ya aclara que ahí también se cambia o se cancela, así que no hace
 * falta una fila separada de "Cancelar suscripción" en la lista — el modal de cancelación se
 * mantiene igual que antes, solo cambia desde dónde se dispara.
 */

import { useFocusEffect, useRouter } from 'expo-router';
import Head from 'expo-router/head';
import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { precioSuscripcion } from '../../src/api';
import { useAuth } from '../../src/auth';
import { ConfirmacionModal } from '../../src/componentes/Confirmacion';
import { HeaderNegro, TituloHeader } from '../../src/componentes/HeaderNegro';
import { desuscribir, pedirPermisoYSuscribir, soportaPush, yaSuscripto } from '../../src/push/push';
import { diasRestantesTrial, usePlanUsuario } from '../../src/plan';
import { espacio, pesosCorto, radio, texto } from '../../src/theme';
import { useTour } from '../../src/tour/TourContext';
import { useTema } from '../../src/useTema';

// Tarjeta oscura del bloque "TU PLAN" cuando el plan activo es Permanente (turno 13e) — mismo
// token que la tarjeta invertida del Anual en PlanSelect.tsx.
const TARJETA_OSCURA = '#14161A';

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
  const { session, cerrarSesion } = useAuth();
  const { info: infoPlan, recargar: recargarPlan } = usePlanUsuario();
  const tour = useTour();
  const [mostrarConfirmarSalir, setMostrarConfirmarSalir] = useState(false);
  const [precios, setPrecios] = useState<{ mensual: number; anual: number; permanente: number } | null>(null);
  const [notifsSoportadas, setNotifsSoportadas] = useState(false);
  const [notifsActivas, setNotifsActivas] = useState(false);
  const [notifsCargando, setNotifsCargando] = useState(false);

  // El tour se lanza desde esta misma pantalla y su overlay se pinta encima sin desmontarla: el
  // paso "notificaciones" pide el permiso y suscribe por su cuenta (TourOverlay.tsx), así que acá
  // hay que volver a consultar `yaSuscripto()` cuando el tour termina, no solo al montar.
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

  // Solo para mostrar el precio del plan activo en el bloque "TU PLAN" (turno 13d/13e) — si
  // falla, los textos caen a la variante sin precio, no bloquea la pantalla.
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

  // Subtítulo de la fila "Plan y pago" — mismo dato (tipo de plan + próximo cobro/fecha de
  // pago) que va a repetirse arriba de `PlanSelect`, pero acá solo hace falta una línea.
  const subtituloPlan = infoPlan?.plan === 'premium'
    ? infoPlan.tipoPlan === 'permanente'
      ? (precioPlanActivo != null
        ? `Pagaste ${pesosCorto(precioPlanActivo)} el ${formatearFecha(infoPlan.pagadoEl)}. No hay renovaciones ni cobros futuros.`
        : `Pagado el ${formatearFecha(infoPlan.pagadoEl)}. No hay renovaciones ni cobros futuros.`)
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
          <Text style={[texto.tituloSeccion, { color: paleta.tintaSuave }]}>CUENTA</Text>
          <View style={[styles.grupo, { borderColor: paleta.borde }]}>
            <View style={styles.fila}>
              <Text style={[texto.cuerpoMedio, { color: paleta.tinta, flex: 1 }]} numberOfLines={1}>
                {session.user.email}
              </Text>
            </View>
            <View style={[styles.separador, { backgroundColor: paleta.borde }]} />
            <Pressable
              onPress={() => setMostrarConfirmarSalir(true)}
              accessibilityRole="button"
              style={styles.fila}
            >
              <Text style={[texto.cuerpoMedio, { color: paleta.alerta }]}>Cerrar sesión</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.seccion}>
          <Text style={[texto.tituloSeccion, { color: paleta.tintaSuave }]}>TU PLAN</Text>
          {infoPlan?.plan === 'premium' && infoPlan.tipoPlan === 'permanente' ? (
            <Pressable
              onPress={() => router.push('/plan-y-pago')}
              accessibilityRole="button"
              style={[styles.tarjetaPlan, { backgroundColor: TARJETA_OSCURA }]}
            >
              <View style={{ flex: 1, gap: 2 }}>
                <View style={styles.filaNombrePlan}>
                  <Text style={[texto.cuerpoMedio, { color: '#FFFFFF' }]}>Permanente</Text>
                  <View style={[styles.badgeActivo, { backgroundColor: paleta.oferta }]}>
                    <Text style={[texto.micro, { color: paleta.ofertaTinta }]}>ACTIVO</Text>
                  </View>
                </View>
                <Text style={[texto.dato, { color: '#C6CCD3' }]}>{subtituloPlan}</Text>
              </View>
              <Text style={[texto.subtitulo, { color: '#FFFFFF' }]}>›</Text>
            </Pressable>
          ) : (
            <Pressable
              onPress={() => router.push('/plan-y-pago')}
              accessibilityRole="button"
              style={[styles.tarjetaPlan, { borderWidth: 1, borderColor: paleta.borde }]}
            >
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={[texto.cuerpoMedio, { color: paleta.tinta }]}>Plan y pago</Text>
                <Text style={[texto.dato, { color: paleta.tintaSuave }]}>{subtituloPlan}</Text>
              </View>
              <Text style={[texto.subtitulo, { color: paleta.tintaTenue }]}>›</Text>
            </Pressable>
          )}
          {infoPlan?.plan === 'premium' ? (
            <Text style={[texto.dato, { color: paleta.tintaSuave }]}>
              {infoPlan.tipoPlan === 'permanente'
                ? 'Tenés la app completa para siempre.'
                : 'Acá cambiás de plan o cancelás.'}
            </Text>
          ) : null}
        </View>

        <View style={styles.seccion}>
          <Text style={[texto.tituloSeccion, { color: paleta.tintaSuave }]}>NOTIFICACIONES</Text>
          {notifsSoportadas ? (
            <View style={[styles.grupo, { borderColor: paleta.borde }]}>
              <View style={styles.fila}>
                <Text style={[texto.cuerpoMedio, { color: paleta.tinta, flex: 1 }]}>
                  Recordatorio semanal
                </Text>
                <Switch value={notifsActivas} onValueChange={alCambiarNotifs} disabled={notifsCargando} />
              </View>
            </View>
          ) : (
            <Text style={[texto.dato, { color: paleta.tintaSuave }]}>
              Agregá la app a tu pantalla de inicio para poder activar notificaciones.
            </Text>
          )}
        </View>

        <View style={[styles.grupo, { borderColor: paleta.borde }]}>
          <Pressable
            onPress={tour.iniciar}
            accessibilityRole="button"
            style={styles.fila}
          >
            <Text style={[texto.cuerpoMedio, { color: paleta.tinta, flex: 1 }]}>Ver el tutorial</Text>
            <Text style={[texto.subtitulo, { color: paleta.tintaTenue }]}>›</Text>
          </Pressable>
        </View>

        <Text style={[texto.cuerpo, { color: paleta.tintaSuave }]}>
          Ante cualquier duda, opinión o problema, escribir a contacto@mi-superapp.com.ar
        </Text>
      </View>
      <ConfirmacionModal
        visible={mostrarConfirmarSalir}
        titulo="Cerrar sesión"
        mensaje="Vas a tener que volver a iniciar sesión para seguir usando la app — la cuenta es obligatoria."
        textoConfirmar="Cerrar sesión"
        onCancelar={() => setMostrarConfirmarSalir(false)}
        onConfirmar={() => { setMostrarConfirmarSalir(false); cerrarSesion(); }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  pantalla: { flex: 1 },
  cuerpo: { padding: espacio.pantalla, gap: espacio.pantalla },
  seccion: { gap: espacio.sm },
  grupo: { borderWidth: 1, borderRadius: radio.tarjeta, paddingHorizontal: espacio.md },
  fila: { flexDirection: 'row', alignItems: 'center', minHeight: 52 },
  separador: { height: StyleSheet.hairlineWidth },
  tarjetaPlan: {
    flexDirection: 'row', alignItems: 'center', gap: espacio.md,
    borderRadius: radio.tarjeta, padding: espacio.lg,
  },
  filaNombrePlan: { flexDirection: 'row', alignItems: 'center', gap: espacio.sm },
  badgeActivo: { borderRadius: 5, paddingHorizontal: espacio.sm, paddingVertical: 3 },
});
