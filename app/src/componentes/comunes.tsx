/**
 * Piezas compartidas por las tres pantallas: puntos de disponibilidad, stepper de cantidad,
 * botón principal, estados vacíos y encabezado de pantalla.
 *
 * Cada una hace una sola cosa. Los textos de la interfaz nombran lo que el usuario controla
 * ("Comparar precios", "Vaciar carrito"), no cómo está hecho por dentro.
 */

import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import type { SuperKey } from '../api';
import { espacio, radio, texto } from '../theme';
import { useTema } from '../useTema';

const ORDEN_SUPERS: SuperKey[] = ['vea', 'carr', 'changomas', 'dia', 'coto'];
const NOMBRE_SUPER: Record<SuperKey, string> = {
  vea: 'Vea', carr: 'Carrefour', changomas: 'Chango Más', dia: 'Día', coto: 'Coto',
};

/** En qué supers existe el producto, antes de saber precios. Color = identidad del super. */
export function PuntosDisponibilidad({ disponibleEn }: { disponibleEn: SuperKey[] }) {
  const { paleta } = useTema();
  return (
    <View
      style={styles.puntos}
      accessibilityLabel={`Disponible en ${disponibleEn.map(k => NOMBRE_SUPER[k]).join(', ')}`}
    >
      {ORDEN_SUPERS.map(key => {
        const presente = disponibleEn.includes(key);
        // Día es blanco: sin borde se pierde contra `superficie` o se lee como "no disponible".
        const bordeIdentidad = (paleta.supersBorde as Partial<Record<SuperKey, string>>)[key];
        return (
          <View
            key={key}
            style={[
              styles.punto,
              presente
                ? {
                    backgroundColor: paleta.supers[key],
                    ...(bordeIdentidad ? { borderWidth: 1, borderColor: bordeIdentidad } : null),
                  }
                : { backgroundColor: 'transparent', borderWidth: 1, borderColor: paleta.borde },
            ]}
          />
        );
      })}
    </View>
  );
}

export function Stepper({
  cantidad, onCambiar, compacto = false,
}: { cantidad: number; onCambiar: (n: number) => void; compacto?: boolean }) {
  const { paleta } = useTema();
  const lado = compacto ? 30 : 36;

  return (
    <View style={[styles.stepper, { borderColor: paleta.borde, backgroundColor: paleta.superficie }]}>
      <Pressable
        onPress={() => onCambiar(cantidad - 1)}
        hitSlop={6}
        style={({ pressed }) => [
          styles.stepperBoton,
          { width: lado, height: lado, opacity: pressed ? 0.55 : 1 },
        ]}
        accessibilityRole="button"
        accessibilityLabel={cantidad === 1 ? 'Quitar del carrito' : 'Restar una unidad'}
      >
        <Text style={[texto.subtitulo, { color: paleta.tintaSuave }]}>−</Text>
      </Pressable>

      <Text style={[texto.precioChico, { color: paleta.tinta, minWidth: 22, textAlign: 'center' }]}>
        {cantidad}
      </Text>

      <Pressable
        onPress={() => onCambiar(cantidad + 1)}
        hitSlop={6}
        style={({ pressed }) => [
          styles.stepperBoton,
          { width: lado, height: lado, opacity: pressed ? 0.55 : 1 },
        ]}
        accessibilityRole="button"
        accessibilityLabel="Sumar una unidad"
      >
        <Text style={[texto.subtitulo, { color: paleta.tintaSuave }]}>+</Text>
      </Pressable>
    </View>
  );
}

export function BotonPrincipal({
  children, onPress, cargando = false, deshabilitado = false, subtitulo,
}: {
  children: string;
  onPress: () => void;
  cargando?: boolean;
  deshabilitado?: boolean;
  subtitulo?: string;
}) {
  const { paleta } = useTema();
  const inactivo = deshabilitado || cargando;

  return (
    <Pressable
      onPress={onPress}
      disabled={inactivo}
      accessibilityRole="button"
      accessibilityState={{ disabled: inactivo, busy: cargando }}
      style={({ pressed }) => [
        styles.botonPrincipal,
        {
          backgroundColor: inactivo ? paleta.superficieAlt : paleta.tinta,
          borderColor: inactivo ? paleta.borde : paleta.tinta,
          opacity: pressed ? 0.9 : 1,
        },
      ]}
    >
      {cargando ? (
        <ActivityIndicator color={paleta.tintaSuave} />
      ) : (
        <View style={styles.botonContenido}>
          <Text style={[texto.subtitulo, { color: inactivo ? paleta.tintaTenue : paleta.superficie }]}>
            {children}
          </Text>
          {subtitulo ? (
            <Text style={[texto.micro, { color: inactivo ? paleta.tintaTenue : paleta.superficie, opacity: 0.75 }]}>
              {subtitulo}
            </Text>
          ) : null}
        </View>
      )}
    </Pressable>
  );
}

/** Una pantalla vacía es una invitación a actuar, no un cartel de error. */
export function Vacio({ titulo, detalle }: { titulo: string; detalle: string }) {
  const { paleta } = useTema();
  return (
    <View style={styles.vacio}>
      <Text style={[texto.subtitulo, { color: paleta.tinta, textAlign: 'center' }]}>{titulo}</Text>
      <Text style={[texto.cuerpo, { color: paleta.tintaSuave, textAlign: 'center' }]}>{detalle}</Text>
    </View>
  );
}

/** Los errores explican qué pasó y cómo seguir; nunca se disculpan ni son vagos. */
export function Problema({ mensaje, onReintentar }: { mensaje: string; onReintentar?: () => void }) {
  const { paleta } = useTema();
  return (
    <View style={[styles.problema, { backgroundColor: paleta.alertaFondo, borderColor: paleta.alerta }]}>
      <Text style={[texto.cuerpoMedio, { color: paleta.alerta }]}>{mensaje}</Text>
      {onReintentar ? (
        <Pressable onPress={onReintentar} accessibilityRole="button">
          <Text style={[texto.etiqueta, { color: paleta.alerta, textDecorationLine: 'underline' }]}>
            Volver a intentar
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function EncabezadoPantalla({ titulo, bajada }: { titulo: string; bajada?: string }) {
  const { paleta } = useTema();
  return (
    <View style={styles.encabezado}>
      <Text style={[texto.titulo, { color: paleta.tinta }]}>{titulo}</Text>
      {bajada ? <Text style={[texto.cuerpo, { color: paleta.tintaSuave }]}>{bajada}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  puntos: { flexDirection: 'row', gap: 4, alignItems: 'center' },
  punto: { width: 8, height: 8, borderRadius: radio.pill },
  stepper: {
    flexDirection: 'row', alignItems: 'center', borderWidth: 1,
    borderRadius: radio.pill, paddingHorizontal: 2,
  },
  stepperBoton: { alignItems: 'center', justifyContent: 'center' },
  botonPrincipal: {
    borderRadius: radio.md, borderWidth: 1, paddingVertical: 14,
    alignItems: 'center', justifyContent: 'center', minHeight: 52,
  },
  botonContenido: { alignItems: 'center', gap: 2 },
  vacio: { padding: espacio.xl, gap: espacio.sm, alignItems: 'center' },
  problema: {
    borderWidth: 1, borderRadius: radio.md, padding: espacio.md, gap: espacio.sm,
  },
  encabezado: { gap: 2, paddingBottom: espacio.md },
});
