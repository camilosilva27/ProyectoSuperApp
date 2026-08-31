/**
 * Pantalla Buscar: elegir productos de una lista, en vez de escribir su nombre.
 *
 * Esto es lo que resuelve el problema central que el CLI tiene que atacar preguntando. En la
 * terminal, "pepitos 357 gr" puede matchear tres productos distintos y hay que preguntar cuál
 * es; acá los tres aparecen juntos, con su nombre real y en qué supers están, y el usuario
 * toca el que quiere. La ambigüedad no se resuelve: no llega a existir.
 *
 * Rediseño v2 (ver design_handoff_allpromos_v2/SPEC.md § 4.2 y § 4.1): header negro con
 * buscador; la barra de supers y los resultados solo aparecen una vez que hay una búsqueda
 * válida — antes de eso (3a) el header no tiene nada que filtrar, y el cuerpo explica qué es
 * la app en vez de mostrar un estado vacío genérico.
 */

import { useQuery } from '@tanstack/react-query';
import { usePathname, useRouter } from 'expo-router';
import Head from 'expo-router/head';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, FlatList, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
// expo-router (v57) vendorea su propio bottom-tabs y no lo reexporta desde el root del
// paquete: no hay `@react-navigation/bottom-tabs` instalado por separado, así que este es
// el único import que existe hoy para este hook.
import { useBottomTabBarHeight } from 'expo-router/build/react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  buscarProductos, ErrorApi, precios as pedirPrecios, MAX_EANS_PRECIOS,
  type ProductoCatalogo, type PrecioRapido, type SuperKey, type OrdenBusqueda,
} from '../../src/api';
import { useAuth } from '../../src/auth';
import { useCarrito } from '../../src/carrito';
import {
  BandaDisponibilidad, BotonPrincipal, NOMBRE_SUPER, ORDEN_SUPERS, Problema, Stepper, Vacio,
} from '../../src/componentes/comunes';
import { FotoProducto } from '../../src/componentes/FotoProducto';
import { HeaderNegro, SelectorSupers, TituloHeader } from '../../src/componentes/HeaderNegro';
import { PlacaLogoSuper } from '../../src/componentes/LogoSuper';
import { HojaSupers } from '../../src/componentes/HojaSupers';
import { useFiltrosSupers } from '../../src/filtrosSupers';
import { espacio, pesos, radio, texto } from '../../src/theme';
import { tourReportarAltoTabBar, tourYaVisto, useTour, useTourPaso } from '../../src/tour/TourContext';
import { useTema } from '../../src/useTema';

/**
 * Precio/oferta de a lotes chicos, a medida que se scrollea — no de toda la búsqueda de una.
 * `onViewableItemsChanged` de FlatList avisa qué EANs están en pantalla en cada momento; los
 * que todavía no se pidieron (ni están en curso) se acumulan y se piden juntos, con un debounce
 * corto para no disparar un request por cada pixel de scroll. Ver backend/src/routes/comparar.js
 * (POST /api/precios) para por qué esto no reemplaza /api/catalogo/buscar: ese nunca trae
 * precio, a propósito.
 */
