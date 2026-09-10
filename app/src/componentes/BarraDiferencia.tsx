/**
 * ELEMENTO FIRMA de la app: la barra de diferencia.
 *
 * El problema real que resuelve: una lista de tres precios casi iguales y una lista de tres
 * precios muy distintos se leen igual si solo mostrás los números. Pero la decisión que el
 * usuario tiene que tomar es distinta en cada caso — si el segundo super está $90 más caro
 * no vale la pena un segundo viaje; si está $970 más caro, sí.
 *
 * Entonces acá no se grafica el precio absoluto (que haría barras casi idénticas), se grafica
 * **cuánto peor es cada alternativa respecto de la más barata**. El más barato queda anclado
 * a la izquierda sin barra, y los demás muestran su sobreprecio como largo. De un vistazo se
 * ve si conviene repartir la compra o no.
 *
 * Es también la traducción visual de lo que el CLI ya dice en texto:
 * "Comprando en Carrefour ahorrás $89,70 vs Vea y $967,70 vs Chango Más".
 *
 * Dos correcciones sobre la primera versión, encontradas probando con datos reales:
 *
 * 1. **La barra es de un solo color neutro, nunca el color del super.** El punto de color
 *    sigue identificando "de qué super es" (mismo código de color que el resto de la app),
 *    pero la barra en sí no lleva color de marca. Con Vea en verde, una barra verde llena
 *    marcando "esto es más caro" se leía como una señal positiva — el verde ya significa
 *    "Vea" en toda la app, no puede significar también "atención" en el mismo componente.
 * 2. **El ancho se escala contra el precio más barato, no contra la diferencia máxima entre
 *    alternativas.** La versión anterior normalizaba cada barra contra `deltaMaximo` (la
 *    diferencia más grande entre las opciones mostradas) — con solo dos opciones, eso hace
 *    que la segunda SIEMPRE ocupe el 100% del ancho, sin importar si está $50 o $5.000 más
 *    cara. Ahora el ancho es "cuánto % más caro que la mejor opción", con un techo en 100%:
 *    es comparable entre productos y no depende de cuántas alternativas haya.
 */

import React, { useEffect, useRef } from 'react';
import { AccessibilityInfo, Animated, Easing, StyleSheet, Text, View } from 'react-native';
import type { OpcionSuper } from '../api';
import { espacio, pesos, radio, texto } from '../theme';
import { useTema } from '../useTema';

/** Color de identidad de un super, con el borde de contraste de Día si corresponde (ver theme.ts). */
function estiloIdentidadDe(paleta: ReturnType<typeof useTema>['paleta'], key: OpcionSuper['key']) {
  const borde = (paleta.supersBorde as Partial<Record<OpcionSuper['key'], string>>)[key];
  return {
    backgroundColor: paleta.supers[key],
    ...(borde ? { borderWidth: 1, borderColor: borde } : null),
  };
}

type Props = {
  /** Ya ordenadas de más barata a más cara (así las devuelve el backend). */
  opciones: OpcionSuper[];
  /** Supers activos con el producto pero excluidos del plan por el tope de supers — se
   *  muestran igual, con su precio real, al final de `opciones` (ver ItemComparado en
   *  api.ts). */
  fueraDeTope?: OpcionSuper[];
  /** Supers consultados en esta comparación que no tienen el producto — se muestran al
   *  final de la lista con "No Disponible" en vez de desaparecer sin aviso. */
  faltantes?: { key: OpcionSuper['key']; nombre: string }[];
  /** Se anima solo la primera vez que aparece; en re-render no vuelve a medirse. */
  animar?: boolean;
  demoraMs?: number;
};

