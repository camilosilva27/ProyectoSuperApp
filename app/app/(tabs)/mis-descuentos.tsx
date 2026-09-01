/**
 * Pantalla Mis descuentos (rediseño v2, SPEC.md § 4.7). Reemplaza a "Tus tarjetas": el
 * nombre viejo era incorrecto — Mi Carrefour es un programa, MODO una app, MasClub un club,
 * Cuenta DNI una billetera. Lo que los une es que son cosas que el usuario ya tiene y que
 * desbloquean descuentos, no "tarjetas".
 *
 * El switch de cada fila es la MISMA selección que las tarjetas del carrito (`carrito.
 * tarjetas`) — no hay un estado separado que sincronizar, es una sola fuente de verdad con
 * dos lugares para tocarla.
 *
 * Pasó de ser una pantalla apilada (abierta desde Ajustes) a su propia pestaña de la barra
 * inferior: por eso el header ya no tiene flecha de "volver" (no hay a dónde volver, es un
 * tab más) y usa `TituloHeader` como el resto de las pestañas (ver ahorros.tsx).
 */

import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import Head from 'expo-router/head';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Animated, Easing, Pressable, ScrollView, StyleSheet, Text, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ErrorApi, misDescuentos, type Descuento } from '../../src/api';
import { useAuth } from '../../src/auth';
import { useCarrito } from '../../src/carrito';
import { NOMBRE_SUPER, ORDEN_SUPERS, Problema } from '../../src/componentes/comunes';
import { HeaderNegro, TituloHeader } from '../../src/componentes/HeaderNegro';
import { espacio, fuentes, pesos, radio, texto } from '../../src/theme';
import { useTour, useTourPaso } from '../../src/tour/TourContext';
import { useTema } from '../../src/useTema';

// Nombre exacto tal como lo devuelve el backend en `Descuento.nombre` — el paso del tour que
// pide activar esta tarjeta (ver TourContext.tsx) mide justo esta fila. Mercado Pago, no Banco
// Nación: casi todo el mundo la tiene y aparece cerca del principio de la lista (ver el orden
// en AllPromos/promos-bancarias.js, ALIAS_TARJETAS) — con Banco Nación, casi al final, había
// que scrollear para ver la zona resaltada.
const NOMBRE_TARJETA_TOUR = 'Mercado Pago';

/**
 * Ítem de la lista (SPEC diseño v2, tarjeta con barra de acento + radio circular): reemplaza al
 * switch anterior. Cada fila es su propia "tarjeta" tocable (fondo, borde y barra de acento
 * cambian juntos según el estado), en vez de un switch aislado dentro de una lista con borde
 * único. Todos los colores salen de `paleta` (no fijos) para no romper el tema oscuro.
 *
 * Selección múltiple real (varias tarjetas activas a la vez) — visualmente es un radio circular
 * con check, pero la semántica de accesibilidad sigue siendo checkbox, no radio.
 */
