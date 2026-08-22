/**
 * Pantalla Resultado: el veredicto.
 *
 * La pregunta que responde no es "cuánto sale cada cosa" sino "¿me conviene ir a dos
 * supermercados o comprar todo en uno?". Por eso arranca con el total repartido y cuánto se
 * ahorra contra la mejor opción de un solo super.
 *
 * Rediseño v2 (SPEC.md § 4.6, versión de un solo total — el header con los DOS totales de
 * 3c/5b queda para esa fase): header negro con el total, el ahorro y un aviso de promos sin
 * aplicar; PLAN DE COMPRA con un bloque grande por super; PROMOS SIN APLICAR agrupadas (solo
 * las de tarjeta: la sugerencia por cantidad sigue en "Producto por producto", ver comentario
 * en PromosSinAplicar); y "si comprás todo en uno" como gráfico de barras.
 */

import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, Text, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  comparar, ErrorApi, type ItemComparado, type RespuestaComparar, type SuperKey,
} from '../src/api';
import { useCarrito } from '../src/carrito';
import { BarraDiferencia } from '../src/componentes/BarraDiferencia';
import { Problema, Vacio } from '../src/componentes/comunes';
import { FotoProducto } from '../src/componentes/FotoProducto';
import { HeaderNegro } from '../src/componentes/HeaderNegro';
import { useFiltrosSupers } from '../src/filtrosSupers';
import { useHistorialAhorro } from '../src/historialAhorro';
import { espacio, pesos, pesosCorto, radio, texto } from '../src/theme';
import { useTema } from '../src/useTema';

/** Color de identidad de un super, con el borde de contraste de Día si corresponde (ver theme.ts). */
function colorIdentidad(paleta: ReturnType<typeof useTema>['paleta'], key: SuperKey) {
  const borde = (paleta.supersBorde as Partial<Record<SuperKey, string>>)[key];
  return {
    backgroundColor: paleta.supers[key],
    ...(borde ? { borderWidth: 1, borderColor: borde } : null),
  };
}

/** Verde de "ya aplicada" en la fila de estado (§3.6) — no es identidad de ningún super,
 *  es el mismo valor que usa el diseño aprobado para ese punto con ✓. */
const VERDE_APLICADA = '#12874A';

/** Algunos bancos escriben su propio tope legal como un número absurdamente alto (ej.
 *  Mercado Pago: "$ 9999999 por usuario") para decir, en la práctica, "sin tope" — es el
 *  texto real de la promo, no un error de parseo. Por encima de este umbral (bien por
 *  arriba de lo que puede costar un ticket de supermercado real) no tiene sentido mostrarle
 *  el número al usuario como si fuera un límite que puede llegar a tocar. */
const TOPE_PRACTICO_MAXIMO = 1_000_000;

/** Una promo de tarjeta sin activar, en el super donde el producto ya quedó asignado —
 *  ver PromosSinAplicar para por qué solo estas entran acá. */
type PromoSinAplicar = {
  ean: string;
  producto: string;
  super: string;
  ahorro: number;
  quedaEn: number;
  descripcion: string;
  tarjeta: string;
};

function promosSinAplicarDe(items: ItemComparado[]): PromoSinAplicar[] {
  const promos: PromoSinAplicar[] = [];
  for (const item of items) {
    const mejor = item.mejor;
    if (!mejor?.promo || mejor.promo.tarjetaActiva || !mejor.promo.requiereTarjeta) continue;
    if (mejor.totalConTarjeta == null) continue;
    promos.push({
      ean: item.ean,
      producto: item.nombre ?? item.ean,
      super: mejor.super,
      ahorro: mejor.total - mejor.totalConTarjeta,
      quedaEn: mejor.totalConTarjeta,
      descripcion: mejor.promo.descripcion,
      tarjeta: mejor.promo.requiereTarjeta,
    });
  }
  return promos;
}

