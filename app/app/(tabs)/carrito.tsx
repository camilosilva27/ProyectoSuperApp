/**
 * Pantalla Carrito: revisar cantidades y disparar la comparación.
 *
 * Las tarjetas que marcás acá son solo el default: no hace falta elegir ninguna para
 * comparar. El resultado siempre muestra qué promos de tarjeta existen para cada producto,
 * y se pueden activar ahí mismo con un toque — esto es solo para no tener que activarlas
 * cada vez si siempre pagás con las mismas.
 */

import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TARJETAS_DISPONIBLES, useCarrito } from '../../src/carrito';
import { BotonPrincipal, EncabezadoPantalla, Stepper, Vacio } from '../../src/componentes/comunes';
import { FotoProducto } from '../../src/componentes/FotoProducto';
import { espacio, radio, texto } from '../../src/theme';
import { useTema } from '../../src/useTema';

export default function PantallaCarrito() {
  const { paleta, sombra } = useTema();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const carrito = useCarrito();
  const [mostrarTarjetas, setMostrarTarjetas] = useState(false);

  const vacia = carrito.items.length === 0;

  return (
    <View style={[styles.pantalla, { backgroundColor: paleta.fondo, paddingTop: insets.top + espacio.md }]}>
      <ScrollView
        contentContainerStyle={[styles.contenido, { paddingBottom: vacia ? espacio.xl : 140 }]}
        keyboardShouldPersistTaps="handled"
      >
        <EncabezadoPantalla
          titulo="Carrito"
          bajada={vacia ? undefined : `${carrito.items.length} producto${carrito.items.length === 1 ? '' : 's'} · ${carrito.totalUnidades} unidad${carrito.totalUnidades === 1 ? '' : 'es'}`}
        />

        {vacia ? (
          <Vacio
            titulo="Todavía no elegiste nada"
            detalle="Andá a Buscar y tocá los productos que querés comparar."
          />
        ) : (
          <>
            <View style={[styles.tarjeta, { backgroundColor: paleta.superficie, borderColor: paleta.borde }, sombra]}>
              {carrito.items.map((item, i) => (
                <View key={item.ean}>
                  {i > 0 ? <View style={[styles.separador, { backgroundColor: paleta.borde }]} /> : null}
                  <View style={styles.fila}>
                    <FotoProducto nombre={item.nombre} imagen={item.imagen} tamano={40} />
                    <View style={styles.filaTexto}>
                      <Text style={[texto.cuerpoMedio, { color: paleta.tinta }]} numberOfLines={2}>
                        {item.nombre}
                      </Text>
                      <Text style={[texto.dato, { color: paleta.tintaTenue }]}>{item.ean}</Text>
                    </View>
                    <Stepper
                      cantidad={item.cantidad}
                      onCambiar={n => carrito.cambiarCantidad(item.ean, n)}
                      compacto
                    />
                  </View>
                </View>
              ))}
            </View>

            <Pressable
              onPress={() => setMostrarTarjetas(v => !v)}
              accessibilityRole="button"
              style={[styles.tarjeta, styles.filaTarjetas, { backgroundColor: paleta.superficie, borderColor: paleta.borde }, sombra]}
            >
              <View style={styles.filaTexto}>
                <Text style={[texto.cuerpoMedio, { color: paleta.tinta }]}>Tus tarjetas (opcional)</Text>
                <Text style={[texto.etiqueta, { color: paleta.tintaSuave }]} numberOfLines={1}>
                  {carrito.tarjetas.length
                    ? carrito.tarjetas.join(' · ')
                    : 'Vas a ver todas las promos igual; elegí acá las que usás siempre'}
                </Text>
              </View>
              <Text style={[texto.subtitulo, { color: paleta.tintaTenue }]}>
                {mostrarTarjetas ? '×' : '›'}
              </Text>
            </Pressable>

            {mostrarTarjetas ? (
              <View style={styles.chips}>
                {TARJETAS_DISPONIBLES.map(tarjeta => {
                  const activa = carrito.tarjetas.includes(tarjeta);
                  return (
                    <Pressable
                      key={tarjeta}
                      onPress={() =>
                        carrito.setTarjetas(
                          activa
                            ? carrito.tarjetas.filter(t => t !== tarjeta)
                            : [...carrito.tarjetas, tarjeta]
                        )
                      }
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: activa }}
                      style={[
                        styles.chip,
                        {
                          backgroundColor: activa ? paleta.tinta : paleta.superficie,
                          borderColor: activa ? paleta.tinta : paleta.borde,
                        },
                      ]}
                    >
                      <Text style={[texto.etiqueta, { color: activa ? paleta.superficie : paleta.tintaSuave }]}>
                        {tarjeta}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            ) : null}

            <Pressable
              onPress={carrito.vaciar}
              accessibilityRole="button"
              style={styles.vaciar}
            >
              <Text style={[texto.etiqueta, { color: paleta.tintaTenue, textDecorationLine: 'underline' }]}>
                Vaciar carrito
              </Text>
            </Pressable>
          </>
        )}
      </ScrollView>

      {!vacia ? (
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
            onPress={() => router.push('/resultado')}
            subtitulo="Precios en vivo de los 3 supermercados"
          >
            Comparar precios
          </BotonPrincipal>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  pantalla: { flex: 1 },
  contenido: { paddingHorizontal: espacio.lg, gap: espacio.md },
  tarjeta: { borderWidth: 1, borderRadius: radio.lg, paddingHorizontal: espacio.md },
  filaTarjetas: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    gap: espacio.md, paddingVertical: espacio.md,
  },
  fila: {
    flexDirection: 'row', alignItems: 'center', gap: espacio.md, paddingVertical: espacio.md,
  },
  filaTexto: { flex: 1, gap: 3 },
  separador: { height: StyleSheet.hairlineWidth },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: espacio.sm },
  chip: { paddingHorizontal: espacio.md, paddingVertical: 7, borderRadius: radio.pill, borderWidth: 1 },
  vaciar: { alignSelf: 'center', paddingVertical: espacio.md },
  barraInferior: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: espacio.lg, paddingTop: espacio.md,
  },
});
