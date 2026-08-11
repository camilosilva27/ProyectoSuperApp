/**
 * Pantalla Resultado: el veredicto.
 *
 * La pregunta que responde no es "cuánto sale cada cosa" sino "¿me conviene ir a dos
 * supermercados o compro todo en uno?". Por eso arranca con el total repartido y cuánto se
 * ahorra contra la mejor opción de un solo super, y después detalla producto por producto
 * con la barra de diferencia.
 *
 * La sugerencia de cantidad se muestra como aviso con un botón, nunca como pregunta que
 * bloquee: los números de cada cantidad posible ya vienen en la respuesta, así que se puede
 * mostrar el "y si llevás 3" sin volver a consultar nada. Solo al aceptar se recalcula.
 */

import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import React from 'react';
import {
  ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  comparar, ErrorApi, type ItemComparado, type RespuestaComparar, type SuperKey,
} from '../src/api';
import { useCarrito } from '../src/carrito';
import { BarraDiferencia } from '../src/componentes/BarraDiferencia';
import { EncabezadoPantalla, Problema, Vacio } from '../src/componentes/comunes';
import { FotoProducto } from '../src/componentes/FotoProducto';
import { espacio, pesos, radio, texto } from '../src/theme';
import { useTema } from '../src/useTema';

/** Color de identidad de un super, con el borde de contraste de Día si corresponde (ver theme.ts). */
function colorIdentidad(paleta: ReturnType<typeof useTema>['paleta'], key: SuperKey) {
  const borde = (paleta.supersBorde as Partial<Record<SuperKey, string>>)[key];
  return {
    backgroundColor: paleta.supers[key],
    ...(borde ? { borderWidth: 1, borderColor: borde } : null),
  };
}

export default function PantallaResultado() {
  const { paleta } = useTema();
  const insets = useSafeAreaInsets();
  const carrito = useCarrito();

  const pedido = carrito.items.map(i => ({ ean: i.ean, cantidad: i.cantidad }));
  const clave = JSON.stringify({ pedido, tarjetas: carrito.tarjetas });

  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ['comparar', clave],
    queryFn: () => comparar(pedido, carrito.tarjetas),
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

  return (
    <ScrollView
      style={{ backgroundColor: paleta.fondo }}
      contentContainerStyle={[styles.contenido, { paddingBottom: insets.bottom + espacio.xl }]}
    >
      <Veredicto data={data} />

      {data.advertencias.length ? (
        <Problema mensaje={data.advertencias.join('\n')} />
      ) : null}

      <PlanDeCompra data={data} />

      <View style={styles.seccion}>
        <Text style={[texto.micro, { color: paleta.tintaTenue }]}>PRODUCTO POR PRODUCTO</Text>
        {data.items.map((item, i) => (
          <TarjetaItem key={item.ean} item={item} indice={i} />
        ))}
      </View>

      <Text style={[texto.dato, styles.pie, { color: paleta.tintaTenue }]}>
        Precios consultados {new Date(data.generado).toLocaleString('es-AR')}
        {isFetching ? ' · actualizando…' : ''}
      </Text>
    </ScrollView>
  );
}

