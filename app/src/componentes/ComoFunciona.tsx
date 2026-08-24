/**
 * Onboarding "Cómo funciona" (SPEC.md § 4.5): 3 hojas secuenciales sobre backdrop. Se reabre
 * siempre desde el estado inicial de Buscar y desde Ajustes — no es un modal de una sola vez,
 * por eso no guarda "ya lo vi" en ningún lado.
 */

import React, { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { espacio, pesos, radio, texto } from '../theme';
import { useTema } from '../useTema';
import { NOMBRE_SUPER, ORDEN_SUPERS } from './comunes';
import { FotoProducto } from './FotoProducto';
import { PlacaLogoSuper } from './LogoSuper';

const PASOS = [
  {
    titulo: 'Armá un carrito',
    texto: 'Buscá el producto por nombre y seleccionalo. No elegís supermercado: el mismo producto se busca en todos a la vez.',
  },
  {
    titulo: 'Dónde comprar cada cosa',
    texto: 'Al comparar, cada producto queda asignado al supermercado donde sale más barato, con las ofertas por cantidad y lo que tengas en "Mis descuentos" ya contado, ayudandote a hacer la compra más óptima posible.',
  },
  {
    titulo: 'Los colores importan',
    texto: 'Cada supermercado tiene el suyo. El amarillo significa ahorro.',
  },
];

export function ComoFunciona({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { paleta } = useTema();
  const [paso, setPaso] = useState(0);

  const cerrar = () => {
    setPaso(0);
    onClose();
  };

  const siguiente = () => {
    if (paso === PASOS.length - 1) return cerrar();
    setPaso(p => p + 1);
  };

  const actual = PASOS[paso];

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={cerrar}>
      <View style={styles.fondo}>
        <Pressable style={StyleSheet.absoluteFill} onPress={cerrar} accessibilityLabel="Cerrar" />
        <View style={[styles.hoja, { backgroundColor: paleta.superficie }]}>
          <View style={styles.filaSuperior}>
            <Text style={[texto.tituloSeccion, { color: paleta.tintaSuave }]}>PASO {paso + 1} DE {PASOS.length}</Text>
            <Pressable onPress={cerrar} accessibilityRole="button" style={styles.saltar}>
              <Text style={[texto.etiqueta, { color: paleta.tintaSuave, textDecorationLine: 'underline' }]}>
                Saltar
              </Text>
            </Pressable>
          </View>

          <View style={{ gap: espacio.sm }}>
            <Text style={[texto.titulo, { color: paleta.tinta, fontSize: 26, lineHeight: 28 }]}>{actual.titulo}</Text>
            <Text style={[texto.prosa, { color: paleta.tintaProsa }]}>{actual.texto}</Text>
          </View>

          <IlustracionPaso paso={paso} />

          <View style={styles.filaInferior}>
            <View style={styles.dots}>
              {PASOS.map((_, i) => (
                <View
                  key={i}
                  style={[
                    styles.dot,
                    { backgroundColor: i === paso ? paleta.tinta : paleta.borde },
                  ]}
                />
              ))}
            </View>
            <Pressable
              onPress={siguiente}
              accessibilityRole="button"
              style={[styles.botonSiguiente, { backgroundColor: paleta.tinta }]}
            >
              <Text style={[texto.cuerpoMedio, { color: paleta.superficie }]}>
                {paso === PASOS.length - 1 ? 'Empezar' : 'Siguiente'}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function IlustracionPaso({ paso }: { paso: number }) {
  const { paleta } = useTema();

  if (paso === 0) {
    return (
      <View style={[styles.ilustracionFila, { backgroundColor: paleta.superficieAlt }]}>
        <FotoProducto nombre="Coca Cola" imagen={null} tamano={40} />
        <Text style={[texto.cuerpoMedio, { color: paleta.tinta, flex: 1 }]}>Coca Cola Regular 2.25 Lts</Text>
        <View style={[styles.masMini, { backgroundColor: paleta.oferta }]}>
          <Text style={[texto.subtitulo, { color: paleta.ofertaTinta }]}>+</Text>
        </View>
      </View>
    );
  }

  if (paso === 1) {
    const filas: [string, string, string, string][] = [
      ['VEA', pesos(5200), '#12874A', 'coca cola · yerba'],
      ['CARREFOUR', pesos(4300), '#1B5FD9', 'fideos · oreo · sensodyne'],
    ];
    return (
      <View style={{ gap: espacio.sm }}>
        {filas.map(([nombre, total, color, detalle]) => (
          <View key={nombre} style={[styles.bloqueMini, { borderColor: paleta.borde }]}>
            <View style={[styles.cabeceraMini, { backgroundColor: color }]}>
              <Text style={[texto.precioChico, styles.textoBlanco]}>{nombre}</Text>
              <Text style={[texto.precioChico, styles.textoBlanco]}>{total}</Text>
            </View>
            <Text style={[texto.dato, { color: paleta.tintaSuave, padding: espacio.sm }]}>{detalle}</Text>
          </View>
        ))}
      </View>
    );
  }

  // Los 7 supers soportados (super-app-supermercados-soportados), no solo los 3 que aparecían
  // en las filas anteriores del onboarding — acá es donde se enseña el código de color completo.
  return (
    <ScrollView style={styles.scrollLeyenda} showsVerticalScrollIndicator={false}>
      <View style={{ gap: 9 }}>
        {ORDEN_SUPERS.map(key => (
          <View key={key} style={styles.filaLeyenda}>
            <View style={[styles.barraLeyenda, { backgroundColor: paleta.supers[key] }]} />
            <PlacaLogoSuper superKey={key} ancho={44} alto={22} padding={3} radio={radio.sm} />
            <Text style={[texto.etiqueta, { color: paleta.tinta }]}>{NOMBRE_SUPER[key]}</Text>
          </View>
        ))}
        <View style={[styles.filaLeyenda, styles.filaLeyendaAhorro, { borderTopColor: paleta.borde }]}>
          <View style={[styles.barraLeyenda, { backgroundColor: paleta.oferta }]} />
          <Text style={[texto.etiqueta, { color: paleta.tinta }]}>Ahorro y promociones</Text>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  fondo: { flex: 1, backgroundColor: 'rgba(20,22,26,.55)', justifyContent: 'flex-end' },
  hoja: {
    borderTopLeftRadius: radio.pantalla, borderTopRightRadius: radio.pantalla,
    padding: espacio.pantalla, paddingTop: espacio.lg, gap: espacio.lg,
  },
  filaSuperior: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  saltar: { height: 44, paddingHorizontal: espacio.sm, marginRight: -espacio.sm, justifyContent: 'center' },
  filaInferior: { flexDirection: 'row', alignItems: 'center', gap: espacio.md },
  dots: { flexDirection: 'row', gap: 6 },
  dot: { width: 8, height: 8, borderRadius: radio.pill },
  botonSiguiente: {
    flex: 1, height: 50, borderRadius: radio.md, alignItems: 'center', justifyContent: 'center',
  },
  ilustracionFila: {
    flexDirection: 'row', alignItems: 'center', gap: espacio.md,
    borderRadius: radio.md, padding: espacio.md,
  },
  masMini: {
    width: 32, height: 32, borderRadius: radio.sm, alignItems: 'center', justifyContent: 'center',
  },
  bloqueMini: { borderWidth: 1, borderRadius: radio.sm, overflow: 'hidden' },
  cabeceraMini: {
    paddingHorizontal: espacio.md, paddingVertical: espacio.sm,
    flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between',
  },
  textoBlanco: { color: '#FFFFFF' },
  // 7 supers + la fila de ahorro no siempre entran en una hoja chica — con `maxHeight` en vez
  // de `flex` esto scrollea sin empujar el pie (dots + botón) fuera de la pantalla.
  scrollLeyenda: { maxHeight: 220 },
  filaLeyenda: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  filaLeyendaAhorro: { borderTopWidth: 1, paddingTop: 9 },
  barraLeyenda: { width: 30, height: 8, borderRadius: radio.pill },
});