function ItemDescuento({
  paleta, filaRef, nombre, detalle, supersTexto, sinUsar, activa, onCambiar, accessibilityLabel,
}: {
  paleta: ReturnType<typeof useTema>['paleta'];
  filaRef?: React.Ref<View>;
  nombre: string;
  detalle: string;
  supersTexto: string | null;
  sinUsar: boolean;
  activa: boolean;
  onCambiar: (valor: boolean) => void;
  accessibilityLabel: string;
}) {
  const progreso = useRef(new Animated.Value(activa ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(progreso, {
      toValue: activa ? 1 : 0,
      duration: 180,
      easing: Easing.out(Easing.ease), // fade suave, sin rebote (spec: ease-out 150-200ms)
      useNativeDriver: false, // anima colores, no soportado por el driver nativo
    }).start();
  }, [activa, progreso]);

  const fondo = progreso.interpolate({ inputRange: [0, 1], outputRange: [paleta.superficieAlt, paleta.ofertaSuave] });
  const borde = progreso.interpolate({ inputRange: [0, 1], outputRange: [paleta.borde, paleta.oferta] });
  const acento = progreso.interpolate({ inputRange: [0, 1], outputRange: [paleta.borde, paleta.oferta] });
  const radioFondo = progreso.interpolate({ inputRange: [0, 1], outputRange: [paleta.superficie, paleta.tinta] });
  const radioBorde = progreso.interpolate({ inputRange: [0, 1], outputRange: [paleta.bordeFuerte, paleta.tinta] });

  return (
    <Pressable
      ref={filaRef}
      onPress={() => onCambiar(!activa)}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: activa }}
      accessibilityLabel={accessibilityLabel}
    >
      <Animated.View style={[styles.fila, { backgroundColor: fondo, borderColor: borde }]}>
        <Animated.View style={[styles.barraAcento, { backgroundColor: acento }]} />
        <View style={styles.filaTexto}>
          <View style={styles.filaNombreTag}>
            <Text style={[texto.cuerpoMedio, { color: paleta.tinta }]}>{nombre}</Text>
            {sinUsar ? (
              <View style={[styles.tagSinUsar, { borderColor: paleta.tinta }]}>
                <Text style={[styles.tagSinUsarTexto, { color: paleta.tinta }]}>SIN USAR</Text>
              </View>
            ) : null}
          </View>
          <Text style={[texto.etiqueta, { color: paleta.tintaSuave }]}>{detalle}</Text>
          {supersTexto ? (
            <Text style={[texto.etiqueta, { color: paleta.tintaSuave }]}>{supersTexto}</Text>
          ) : null}
        </View>
        <Animated.View style={[styles.radio, { backgroundColor: radioFondo, borderColor: radioBorde }]}>
          <Animated.Text style={[styles.radioCheck, { color: paleta.oferta, opacity: progreso }]}>✓</Animated.Text>
        </Animated.View>
      </Animated.View>
    </Pressable>
  );
}

function descripcionDe(d: Descuento): string {
  if (!d.disponible || d.descuentoPct == null) return 'Sin promo vigente ahora';
  const pct = `${Math.round(d.descuentoPct * 100)}%`;
  const dias = d.dias.length ? ` los ${d.dias.join(', ')}` : '';
  const tope = d.tope != null ? ` · tope ${pesos(d.tope)}` : '';
  return `${pct}${dias}${tope}`;
}

/**
 * En qué super(s) aplica. Se omite para Mi Carrefour cuando el único super es Carrefour:
 * decirlo ahí es redundante, el nombre ya lo dice. Si algún día tuviera otros supers además
 * de Carrefour, se muestra igual — la redundancia se decide por los datos, no por el nombre.
 */
function supersDe(d: Descuento): string | null {
  if (!d.disponible || !d.supers.length) return null;
  if (d.nombre === 'Mi Carrefour' && d.supers.every(s => s === 'carr')) return null;
  const ordenados = ORDEN_SUPERS.filter(k => d.supers.includes(k));
  return `Aplica en ${ordenados.map(k => NOMBRE_SUPER[k]).join(', ')}`;
}

