/**
 * Onboarding "Cómo funciona" (SPEC.md § 4.5): 3 hojas secuenciales sobre backdrop. Se reabre
 * siempre desde el estado inicial de Buscar y desde Ajustes — no es un modal de una sola vez,
 * por eso no guarda "ya lo vi" en ningún lado.
 */

import React, { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { espacio, pesos, radio, texto } from '../theme';
import { useTema } from '../useTema';
import { FotoProducto } from './FotoProducto';

const PASOS = [
  {
    titulo: 'Armá un solo carrito',
    texto: 'Buscá el producto por nombre y tocalo. No elegís supermercado: el mismo producto se busca en los cinco a la vez.',
  },
  {
    titulo: 'Dónde comprar cada cosa',
    texto: 'Al comparar, cada producto queda asignado al supermercado donde sale más barato, con las ofertas por cantidad y lo que tengas en Mis descuentos ya contado. Vas a ver ese total y el de comprar todo en un solo lugar.',
  },
  {
    titulo: 'Dos colores que importan',
    texto: 'Cada supermercado tiene el suyo: el color de un precio dice de dónde es. El amarillo nunca es un super, siempre es ahorro.',
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
            <Text style={[texto.micro, { color: paleta.tintaTenue }]}>PASO {paso + 1} DE {PASOS.length}</Text>
            <Pressable onPress={cerrar} accessibilityRole="button" style={styles.saltar}>
              <Text style={[texto.etiqueta, { color: paleta.tintaTenue, textDecorationLine: 'underline' }]}>
                Saltar
              </Text>
            </Pressable>
          </View>

          <View style={{ gap: espacio.sm }}>
            <Text style={[texto.titulo, { color: paleta.tinta, fontSize: 26, lineHeight: 28 }]}>{actual.titulo}</Text>
            <Text style={[texto.cuerpo, { color: paleta.tintaSuave }]}>{actual.texto}</Text>
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
      ['VEA', pesos(48310), '#12874A', 'coca cola · yerba'],
      ['CARREFOUR', pesos(61130), '#1B5FD9', 'fideos · oreo · sensodyne'],
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

  const supers: [string, string][] = [
    ['Vea', paleta.supers.vea], ['Carrefour', paleta.supers.carr], ['Chango Más', paleta.supers.changomas],
  ];
  return (
    <View style={{ gap: 9 }}>
      {supers.map(([nombre, color]) => (
        <View key={nombre} style={styles.filaLeyenda}>
          <View style={[styles.barraLeyenda, { backgroundColor: color }]} />
          <Text style={[texto.etiqueta, { color: paleta.tinta }]}>{nombre}</Text>
        </View>
      ))}
      <View style={[styles.filaLeyenda, styles.filaLeyendaAhorro, { borderTopColor: paleta.borde }]}>
        <View style={[styles.barraLeyenda, { backgroundColor: paleta.oferta }]} />
        <Text style={[texto.etiqueta, { color: paleta.tinta }]}>Ahorro y promociones</Text>
      </View>
    </View>
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
  filaLeyenda: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  filaLeyendaAhorro: { borderTopWidth: 1, paddingTop: 9 },
  barraLeyenda: { width: 30, height: 8, borderRadius: radio.pill },
});