export function BarraDiferencia({
  opciones, fueraDeTope, faltantes, animar = true, demoraMs = 0,
}: Props) {
  const { paleta } = useTema();
  const fuera = fueraDeTope ?? [];

  if (!opciones.length && !fuera.length && !(faltantes ?? []).length) return null;

  // Si el tope dejó a este producto sin ninguna opción "en plan", la más barata de las
  // excluidas pasa a hacer de referencia para el delta (y se muestra como "MÁS BARATO": es la
  // más barata disponible de verdad, aunque haya quedado fuera del plan capado).
  const mejor = opciones[0] ?? fuera[0] ?? null;

  return (
    <View style={styles.contenedor}>
      {opciones.map((opcion, i) => (
        <FilaSuper
          key={opcion.key}
          opcion={opcion}
          delta={opcion.total - mejor!.total}
          totalMejor={mejor!.total}
          esMejor={i === 0}
          estiloIdentidad={estiloIdentidadDe(paleta, opcion.key)}
          animar={animar}
          demoraMs={demoraMs + i * 70}
        />
      ))}
      {fuera.map((opcion, i) => (
        <FilaSuper
          key={opcion.key}
          opcion={opcion}
          delta={mejor ? opcion.total - mejor.total : 0}
          totalMejor={mejor ? mejor.total : opcion.total}
          esMejor={opciones.length === 0 && i === 0}
          estiloIdentidad={estiloIdentidadDe(paleta, opcion.key)}
          animar={animar}
          demoraMs={demoraMs + (opciones.length + i) * 70}
        />
      ))}
      {(faltantes ?? []).map(f => (
        <FilaNoDisponible key={f.key} nombre={f.nombre} estiloIdentidad={estiloIdentidadDe(paleta, f.key)} />
      ))}
    </View>
  );
}

function FilaNoDisponible({
  nombre, estiloIdentidad,
}: {
  nombre: string;
  estiloIdentidad: { backgroundColor: string; borderWidth?: number; borderColor?: string };
}) {
  const { paleta } = useTema();
  return (
    <View style={styles.fila}>
      <View style={styles.encabezado}>
        <View style={styles.identidad}>
          <View style={[styles.punto, estiloIdentidad]} />
          <Text style={[texto.etiqueta, { color: paleta.tinta }]} numberOfLines={1}>{nombre}</Text>
        </View>
        <View style={styles.numeros}>
          <Text style={[texto.precio, { color: paleta.tintaSuave }]}>No Disponible</Text>
        </View>
      </View>
    </View>
  );
}

