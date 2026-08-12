/**
 * Pantalla Buscar: elegir productos de una lista, en vez de escribir su nombre.
 *
 * Esto es lo que resuelve el problema central que el CLI tiene que atacar preguntando. En la
 * terminal, "pepitos 357 gr" puede matchear tres productos distintos y hay que preguntar cuál
 * es; acá los tres aparecen juntos, con su nombre real y en qué supers están, y el usuario
 * toca el que quiere. La ambigüedad no se resuelve: no llega a existir.
 */

import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, FlatList, Pressable, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  buscarProductos, ErrorApi, precios as pedirPrecios, MAX_EANS_PRECIOS,
  type ProductoCatalogo, type PrecioRapido,
} from '../../src/api';
import { useCarrito } from '../../src/carrito';
import {
  BotonPrincipal, EncabezadoPantalla, Problema, PuntosDisponibilidad, Stepper, Vacio,
} from '../../src/componentes/comunes';
import { FotoProducto } from '../../src/componentes/FotoProducto';
import { espacio, pesos, radio, texto } from '../../src/theme';
import { useTema } from '../../src/useTema';

/**
 * Precio/oferta de a lotes chicos, a medida que se scrollea — no de toda la búsqueda de una.
 * `onViewableItemsChanged` de FlatList avisa qué EANs están en pantalla en cada momento; los
 * que todavía no se pidieron (ni están en curso) se acumulan y se piden juntos, con un debounce
 * corto para no disparar un request por cada pixel de scroll. Ver backend/src/routes/comparar.js
 * (POST /api/precios) para por qué esto no reemplaza /api/catalogo/buscar: ese nunca trae
 * precio, a propósito.
 */
