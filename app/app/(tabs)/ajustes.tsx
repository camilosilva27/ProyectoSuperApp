/**
 * Pantalla Ajustes.
 *
 * El rediseño v2 agrega este tab (antes eran solo Buscar/Carrito) pero su contenido no está
 * diseñado del todo (ver design_handoff_allpromos_v2/SPEC.md § 7.4): tema claro/oscuro y la
 * preferencia de compra online llegan en próximas fases, no como relleno acá. "Cómo funciona",
 * "Mis descuentos" y ahora "Cuenta" (Fase 1, Plan_Usuarios_y_cobros.md) sí tienen su punto de
 * entrada ya.
 *
 * La cuenta ya no es opcional (Fase 2, `GateSesion.tsx`): sin sesión no se llega a este tab
 * (ni a ningún otro) — por eso acá abajo no hace falta un branch para el caso sin sesión.
 *
 * La fila "Plan y pago" (turnos 12/13) reemplaza a los tres botones provisorios de elegir plan
 * que había acá (opciones_planes.md, Fase 3) — la selección real de plan vive en `PlanSelect`,
 * alcanzada desde `/plan-y-pago`. El subtítulo de esa fila ya aclara que ahí también se cambia
 * o se cancela, así que no hace falta una fila separada de "Cancelar suscripción" en la lista —
 * el modal de cancelación se mantiene igual que antes, solo cambia desde dónde se dispara.
 */

import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../src/auth';
import { ComoFunciona } from '../../src/componentes/ComoFunciona';
import { ConfirmacionModal } from '../../src/componentes/Confirmacion';
import { HeaderNegro, TituloHeader } from '../../src/componentes/HeaderNegro';
import { diasRestantesTrial, usePlanUsuario } from '../../src/plan';
import { espacio, radio, texto } from '../../src/theme';
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
  const { session, cerrarSesion } = useAuth();
  const { info: infoPlan, recargar: recargarPlan } = usePlanUsuario();
  const [mostrarComoFunciona, setMostrarComoFunciona] = useState(false);
  const [mostrarConfirmarSalir, setMostrarConfirmarSalir] = useState(false);

  // Al volver a esta pantalla (ej. después de ir y volver del checkout de Mercado Pago) se
  // refresca el plan — el webhook de MP ya pudo haber actualizado `perfil_usuario` mientras
  // el usuario estaba afuera.
  useFocusEffect(useCallback(() => { recargarPlan(); }, [recargarPlan]));

  const diasTrial = diasRestantesTrial(infoPlan?.trialTerminaEn ?? null);

  // Subtítulo de la fila "Plan y pago" — mismo dato (tipo de plan + próximo cobro/fecha de
  // pago) que va a repetirse arriba de `PlanSelect`, pero acá solo hace falta una línea.
  const subtituloPlan = infoPlan?.plan === 'premium'
    ? infoPlan.tipoPlan === 'permanente'
      ? `Permanente · pagado el ${formatearFecha(infoPlan.pagadoEl)} · sin renovaciones`
      : `${infoPlan.tipoPlan === 'anual' ? 'Anual' : 'Mensual'} · próximo cobro ${formatearFecha(infoPlan.renuevaEl)}`
    : infoPlan?.plan === 'trial'
      ? (diasTrial !== null
        ? `Prueba gratis · vence en ${diasTrial} día${diasTrial === 1 ? '' : 's'}`
        : 'Prueba gratis')
      : 'Elegí un plan';

  // GateSesion (_layout.tsx) ya garantiza que no se llega acá sin sesión.
  if (!session) return null;

  return (
    <View style={[styles.pantalla, { backgroundColor: paleta.fondo }]}>
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
              onPress={() => router.push('/plan-y-pago')}
              accessibilityRole="button"
              style={styles.fila}
            >
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={[texto.cuerpoMedio, { color: paleta.tinta }]}>Plan y pago</Text>
                <Text style={[texto.dato, { color: paleta.tintaSuave }]}>{subtituloPlan}</Text>
              </View>
              <Text style={[texto.subtitulo, { color: paleta.tintaTenue }]}>›</Text>
            </Pressable>
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

        <View style={[styles.grupo, { borderColor: paleta.borde }]}>
          <Pressable
            onPress={() => router.push('/mis-descuentos')}
            accessibilityRole="button"
            style={styles.fila}
          >
            <Text style={[texto.cuerpoMedio, { color: paleta.tinta, flex: 1 }]}>Mis descuentos</Text>
            <Text style={[texto.subtitulo, { color: paleta.tintaTenue }]}>›</Text>
          </Pressable>
          <View style={[styles.separador, { backgroundColor: paleta.borde }]} />
          <Pressable
            onPress={() => setMostrarComoFunciona(true)}
            accessibilityRole="button"
            style={styles.fila}
          >
            <Text style={[texto.cuerpoMedio, { color: paleta.tinta, flex: 1 }]}>Cómo funciona</Text>
            <Text style={[texto.subtitulo, { color: paleta.tintaTenue }]}>›</Text>
          </Pressable>
        </View>

        <Text style={[texto.cuerpo, { color: paleta.tintaSuave }]}>
          Ante cualquier duda, opinión o problema, escribir a camilosilva28@gmail.com
        </Text>
      </View>
      <ComoFunciona visible={mostrarComoFunciona} onClose={() => setMostrarComoFunciona(false)} />
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
});