/** Hero: total repartido vs. la mejor opción de comprar todo en un solo super. */
function Veredicto({ data }: { data: RespuestaComparar }) {
  const { paleta, sombra } = useTema();
  const { totalOptimo, totalesPorSuper } = data.resumen;

  const supersConTotal = data.supermercados
    .map(s => ({ ...s, total: totalesPorSuper[s.key] }))
    .filter(s => typeof s.total === 'number' && s.total > 0)
    .sort((a, b) => a.total - b.total);

  const mejorUnico = supersConTotal[0];
  const ahorroRepartiendo = mejorUnico ? mejorUnico.total - totalOptimo : 0;
  const valeRepartir = ahorroRepartiendo >= 1;

  return (
    <View style={[styles.hero, { backgroundColor: paleta.superficie, borderColor: paleta.borde }, sombra]}>
      <Text style={[texto.micro, { color: paleta.tintaTenue }]}>
        {valeRepartir ? 'REPARTIENDO LA COMPRA' : 'TOTAL DE TU CARRITO'}
      </Text>
      <Text style={[texto.precioHero, { color: paleta.tinta }]}>{pesos(totalOptimo)}</Text>

      {valeRepartir && mejorUnico ? (
        <View style={[styles.destacado, { backgroundColor: paleta.ofertaSuave, borderColor: paleta.oferta }]}>
          <Text style={[texto.cuerpoMedio, { color: paleta.tinta }]}>
            Ahorrás {pesos(ahorroRepartiendo)}
          </Text>
          <Text style={[texto.etiqueta, { color: paleta.tintaSuave }]}>
            contra comprar todo en {mejorUnico.nombre} ({pesos(mejorUnico.total)})
          </Text>
        </View>
      ) : mejorUnico ? (
        <Text style={[texto.cuerpo, { color: paleta.tintaSuave }]}>
          Comprando todo en {mejorUnico.nombre} pagás lo mismo: no hace falta un segundo viaje.
        </Text>
      ) : null}

      <View style={[styles.comparativaUnicos, { borderTopColor: paleta.borde }]}>
        {supersConTotal.map(s => (
          <View key={s.key} style={styles.filaUnico}>
            <View style={styles.identidadUnico}>
              <View style={[styles.punto, colorIdentidad(paleta, s.key)]} />
              <Text style={[texto.etiqueta, { color: paleta.tintaSuave }]}>Todo en {s.nombre}</Text>
            </View>
            <Text style={[texto.precioChico, { color: paleta.tintaSuave }]}>
              {s.total === totalOptimo ? pesos(s.total) : `+${pesos(s.total - totalOptimo)}`}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

/** El itinerario: qué comprar en cada super. Es la instrucción accionable de la pantalla. */
function PlanDeCompra({ data }: { data: RespuestaComparar }) {
  const { paleta, sombra } = useTema();
  const { comprasPorSuper, subtotalAsignadoPorSuper, requiereOnlinePorSuper } = data.resumen;

  const conCompras = data.supermercados.filter(s => (comprasPorSuper[s.key] ?? []).length > 0);
  if (conCompras.length <= 1) return null;

  return (
    <View style={styles.seccion}>
      <Text style={[texto.micro, { color: paleta.tintaTenue }]}>PLAN DE COMPRA</Text>
      {conCompras.map(s => (
        <View
          key={s.key}
          style={[styles.tarjetaPlan, { backgroundColor: paleta.superficie, borderColor: paleta.borde }, sombra]}
        >
          <View style={[styles.bandaColor, colorIdentidad(paleta, s.key)]} />
          <View style={styles.planCuerpo}>
            <View style={styles.planEncabezado}>
              <Text style={[texto.subtitulo, { color: paleta.tinta }]}>{s.nombre}</Text>
              <Text style={[texto.precio, { color: paleta.tinta }]}>
                {pesos(subtotalAsignadoPorSuper[s.key])}
              </Text>
            </View>
            {requiereOnlinePorSuper[s.key] ? (
              <Text style={[texto.micro, { color: paleta.alerta }]}>
                REQUIERE COMPRAR ONLINE
              </Text>
            ) : null}
            <Text style={[texto.cuerpo, { color: paleta.tintaSuave }]}>
              {comprasPorSuper[s.key].map(c => c.input).join(' · ')}
            </Text>
          </View>
        </View>
      ))}
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
        <Text style={[texto.etiqueta, { color: paleta.tintaTenue }]}>×{item.cantidad}</Text>
      </View>

      {item.error ? (
        <Text style={[texto.etiqueta, { color: paleta.alerta }]}>{item.error}</Text>
      ) : item.opciones.length === 0 ? (
        <Text style={[texto.etiqueta, { color: paleta.tintaTenue }]}>
          No está disponible en ninguno de los tres.
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
  contenido: { padding: espacio.lg, gap: espacio.lg },
  centrado: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: espacio.xl, gap: espacio.md },
  hero: { borderWidth: 1, borderRadius: radio.lg, padding: espacio.lg, gap: espacio.sm },
  destacado: {
    borderWidth: 1, borderRadius: radio.md, padding: espacio.md, gap: 2,
  },
  comparativaUnicos: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: espacio.md, gap: espacio.sm },
  filaUnico: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  identidadUnico: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  punto: { width: 9, height: 9, borderRadius: radio.pill },
  seccion: { gap: espacio.sm },
  tarjetaPlan: {
    flexDirection: 'row', borderWidth: 1, borderRadius: radio.lg, overflow: 'hidden',
  },
  bandaColor: { width: 4 },
  planCuerpo: { flex: 1, padding: espacio.md, gap: 4 },
  planEncabezado: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  tarjetaItem: {
    borderWidth: 1, borderRadius: radio.lg, padding: espacio.md, gap: espacio.md,
  },
  itemEncabezado: { flexDirection: 'row', alignItems: 'flex-start', gap: espacio.sm },
  aviso: { borderWidth: 1, borderRadius: radio.md, padding: espacio.md, gap: espacio.sm },
  opcionPrevia: {
    flexDirection: 'row', alignItems: 'center', gap: espacio.sm,
    borderTopWidth: StyleSheet.hairlineWidth, paddingTop: espacio.sm,
  },
  pie: { textAlign: 'center' },
});