function usePreciosProgresivos() {
  const [precios, setPrecios] = useState<Record<string, PrecioRapido | 'error'>>({});
  const pedidos = useRef(new Set<string>());
  const pendientes = useRef(new Set<string>());
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const pedirLote = useCallback(() => {
    const lote = [...pendientes.current].slice(0, MAX_EANS_PRECIOS);
    pendientes.current.clear();
    if (!lote.length) return;
    lote.forEach(ean => pedidos.current.add(ean));

    pedirPrecios(lote)
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

  return { precios, marcarVisibles };
}

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
  const { paleta, sombra } = useTema();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const carrito = useCarrito();
  const [consulta, setConsulta] = useState('');
  const consultaDemorada = useTextoDemorado(consulta.trim());
  const consultaValida = consultaDemorada.length >= 2;

  const { data, isFetching, error, refetch } = useQuery({
    queryKey: ['catalogo', consultaDemorada],
    queryFn: () => buscarProductos(consultaDemorada),
    enabled: consultaValida,
  });

  const resultados = data?.resultados ?? [];
  const hayMas = (data?.total ?? 0) > resultados.length;

  const { precios, marcarVisibles } = usePreciosProgresivos();
  const onViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: Array<{ item: ProductoCatalogo }> }) => {
      marcarVisibles(viewableItems.map(v => v.item.ean));
    }
  ).current;
  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 60 }).current;

  const encabezado = useMemo(() => (
    <View>
      <EncabezadoPantalla
        titulo="Qué vas a comprar"
        bajada="Buscá el producto y tocalo para sumarlo al carrito."
      />
      <View style={[styles.buscador, { backgroundColor: paleta.superficie, borderColor: paleta.borde }, sombra]}>
        <TextInput
          value={consulta}
          onChangeText={setConsulta}
          placeholder="yerba, fideos, shampoo…"
          placeholderTextColor={paleta.tintaTenue}
          style={[texto.cuerpo, styles.input, { color: paleta.tinta }]}
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
          clearButtonMode="while-editing"
          accessibilityLabel="Buscar productos"
        />
        {isFetching ? <ActivityIndicator size="small" color={paleta.tintaTenue} /> : null}
      </View>

      {consultaValida && !isFetching && !error ? (
        <Text style={[texto.micro, styles.contador, { color: paleta.tintaTenue }]}>
          {data?.total === 0
            ? 'SIN RESULTADOS'
            : `${data?.total} RESULTADO${data?.total === 1 ? '' : 'S'}${hayMas ? ` · MOSTRANDO ${resultados.length}` : ''}`}
        </Text>
      ) : null}
    </View>
  ), [consulta, isFetching, error, data?.total, resultados.length, hayMas, paleta, sombra, consultaValida]);

  return (
    <View style={[styles.pantalla, { backgroundColor: paleta.fondo, paddingTop: insets.top + espacio.md }]}>
      <FlatList
        data={resultados}
        keyExtractor={p => p.ean}
        ListHeaderComponent={encabezado}
        contentContainerStyle={[
          styles.lista,
          { paddingBottom: carrito.items.length ? 120 : espacio.xl },
        ]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        ItemSeparatorComponent={() => <View style={[styles.separador, { backgroundColor: paleta.borde }]} />}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
        renderItem={({ item }) => (
          <FilaProducto
            producto={item}
            cantidad={carrito.cantidadDe(item.ean)}
            precio={precios[item.ean]}
            onAgregar={() => carrito.agregar(item)}
            onCambiarCantidad={n => carrito.cambiarCantidad(item.ean, n)}
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
          ) : consultaValida && !isFetching ? (
            <Vacio
              titulo="Nada con ese nombre"
              detalle="Probá con menos palabras o con el nombre de la marca. El catálogo local es un recorte: puede faltar algún producto poco común."
            />
          ) : !consultaValida ? (
            <Vacio
              titulo="Empezá a escribir"
              detalle="Con dos letras alcanza. Los puntos de color muestran en qué supermercados existe cada producto."
            />
          ) : null
        }
      />

      {carrito.items.length > 0 ? (
        <View
          style={[
            styles.barraInferior,
            {
              backgroundColor: paleta.superficie,
              borderTopColor: paleta.borde,
              paddingBottom: Math.max(insets.bottom, espacio.md),
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
  producto, cantidad, precio, onAgregar, onCambiarCantidad,
}: {
  producto: ProductoCatalogo;
  cantidad: number;
  /** undefined = todavía no se pidió (no visible el tiempo suficiente); 'error' = falló el pedido. */
  precio: PrecioRapido | 'error' | undefined;
  onAgregar: () => void;
  onCambiarCantidad: (n: number) => void;
}) {
  const { paleta } = useTema();
  const enLista = cantidad > 0;

  const contenido = (
    <>
      <FotoProducto nombre={producto.nombre} imagen={producto.imagen} />

      <View style={styles.filaTexto}>
        <Text style={[texto.cuerpoMedio, { color: paleta.tinta }]} numberOfLines={2}>
          {producto.nombre}
        </Text>
        {producto.variante ? (
          <Text style={[texto.etiqueta, { color: paleta.tintaTenue }]} numberOfLines={1}>
            {producto.variante}
          </Text>
        ) : null}
        <View style={styles.filaMeta}>
          <PuntosDisponibilidad disponibleEn={producto.disponibleEn} />
          {producto.categoria ? (
            <Text style={[texto.micro, { color: paleta.tintaTenue }]} numberOfLines={1}>
              {producto.categoria.split('>').pop()?.trim().toUpperCase()}
            </Text>
          ) : null}
        </View>
        <BadgePrecio precio={precio} />
      </View>

      {enLista ? (
        <Stepper cantidad={cantidad} onCambiar={onCambiarCantidad} compacto />
      ) : (
        <View style={[styles.masBoton, { borderColor: paleta.bordeFuerte }]}>
          <Text style={[texto.subtitulo, { color: paleta.tinta }]}>+</Text>
        </View>
      )}
    </>
  );

  if (enLista) {
    return (
      <View style={styles.fila} accessibilityLabel={`${producto.nombre}, ${cantidad} en el carrito`}>
        {contenido}
      </View>
    );
  }

  return (
    <Pressable
      onPress={onAgregar}
      accessibilityRole="button"
      accessibilityLabel={`${producto.nombre}, agregar al carrito`}
      style={({ pressed }) => [styles.fila, { opacity: pressed ? 0.6 : 1 }]}
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

  return (
    <View style={styles.badgePrecio}>
      <Text style={[texto.cuerpoMedio, { color: paleta.tinta }]}>{pesos(precio.mejor.total)}</Text>
      <Text style={[texto.micro, { color: paleta.supers[precio.mejor.key] }]} numberOfLines={1}>
        {precio.mejor.tag} {precio.mejor.super}
      </Text>
      {precio.oferta ? (
        <View style={[styles.pillOferta, { backgroundColor: paleta.ofertaSuave, borderColor: paleta.oferta }]}>
          <Text style={[texto.micro, { color: paleta.tinta }]} numberOfLines={1}>{precio.oferta}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  pantalla: { flex: 1 },
  lista: { paddingHorizontal: espacio.lg },
  buscador: {
    flexDirection: 'row', alignItems: 'center', gap: espacio.sm,
    borderWidth: 1, borderRadius: radio.md, paddingHorizontal: espacio.md,
  },
  input: { flex: 1, paddingVertical: 13 },
  contador: { paddingTop: espacio.md, paddingBottom: espacio.xs },
  fila: {
    flexDirection: 'row', alignItems: 'center', gap: espacio.md,
    paddingVertical: espacio.md,
  },
  filaTexto: { flex: 1, gap: 3 },
  filaMeta: { flexDirection: 'row', alignItems: 'center', gap: espacio.sm, paddingTop: 2 },
  badgePrecio: { flexDirection: 'row', alignItems: 'center', gap: espacio.sm, paddingTop: 4 },
  pillOferta: {
    borderWidth: 1, borderRadius: radio.pill,
    paddingHorizontal: espacio.sm, paddingVertical: 1,
  },
  masBoton: {
    width: 34, height: 34, borderRadius: radio.pill, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center',
  },
  separador: { height: StyleSheet.hairlineWidth },
  barraInferior: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: espacio.lg, paddingTop: espacio.md,
  },
});
