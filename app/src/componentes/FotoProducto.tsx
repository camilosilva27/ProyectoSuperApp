/**
 * Foto de producto, con fallback cuando no hay imagen.
 *
 * Usa `expo-image` en vez del `Image` nativo de RN porque cachea en disco — una vez que el
 * teléfono la vio, no la vuelve a pedir al backend entre aperturas de la app (el `Image`
 * nativo solo cachea en memoria, así que se perdía al cerrar la app).
 *
 * El fallback no es un ícono genérico de "sin imagen": es un círculo con el color de fondo
 * derivado del nombre del producto (siempre el mismo para el mismo producto, para que sea
 * reconocible en una lista) y su inicial — más parecido a un avatar que a un error.
 */

import { Image, type ImageStyle } from 'expo-image';
import React, { useState } from 'react';
import { StyleSheet, Text, View, type StyleProp } from 'react-native';
import { urlImagen } from '../api';
import { radio, texto } from '../theme';

// Paleta de fondos para el fallback — no son los colores de super (esos significan identidad
// de supermercado en toda la app); acá solo hace falta variedad para distinguir productos
// en una lista, así que son tonos neutros con distinta luminosidad.
const FONDOS_FALLBACK = ['#6B7280', '#7C6F64', '#5B7A8C', '#7A6A8C', '#6B8C7A', '#8C6B6B'];

function colorFallbackDe(nombre: string): string {
  let hash = 0;
  for (let i = 0; i < nombre.length; i++) hash = (hash * 31 + nombre.charCodeAt(i)) >>> 0;
  return FONDOS_FALLBACK[hash % FONDOS_FALLBACK.length];
}

function inicialDe(nombre: string): string {
  const letra = nombre.trim().charAt(0).toUpperCase();
  return /[A-ZÁÉÍÓÚÑ]/.test(letra) ? letra : '?';
}

type Props = {
  nombre: string;
  imagen: string | null;
  tamano?: number;
  estilo?: StyleProp<ImageStyle>;
};

export function FotoProducto({ nombre, imagen, tamano = 44, estilo }: Props) {
  const [fallo, setFallo] = useState(false);
  const uri = urlImagen(imagen);
  const dimension = { width: tamano, height: tamano, borderRadius: radio.md };

  if (!uri || fallo) {
    return (
      <View style={[styles.fallback, dimension, { backgroundColor: colorFallbackDe(nombre) }, estilo]}>
        <Text style={[texto.subtitulo, { color: '#FFFFFF', fontSize: tamano * 0.4 }]}>
          {inicialDe(nombre)}
        </Text>
      </View>
    );
  }

  return (
    <Image
      source={{ uri }}
      style={[dimension, estilo]}
      contentFit="cover"
      cachePolicy="disk"
      transition={150}
      onError={() => setFallo(true)}
      accessibilityLabel={`Foto de ${nombre}`}
    />
  );
}

const styles = StyleSheet.create({
  fallback: { alignItems: 'center', justifyContent: 'center' },
});