function usePreciosProgresivos(supersActivos: SuperKey[], accessToken: string | null) {
  const [precios, setPrecios] = useState<Record<string, PrecioRapido | 'error'>>({});
  const pedidos = useRef(new Set<string>());
  const pendientes = useRef(new Set<string>());
  const visibles = useRef<string[]>([]);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const supersRef = useRef(supersActivos);
  supersRef.current = supersActivos;
  const tokenRef = useRef(accessToken);
  tokenRef.current = accessToken;

  const pedirLote = useCallback(() => {
    const lote = [...pendientes.current].slice(0, MAX_EANS_PRECIOS);
    pendientes.current.clear();
    if (!lote.length || !tokenRef.current) return;
    lote.forEach(ean => pedidos.current.add(ean));

    pedirPrecios(lote, tokenRef.current, supersRef.current)
      .then(({ resultados }) => {
        setPrecios(prev => {
          const siguiente = { ...prev };
          for (const r of resultados) siguiente[r.ean] = r;
          return siguiente;
        });
      })
      .catch(() => {
        setPrecios(prev => {
          const siguiente = { ...prev };
          for (const ean of lote) siguiente[ean] = 'error';
          return siguiente;
        });
      });
  }, []);

  const marcarVisibles = useCallback((eans: string[]) => {
    visibles.current = eans;
    let hayNuevos = false;
    for (const ean of eans) {
      if (pedidos.current.has(ean) || pendientes.current.has(ean)) continue;
      pendientes.current.add(ean);
      hayNuevos = true;
    }
    if (!hayNuevos) return;
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(pedirLote, 350);
  }, [pedirLote]);

  // El "mejor precio" depende de qué supers se consideran: si el filtro cambia, lo ya
  // pedido queda obsoleto y hay que volver a consultarlo. No alcanza con esperar a que
  // `FlatList` dispare `onViewableItemsChanged` de nuevo: si los EAN en pantalla siguen
  // disponibles en otro super, la lista visible no cambia y ese evento nunca se re-dispara,
  // dejando el precio vacío para siempre. Por eso se recuerdan los últimos EAN visibles y se
  // vuelven a pedir a mano acá.
  useEffect(() => {
    setPrecios({});
    pedidos.current.clear();
    pendientes.current.clear();
    if (visibles.current.length) marcarVisibles(visibles.current);
  }, [supersActivos, marcarVisibles]);

  return { precios, marcarVisibles };
}

const OPCIONES_ORDEN: { valor: OrdenBusqueda; etiqueta: string }[] = [
  { valor: 'alfabetico', etiqueta: 'Alfabético' },
  { valor: 'disponibilidad', etiqueta: 'Más disponible' },
  { valor: 'precio', etiqueta: 'Precio' },
];

/** Espera a que el usuario deje de tipear antes de consultar: menos requests, menos parpadeo. */
function useTextoDemorado(valor: string, ms = 300) {
  const [demorado, setDemorado] = useState(valor);
  useEffect(() => {
    const t = setTimeout(() => setDemorado(valor), ms);
    return () => clearTimeout(t);
  }, [valor, ms]);
  return demorado;
}