export default function PantallaResultado() {
  const { paleta } = useTema();
  const insets = useSafeAreaInsets();
  const carrito = useCarrito();
  const { supersActivos } = useFiltrosSupers();
  const scrollRef = useRef<ScrollView>(null);
  const yPromos = useRef(0);

  const pedido = carrito.items.map(i => ({ ean: i.ean, cantidad: i.cantidad }));
  const clave = JSON.stringify({ pedido, tarjetas: carrito.tarjetas, supersActivos });

  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ['comparar', clave],
    queryFn: () => comparar(pedido, carrito.tarjetas, supersActivos),
    enabled: pedido.length > 0,
    staleTime: 0, // los precios son en vivo: no se reusan entre comparaciones
  });

  if (!pedido.length) {
    return (
      <View style={[styles.centrado, { backgroundColor: paleta.fondo }]}>
        <Vacio titulo="No hay nada para comparar" detalle="Volvé a Buscar y armá tu carrito." />
      </View>
    );
  }

  if (isLoading) {
    return (
      <View style={[styles.centrado, { backgroundColor: paleta.fondo }]}>
        <ActivityIndicator color={paleta.tintaSuave} />
        <Text style={[texto.cuerpo, { color: paleta.tintaSuave, textAlign: 'center' }]}>
          Consultando precios en Vea, Carrefour, Chango Más, Día y Coto…
        </Text>
      </View>
    );
  }

  if (error || !data) {
    return (
      <View style={[styles.centrado, { backgroundColor: paleta.fondo }]}>
        <Problema
          mensaje={error instanceof ErrorApi ? error.message : 'No se pudieron traer los precios.'}
          onReintentar={refetch}
        />
      </View>
    );
  }

  const promos = promosSinAplicarDe(data.items);
  const montoPromos = promos.reduce((n, p) => n + p.ahorro, 0);

  return (
    <View style={{ flex: 1, backgroundColor: paleta.fondo }}>
      <HeaderVeredicto
        data={data}
        insets={insets}
        promos={promos}
        montoPromos={montoPromos}
        onVerPromos={() => scrollRef.current?.scrollTo({ y: yPromos.current, animated: true })}
      />

      <ScrollView
        ref={scrollRef}
        style={{ backgroundColor: paleta.fondo }}
        contentContainerStyle={[styles.contenido, { paddingBottom: insets.bottom + espacio.xl }]}
      >
        {data.advertencias.length ? (
          <Problema mensaje={data.advertencias.join('\n')} />
        ) : null}

        <PlanDeCompra data={data} />

        {promos.length ? (
          <View style={styles.seccion} onLayout={e => { yPromos.current = e.nativeEvent.layout.y; }}>
            <Text style={[texto.tituloSeccion, { color: paleta.tintaSuave }]}>PROMOS SIN APLICAR · {promos.length}</Text>
            {promos.map(promo => (
              <BloquePromo
                key={promo.ean}
                promo={promo}
                onAplicar={() => {
                  if (!carrito.tarjetas.includes(promo.tarjeta)) {
                    carrito.setTarjetas([...carrito.tarjetas, promo.tarjeta]);
                  }
                }}
              />
            ))}
          </View>
        ) : null}

        <SiComprasTodoEnUno data={data} />

        <DetalleProductoPorProducto data={data} isFetching={isFetching} />
      </ScrollView>
    </View>
  );
}

/** Header negro: total repartido, ahorro contra la mejor opción de un solo super, y aviso
 *  de promos sin aplicar si hay alguna (ver SPEC § 4.6, versión turno v2 — un solo total). */