function FilaSuper({
  opcion, delta, totalMejor, esMejor, estiloIdentidad, animar, demoraMs,
}: {
  opcion: OpcionSuper;
  delta: number;
  totalMejor: number;
  esMejor: boolean;
  estiloIdentidad: { backgroundColor: string; borderWidth?: number; borderColor?: string };
  animar: boolean;
  demoraMs: number;
}) {
  const { paleta } = useTema();
  const progreso = useRef(new Animated.Value(animar ? 0 : 1)).current;

  useEffect(() => {
    let cancelado = false;
    // El movimiento acá es funcional (la barra "mide" la diferencia), pero igual se respeta
    // la preferencia del sistema: con reduce motion aparece ya medida.
    AccessibilityInfo.isReduceMotionEnabled().then(reducir => {
      if (cancelado) return;
      if (!animar || reducir) return progreso.setValue(1);
      Animated.timing(progreso, {
        toValue: 1,
        duration: 520,
        delay: demoraMs,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false, // se anima width en %, que el native driver no soporta
      }).start();
    });
    return () => { cancelado = true; };
  }, [animar, demoraMs, progreso]);

  // "Cuánto % más caro que la mejor opción" — comparable entre productos y entre cantidad
  // de alternativas, a diferencia de normalizar contra la diferencia máxima (ver comentario
  // de arriba). Techo en 100% para que un caso extremo no rompa el layout.
  const porcentaje = totalMejor > 0 ? Math.min(100, (delta / totalMejor) * 100) : 0;
  // Raíz cuadrada, no lineal: en la práctica casi todas las diferencias reales caen entre 2%
  // y 15% (un segundo viaje rara vez duplica el precio), así que una escala lineal dejaba casi
  // todas las barras apiladas cerca del piso — se notaba la diferencia en el número ("+$90" vs
  // "+$970") pero no en el ancho de la barra, que es justamente lo que este componente existe
  // para resolver. La raíz cuadrada expande esa zona chica (4% → 20% de ancho, 15% → ~39%) sin
  // dejar de comprimir los extremos (100% sigue en 100%).
  const escalado = Math.sqrt(porcentaje / 100) * 100;
  const ancho = progreso.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', `${Math.max(escalado, delta > 0 ? 8 : 0)}%`],
  });

  return (
    <View style={styles.fila}>
      <View style={styles.encabezado}>
        <View style={styles.identidad}>
          <View style={[styles.punto, estiloIdentidad]} />
          <Text style={[texto.etiqueta, { color: paleta.tinta }]} numberOfLines={1}>
            {opcion.super}
          </Text>
          {opcion.promo?.esOnline ? <Marca texto="ONLINE" paleta={paleta} /> : null}
          {opcion.promo?.requiereTarjeta && opcion.promo.tarjetaActiva ? (
            <Marca texto="TARJETA" paleta={paleta} />
          ) : null}
        </View>

        <View style={styles.numeros}>
          <Text style={[texto.precio, { color: esMejor ? paleta.tinta : paleta.tintaSuave }]}>
            {pesos(opcion.total)}
          </Text>
        </View>
      </View>

      <View style={styles.pista}>
        {esMejor ? (
          <View style={[styles.insigniaMejor, { backgroundColor: paleta.oferta }]}>
            <Text style={[texto.micro, { color: paleta.ofertaTinta }]}>MÁS BARATO</Text>
          </View>
        ) : (
          <View style={styles.zonaBarra}>
            <View style={[styles.canal, { backgroundColor: paleta.superficie2 }]}>
              <Animated.View style={[styles.barra, { width: ancho, backgroundColor: paleta.tintaTenue }]} />
            </View>
            <Text style={[texto.etiqueta, { color: paleta.tintaSuave, letterSpacing: 0.2 }]}>+{pesos(delta)}</Text>
          </View>
        )}
      </View>

      {opcion.promo && opcion.promo.tarjetaActiva ? (
        <Text style={[texto.etiqueta, { color: paleta.tintaSuave, letterSpacing: 0.2 }]} numberOfLines={1}>
          {opcion.promo.descripcion}
          {opcion.promo.activa ? '' : ` · necesitás ${opcion.promo.cantidadMinima}`}
        </Text>
      ) : null}
    </View>
  );
}

function Marca({ texto: t, paleta }: { texto: string; paleta: ReturnType<typeof useTema>['paleta'] }) {
  return (
    <View style={[styles.marca, { borderColor: paleta.borde }]}>
      <Text style={[texto.tituloSeccion, { color: paleta.tintaSuave, fontSize: 9 }]}>{t}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  contenedor: { gap: espacio.md },
  fila: { gap: 5 },
  encabezado: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: espacio.sm },
  identidad: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 },
  punto: { width: 9, height: 9, borderRadius: radio.pill },
  numeros: { flexDirection: 'row', alignItems: 'baseline' },
  pista: { minHeight: 18, justifyContent: 'center' },
  zonaBarra: { flexDirection: 'row', alignItems: 'center', gap: espacio.sm },
  canal: { flex: 1, height: 6, borderRadius: radio.pill, overflow: 'hidden' },
  barra: { height: 6, borderRadius: radio.pill },
  insigniaMejor: { alignSelf: 'flex-start', paddingHorizontal: 7, paddingVertical: 3, borderRadius: radio.sm },
  marca: { paddingHorizontal: 5, paddingVertical: 1, borderRadius: radio.sm, borderWidth: 1 },
});
