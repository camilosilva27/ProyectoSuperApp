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
 *
 * También vive acá el aviso de "hay una promo de tarjeta sin activar" (`promo.tarjetaActiva
 * === false`): no hace falta elegir tarjetas antes de comparar — cualquier promo de tarjeta
 * propia que exista se muestra igual, con el precio que tendría, y tocándola se activa esa
 * tarjeta para el usuario y se recalcula. El total que se ve arriba nunca la cuenta hasta
 * que se activa.
 */

import React, { useEffect, useRef } from 'react';
import { AccessibilityInfo, Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import type { OpcionSuper } from '../api';
import { espacio, pesos, radio, texto } from '../theme';
import { useTema } from '../useTema';

type Props = {
  /** Ya ordenadas de más barata a más cara (así las devuelve el backend). */
  opciones: OpcionSuper[];
  /** Se anima solo la primera vez que aparece; en re-render no vuelve a medirse. */
  animar?: boolean;
  demoraMs?: number;
  /** Se llama cuando el usuario toca el aviso de "activar esta tarjeta". */
  onActivarTarjeta?: (tarjeta: string) => void;
};

export function BarraDiferencia({ opciones, animar = true, demoraMs = 0, onActivarTarjeta }: Props) {
  const { paleta } = useTema();

  if (!opciones.length) return null;

  const mejor = opciones[0];

  return (
    <View style={styles.contenedor}>
      {opciones.map((opcion, i) => (
        <FilaSuper
          key={opcion.key}
          opcion={opcion}
          delta={opcion.total - mejor.total}
          totalMejor={mejor.total}
          esMejor={i === 0}
          colorIdentidad={paleta.supers[opcion.key]}
          animar={animar}
          demoraMs={demoraMs + i * 70}
          onActivarTarjeta={onActivarTarjeta}
        />
      ))}
    </View>
  );
}

function FilaSuper({
  opcion, delta, totalMejor, esMejor, colorIdentidad, animar, demoraMs, onActivarTarjeta,
}: {
  opcion: OpcionSuper;
  delta: number;
  totalMejor: number;
  esMejor: boolean;
  colorIdentidad: string;
  animar: boolean;
  demoraMs: number;
  onActivarTarjeta?: (tarjeta: string) => void;
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
  const ancho = progreso.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', `${Math.max(porcentaje, delta > 0 ? 4 : 0)}%`],
  });

  return (
    <View style={styles.fila}>
      <View style={styles.encabezado}>
        <View style={styles.identidad}>
          <View style={[styles.punto, { backgroundColor: colorIdentidad }]} />
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
            <View style={[styles.canal, { backgroundColor: paleta.superficieAlt }]}>
              <Animated.View style={[styles.barra, { width: ancho, backgroundColor: paleta.tintaTenue }]} />
            </View>
            <Text style={[texto.dato, { color: paleta.tintaTenue }]}>+{pesos(delta)}</Text>
          </View>
        )}
      </View>

      {opcion.promo && opcion.promo.tarjetaActiva ? (
        <Text style={[texto.dato, { color: paleta.tintaTenue }]} numberOfLines={1}>
          {opcion.promo.descripcion}
          {opcion.promo.activa ? '' : ` · necesitás ${opcion.promo.cantidadMinima}`}
        </Text>
      ) : null}

      {opcion.promo && !opcion.promo.tarjetaActiva && opcion.promo.requiereTarjeta ? (
        <Pressable
          onPress={() => onActivarTarjeta?.(opcion.promo!.requiereTarjeta!)}
          accessibilityRole="button"
          accessibilityLabel={`Activar ${opcion.promo.requiereTarjeta} para pagar ${pesos(opcion.totalConTarjeta)} en ${opcion.super}`}
          style={({ pressed }) => [
            styles.avisoTarjeta,
            { backgroundColor: paleta.ofertaSuave, borderColor: paleta.oferta, opacity: pressed ? 0.7 : 1 },
          ]}
        >
          <View style={styles.avisoTarjetaTexto}>
            <Text style={[texto.etiqueta, { color: paleta.tinta }]} numberOfLines={1}>
              Con {opcion.promo.requiereTarjeta}: {pesos(opcion.totalConTarjeta)}
            </Text>
            <Text style={[texto.dato, { color: paleta.tintaSuave }]} numberOfLines={1}>
              {opcion.promo.descripcion} · tocá para activarla
            </Text>
          </View>
          <Text style={[texto.subtitulo, { color: paleta.tinta }]}>›</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function Marca({ texto: t, paleta }: { texto: string; paleta: ReturnType<typeof useTema>['paleta'] }) {
  return (
    <View style={[styles.marca, { borderColor: paleta.borde }]}>
      <Text style={[texto.micro, { color: paleta.tintaTenue, fontSize: 9 }]}>{t}</Text>
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
  avisoTarjeta: {
    flexDirection: 'row', alignItems: 'center', gap: espacio.sm,
    borderWidth: 1, borderRadius: radio.sm, padding: espacio.sm,
  },
  avisoTarjetaTexto: { flex: 1, gap: 1 },
});
