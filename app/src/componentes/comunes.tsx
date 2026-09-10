/**
 * Piezas compartidas por las tres pantallas: puntos de disponibilidad, stepper de cantidad,
 * botón principal, estados vacíos y encabezado de pantalla.
 *
 * Cada una hace una sola cosa. Los textos de la interfaz nombran lo que el usuario controla
 * ("Comparar precios", "Vaciar carrito"), no cómo está hecho por dentro.
 */

import React, { useEffect, useRef } from 'react';
import {
  ActivityIndicator, Animated, Easing, Pressable, StyleSheet, Text, View,
  type StyleProp, type ViewStyle,
} from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import type { SuperKey } from '../api';
import { espacio, fuentes, radio, texto, usePantallaBaja, type Paleta } from '../theme';
import { useTema } from '../useTema';

export const ORDEN_SUPERS: SuperKey[] = ['vea', 'carr', 'changomas', 'dia', 'coto', 'jumbo', 'disco'];
export const NOMBRE_SUPER: Record<SuperKey, string> = {
  vea: 'Vea', carr: 'Carrefour', changomas: 'Chango Más', dia: 'Día', coto: 'Coto', jumbo: 'Jumbo', disco: 'Disco',
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

/**
 * Banda de disponibilidad (rediseño v2, SPEC § 3.3): columna de 8px pegada al borde
 * izquierdo de cada resultado de búsqueda, 5 segmentos en el orden fijo de ORDEN_SUPERS.
 * El orden nunca cambia — es lo que la hace legible de un vistazo. Reemplaza a
 * PuntosDisponibilidad en la fila de resultado (esa queda para otros usos más compactos).
 *
 * `supersActivos` (opcional): si se pasa, un super se pinta como "presente" solo cuando
 * además está activo en el filtro. Sin esto, un producto que existe en un super desactivado
 * se veía "disponible" ahí aunque ese super nunca fuera a entrar en la comparación — el
 * usuario lo agregaba al carrito creyendo que participaba y "Comparar precios" lo ignoraba
 * sin ninguna señal previa de por qué.
 */
export function BandaDisponibilidad({
  disponibleEn, supersActivos,
}: { disponibleEn: SuperKey[]; supersActivos?: SuperKey[] }) {
  const { paleta } = useTema();
  const disponibleEnActivos = supersActivos
    ? disponibleEn.filter(k => supersActivos.includes(k))
    : disponibleEn;
  return (
    <View
      style={styles.banda}
      accessibilityLabel={`Disponible en ${disponibleEnActivos.map(k => NOMBRE_SUPER[k]).join(', ')}`}
    >
      {ORDEN_SUPERS.map(key => {
        const presente = disponibleEnActivos.includes(key);
        const bordeIdentidad = (paleta.supersBorde as Partial<Record<SuperKey, string>>)[key];
        return (
          <View
            key={key}
            style={[
              styles.segmentoBanda,
              presente
                ? {
                    backgroundColor: paleta.supers[key],
                    ...(bordeIdentidad ? { borderWidth: 1, borderColor: bordeIdentidad } : null),
                  }
                : { backgroundColor: paleta.superficie2 },
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

// Paths tal como quedaron definidos en Claude Design (turno 19/19a "Íconos de balanza y
// carrito"): trazo de 2px sobre grilla de 24px en el tamaño normal; el tamaño chico (18px, para
// `usePantallaBaja` — pantallas bajas tipo iPhone SE) sube el trazo a 2.4 para que no se vea
// débil al achicarse, mismo criterio que el resto de los íconos a mano de este archivo/
// _layout.tsx en vez de sumar una librería.
function tamanoIcono(chico: boolean) {
  return { lado: chico ? 18 : 24, grosor: chico ? 2.4 : 2 };
}

function IconoCarritoCompra({ color, chico = false }: { color: string; chico?: boolean }) {
  const { lado, grosor } = tamanoIcono(chico);
  return (
    <Svg width={lado} height={lado} viewBox="0 0 24 24" fill="none">
      <Path
        d="M2 3.5h2.2l2.5 10.9a1.7 1.7 0 0 0 1.66 1.32h8.03a1.7 1.7 0 0 0 1.66-1.3L19.8 8H5.6"
        stroke={color}
        strokeWidth={grosor}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Circle cx={9.5} cy={20} r={1.4} fill={color} />
      <Circle cx={16.5} cy={20} r={1.4} fill={color} />
    </Svg>
  );
}

/** Balanza de dos platillos — distingue "Comparar precios" (carrito.tsx) de "Ver carrito".
 *  Mástil + travesaño horizontal, dos cadenas por platillo y un arco (no un círculo entero:
 *  así se lee como que "cuelga" del travesaño) por cada uno, más la base. */
export function IconoBalanza({ color, chico = false }: { color: string; chico?: boolean }) {
  const { lado, grosor } = tamanoIcono(chico);
  return (
    <Svg
      width={lado} height={lado} viewBox="0 0 24 24" fill="none"
      stroke={color} strokeWidth={grosor} strokeLinecap="round" strokeLinejoin="round"
    >
      <Path d="M12 4.5V20" />
      <Path d="M8 20h8" />
      <Path d="M4 7h16" />
      <Path d="M4 7l-2.5 5" />
      <Path d="M4 7l2.5 5" />
      <Path d="M1.5 12a2.5 2.5 0 0 0 5 0" />
      <Path d="M20 7l-2.5 5" />
      <Path d="M20 7l2.5 5" />
      <Path d="M17.5 12a2.5 2.5 0 0 0 5 0" />
    </Svg>
  );
}

/** Flecha de navegación ("ir a X") al final de una fila tocable — antes era el carácter "›"
 *  suelto en varios lugares (ajustes.tsx, resultado.tsx), la única "iconografía" de la app que
 *  no era SVG. Mismo mecanismo (`react-native-svg`, trazo de `tamanoIcono`) que el resto. */
export function IconoChevron({ color, chico = false }: { color: string; chico?: boolean }) {
  const { lado, grosor } = tamanoIcono(chico);
  return (
    <Svg width={lado} height={lado} viewBox="0 0 24 24" fill="none">
      <Path d="M9 6l6 6-6 6" stroke={color} strokeWidth={grosor} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

/**
 * Botón CTA único de la app (SPEC diseño v2): antes solo lo usaban "Ver carrito" y "Volver a
 * Buscar", mientras "Comparar precios" (carrito.tsx), "Ver carrito en X"/"Llevar N"
 * (resultado.tsx) y los pares Cancelar/Confirmar de las 3 hojas modales se resolvían cada uno
 * a mano, con su propia altura/radio/opacity de "presionado". `variante` cubre esos casos:
 * - primario (default): fondo `tinta`, para el CTA principal de una pantalla.
 * - secundario: outline, para "Cancelar" al lado de un primario o un peligro.
 * - peligro: fondo `paleta.peligro`, para confirmar una acción destructiva.
 */
export function BotonPrincipal({
  children, onPress, cargando = false, deshabilitado = false, subtitulo, iconoCarrito = false,
  iconoBalanza = false, variante = 'primario', estilo, botonRef,
}: {
  children: string;
  onPress: () => void;
  cargando?: boolean;
  deshabilitado?: boolean;
  subtitulo?: string;
  /** Ícono de carrito de supermercado antes del texto — solo lo usa "Ver carrito" (index.tsx). */
  iconoCarrito?: boolean;
  /** Balanza de dos platillos, en amarillo de oferta — solo la usa "Comparar precios"
   *  (carrito.tsx), para distinguirse de "Ver carrito" (ver comentario de IconoBalanza). */
  iconoBalanza?: boolean;
  variante?: 'primario' | 'secundario' | 'peligro';
  /** Para los pares Cancelar/Confirmar de las hojas modales, que necesitan `flex: 1` cada uno. */
  estilo?: StyleProp<ViewStyle>;
  /** Solo lo usa el tour, para medir el botón (ej. "comparar-precios" en carrito.tsx). */
  botonRef?: React.Ref<View>;
}) {
  const { paleta } = useTema();
  const pantallaBaja = usePantallaBaja();
  const inactivo = deshabilitado || cargando;

  const fondo = inactivo
    ? (variante === 'secundario' ? 'transparent' : paleta.superficieAlt)
    : variante === 'secundario' ? 'transparent' : variante === 'peligro' ? paleta.peligro : paleta.tinta;
  const borde = inactivo ? paleta.borde : variante === 'secundario' ? paleta.borde : fondo;
  const colorTexto = inactivo
    ? paleta.tintaTenue
    : variante === 'secundario' ? paleta.tinta : paleta.superficie;

  return (
    <Pressable
      ref={botonRef}
      onPress={onPress}
      disabled={inactivo}
      accessibilityRole="button"
      accessibilityState={{ disabled: inactivo, busy: cargando }}
      style={({ pressed }) => [
        styles.botonPrincipal,
        { backgroundColor: fondo, borderColor: borde, opacity: pressed ? 0.9 : 1 },
        estilo,
      ]}
    >
      {cargando ? (
        <ActivityIndicator color={paleta.tintaSuave} />
      ) : (
        <View style={styles.botonContenido}>
          <View style={styles.filaTituloBoton}>
            {iconoCarrito ? <IconoCarritoCompra color={colorTexto} chico={pantallaBaja} /> : null}
            {iconoBalanza ? <IconoBalanza color={paleta.oferta} chico={pantallaBaja} /> : null}
            <Text style={[texto.subtitulo, { color: colorTexto }]}>{children}</Text>
          </View>
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

/**
 * Fila con switch animado (tarjeta con barra de acento + radio circular, SPEC diseño v2) — la
 * usan tanto "Mis descuentos" (marcar qué tarjetas/apps tenés) como "Ajustes" (recordatorio
 * semanal). Antes estaba duplicada a mano en los dos archivos; unificada acá porque eran
 * pixel-idénticas salvo `filaRef` (scroll del tour a esta fila) y `deshabilitada`.
 */
export function FilaToggleAnimada({
  paleta, filaRef, nombre, activa, deshabilitada = false, onCambiar, accessibilityLabel,
}: {
  paleta: Paleta;
  filaRef?: React.Ref<View>;
  nombre: string;
  activa: boolean;
  deshabilitada?: boolean;
  onCambiar: (valor: boolean) => void;
  accessibilityLabel: string;
}) {
  const progreso = useRef(new Animated.Value(activa ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(progreso, {
      toValue: activa ? 1 : 0,
      duration: 180,
      easing: Easing.out(Easing.ease), // fade suave, sin rebote (spec: ease-out 150-200ms)
      useNativeDriver: false, // anima colores, no soportado por el driver nativo
    }).start();
  }, [activa, progreso]);

  const fondo = progreso.interpolate({ inputRange: [0, 1], outputRange: [paleta.superficieAlt, paleta.ofertaSuave] });
  const borde = progreso.interpolate({ inputRange: [0, 1], outputRange: [paleta.borde, paleta.oferta] });
  const acento = progreso.interpolate({ inputRange: [0, 1], outputRange: [paleta.borde, paleta.oferta] });
  const radioFondo = progreso.interpolate({ inputRange: [0, 1], outputRange: [paleta.superficie, paleta.tinta] });
  const radioBorde = progreso.interpolate({ inputRange: [0, 1], outputRange: [paleta.bordeFuerte, paleta.tinta] });

  return (
    <Pressable
      ref={filaRef}
      onPress={() => onCambiar(!activa)}
      disabled={deshabilitada}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: activa, disabled: deshabilitada }}
      accessibilityLabel={accessibilityLabel}
    >
      <Animated.View style={[styles.filaToggleAnimada, { backgroundColor: fondo, borderColor: borde, opacity: deshabilitada ? 0.6 : 1 }]}>
        <Animated.View style={[styles.barraAcentoToggle, { backgroundColor: acento }]} />
        <Text style={[texto.cuerpoMedio, { color: paleta.tinta, flex: 1 }]}>{nombre}</Text>
        <Animated.View style={[styles.radioToggle, { backgroundColor: radioFondo, borderColor: radioBorde }]}>
          <Animated.Text style={[styles.radioCheckToggle, { color: paleta.oferta, opacity: progreso }]}>✓</Animated.Text>
        </Animated.View>
      </Animated.View>
    </Pressable>
  );
}

/**
 * Estado de carga compartido — antes cada pantalla (Buscar, Mis descuentos, Resultado, Plan y
 * pago) armaba el suyo por separado (con/sin texto, con/sin centrado propio), a diferencia de
 * `Vacio`/`Problema` que sí eran un patrón único y bien adoptado. `mensaje` es opcional: solo
 * Resultado lo usaba (explica qué está pasando mientras se consultan precios en vivo), el resto
 * mostraba solo el spinner.
 */
export function Cargando({ mensaje }: { mensaje?: string }) {
  const { paleta } = useTema();
  return (
    <View style={styles.cargando}>
      <ActivityIndicator color={paleta.tintaSuave} />
      {mensaje ? (
        <Text style={[texto.cuerpo, { color: paleta.tintaSuave, textAlign: 'center' }]}>{mensaje}</Text>
      ) : null}
    </View>
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
  banda: { width: 8, alignSelf: 'stretch', flexDirection: 'column' },
  segmentoBanda: { flex: 1 },
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
  filaTituloBoton: { flexDirection: 'row', alignItems: 'center', gap: espacio.xs },
  cargando: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: espacio.sm, padding: espacio.xl },
  vacio: { padding: espacio.xl, gap: espacio.sm, alignItems: 'center' },
  problema: {
    borderWidth: 1, borderRadius: radio.md, padding: espacio.md, gap: espacio.sm,
  },
  encabezado: { gap: 2, paddingBottom: espacio.md },
  filaToggleAnimada: {
    flexDirection: 'row', alignItems: 'center', gap: espacio.md, padding: espacio.md,
    borderRadius: radio.tarjeta, borderWidth: 1, minHeight: 44,
  },
  barraAcentoToggle: { width: 8, height: 36, borderRadius: radio.pill },
  radioToggle: { width: 26, height: 26, borderRadius: radio.pill, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  radioCheckToggle: { fontFamily: fuentes.semi, fontSize: 13, lineHeight: 13 },
});