export default function PantallaBuscar() {
  const { paleta } = useTema();
  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight();
  const router = useRouter();
  const pathname = usePathname();
  const carrito = useCarrito();
  const tour = useTour();
  const { session } = useAuth();
  const accessToken = session?.access_token ?? null;
  const [consulta, setConsulta] = useState('');
  const consultaDemorada = useTextoDemorado(consulta.trim());
  const consultaValida = consultaDemorada.length >= 2;
  const [orden, setOrden] = useState<OrdenBusqueda>('alfabetico');
  const [mostrarHojaSupers, setMostrarHojaSupers] = useState(false);
  const { supersActivos, toggleSuper, topeSupers, setSupersYTope, usoPorSuper } = useFiltrosSupers();

  // El alto real de la tab bar solo se puede leer desde una pantalla que esté DENTRO del
  // navigator de tabs (este hook depende de su Context) — el overlay del tour vive afuera
  // (app/_layout.tsx), así que esta pantalla se lo reporta. Es un dato físico de layout, no
  // una condición de avance, por eso no pasa por `useTourPaso`.
  useEffect(() => {
    tourReportarAltoTabBar(tabBarHeight);
  }, [tabBarHeight]);

  // Auto-inicio del tour, una sola vez por dispositivo — el botón manual (EstadoInicial,
  // Ajustes) sigue andando igual después de esto.
  useEffect(() => {
    tourYaVisto().then(visto => {
      if (!visto) tour.iniciar();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo al montar
  }, []);

  const refBuscador = useTourPaso<TextInput>('buscador-input', consultaDemorada.length >= 3);
  const refCeldaOtros = useTourPaso('selector-otros', mostrarHojaSupers);
  // NO mira `carrito.items.length > 0`: el carrito persiste entre sesiones (igual que
  // `carrito.tarjetas`), así que si la cuenta ya tenía algo cargado de antes esa condición ya
  // estaría cumplida apenas arranca este paso — mismo bug que ya se corrigió para "marcá Coto"
  // y "activá Mercado Pago". Este estado exige el toque real sobre la primera fila.
  const [tocoPrimerResultado, setTocoPrimerResultado] = useState(false);
  const refPrimerResultado = useTourPaso('primer-resultado', tocoPrimerResultado);
  const refVerCarrito = useTourPaso('ver-carrito', pathname === '/carrito');

  const { data, isFetching, error, refetch } = useQuery({
    queryKey: ['catalogo', consultaDemorada, supersActivos, orden],
    queryFn: () => buscarProductos(consultaDemorada, accessToken as string, { supers: supersActivos, orden }),
    enabled: consultaValida && !!accessToken,
  });

  const resultados = data?.resultados ?? [];
  const hayMas = (data?.total ?? 0) > resultados.length;

  const { precios, marcarVisibles } = usePreciosProgresivos(supersActivos, accessToken);
  const onViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: Array<{ item: ProductoCatalogo }> }) => {
      marcarVisibles(viewableItems.map(v => v.item.ean));
    }
  ).current;
  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 60 }).current;

  // "Ordenar por precio" pide precio de TODA la búsqueda de una (no progresivo por scroll,
  // ver la discusión en el chat) — así la lista no salta de lugar mientras se completa. El
  // límite de /api/precios (MAX_EANS_PRECIOS) coincide con el límite default de la búsqueda,
  // por eso alcanza un solo lote.
  useEffect(() => {
    if (orden === 'precio' && data?.resultados?.length) {
      marcarVisibles(data.resultados.map(p => p.ean));
    }
  }, [orden, data, marcarVisibles]);

  const cargandoOrdenPrecio = orden === 'precio' && resultados.some(p => precios[p.ean] === undefined);

  const resultadosMostrados = useMemo(() => {
    if (orden !== 'precio' || cargandoOrdenPrecio) return orden === 'precio' ? [] : resultados;
    return [...resultados].sort((a, b) => {
      const pa = precios[a.ean];
      const pb = precios[b.ean];
      const va = pa && pa !== 'error' && pa.mejor ? pa.mejor.total : Infinity;
      const vb = pb && pb !== 'error' && pb.mejor ? pb.mejor.total : Infinity;
      return va - vb;
    });
  }, [resultados, orden, precios, cargandoOrdenPrecio]);

  const supersEnResultados = useMemo(
    () => new Set(resultadosMostrados.flatMap(p => p.disponibleEn.filter(k => supersActivos.includes(k)))).size,
    [resultadosMostrados, supersActivos]
  );

  const cicloOrden = () => {
    const i = OPCIONES_ORDEN.findIndex(o => o.valor === orden);
    setOrden(OPCIONES_ORDEN[(i + 1) % OPCIONES_ORDEN.length].valor);
  };

  const encabezadoLista = useMemo(() => (
    consultaValida ? (
      <View style={styles.filaContador}>
        <Text style={[texto.tituloSeccion, { color: paleta.tintaSuave }]}>
          {cargandoOrdenPrecio
            ? 'ORDENANDO POR PRECIO…'
            : isFetching && data === undefined
              ? 'BUSCANDO…'
              : data?.total === 0
                ? 'SIN RESULTADOS'
                : `${data?.total} RESULTADO${data?.total === 1 ? '' : 'S'} EN ${supersEnResultados} SUPER${supersEnResultados === 1 ? '' : 'S'}`}
        </Text>
        <Pressable onPress={cicloOrden} accessibilityRole="button" style={styles.selectorOrden}>
          <Text style={[texto.etiqueta, styles.subrayado, { color: paleta.tinta }]}>
            {OPCIONES_ORDEN.find(o => o.valor === orden)?.etiqueta}
          </Text>
          <Text style={[texto.cuerpo, { color: paleta.tintaTenue }]}>⌄</Text>
        </Pressable>
      </View>
    ) : null
  ), [consultaValida, cargandoOrdenPrecio, isFetching, data, supersEnResultados, orden, paleta]);

  return (
    <View style={[styles.pantalla, { backgroundColor: paleta.fondo }]}>
      <Head><title>Buscar productos - Super App</title></Head>
      <HeaderNegro paddingTop={insets.top + espacio.xl}>
        <TituloHeader>Qué vas a comprar</TituloHeader>
        <View style={styles.buscador}>
          <TextInput
            ref={refBuscador}
            value={consulta}
            onChangeText={setConsulta}
            placeholder="yerba, fideos, shampoo…"
            placeholderTextColor={paleta.tintaTenue}
            style={[texto.cuerpo, styles.input, { color: paleta.tinta }]}
            autoCorrect={false}
            autoCapitalize="none"
            returnKeyType="search"
            accessibilityLabel="Buscar productos"
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
          {isFetching ? <ActivityIndicator size="small" color={paleta.tintaTenue} /> : null}
        </View>
        {/* Sin selector de supers antes de una búsqueda válida: todavía no hay nada que filtrar
            (SPEC § 4.1, gana sobre el turno v2 que la mostraba siempre). */}
        {consultaValida ? (
          <SelectorSupers
            activos={supersActivos}
            usoPorSuper={usoPorSuper}
            onQuitar={toggleSuper}
            onAbrirHoja={() => setMostrarHojaSupers(true)}
            refCeldaOtros={refCeldaOtros}
          />
        ) : null}
      </HeaderNegro>

      {!consultaValida ? (
        <EstadoInicial
          onAbrirTour={tour.iniciar}
          conCarritoFlotante={carrito.items.length > 0}
        />
      ) : (
        <FlatList
          data={resultadosMostrados}
          keyExtractor={p => p.ean}
          ListHeaderComponent={encabezadoLista}
          contentContainerStyle={[
            styles.lista,
            { paddingBottom: carrito.items.length ? 120 : espacio.xl },
          ]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          ItemSeparatorComponent={() => <View style={{ height: espacio.sm }} />}
          onViewableItemsChanged={onViewableItemsChanged}
          viewabilityConfig={viewabilityConfig}
          renderItem={({ item, index }) => (
            <FilaProducto
              producto={item}
              cantidad={carrito.cantidadDe(item.ean)}
              precio={precios[item.ean]}
              supersActivos={supersActivos}
              onAgregar={() => {
                if (index === 0) setTocoPrimerResultado(true);
                carrito.agregar(item);
              }}
              onCambiarCantidad={n => carrito.cambiarCantidad(item.ean, n)}
              tourRef={index === 0 ? refPrimerResultado : undefined}
            />
          )}
          ListEmptyComponent={
            error ? (
              <Problema
                mensaje={
                  error instanceof ErrorApi
                    ? error.message
                    : 'No se pudo buscar en el catálogo.'
                }
                onReintentar={refetch}
              />
            ) : cargandoOrdenPrecio ? (
              <ActivityIndicator style={styles.cargandoOrden} color={paleta.tintaTenue} />
            ) : !isFetching ? (
              <Vacio
                titulo="Nada con ese nombre"
                detalle="Probá con menos palabras o con el nombre de la marca. El catálogo local es un recorte: puede faltar algún producto poco común."
              />
            ) : null
          }
        />
      )}

      <HojaSupers
        visible={mostrarHojaSupers}
        activos={supersActivos}
        tope={topeSupers}
        onCerrar={() => setMostrarHojaSupers(false)}
        onAplicar={setSupersYTope}
      />

      {/* Oculto mientras la hoja está abierta: sin esto queda pintado ARRIBA del scrim (es un
          hermano posterior en el JSX, y ninguno de los dos tiene z-index/elevation) — se podía
          tocar "Ver carrito" con la hoja todavía abierta y navegar sin pasar por
          cerrarYConfirmar, así que la comparación salía con el tope/selección viejos, de antes
          de abrir la hoja, no con lo que se acababa de elegir ahí. */}
      {carrito.items.length > 0 && !mostrarHojaSupers ? (
        <View
          ref={refVerCarrito}
          style={[
            styles.barraInferior,
            {
              backgroundColor: paleta.superficie,
              borderTopColor: paleta.borde,
              // Arriba del tab bar (que ya resuelve su propio safe-area), no contra el
              // borde de la pantalla: si no, tapaba las 4 pestañas de abajo.
              bottom: tabBarHeight,
              paddingBottom: espacio.md,
            },
          ]}
        >
          <BotonPrincipal
            onPress={() => router.push('/carrito')}
            subtitulo={`${carrito.items.length} producto${carrito.items.length === 1 ? '' : 's'} · ${carrito.totalUnidades} unidad${carrito.totalUnidades === 1 ? '' : 'es'}`}
          >
            Ver carrito
          </BotonPrincipal>
        </View>
      ) : null}
    </View>
  );
}

