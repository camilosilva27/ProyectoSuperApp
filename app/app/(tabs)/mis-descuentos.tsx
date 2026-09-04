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
import { useFocusEffect } from 'expo-router';
import Head from 'expo-router/head';
import React, { useCallback, useEffect, useRef, useState } from 'react';
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
import { useEstadoTour, useTour, useTourPaso } from '../../src/tour/TourContext';
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
  paleta, filaRef, nombre, detalle, supersTexto, activa, onCambiar, accessibilityLabel,
}: {
  paleta: ReturnType<typeof useTema>['paleta'];
  filaRef?: React.Ref<View>;
  nombre: string;
  detalle: string;
  supersTexto: string | null;
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
          <Text style={[texto.cuerpoMedio, { color: paleta.tinta }]}>{nombre}</Text>
          {detalle ? (
            <Text style={[texto.etiqueta, { color: paleta.tintaSuave }]}>{detalle}</Text>
          ) : null}
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

// `disponible: false` con `descuentoPct` presente significa que el backend encontró una promo
// con día definido para esta tarjeta pero fuera de la ventana de vigencia de la campaña actual
// (ver misDescuentos.js) — es una promo con periodicidad conocida (ej. Mercado Pago, que se
// renueva mes a mes), no "no tiene nada". Se muestra igual, sin decir que está vigente ahora.
// Cuando no hay ni eso, se devuelve vacío en vez de un texto fijo tipo "Sin promo vigente
// ahora": ese texto en TODAS las tarjetas sin datos se leía como que algo estaba roto.
function descripcionDe(d: Descuento): string {
  if (d.descuentoPct == null) return '';
  const pct = `${Math.round(d.descuentoPct * 100)}%`;
  const dias = d.dias.length ? ` los ${d.dias.join(', ')}` : '';
  const tope = d.tope != null ? ` · tope ${pesos(d.tope)}` : '';
  return `${pct}${dias}${tope}`;
}

// Los 3 beneficios propios de Carrefour (Mi Carrefour DNI / Cuenta Digital / tarjeta de
// Crédito) — ver ALIAS_TARJETAS en AllPromos/promos-bancarias.js para el detalle de qué
// distingue a cada uno.
const NOMBRES_CARREFOUR_PROPIO = ['Mi Carrefour', 'Cuenta Digital Carrefour', 'Tarjeta Carrefour Crédito'];

/**
 * En qué super(s) aplica. Se omite para los niveles propios de Carrefour cuando el único
 * super es Carrefour: decirlo ahí es redundante, el nombre ya lo dice. Si algún día tuviera
 * otros supers además de Carrefour, se muestra igual — la redundancia se decide por los
 * datos, no por el nombre.
 */
function supersDe(d: Descuento): string | null {
  if (!d.supers.length) return null;
  if (NOMBRES_CARREFOUR_PROPIO.includes(d.nombre) && d.supers.every(s => s === 'carr')) return null;
  const ordenados = ORDEN_SUPERS.filter(k => d.supers.includes(k));
  return `Aplica en ${ordenados.map(k => NOMBRE_SUPER[k]).join(', ')}`;
}

export default function PantallaMisDescuentos() {
  const { paleta } = useTema();
  const insets = useSafeAreaInsets();
  const carrito = useCarrito();
  const { session } = useAuth();
  const accessToken = session?.access_token ?? null;
  const tour = useTour();

  // El target del paso 'tab-descuentos' (la celda de la barra inferior) se calcula por fórmula
  // en TourOverlay, no con un ref — el ref que devuelve `useTourPaso` no se usa en ningún lado
  // a propósito. NO usa `true` fijo: los tabs de expo-router no se desmontan al cambiar de
  // pestaña, así que si el usuario ya había visitado esta pantalla antes de arrancar el tour,
  // esa condición ya estaría cumplida apenas el paso se activa, saltándolo sin cartel — mismo
  // bug que ya se corrigió para "marcá Coto"/"activá Mercado Pago". `useFocusEffect` sí exige
  // una transición real de foco (un tap genuino en la pestaña): se resetea a `false` en el
  // blur, así que un foco viejo de antes de iniciar el tour no cuenta.
  const [enfocada, setEnfocada] = useState(false);
  useFocusEffect(useCallback(() => {
    setEnfocada(true);
    return () => setEnfocada(false);
  }, []));
  useTourPaso('tab-descuentos', enfocada);

  // NO mira `carrito.tarjetas.includes(...)`: si la cuenta ya tenía Mercado Pago activado de
  // antes (persiste entre sesiones, igual que el carrito), esa condición ya estaría cumplida
  // apenas monta la pantalla, saltando el paso sin que el usuario llegue a ver el switch —
  // mismo bug que ya se corrigió para "marcá Coto" en HojaSupers.tsx.
  //
  // El toggle de esta fila también se marca acá abajo (`onCambiar`) — pero SOLO cuenta si pasa
  // con el paso 'mercado-pago' activo (ver el guard `tour.pasoActivo === 'mercado-pago'`): la
  // pantalla no se desmonta al cambiar de tab, así que un toque de Mercado Pago hecho fuera del
  // tour (antes de arrancarlo, o en una sesión previa del tour) dejaba esta bandera en `true`
  // para siempre y el paso se saltaba sin que el usuario tocara nada esta vez. También se
  // resetea al perder el foco de la pantalla, para que un tour anterior no deje esto "gastado"
  // si se reinicia el tutorial más de una vez en la misma sesión.
  const [tocoMercadoPago, setTocoMercadoPago] = useState(false);
  useFocusEffect(useCallback(() => () => setTocoMercadoPago(false), []));
  // Sin callback de navegación: antes este paso volvía solo a Buscar (`router.navigate('/')`)
  // apenas se completaba, "teletransportando" al usuario — ahora el paso siguiente
  // ('volver-buscar', ver pasos.ts) le pide el toque real sobre la pestaña.
  const refMercadoPago = useTourPaso('mercado-pago', tocoMercadoPago);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['mis-descuentos'],
    queryFn: () => misDescuentos(accessToken as string),
    enabled: !!accessToken,
    staleTime: 10 * 60 * 1000,
  });

  // Si el usuario ya había scrolleado la lista (buscando otra tarjeta, revisando promos) antes
  // de iniciar el tour, la fila de Mercado Pago puede quedar fuera del área visible cuando este
  // paso se activa — el spotlight mide su posición real (aunque esté scrolleada afuera) y queda
  // apuntando a un lugar que no se ve en pantalla. Mismo mecanismo que el paso "Coto" en
  // HojaSupers.tsx: se trae la fila a la vista sola apenas arranca este paso, en vez de esperar
  // que el usuario adivine que tiene que scrollear.
  //
  // Depende de `isLoading` a propósito (bug real, corregido acá): el paso 'mercado-pago' se
  // activa apenas el usuario toca la pestaña (con el foco, no con datos), pero la fila recién
  // existe en el árbol cuando `misDescuentos()` resuelve — con latencia de red real (a
  // diferencia de una query ya en cache) eso tarda más que el timeout fijo de abajo, así que el
  // efecto corría una sola vez con `refMercadoPago.current` todavía `null`, sin reintentar
  // nunca: el spotlight terminaba midiendo la posición real de la fila (fuera de la pantalla,
  // sin scrollear) y el recorte quedaba con alto 0 — pantalla oscurecida sin nada tocable.
  const scrollRef = useRef<ScrollView>(null);
  const scrollYRef = useRef(0);
  const refContenedor = useRef<View>(null);
  const { pasoActivo } = useEstadoTour();
  useEffect(() => {
    if (pasoActivo !== 'mercado-pago' || isLoading) return;
    const id = setTimeout(() => {
      const fila = refMercadoPago.current;
      const contenedor = refContenedor.current;
      if (!fila || !contenedor) return;
      fila.measureInWindow((xF, yF, wF, hF) => {
        if (!wF) return;
        contenedor.measureInWindow((xC, yC, wC, hC) => {
          if (yF >= yC && yF + hF <= yC + hC) return; // ya está a la vista
          const delta = (yF + hF / 2) - (yC + hC / 2);
          scrollRef.current?.scrollTo({ y: Math.max(0, scrollYRef.current + delta), animated: true });
        });
      });
    }, 300);
    return () => clearTimeout(id);
  }, [pasoActivo, isLoading]);

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
        <View style={styles.contenedorLista} ref={refContenedor}>
          <ScrollView
            ref={scrollRef}
            onScroll={e => { scrollYRef.current = e.nativeEvent.contentOffset.y; }}
            scrollEventThrottle={32}
            contentContainerStyle={[styles.contenido, { paddingBottom: insets.bottom + espacio.xl }]}
          >
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
                    activa={activa}
                    onCambiar={valor => {
                      // Durante el tour, tocar la fila de Mercado Pago cuenta como el toque
                      // que completa el paso pase lo que pase — pero si ya estaba activa (de
                      // una sesión anterior), no la desactiva: el usuario no eligió activarla
                      // ahora, solo tocó para seguir el tutorial, y apagarle una promo real
                      // que ya tenía cargada sería un efecto secundario no pedido.
                      //
                      // El guard `tour.pasoActivo === 'mercado-pago'` es a propósito: sin él,
                      // CUALQUIER toque a esta fila (incluso fuera del tour, o de un tour previo
                      // en la misma sesión) dejaba `tocoMercadoPago` en `true` para siempre —la
                      // pantalla no se desmonta al cambiar de tab— y el paso se salteaba la
                      // próxima vez sin que el usuario tocara nada.
                      if (d.nombre === NOMBRE_TARJETA_TOUR && tour.pasoActivo === 'mercado-pago') {
                        setTocoMercadoPago(true);
                        if (activa && !valor) return;
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
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  bajada: { color: '#FFFFFF', opacity: 0.7 },
  centrado: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: espacio.xl },
  contenedorLista: { position: 'relative', flex: 1, minHeight: 0 },
  contenido: { padding: espacio.pantalla, gap: espacio.pantalla },
  lista: { gap: espacio.sm },
  fila: {
    flexDirection: 'row', alignItems: 'center', gap: espacio.md, padding: espacio.md,
    borderRadius: radio.tarjeta, borderWidth: 1, minHeight: 44,
  },
  barraAcento: { width: 8, height: 36, borderRadius: radio.pill },
  filaTexto: { flex: 1, gap: 2 },
  bloqueInfo: { borderRadius: radio.tarjeta, padding: espacio.md },
  radio: { width: 26, height: 26, borderRadius: radio.pill, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  radioCheck: { fontFamily: fuentes.semi, fontSize: 13, lineHeight: 13 },
});