export default function PantallaMisDescuentos() {
  const { paleta } = useTema();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const carrito = useCarrito();
  const { session } = useAuth();
  const accessToken = session?.access_token ?? null;
  const tour = useTour();

  // El target del paso 'tab-descuentos' (la celda de la barra inferior) se calcula por fórmula
  // en TourOverlay, no con un ref — pero el avance sigue necesitando este hook: si el usuario
  // ya está en esta pantalla, la condición del paso ("navegó a Descuentos") está cumplida. El
  // ref que devuelve no se usa en ningún lado a propósito.
  useTourPaso('tab-descuentos', true);

  // NO mira `carrito.tarjetas.includes(...)`: si la cuenta ya tenía Mercado Pago activado de
  // antes (persiste entre sesiones, igual que el carrito), esa condición ya estaría cumplida
  // apenas monta la pantalla, saltando el paso sin que el usuario llegue a ver el switch —
  // mismo bug que ya se corrigió para "marcá Coto" en HojaSupers.tsx. Este estado local sí se
  // resetea en cada visita a la pantalla, que es justo lo que hace falta acá.
  const [tocoMercadoPago, setTocoMercadoPago] = useState(false);
  const refMercadoPago = useTourPaso('mercado-pago', tocoMercadoPago, () => router.navigate('/'));

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['mis-descuentos'],
    queryFn: () => misDescuentos(accessToken as string),
    enabled: !!accessToken,
    staleTime: 10 * 60 * 1000,
  });

  return (
    <View style={{ flex: 1, backgroundColor: paleta.fondo }}>
      <Head><title>Mis descuentos - Super App</title></Head>
      <HeaderNegro paddingTop={insets.top + espacio.xl} estilo={{ gap: espacio.sm }}>
        <TituloHeader>Mis descuentos</TituloHeader>
        <Text style={[texto.cuerpo, styles.bajada]}>
          Tarjetas, apps y clubes que tenés. Sus promos se suman al comparar.
        </Text>
      </HeaderNegro>

      {isLoading ? (
        <View style={styles.centrado}>
          <ActivityIndicator color={paleta.tintaSuave} />
        </View>
      ) : error || !data ? (
        <View style={styles.centrado}>
          <Problema
            mensaje={error instanceof ErrorApi ? error.message : 'No se pudieron consultar las promos bancarias.'}
            onReintentar={refetch}
          />
        </View>
      ) : (
        <ScrollView contentContainerStyle={[styles.contenido, { paddingBottom: insets.bottom + espacio.xl }]}>
          <View style={styles.lista}>
            {data.descuentos.map(d => {
              const activa = carrito.tarjetas.includes(d.nombre);
              return (
                <ItemDescuento
                  key={d.nombre}
                  paleta={paleta}
                  filaRef={d.nombre === NOMBRE_TARJETA_TOUR ? refMercadoPago : undefined}
                  nombre={d.nombre}
                  detalle={descripcionDe(d)}
                  supersTexto={supersDe(d)}
                  sinUsar={!activa}
                  activa={activa}
                  onCambiar={valor => {
                    // Durante el tour, tocar la fila de Mercado Pago cuenta como el toque
                    // que completa el paso pase lo que pase — pero si ya estaba activa (de
                    // una sesión anterior), no la desactiva: el usuario no eligió activarla
                    // ahora, solo tocó para seguir el tutorial, y apagarle una promo real
                    // que ya tenía cargada sería un efecto secundario no pedido.
                    if (d.nombre === NOMBRE_TARJETA_TOUR) {
                      setTocoMercadoPago(true);
                      if (tour.pasoActivo === 'mercado-pago' && activa && !valor) return;
                    }
                    carrito.setTarjetas(
                      valor
                        ? [...carrito.tarjetas, d.nombre]
                        : carrito.tarjetas.filter(t => t !== d.nombre)
                    );
                  }}
                  accessibilityLabel={`${activa ? 'Tengo' : 'No tengo'} ${d.nombre}`}
                />
              );
            })}
          </View>

          <View style={[styles.bloqueInfo, { backgroundColor: paleta.superficieAlt }]}>
            <Text style={[texto.cuerpo, { color: paleta.tintaSuave }]}>
              Marcá solo las que tenés de verdad. Las promos de las demás igual se muestran al
              comparar, avisando que no están contadas.
            </Text>
          </View>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  bajada: { color: '#FFFFFF', opacity: 0.7 },
  centrado: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: espacio.xl },
  contenido: { padding: espacio.pantalla, gap: espacio.pantalla },
  lista: { gap: espacio.sm },
  fila: {
    flexDirection: 'row', alignItems: 'center', gap: espacio.md, padding: espacio.md,
    borderRadius: radio.tarjeta, borderWidth: 1, minHeight: 44,
  },
  barraAcento: { width: 8, height: 36, borderRadius: radio.pill },
  filaTexto: { flex: 1, gap: 2 },
  bloqueInfo: { borderRadius: radio.tarjeta, padding: espacio.md },
  filaNombreTag: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  tagSinUsar: { borderWidth: 1, borderRadius: 4, paddingHorizontal: 6 },
  tagSinUsarTexto: { fontFamily: fuentes.semi, fontSize: 10, lineHeight: 14, letterSpacing: 0.6 },
  radio: { width: 26, height: 26, borderRadius: radio.pill, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  radioCheck: { fontFamily: fuentes.semi, fontSize: 13, lineHeight: 13 },
});
