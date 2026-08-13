/**
 * Pantalla Carrito: revisar cantidades y disparar la comparación.
 *
 * Las tarjetas que marcás acá son solo el default: no hace falta elegir ninguna para
 * comparar. El resultado siempre muestra qué promos de tarjeta existen para cada producto,
 * y se pueden activar ahí mismo con un toque — esto es solo para no tener que activarlas
 * cada vez si siempre pagás con las mismas.
 *
 * Rediseño v2 (SPEC.md § 4.3): header negro, filas de producto sin EAN, bloque de tarjetas
 * ("Mis descuentos" — el nombre completo y la pantalla propia son turno 5, todavía no
 * implementados acá), y confirmación antes de vaciar (era deuda de UX, ver SPEC § 7.1).
 *
 * "Carritos guardados" (turno 4, con su hoja de guardado) queda para esa fase: necesita
 * estado persistente propio que todavía no existe, no solo un reskin.
 */

import { useRouter } from 'expo-router';
import React from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TARJETAS_DISPONIBLES, useCarrito } from '../../src/carrito';
import { Stepper, Vacio } from '../../src/componentes/comunes';
import { FotoProducto } from '../../src/componentes/FotoProducto';
import { HeaderNegro, TituloHeader } from '../../src/componentes/HeaderNegro';
import { espacio, radio, texto } from '../../src/theme';
import { useTema } from '../../src/useTema';

export default function PantallaCarrito() {
  const { paleta } = useTema();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const carrito = useCarrito();

  const vacia = carrito.items.length === 0;

  const confirmarVaciar = () => {
    Alert.alert(
      'Vaciar carrito',
      `Se van a borrar los ${carrito.items.length} productos que agregaste.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Vaciar', style: 'destructive', onPress: carrito.vaciar },
      ]
    );
  };

  return (
    <View style={[styles.pantalla, { backgroundColor: paleta.fondo }]}>
      <HeaderNegro paddingTop={insets.top + espacio.xl} estilo={styles.headerCarrito}>
        <TituloHeader>Carrito</TituloHeader>
        {!vacia ? (
          <Text style={[texto.etiqueta, styles.subtituloHeader]}>
            {carrito.items.length} producto{carrito.items.length === 1 ? '' : 's'} · {carrito.totalUnidades} u
          </Text>
        ) : null}
      </HeaderNegro>

      <ScrollView
        contentContainerStyle={[styles.contenido, { paddingBottom: vacia ? espacio.xl : 140 }]}
        keyboardShouldPersistTaps="handled"
      >
        {vacia ? (
          <Vacio
            titulo="Todavía no elegiste nada"
            detalle="Andá a Buscar y tocá los productos que querés comparar."
          />
        ) : (
          <>
            <View style={styles.seccion}>
              <Text style={[texto.micro, { color: paleta.tintaTenue }]}>EN ESTA COMPRA</Text>
              {carrito.items.map(item => (
                <View
                  key={item.ean}
                  style={[styles.filaProducto, { backgroundColor: paleta.superficieAlt }]}
                >
                  <FotoProducto nombre={item.nombre} imagen={item.imagen} tamano={44} />
                  <Text style={[texto.cuerpoMedio, styles.filaNombre, { color: paleta.tinta }]} numberOfLines={2}>
                    {item.nombre}
                  </Text>
                  <Stepper
                    cantidad={item.cantidad}
                    onCambiar={n => carrito.cambiarCantidad(item.ean, n)}
                    compacto
                  />
                </View>
              ))}
            </View>

            <View style={[styles.tarjetaDescuentos, { borderColor: paleta.borde }]}>
              <View style={[styles.cabeceraDescuentos, { backgroundColor: paleta.oferta }]}>
                <Text style={[texto.micro, { color: paleta.ofertaTinta, letterSpacing: 1.2 }]}>
                  MIS DESCUENTOS · {carrito.tarjetas.length}
                </Text>
                {/* Aclara para qué sirve marcarlas — no es una lista, es lo que suma al comparar
                    (SPEC § 3d). */}
                <Text style={[texto.micro, { color: paleta.ofertaTinta, opacity: 0.7, letterSpacing: 0.7 }]}>
                  SUMAN SUS PROMOS
                </Text>
              </View>
              <View style={styles.chipsDescuentos}>
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
                        activa
                          ? { backgroundColor: paleta.tinta }
                          : { borderWidth: 1, borderColor: paleta.borde },
                      ]}
                    >
                      <Text style={[texto.etiqueta, { color: activa ? paleta.superficie : paleta.tintaSuave }]}>
                        {tarjeta}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            <Pressable onPress={confirmarVaciar} accessibilityRole="button" style={styles.vaciar}>
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
            { borderTopColor: paleta.borde, paddingBottom: Math.max(insets.bottom, espacio.md) },
          ]}
        >
          <Pressable
            onPress={() => router.push('/resultado')}
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.botonComparar,
              { backgroundColor: paleta.tinta, opacity: pressed ? 0.9 : 1 },
            ]}
          >
            <Text style={[texto.tituloHeader, styles.textoComparar]}>Comparar precios</Text>
            <View style={[styles.puntoAmarillo, { backgroundColor: paleta.oferta }]} />
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  pantalla: { flex: 1 },
  headerCarrito: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  subtituloHeader: { color: '#FFFFFF', opacity: 0.7 },
  contenido: { paddingHorizontal: espacio.pantalla, paddingTop: espacio.pantalla, gap: espacio.pantalla },
  seccion: { gap: espacio.sm },
  filaProducto: {
    flexDirection: 'row', alignItems: 'center', gap: espacio.md,
    borderRadius: radio.md, padding: espacio.md, marginTop: espacio.sm,
  },
  filaNombre: { flex: 1 },
  tarjetaDescuentos: { borderWidth: 1, borderRadius: radio.tarjeta, overflow: 'hidden' },
  cabeceraDescuentos: {
    paddingHorizontal: espacio.md, paddingVertical: espacio.sm,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: espacio.sm,
  },
  chipsDescuentos: { flexDirection: 'row', flexWrap: 'wrap', gap: espacio.sm, padding: espacio.md },
  chip: { paddingHorizontal: espacio.md, paddingVertical: espacio.sm, borderRadius: radio.sm },
  vaciar: {
    alignSelf: 'center', height: 44, paddingHorizontal: espacio.md,
    alignItems: 'center', justifyContent: 'center',
  },
  barraInferior: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: espacio.pantalla, paddingTop: espacio.md,
  },
  botonComparar: {
    borderRadius: radio.md, minHeight: 56,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: espacio.sm,
  },
  textoComparar: { fontSize: 24, lineHeight: 26, textTransform: 'uppercase', color: '#FFFFFF' },
  puntoAmarillo: { width: 8, height: 8, borderRadius: radio.pill },
});