function HeaderVeredicto({
  data, insets, promos, montoPromos, onVerPromos,
}: {
  data: RespuestaComparar;
  insets: { top: number };
  promos: PromoSinAplicar[];
  montoPromos: number;
  onVerPromos: () => void;
}) {
  const { paleta } = useTema();
  const router = useRouter();
  const { registrar } = useHistorialAhorro();
  const { registrarUso } = useFiltrosSupers();
  const { totalOptimo, totalSinPromo, totalesPorSuper } = data.resumen;
  const hayAhorroPorPromos = totalSinPromo > totalOptimo;

  const supersConTotal = data.supermercados
    .map(s => ({ ...s, total: totalesPorSuper[s.key] }))
    .filter((s): s is typeof s & { total: number } => typeof s.total === 'number' && s.total > 0)
    .sort((a, b) => a.total - b.total);

  const mejorUnico = supersConTotal[0];
  const ahorroRepartiendo = mejorUnico ? mejorUnico.total - totalOptimo : 0;
  const valeRepartir = ahorroRepartiendo >= 1;

  // Historial de ahorro (PANTALLAS-ahorros-y-paywall.md) y frecuencia de uso por super (para
  // el orden del selector, ver SelectorSupers en HeaderNegro.tsx): una comparación vista, un
  // evento — el ref evita duplicar el registro si este componente vuelve a renderizar sin que
  // `data` haya cambiado (misma respuesta de /api/comparar).
  const dataRegistradaRef = useRef<RespuestaComparar | null>(null);
  useEffect(() => {
    if (dataRegistradaRef.current === data) return;
    dataRegistradaRef.current = data;
    registrar(Math.max(0, ahorroRepartiendo));
    registrarUso(data.supermercados.map(s => s.key));
  }, [data, ahorroRepartiendo, registrar, registrarUso]);

  const paradasNombres = data.supermercados
    .filter(s => (data.resumen.subtotalAsignadoPorSuper[s.key] ?? 0) > 0)
    .map(s => s.nombre);

  // Repartiendo en más de una parada: layout de dos columnas (con o sin la de "PRECIO SIN
  // DESCUENTOS" a la derecha, según hayAhorroPorPromos). No depende de mejorUnico —desde que
  // a67b4f1 sacó la comparación "en un solo super", esta rama no lo usa— así que un carrito
  // que necesita repartirse porque NINGÚN super tiene todos los productos (mejorUnico
  // undefined, ver totalesPorSuper en null en comparador.js) sigue yendo por aquí en vez de
  // caer al branch de un solo total con el tachado arriba (justo lo que a67b4f1 quiso evitar).
  const dosTotales = paradasNombres.length > 1;

  return (
    <HeaderNegro paddingTop={insets.top + espacio.md} estilo={{ gap: espacio.md }}>
      {/* router.back() sin más falla con "GO_BACK not handled" si no hay historial previo
          (recargar la página en /resultado, o entrar por URL directa) — el botón quedaba sin
          responder en ese caso. canGoBack() lo detecta y cae a Carrito, que es de donde se
          llega siempre en el flujo normal. */}
      <Pressable
        onPress={() => (router.canGoBack() ? router.back() : router.replace('/carrito'))}
        accessibilityRole="button"
        style={styles.filaVolver}
      >
        <Text style={styles.flechaVolver}>‹</Text>
        <Text style={[texto.micro, styles.labelHeaderOscuro]}>DÓNDE COMPRAR</Text>
      </Pressable>

      {dosTotales ? (
        <View style={hayAhorroPorPromos ? styles.filaDosTotales : { gap: espacio.md }}>
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={[texto.micro, { color: paleta.oferta, letterSpacing: 0.7 }]}>
              REPARTIENDO EN {paradasNombres.length} PARADAS
            </Text>
            <Text style={[texto.precioHero, styles.totalHero, styles.totalPrincipal]}>
              {pesosCorto(totalOptimo)}
            </Text>
            <Text style={[texto.dato, styles.textoMutedOscuro]}>{paradasNombres.join(' · ')}</Text>
          </View>
          {hayAhorroPorPromos ? (
            <>
              <View style={styles.divisorVertical} />
              <View style={styles.columnaTotalUnico}>
                <Text style={[texto.micro, styles.textoMutedOscuro, { letterSpacing: 0.7 }]}>
                  PRECIO SIN DESCUENTOS
                </Text>
                <Text style={[texto.precioGrande, styles.totalSecundario]}>{pesosCorto(totalSinPromo)}</Text>
              </View>
            </>
          ) : null}
        </View>
      ) : (
        <View style={{ gap: 6 }}>
          {hayAhorroPorPromos ? (
            <Text style={[texto.dato, styles.precioSinPromoHero]}>{pesosCorto(totalSinPromo)}</Text>
          ) : null}
          <Text style={[texto.precioHero, styles.totalHero]}>{pesosCorto(totalOptimo)}</Text>
          {mejorUnico ? (
            <Text style={[texto.etiqueta, styles.subtitutloHero]}>
              Comprando todo en {mejorUnico.nombre} pagás el mejor precio: no hace falta un segundo viaje.
            </Text>
          ) : null}
        </View>
      )}

      {valeRepartir && mejorUnico ? (
        <View style={[styles.bloqueAhorro, { backgroundColor: paleta.oferta }]}>
          <Text style={[texto.cuerpoMedio, { color: paleta.ofertaTinta }]}>Repartiendo ahorrás</Text>
          <Text style={[texto.precioGrande, { color: paleta.ofertaTinta }]}>{pesos(ahorroRepartiendo)}</Text>
        </View>
      ) : null}

      {promos.length ? (
        <Pressable onPress={onVerPromos} accessibilityRole="button" style={styles.bloqueAvisoPromos}>
          <View style={[styles.puntoAviso, { backgroundColor: paleta.oferta }]} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={[texto.cuerpoMedio, { color: '#FFFFFF' }]}>
              {promos.length} promoción{promos.length === 1 ? '' : 'es'} sin aplicar
            </Text>
            <Text style={[texto.dato, { color: paleta.oferta }]}>{pesos(montoPromos)} más de ahorro</Text>
          </View>
          <View style={styles.pillVer}>
            <Text style={[texto.etiqueta, { color: '#FFFFFF' }]}>Ver</Text>
          </View>
        </Pressable>
      ) : null}
    </HeaderNegro>
  );
}