function filasDe<T>(items: T[], porFila: number): T[][] {
  const filas: T[][] = [];
  for (let i = 0; i < items.length; i += porFila) filas.push(items.slice(i, i + porFila));
  return filas;
}

/** Estado inicial de Buscar (SPEC § 4.1): lo que se ve antes de escribir nada. Es donde el
 *  usuario entiende qué es esto — nunca se vio antes en la app. */
function EstadoInicial({
  onAbrirTour,
  conCarritoFlotante,
}: {
  onAbrirTour: () => void;
  conCarritoFlotante: boolean;
}) {
  const { paleta } = useTema();

  return (
    <ScrollView
      contentContainerStyle={[
        styles.estadoInicial,
        conCarritoFlotante ? { paddingBottom: 120 } : null,
      ]}
      keyboardShouldPersistTaps="handled"
    >
      <View style={{ gap: espacio.sm }}>
        <Text style={[texto.titulo, { color: paleta.tinta }]}>Un carrito, siete supermercados</Text>
        <Text style={[texto.cuerpo, { color: paleta.tintaSuave }]}>
          Armá tu carrito y al final Super App calcula, con promos y tarjetas
          incluidas, qué conviene comprar en cada lugar.
        </Text>
      </View>

      <View style={{ gap: espacio.md }}>
        <Text style={[texto.tituloSeccion, { color: paleta.tintaSuave }]}>CADA SUPER TIENE SU COLOR</Text>
        <View style={{ gap: espacio.sm }}>
          {filasDe(ORDEN_SUPERS, 4).map((fila, i) => (
            <View key={i} style={styles.filaGridSupers}>
              {fila.map(key => {
                const bordeIdentidad = (paleta.supersBorde as Partial<Record<SuperKey, string>>)[key];
                return (
                  <View key={key} style={styles.celdaGridSuper}>
                    <View
                      style={[
                        styles.barraLeyendaSuper,
                        {
                          backgroundColor: paleta.supers[key],
                          ...(bordeIdentidad ? { borderWidth: 1, borderColor: bordeIdentidad } : null),
                        },
                      ]}
                    />
                    <PlacaLogoSuper superKey={key} ancho="100%" alto={34} padding={4} radio={radio.sm} />
                    <Text style={[texto.microSuper, { color: paleta.tintaSuave, textAlign: 'center' }]}>
                      {NOMBRE_SUPER[key]}
                    </Text>
                  </View>
                );
              })}
              {/* Rellena la última fila (7 supers = 1 fila de 4 + 1 de 3) para que las celdas
                  sigan alineadas en 4 columnas parejas en vez de estirarse. */}
              {Array.from({ length: 4 - fila.length }).map((_, j) => (
                <View key={`vacio-${j}`} style={styles.celdaGridSuper} />
              ))}
            </View>
          ))}
        </View>
        <Text style={[texto.prosa, { color: paleta.tintaProsa }]}>
          El color siempre dice de qué super es un precio. El amarillo, en cambio, siempre dice ahorro.
        </Text>
      </View>

      <View style={[styles.filaOnboarding, { borderTopColor: paleta.borde }]}>
        <Text style={[texto.cuerpo, { color: paleta.tintaSuave, flex: 1 }]}>Primera vez acá?</Text>
        <Pressable
          onPress={onAbrirTour}
          accessibilityRole="button"
          style={[styles.botonComoFunciona, { borderColor: paleta.tinta }]}
        >
          <Text style={[texto.cuerpoMedio, { color: paleta.tinta }]}>Ver el tutorial</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

/**
 * OJO — bug ya encontrado y corregido acá: la fila entera no puede ser un único Pressable
 * con accessibilityRole="button" cuando ya está en el carrito, porque adentro el Stepper
 * tiene sus propios botones (+/−). Un <button> no puede contener otro <button> en HTML: en
 * react-native-web eso rompe la hidratación con un error visible y deja el manejo de clicks
 * inconsistente. Por eso acá SOLO se envuelve en Pressable+button cuando no hay Stepper
 * adentro (producto todavía no agregado); una vez agregado, la fila es una View simple y el
 * Stepper es el único elemento interactivo.
 */
function FilaProducto({
  producto, cantidad, precio, supersActivos, onAgregar, onCambiarCantidad, tourRef,
}: {
  producto: ProductoCatalogo;
  cantidad: number;
  /** undefined = todavía no se pidió (no visible el tiempo suficiente); 'error' = falló el pedido. */
  precio: PrecioRapido | 'error' | undefined;
  supersActivos: SuperKey[];
  onAgregar: () => void;
  onCambiarCantidad: (n: number) => void;
  /** Solo lo pasa el tour, y solo para la fila en índice 0 (ver renderItem más arriba). */
  tourRef?: React.RefObject<View | null>;
}) {
  const { paleta } = useTema();
  const enLista = cantidad > 0;

  const contenido = (
    <>
      <BandaDisponibilidad disponibleEn={producto.disponibleEn} supersActivos={supersActivos} />
      <View style={styles.filaCuerpo}>
        <FotoProducto nombre={producto.nombre} imagen={producto.imagen} tamano={48} />

        <View style={styles.filaTexto}>
          <Text style={[texto.cuerpoMedio, { color: paleta.tinta }]} numberOfLines={2}>
            {producto.nombre}
          </Text>
          <BadgePrecio precio={precio} />
        </View>

        {enLista ? (
          <Stepper cantidad={cantidad} onCambiar={onCambiarCantidad} compacto />
        ) : (
          <View style={[styles.masBoton, { backgroundColor: paleta.oferta }]}>
            <Text style={[texto.subtitulo, { color: paleta.ofertaTinta }]}>+</Text>
          </View>
        )}
      </View>
    </>
  );

  if (enLista) {
    return (
      <View
        ref={tourRef}
        style={[styles.fila, { borderColor: paleta.borde }]}
        accessibilityLabel={`${producto.nombre}, ${cantidad} en el carrito`}
      >
        {contenido}
      </View>
    );
  }

  return (
    <Pressable
      ref={tourRef}
      onPress={onAgregar}
      accessibilityRole="button"
      accessibilityLabel={`${producto.nombre}, agregar al carrito`}
      style={({ pressed }) => [styles.fila, { borderColor: paleta.borde, opacity: pressed ? 0.6 : 1 }]}
    >
      {contenido}
    </Pressable>
  );
}

/**
 * Precio + oferta, chico y no bloqueante — no aparece nada hasta que la fila estuvo visible
 * un rato (ver usePreciosProgresivos) y respondió; no hay spinner de carga a propósito, la
 * idea es que el precio "aparezca" en vez de anunciar que está cargando.
 */
function BadgePrecio({ precio }: { precio: PrecioRapido | 'error' | undefined }) {
  const { paleta } = useTema();
  if (precio === undefined || precio === 'error' || !precio.mejor) return null;

  const bordeIdentidad = (paleta.supersBorde as Partial<Record<SuperKey, string>>)[precio.mejor.key];

  return (
    <View style={styles.badgePrecio}>
      <Text style={[texto.precioChico, { color: paleta.tinta }]}>{pesos(precio.mejor.total)}</Text>
      <View style={styles.filaSuper}>
        <View
          style={[
            styles.puntoSuper,
            { backgroundColor: paleta.supers[precio.mejor.key] },
            bordeIdentidad ? { borderWidth: 1, borderColor: bordeIdentidad } : null,
          ]}
        />
        <Text style={[texto.microSuper, { color: paleta.tintaSuave }]} numberOfLines={1}>
          {precio.mejor.super.toUpperCase()}
        </Text>
      </View>
      {precio.oferta ? (
        <View style={[styles.pillOferta, { backgroundColor: paleta.oferta }]}>
          <Text style={[texto.micro, { color: paleta.ofertaTinta, letterSpacing: 0.5 }]} numberOfLines={1}>
            {precio.oferta}
          </Text>
        </View>
      ) : null}
      {precio.esOnline ? (
        <View style={[styles.marcaOnline, { borderColor: paleta.borde }]}>
          <Text style={[texto.tituloSeccion, { color: paleta.tintaSuave, fontSize: 9 }]}>ONLINE</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  pantalla: { flex: 1 },
  lista: { paddingHorizontal: espacio.pantalla, paddingTop: espacio.md },
  buscador: {
    flexDirection: 'row', alignItems: 'center', gap: espacio.sm,
    backgroundColor: '#FFFFFF', borderRadius: radio.md, paddingHorizontal: espacio.md, height: 50,
  },
  input: { flex: 1, outlineWidth: 0, outlineStyle: 'none' },
  botonLimpiar: {
    width: 20, height: 20, borderRadius: radio.pill, alignItems: 'center', justifyContent: 'center',
  },
  filaContador: {
    flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between',
    paddingBottom: espacio.md,
  },
  selectorOrden: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    height: 44, paddingHorizontal: espacio.sm, marginRight: -espacio.sm, marginVertical: -espacio.md,
  },
  subrayado: { textDecorationLine: 'underline' },
  cargandoOrden: { paddingVertical: espacio.xl },
  fila: {
    flexDirection: 'row', borderWidth: 1, borderRadius: radio.tarjeta, overflow: 'hidden',
  },
  filaCuerpo: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: espacio.md, padding: espacio.md,
  },
  filaTexto: { flex: 1, gap: 4 },
  badgePrecio: { flexDirection: 'row', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' },
  filaSuper: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  puntoSuper: { width: 8, height: 8, borderRadius: radio.pill },
  pillOferta: { borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
  marcaOnline: { paddingHorizontal: 5, paddingVertical: 1, borderRadius: radio.sm, borderWidth: 1 },
  masBoton: {
    width: 36, height: 36, borderRadius: radio.sm,
    alignItems: 'center', justifyContent: 'center',
  },
  barraInferior: {
    position: 'absolute', left: 0, right: 0,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: espacio.pantalla, paddingTop: espacio.md,
  },
  estadoInicial: { padding: espacio.pantalla, gap: espacio.xl },
  filaGridSupers: { flexDirection: 'row', gap: espacio.sm },
  celdaGridSuper: { flex: 1, gap: espacio.xs },
  barraLeyendaSuper: { width: '100%', height: 6, borderRadius: radio.pill },
  filaOnboarding: {
    borderTopWidth: StyleSheet.hairlineWidth, paddingTop: espacio.lg,
    flexDirection: 'row', alignItems: 'center', gap: espacio.md,
  },
  botonComoFunciona: {
    height: 44, paddingHorizontal: espacio.lg, borderWidth: 1, borderRadius: radio.sm,
    alignItems: 'center', justifyContent: 'center',
  },
});
