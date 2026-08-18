/**
 * Pantalla de fin del período de prueba (PANTALLAS-ahorros-y-paywall.md § Pantalla 2).
 *
 * DESACTIVADA A PROPÓSITO: existe como componente pero no está enrutada en ningún lado —
 * no hay `Stack.Screen` en `app/_layout.tsx` que la muestre, y nada dispara su apertura. Depende
 * de Fase 2 de Plan_Usuarios_y_cobros.md (cuenta obligatoria + trial + Mercado Pago), que
 * todavía no está implementada: sin eso no hay forma real de saber cuándo terminó el trial de
 * un usuario. Cuando esa fase exista, esta pantalla se conecta como el gate que se muestra al
 * vencer `trial_termina_en` con `plan='gratis'` y sin suscripción.
 *
 * Bloqueante por diseño: sin botón de cerrar, sin X, sin gesto de back (ver `BackHandler`
 * abajo), sin scroll. El que la monte más adelante decide cómo evitar la tab bar (ej. como
 * pantalla de `Stack` con `headerShown: false` fuera de `(tabs)`, igual que `resultado.tsx`).
 */

import React, { useEffect } from 'react';
import { BackHandler, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { espacio, fuentes, pesosCorto, radio, texto } from '../theme';
import { useTema } from '../useTema';

export function PaywallFinTrial({
  montoAhorradoTrial, conteoComparaciones, precioMensual, onSuscribirse, onContinuarGratis,
}: {
  montoAhorradoTrial: number;
  conteoComparaciones: number;
  precioMensual: number;
  onSuscribirse: () => void;
  onContinuarGratis: () => void;
}) {
  const { paleta } = useTema();

  // Sin salida por back: la única forma de avanzar es elegir una de las dos opciones del pie.
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => sub.remove();
  }, []);

  const montoTexto = pesosCorto(montoAhorradoTrial);
  const conteoTexto = `${conteoComparaciones} comparaci${conteoComparaciones === 1 ? 'ón' : 'ones'}`;

  return (
    <View style={[styles.pantalla, { backgroundColor: paleta.tinta }]}>
      <Text style={[texto.tituloSeccion, styles.tituloTope]}>TERMINÓ TU MES DE PRUEBA</Text>

      <View style={styles.bloqueCentral}>
        <View
          style={{ gap: 10 }}
          accessibilityLabel={`Ahorraste ${montoTexto} en ${conteoTexto}`}
        >
          <Text style={[texto.subtitulo, styles.textoBlanco]}>Ahorraste</Text>
          <Text style={[styles.montoTrial, { color: paleta.oferta }]}>{montoTexto}</Text>
          <Text style={[texto.cuerpoMedio, styles.textoBlancoGrande]}>
            en {conteoTexto}, este mes de prueba.
          </Text>
        </View>

        <View style={styles.divisoria} />

        <View style={{ gap: 6 }}>
          <Text style={[texto.cuerpoMedio, styles.textoBlancoGrande]}>
            Por <Text style={styles.precioDestacado}>{pesosCorto(precioMensual)}</Text> al mes podés seguir
            comparando y seguir ahorrándolo.
          </Text>
          <Text style={[texto.cuerpo, styles.textoTenueOscuro]}>
            Cancelás cuando quieras desde Ajustes.
          </Text>
        </View>
      </View>

      <View style={styles.pie}>
        <Pressable
          onPress={onSuscribirse}
          accessibilityRole="button"
          style={({ pressed }) => [
            styles.botonPrincipal,
            { backgroundColor: paleta.oferta, opacity: pressed ? 0.9 : 1 },
          ]}
        >
          <Text style={[styles.textoBotonPrincipal, { color: paleta.ofertaTinta }]}>
            SEGUIR AHORRANDO
          </Text>
          <Text style={[styles.subtextoBotonPrincipal, { color: paleta.ofertaTinta }]}>
            {pesosCorto(precioMensual)} por mes
          </Text>
        </Pressable>

        <Pressable
          onPress={onContinuarGratis}
          accessibilityRole="button"
          style={({ pressed }) => [styles.salidaSecundaria, { opacity: pressed ? 0.7 : 1 }]}
        >
          <Text style={[texto.cuerpoMedio, styles.textoSalida]}>Continuar en el plan gratis</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  pantalla: { flex: 1, paddingTop: 40, paddingHorizontal: 24 },
  tituloTope: { color: '#C6CCD3', letterSpacing: 1.2 },
  bloqueCentral: { flex: 1, justifyContent: 'center', paddingVertical: espacio.xl, gap: 26 },
  textoBlanco: { color: '#FFFFFF' },
  textoBlancoGrande: { color: '#FFFFFF', fontSize: 17, lineHeight: 24 },
  textoTenueOscuro: { color: '#C6CCD3' },
  montoTrial: { fontFamily: fuentes.precio, fontSize: 76, lineHeight: 66 },
  divisoria: { height: 1, backgroundColor: 'rgba(255,255,255,.18)' },
  precioDestacado: { fontFamily: fuentes.semi },
  pie: { paddingBottom: 34, gap: espacio.xs + 2 },
  botonPrincipal: {
    borderRadius: radio.md, minHeight: 58, alignItems: 'center', justifyContent: 'center', gap: 2,
  },
  textoBotonPrincipal: { fontFamily: fuentes.precio, fontSize: 24, lineHeight: 26, letterSpacing: 1 },
  subtextoBotonPrincipal: { fontFamily: fuentes.medio, fontSize: 12, lineHeight: 14 },
  salidaSecundaria: { minHeight: 52, alignItems: 'center', justifyContent: 'center' },
  textoSalida: { color: '#C6CCD3', textDecorationLine: 'underline' },
});