/** El itinerario: un bloque grande por super, con sus productos y el botón de exportar. */
function PlanDeCompra({ data }: { data: RespuestaComparar }) {
  const { paleta } = useTema();
  const carrito = useCarrito();
  const { subtotalAsignadoPorSuper, requiereOnlinePorSuper, linksCarrito, bancario } = data.resumen;
  const [erroresCarrito, setErroresCarrito] = useState<Partial<Record<SuperKey, boolean>>>({});

  // Sin promo bancaria: cada producto va al super donde es más barato por unidad
  // (item.mejor.key). Con promo bancaria aplicada, comprasPorSuper puede haber movido algún
  // producto a un super que no es el más barato por unidad (para maximizar el reintegro
  // dentro del tope) — hay que agrupar por ahí, si no la lista de productos no va a coincidir
  // con subtotalAsignadoPorSuper.
  const itemsPorSuper = useMemo(() => {
    const mapa = new Map<SuperKey, ItemComparado[]>();
    if (bancario) {
      const eanASuper = new Map<string, SuperKey>();
      for (const [key, compras] of Object.entries(data.resumen.comprasPorSuper)) {
        for (const compra of compras) eanASuper.set(compra.ean, key as SuperKey);
      }
      for (const item of data.items) {
        const key = eanASuper.get(item.ean);
        if (!key) continue;
        const lista = mapa.get(key) ?? [];
        lista.push(item);
        mapa.set(key, lista);
      }
    } else {
      for (const item of data.items) {
        if (!item.mejor) continue;
        const lista = mapa.get(item.mejor.key) ?? [];
        lista.push(item);
        mapa.set(item.mejor.key, lista);
      }
    }
    return mapa;
  }, [data.items, data.resumen.comprasPorSuper, bancario]);

  /** La opción de este ítem en `key` — no siempre es `item.mejor` (que es la opción más
   *  barata por producto, sin importar el super): con reasignación bancaria el ítem puede
   *  estar agrupado bajo un super distinto. */
  const opcionEnSuper = (item: ItemComparado, key: SuperKey) =>
    item.opciones.find(o => o.key === key) ?? item.mejor;

  // Suma de lo que pagarías en cada super sin ninguna promo — para contrastar con
  // subtotalAsignadoPorSuper (que ya tiene las promos aplicadas).
  const subtotalSinPromoPorSuper = useMemo(() => {
    const mapa = new Map<SuperKey, number>();
    for (const [key, items] of itemsPorSuper) {
      mapa.set(key, items.reduce((acc, it) => acc + (opcionEnSuper(it, key)?.totalSinPromo ?? 0), 0));
    }
    return mapa;
  }, [itemsPorSuper]);

  const paradas = data.supermercados
    .filter(s => (itemsPorSuper.get(s.key) ?? []).length > 0)
    .sort((a, b) => (subtotalAsignadoPorSuper[b.key] ?? 0) - (subtotalAsignadoPorSuper[a.key] ?? 0));

  if (!paradas.length) return null;

  const abrirCarrito = async (key: SuperKey, url: string) => {
    try {
      await Linking.openURL(url);
      setErroresCarrito(prev => ({ ...prev, [key]: false }));
    } catch {
      setErroresCarrito(prev => ({ ...prev, [key]: true }));
    }
  };

  return (
    <View style={styles.seccion}>
      <Text style={[texto.tituloSeccion, { color: paleta.tintaSuave }]}>PLAN DE COMPRA</Text>
      {paradas.map(s => {
        const url = linksCarrito[s.key];
        const tarjetasAplicadas = new Set(
          (itemsPorSuper.get(s.key) ?? [])
            .map(i => {
              const opcion = opcionEnSuper(i, s.key);
              return opcion?.promo?.tarjetaActiva ? opcion.promo.requiereTarjeta : null;
            })
            .filter((t): t is string => !!t)
        );
        const ahorroBancario = bancario?.porSuper[s.key] ?? null;
        // Tope real pero absurdamente alto (ej. Mercado Pago: "$9.999.999 por usuario", texto
        // legal real, no un error) — ni el número ni "ya está restado del total" se muestran
        // para este caso.
        const topeIrreal = !!ahorroBancario?.topeDetectado && ahorroBancario.tope! > TOPE_PRACTICO_MAXIMO;

        return (
          <View key={s.key} style={[styles.bloqueSuper, { borderColor: paleta.borde }]}>
            <View style={[styles.cabeceraSuper, colorIdentidad(paleta, s.key)]}>
              <Text style={[texto.precioGrande, styles.nombreSuper]}>{s.nombre}</Text>
              <View style={{ alignItems: 'flex-end' }}>
                {(subtotalSinPromoPorSuper.get(s.key) ?? 0) > subtotalAsignadoPorSuper[s.key] ? (
                  <Text style={[texto.micro, styles.precioSinPromoTachado]}>
                    {pesos(subtotalSinPromoPorSuper.get(s.key) ?? 0)}
                  </Text>
                ) : null}
                <Text style={[texto.precioGrande, styles.totalSuper]}>
                  {pesos(subtotalAsignadoPorSuper[s.key])}
                </Text>
              </View>
            </View>
            <View style={styles.cuerpoSuper}>
              {(itemsPorSuper.get(s.key) ?? []).map(item => (
                <View key={item.ean} style={styles.filaItemSuper}>
                  <View style={styles.nombreItemSuper}>
                    <Text style={[texto.cuerpoMedio, { color: paleta.tinta }]} numberOfLines={1}>
                      {item.nombre ?? item.ean}
                    </Text>
                  </View>
                  <Text style={[texto.cuerpoMedio, { color: paleta.tinta }]}>×{item.cantidad}</Text>
                  <Text style={[texto.precioChico, { color: paleta.tintaSuave }]}>
                    {pesos(opcionEnSuper(item, s.key)!.total)}
                  </Text>
                </View>
              ))}

              {requiereOnlinePorSuper[s.key] ? (
                <View style={[styles.avisoOnline, { backgroundColor: paleta.alertaFondo }]}>
                  <Text style={[texto.micro, { color: paleta.alerta, letterSpacing: 0.7 }]}>
                    REQUIERE COMPRAR ONLINE
                  </Text>
                </View>
              ) : null}

              {ahorroBancario ? (
                <View style={[styles.filaEstado, { backgroundColor: paleta.superficieAlt, borderColor: paleta.borde }]}>
                  <View style={styles.checkAplicada}>
                    <Text style={styles.checkTexto}>✓</Text>
                  </View>
                  <View style={{ flex: 1, gap: 1 }}>
                    <Text style={[texto.cuerpoMedio, { color: paleta.tinta }]}>
                      Pagando con {ahorroBancario.tarjeta} ahorrás {pesos(ahorroBancario.descuento)}
                    </Text>
                    <Text style={[texto.dato, { color: paleta.tintaSuave }]}>
                      {Math.round(ahorroBancario.descuentoPct * 100)}% de descuento
                      {ahorroBancario.topeDetectado && !topeIrreal
                        ? ` (tope ${pesos(ahorroBancario.tope!)})`
                        : ''}
                      {!topeIrreal ? ' — ya está restado del total' : ''}
                    </Text>
                  </View>
                </View>
              ) : null}


              {[...tarjetasAplicadas].map(tarjeta => (
                <View key={tarjeta} style={[styles.filaEstado, { backgroundColor: paleta.superficieAlt, borderColor: paleta.borde }]}>
                  <View style={styles.checkAplicada}>
                    <Text style={styles.checkTexto}>✓</Text>
                  </View>
                  <View style={{ flex: 1, gap: 1 }}>
                    <Text style={[texto.cuerpoMedio, { color: paleta.tinta }]}>{tarjeta} está en Mis descuentos</Text>
                    <Text style={[texto.dato, { color: paleta.tintaSuave }]}>el descuento ya está en el total</Text>
                  </View>
                  <Pressable
                    onPress={() => carrito.setTarjetas(carrito.tarjetas.filter(t => t !== tarjeta))}
                    accessibilityRole="button"
                    style={[styles.botonQuitar, { borderColor: paleta.bordeFuerte, backgroundColor: paleta.superficie }]}
                  >
                    <Text style={[texto.etiqueta, { color: paleta.tintaSuave }]}>Quitar</Text>
                  </Pressable>
                </View>
              ))}

              {url ? (
                <BloqueExportar
                  nombre={s.nombre}
                  error={!!erroresCarrito[s.key]}
                  onPress={() => abrirCarrito(s.key, url)}
                />
              ) : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

/** Abre el sitio real del super con el carrito ya cargado (link público de VTEX) — el usuario
 *  termina la compra ahí, con su propia sesión. No soportado en Coto (no es VTEX). */
function BloqueExportar({
  nombre, error, onPress,
}: { nombre: string; error: boolean; onPress: () => void }) {
  const { paleta } = useTema();
  return (
    <View style={{ gap: 4, marginTop: 4 }}>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`Exportar a ${nombre}`}
        style={({ pressed }) => [
          styles.botonExportar,
          { backgroundColor: paleta.tinta, opacity: pressed ? 0.9 : 1 },
        ]}
      >
        <Text style={[texto.cuerpoMedio, { color: paleta.superficie }]}>Exportar a {nombre}</Text>
      </Pressable>
      <Text style={[texto.dato, styles.leyendaExportar, { color: paleta.tintaSuave }]}>
        {error ? `No se pudo abrir el carrito de ${nombre}` : 'abre el sitio del super · iniciá sesión y el carrito se carga solo'}
      </Text>
    </View>
  );
}

/**
 * Bloques amarillos agrupados (SPEC § 3.5 y § 4.6.2): solo promos de tarjeta sin activar en
 * el super donde el producto ya quedó asignado. Las sugerencias por cantidad (3x2, etc.)
 * siguen en "Producto por producto" con su propia vista previa por cantidad — juntarlas acá
 * exigiría inventar un "ahorro por unidad" que el backend no devuelve tal cual, y ya hay un
 * componente (AvisoCantidad, en DetalleProductoPorProducto) que las muestra bien.
 */
function BloquePromo({ promo, onAplicar }: { promo: PromoSinAplicar; onAplicar: () => void }) {
  const { paleta } = useTema();
  return (
    <View style={[styles.bloquePromoContenedor, { borderColor: paleta.oferta }]}>
      <View style={[styles.bloquePromoArriba, { backgroundColor: paleta.oferta }]}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={[texto.etiqueta, styles.labelPromo, { color: paleta.ofertaTinta }]} numberOfLines={1}>
            {promo.producto.toUpperCase()} · {promo.super.toUpperCase()}
          </Text>
          <Text style={[texto.precio, styles.montoPromo, { color: paleta.ofertaTinta }]}>
            −{pesos(promo.ahorro)}
          </Text>
        </View>
        <Text style={[texto.dato, { color: paleta.ofertaTinta, textAlign: 'right' }]}>
          queda en{'\n'}{pesos(promo.quedaEn)}
        </Text>
      </View>
      <View style={[styles.bloquePromoAbajo, { backgroundColor: paleta.ofertaSuave }]}>
        <Text style={[texto.dato, { color: paleta.tintaSuave, flex: 1 }]}>{promo.descripcion}</Text>
        <Pressable
          onPress={onAplicar}
          accessibilityRole="button"
          accessibilityLabel={`Marcar que tenés ${promo.tarjeta}, para ${promo.producto}`}
          style={[styles.botonAplicar, { backgroundColor: paleta.tinta }]}
        >
          {/* "Tengo {nombre}", no "Activar": es una declaración del usuario, no una acción
              técnica — ver SPEC § 4.7. */}
          <Text style={[texto.cuerpoMedio, { color: paleta.superficie }]} numberOfLines={1}>
            Tengo {promo.tarjeta}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

/** SPEC § 4.6.4: sobrecosto de comprar todo en un solo super, como barras — alturas
 *  proporcionales y ancladas abajo. */
function SiComprasTodoEnUno({ data }: { data: RespuestaComparar }) {
  const { paleta } = useTema();
  const { totalOptimo, totalesPorSuper } = data.resumen;

  const barras = data.supermercados
    .map(s => ({ ...s, delta: (totalesPorSuper[s.key] ?? 0) - totalOptimo }))
    .filter(s => (totalesPorSuper[s.key] ?? 0) > 0)
    .sort((a, b) => a.delta - b.delta);

  if (barras.length < 2) return null;
  const maxDelta = Math.max(...barras.map(b => b.delta), 1);

  return (
    <View style={styles.seccion}>
      <Text style={[texto.tituloSeccion, { color: paleta.tintaSuave }]}>SI COMPRÁS TODO EN UNO</Text>
      <View style={styles.grafico}>
        {barras.map(b => (
          <View key={b.key} style={styles.columnaBarra}>
            <Text style={[texto.precioChico, { color: paleta.tintaSuave, fontSize: 12, lineHeight: 14 }]}>
              +{pesos(b.delta).replace(/,\d{2}$/, '')}
            </Text>
            <View
              style={[
                styles.barraVertical,
                colorIdentidad(paleta, b.key),
                { height: Math.max(6, (b.delta / maxDelta) * 100) },
              ]}
            />
            <Text style={[texto.tituloSeccion, { color: paleta.tintaSuave, fontSize: 10 }]}>{b.tag} {b.nombre.slice(0, 6).toUpperCase()}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

/** Detalle por producto, visible por default (se puede ocultar con el link al pie) —
 *  acá vive la comparación con BarraDiferencia y el aviso de cantidad, que el
 *  agrupado de arriba no reemplaza (ver comentario de BloquePromo). */
function DetalleProductoPorProducto({ data, isFetching }: { data: RespuestaComparar; isFetching: boolean }) {
  const { paleta } = useTema();
  const [mostrar, setMostrar] = useState(true);

  return (
    <View style={styles.seccion}>
      <View style={styles.pieDetalle}>
        <Text style={[texto.dato, { color: paleta.tintaSuave }]}>
          {new Date(data.generado).toLocaleString('es-AR')}
          {isFetching ? ' · actualizando…' : ''}
        </Text>
        <Pressable onPress={() => setMostrar(v => !v)} accessibilityRole="button" style={styles.linkDetalle}>
          <Text style={[texto.etiqueta, { color: paleta.tinta, textDecorationLine: 'underline' }]}>
            {mostrar ? 'Ocultar producto por producto' : 'Producto por producto'}
          </Text>
        </Pressable>
      </View>

      {mostrar ? data.items.map((item, i) => (
        <TarjetaItem key={item.ean} item={item} indice={i} />
      )) : null}
    </View>
  );
}

function TarjetaItem({ item, indice }: { item: ItemComparado; indice: number }) {
  const { paleta, sombra } = useTema();
  const carrito = useCarrito();

  return (
    <View style={[styles.tarjetaItem, { backgroundColor: paleta.superficie, borderColor: paleta.borde }, sombra]}>
      <View style={styles.itemEncabezado}>
        <FotoProducto nombre={item.nombre ?? item.ean} imagen={item.imagen} tamano={36} />
        <Text style={[texto.cuerpoMedio, { color: paleta.tinta, flex: 1 }]} numberOfLines={2}>
          {item.nombre ?? item.ean}
        </Text>
        <Text style={[texto.etiqueta, { color: paleta.tintaSuave }]}>×{item.cantidad}</Text>
      </View>

      {item.error ? (
        <Text style={[texto.etiqueta, { color: paleta.alerta }]}>{item.error}</Text>
      ) : item.opciones.length === 0 ? (
        <Text style={[texto.etiqueta, { color: paleta.tintaSuave }]}>
          No está disponible en ninguno de los supers activos.
        </Text>
      ) : (
        <BarraDiferencia
          opciones={item.opciones}
          demoraMs={indice * 60}
          onActivarTarjeta={tarjeta => {
            if (!carrito.tarjetas.includes(tarjeta)) carrito.setTarjetas([...carrito.tarjetas, tarjeta]);
          }}
        />
      )}

      {item.sugerenciaCantidad ? (
        <AvisoCantidad
          item={item}
          onAplicar={cantidad => carrito.cambiarCantidad(item.ean, cantidad)}
        />
      ) : null}
    </View>
  );
}

/**
 * Aviso no bloqueante: qué pasaría llevando otra cantidad. Los totales de cada alternativa
 * ya vinieron en la respuesta, así que esto no cuesta ninguna consulta extra; recién al
 * aplicar el cambio se vuelve a comparar.
 */
function AvisoCantidad({
  item, onAplicar,
}: { item: ItemComparado; onAplicar: (cantidad: number) => void }) {
  const { paleta } = useTema();
  const sugerencia = item.sugerenciaCantidad!;

  return (
    <View style={[styles.aviso, { backgroundColor: paleta.ofertaSuave, borderColor: paleta.oferta }]}>
      <Text style={[texto.etiqueta, { color: paleta.tinta }]}>
        Con {item.cantidad} {item.cantidad === 1 ? 'unidad' : 'unidades'} no se activa una promo
      </Text>

      {sugerencia.vistaPrevia.map(previa => {
        const mejorPrevia = previa.opciones.reduce<{ total: number; nombre: string; oferta: string } | null>(
          (min, o) => (!min || o.total < min.total ? o : min),
          null
        );
        if (!mejorPrevia) return null;

        return (
          <Pressable
            key={previa.cantidad}
            onPress={() => onAplicar(previa.cantidad)}
            accessibilityRole="button"
            accessibilityLabel={`Cambiar a ${previa.cantidad} unidades`}
            style={({ pressed }) => [
              styles.opcionPrevia,
              { borderColor: paleta.oferta, opacity: pressed ? 0.7 : 1 },
            ]}
          >
            <View style={{ flex: 1 }}>
              <Text style={[texto.cuerpoMedio, { color: paleta.tinta }]}>
                Llevá {previa.cantidad}: {pesos(mejorPrevia.total)} en {mejorPrevia.nombre}
              </Text>
              {mejorPrevia.oferta ? (
                <Text style={[texto.dato, { color: paleta.tintaSuave }]}>
                  {mejorPrevia.oferta}
                </Text>
              ) : null}
            </View>
            <Text style={[texto.subtitulo, { color: paleta.tinta }]}>›</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  contenido: { padding: espacio.pantalla, gap: espacio.pantalla },
  centrado: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: espacio.xl, gap: espacio.md },

  filaVolver: {
    flexDirection: 'row', alignItems: 'center', gap: espacio.md,
    height: 44, paddingRight: espacio.md, marginLeft: -espacio.xs, marginVertical: -espacio.xs,
  },
  flechaVolver: { fontSize: 22, color: '#FFFFFF' },
  labelHeaderOscuro: { color: '#FFFFFF', opacity: 0.6, letterSpacing: 1.2 },
  totalHero: { color: '#FFFFFF' },
  subtitutloHero: { color: '#FFFFFF', opacity: 0.7 },
  filaDosTotales: { flexDirection: 'row', alignItems: 'flex-end', gap: espacio.md },
  totalPrincipal: { fontSize: 52, lineHeight: 48 },
  // Grises fijos del header negro (no de la paleta clara/oscura del resto de la app): este
  // header siempre es oscuro, lleve el sistema el tema que lleve — ver useTema.ts.
  textoMutedOscuro: { color: '#727B85' },
  precioSinPromoHero: { color: '#727B85', textDecorationLine: 'line-through' },
  divisorVertical: { width: 1, alignSelf: 'stretch', backgroundColor: '#3C444D' },
  columnaTotalUnico: { width: 118, gap: 4 },
  totalSecundario: { color: '#A6AEB8' },
  bloqueAhorro: {
    borderRadius: radio.md, padding: espacio.md,
    flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between',
  },
  bloqueAvisoPromos: {
    backgroundColor: '#20242B', borderRadius: radio.md, padding: espacio.sm,
    flexDirection: 'row', alignItems: 'center', gap: espacio.sm, minHeight: 48,
  },
  puntoAviso: { width: 8, height: 8, borderRadius: radio.pill },
  pillVer: {
    height: 44, paddingHorizontal: espacio.md, borderWidth: 1, borderColor: '#3C444D',
    borderRadius: radio.pill, alignItems: 'center', justifyContent: 'center',
  },

  seccion: { gap: espacio.sm },
  bloqueSuper: { borderWidth: 1, borderRadius: radio.tarjeta, overflow: 'hidden' },
  cabeceraSuper: {
    paddingHorizontal: espacio.md, paddingVertical: espacio.md,
    flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between',
  },
  nombreSuper: { color: '#FFFFFF', textTransform: 'uppercase', letterSpacing: 1 },
  totalSuper: { color: '#FFFFFF' },
  precioSinPromoTachado: { color: 'rgba(255,255,255,0.7)', textDecorationLine: 'line-through' },
  cuerpoSuper: { padding: espacio.md, gap: espacio.sm },
  filaItemSuper: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: espacio.sm },
  nombreItemSuper: { flex: 1 },
  avisoOnline: { borderRadius: radio.sm, paddingHorizontal: espacio.sm, paddingVertical: espacio.xs },
  filaEstado: {
    flexDirection: 'row', alignItems: 'center', gap: espacio.sm,
    borderWidth: 1, borderRadius: radio.sm, padding: espacio.sm, minHeight: 44,
  },
  checkAplicada: {
    width: 18, height: 18, borderRadius: radio.pill, backgroundColor: VERDE_APLICADA,
    alignItems: 'center', justifyContent: 'center',
  },
  checkTexto: { color: '#FFFFFF', fontSize: 11, fontWeight: '600' },
  botonQuitar: {
    height: 44, paddingHorizontal: espacio.md, borderWidth: 1, borderRadius: radio.pill,
    alignItems: 'center', justifyContent: 'center',
  },
  botonExportar: { minHeight: 48, borderRadius: radio.md, alignItems: 'center', justifyContent: 'center' },
  leyendaExportar: { textAlign: 'center' },

  bloquePromoContenedor: { borderWidth: 1, borderRadius: radio.tarjeta, overflow: 'hidden' },
  bloquePromoArriba: {
    padding: espacio.md, flexDirection: 'row', alignItems: 'flex-end',
    justifyContent: 'space-between', gap: espacio.md,
  },
  labelPromo: { textTransform: 'uppercase', opacity: 0.65, fontSize: 11 },
  montoPromo: { fontSize: 34, lineHeight: 32 },
  bloquePromoAbajo: { padding: espacio.md, flexDirection: 'row', alignItems: 'center', gap: espacio.md },
  botonAplicar: {
    height: 44, paddingHorizontal: espacio.lg, borderRadius: radio.pill,
    alignItems: 'center', justifyContent: 'center',
  },

  grafico: { flexDirection: 'row', alignItems: 'flex-end', gap: espacio.sm, height: 130 },
  columnaBarra: { flex: 1, alignItems: 'center', justifyContent: 'flex-end', gap: 6 },
  barraVertical: { width: '100%', borderTopLeftRadius: 4, borderTopRightRadius: 4 },

  pieDetalle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  linkDetalle: { height: 44, paddingHorizontal: espacio.sm, alignItems: 'center', justifyContent: 'center' },

  tarjetaItem: { borderWidth: 1, borderRadius: radio.lg, padding: espacio.md, gap: espacio.md, marginTop: espacio.sm },
  itemEncabezado: { flexDirection: 'row', alignItems: 'flex-start', gap: espacio.sm },
  aviso: { borderWidth: 1, borderRadius: radio.md, padding: espacio.md, gap: espacio.sm },
  opcionPrevia: {
    flexDirection: 'row', alignItems: 'center', gap: espacio.sm,
    borderTopWidth: StyleSheet.hairlineWidth, paddingTop: espacio.sm,
  },
});
