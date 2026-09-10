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
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ErrorApi, misDescuentos } from '../../src/api';
import { useAuth } from '../../src/auth';
import { useCarrito } from '../../src/carrito';
import { Cargando, FilaToggleAnimada, Problema } from '../../src/componentes/comunes';
import { HeaderNegro, TituloHeader } from '../../src/componentes/HeaderNegro';
import { espacio, radio, texto } from '../../src/theme';
import { useEstadoTour, useTour, useTourPaso } from '../../src/tour/TourContext';
import { useTema } from '../../src/useTema';

// Nombre exacto tal como lo devuelve el backend en `Descuento.nombre` — el paso del tour que
// pide activar esta tarjeta (ver TourContext.tsx) mide justo esta fila. Mercado Pago, no Banco
// Nación: casi todo el mundo la tiene y aparece cerca del principio de la lista (ver el orden
// en AllPromos/promos-bancarias.js, ALIAS_TARJETAS) — con Banco Nación, casi al final, había
// que scrollear para ver la zona resaltada.
const NOMBRE_TARJETA_TOUR = 'Mercado Pago';

// % / días / tope y "aplica en" ya no se muestran acá (redundante con la grilla de promos
// bancarias por día en el estado inicial de Buscar, GrillaPromosBancarias.tsx) — esta pantalla
// es solo para marcar qué tarjetas/apps/clubes tenés de verdad.

// Sin acentos ni mayúsculas: la lista es corta (~25 tarjetas) y los nombres no tienen errores
// de tipeo del backend, así que alcanza con esto — no hace falta el fuzzy match (fallback stem +
// Levenshtein) que usa la búsqueda de productos.
function normalizar(texto: string): string {
  return texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
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

  const [consulta, setConsulta] = useState('');
  const descuentosFiltrados = useMemo(() => {
    if (!data) return [];
    const q = normalizar(consulta.trim());
    if (!q) return data.descuentos;
    return data.descuentos.filter(d => normalizar(d.nombre).includes(q));
  }, [data, consulta]);

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
        <View style={styles.buscador}>
          <TextInput
            value={consulta}
            onChangeText={setConsulta}
            placeholder="Buscar por nombre…"
            placeholderTextColor={paleta.tintaTenue}
            style={[texto.cuerpo, styles.input, { color: paleta.tinta }]}
            autoCorrect={false}
            autoCapitalize="none"
            returnKeyType="search"
            accessibilityLabel="Buscar entre mis descuentos"
          />
          {consulta.length > 0 ? (
            <Pressable
              onPress={() => setConsulta('')}
              accessibilityRole="button"
              accessibilityLabel="Borrar búsqueda"
              hitSlop={12}
              style={[styles.botonLimpiar, { backgroundColor: paleta.superficieAlt }]}
            >
              <Text style={[texto.etiqueta, { color: paleta.tintaTenue }]}>✕</Text>
            </Pressable>
          ) : null}
        </View>
      </HeaderNegro>

      {isLoading ? (
        <Cargando />
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
            {descuentosFiltrados.length === 0 ? (
              <Text style={[texto.cuerpo, { color: paleta.tintaSuave }]}>
                No encontramos ninguna que coincida con "{consulta.trim()}".
              </Text>
            ) : (
            <View style={styles.lista}>
              {descuentosFiltrados.map(d => {
                const activa = carrito.tarjetas.includes(d.nombre);
                return (
                  <FilaToggleAnimada
                    key={d.nombre}
                    paleta={paleta}
                    filaRef={d.nombre === NOMBRE_TARJETA_TOUR ? refMercadoPago : undefined}
                    nombre={d.nombre}
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
            )}

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
  buscador: {
    flexDirection: 'row', alignItems: 'center', gap: espacio.sm,
    backgroundColor: '#FFFFFF', borderRadius: radio.md, paddingHorizontal: espacio.md, height: 44,
  },
  input: { flex: 1, outlineWidth: 0, outlineStyle: 'none' },
  botonLimpiar: {
    width: 20, height: 20, borderRadius: radio.pill, alignItems: 'center', justifyContent: 'center',
  },
  centrado: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: espacio.xl },
  contenedorLista: { position: 'relative', flex: 1, minHeight: 0 },
  contenido: { padding: espacio.pantalla, gap: espacio.pantalla },
  lista: { gap: espacio.sm },
  bloqueInfo: { borderRadius: radio.tarjeta, padding: espacio.md },
});
