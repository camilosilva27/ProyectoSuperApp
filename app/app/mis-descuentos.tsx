/**
 * Pantalla Mis descuentos (rediseño v2, SPEC.md § 4.7). Reemplaza a "Tus tarjetas": el
 * nombre viejo era incorrecto — Mi Carrefour es un programa, MODO una app, MasClub un club,
 * Cuenta DNI una billetera. Lo que los une es que son cosas que el usuario ya tiene y que
 * desbloquean descuentos, no "tarjetas".
 *
 * El switch de cada fila es la MISMA selección que las tarjetas del carrito (`carrito.
 * tarjetas`) — no hay un estado separado que sincronizar, es una sola fuente de verdad con
 * dos lugares para tocarla.
 */

import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import Head from 'expo-router/head';
import React, { useEffect, useRef } from 'react';
import {
  ActivityIndicator, Animated, Easing, Pressable, ScrollView, StyleSheet, Text, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ErrorApi, misDescuentos, type Descuento } from '../src/api';
import { useAuth } from '../src/auth';
import { useCarrito } from '../src/carrito';
import { NOMBRE_SUPER, ORDEN_SUPERS, Problema } from '../src/componentes/comunes';
import { HeaderNegro } from '../src/componentes/HeaderNegro';
import { espacio, fuentes, pesos, radio, texto } from '../src/theme';
import { useTema } from '../src/useTema';

/**
 * Switch a medida (SPEC turno 6c): el nativo no puede dibujar el anillo interior de 1.5px que
 * pide el diseño para el estado apagado, así que esto reemplaza al `Switch` de RN acá. Colores
 * fijos (no de paleta): el diseño los da como valores absolutos, sin variante por tema.
 */
const SWITCH_ANCHO = 46;
const SWITCH_ALTO = 28;
const SWITCH_PERILLA = 22;
const SWITCH_INSET = 3;

function SwitchDescuento({
  activa, onCambiar, accessibilityLabel,
}: { activa: boolean; onCambiar: (valor: boolean) => void; accessibilityLabel: string }) {
  const progreso = useRef(new Animated.Value(activa ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(progreso, {
      toValue: activa ? 1 : 0,
      duration: 150,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false, // anima translateX en un valor calculado en px, no en layout nativo
    }).start();
  }, [activa, progreso]);

  const traslado = progreso.interpolate({
    inputRange: [0, 1],
    outputRange: [SWITCH_INSET, SWITCH_ANCHO - SWITCH_PERILLA - SWITCH_INSET],
  });

  return (
    <Pressable
      onPress={() => onCambiar(!activa)}
      accessibilityRole="switch"
      accessibilityState={{ checked: activa }}
      accessibilityLabel={accessibilityLabel}
      hitSlop={8}
      style={[
        styles.switchPista,
        activa
          ? { backgroundColor: '#14161A' }
          : { backgroundColor: '#FFFFFF', borderWidth: 1.5, borderColor: '#14161A' },
      ]}
    >
      <Animated.View
        style={[
          styles.switchPerilla,
          { backgroundColor: activa ? '#FFFFFF' : '#14161A', transform: [{ translateX: traslado }] },
        ]}
      />
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

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['mis-descuentos'],
    queryFn: () => misDescuentos(accessToken as string),
    enabled: !!accessToken,
    staleTime: 10 * 60 * 1000,
  });

  return (
    <View style={{ flex: 1, backgroundColor: paleta.fondo }}>
      <Head><title>Mis descuentos - Super App</title></Head>
      <HeaderNegro paddingTop={insets.top + espacio.md} estilo={{ gap: espacio.sm }}>
        {/* router.back() sin más falla con "GO_BACK not handled" si no hay historial previo
            (recargar la página acá, o entrar por URL directa) — canGoBack() lo detecta y cae
            a Carrito, que es de donde se llega siempre en el flujo normal. */}
        <Pressable
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/carrito'))}
          accessibilityRole="button"
          style={styles.filaVolver}
        >
          <Text style={styles.flecha}>‹</Text>
          <Text style={[texto.tituloHeader, styles.titulo]}>Mis descuentos</Text>
        </Pressable>
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
          <View style={[styles.lista, { borderColor: paleta.borde }]}>
            {data.descuentos.map((d, i) => {
              const activa = carrito.tarjetas.includes(d.nombre);
              return (
                <View key={d.nombre}>
                  {i > 0 ? <View style={[styles.separador, { backgroundColor: paleta.borde }]} /> : null}
                  <View style={styles.fila}>
                    <View style={{ flex: 1, gap: 3 }}>
                      <View style={styles.filaNombreTag}>
                        <Text style={[texto.cuerpoMedio, { color: paleta.tinta }]}>{d.nombre}</Text>
                        {!activa ? (
                          <View style={[styles.tagSinUsar, { borderColor: paleta.tinta }]}>
                            <Text style={[styles.tagSinUsarTexto, { color: paleta.tinta }]}>SIN USAR</Text>
                          </View>
                        ) : null}
                      </View>
                      <Text style={[texto.dato, { color: paleta.tintaSuave }]}>{descripcionDe(d)}</Text>
                      {supersDe(d) ? (
                        <Text style={[texto.micro, { color: paleta.tintaSuave }]}>{supersDe(d)}</Text>
                      ) : null}
                    </View>
                    <SwitchDescuento
                      activa={activa}
                      onCambiar={valor =>
                        carrito.setTarjetas(
                          valor
                            ? [...carrito.tarjetas, d.nombre]
                            : carrito.tarjetas.filter(t => t !== d.nombre)
                        )
                      }
                      accessibilityLabel={`${activa ? 'Tengo' : 'No tengo'} ${d.nombre}`}
                    />
                  </View>
                </View>
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
  filaVolver: {
    flexDirection: 'row', alignItems: 'center', gap: espacio.md,
    height: 44, paddingRight: espacio.md, marginLeft: -espacio.xs, marginVertical: -espacio.xs,
  },
  flecha: { fontSize: 22, color: '#FFFFFF' },
  titulo: { fontSize: 26, lineHeight: 26, color: '#FFFFFF' },
  bajada: { color: '#FFFFFF', opacity: 0.7 },
  centrado: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: espacio.xl },
  contenido: { padding: espacio.pantalla, gap: espacio.pantalla },
  lista: { borderWidth: 1, borderRadius: radio.tarjeta, paddingHorizontal: espacio.md },
  fila: { flexDirection: 'row', alignItems: 'center', gap: espacio.md, paddingVertical: espacio.md },
  separador: { height: StyleSheet.hairlineWidth },
  bloqueInfo: { borderRadius: radio.tarjeta, padding: espacio.md },
  filaNombreTag: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  tagSinUsar: { borderWidth: 1, borderRadius: 4, paddingHorizontal: 6 },
  tagSinUsarTexto: { fontFamily: fuentes.semi, fontSize: 10, lineHeight: 14, letterSpacing: 0.6 },
  switchPista: { width: SWITCH_ANCHO, height: SWITCH_ALTO, borderRadius: radio.pill, justifyContent: 'center' },
  switchPerilla: { position: 'absolute', width: SWITCH_PERILLA, height: SWITCH_PERILLA, borderRadius: radio.pill },
});
