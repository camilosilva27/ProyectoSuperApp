/**
 * Pantalla de bloqueo por falta de plan pago (PANTALLAS-ahorros-y-paywall.md § Pantalla 2,
 * con un cambio de alcance decidido por el usuario el 2026-08-21: sin pagar no se usa la app,
 * salvo estar dentro del trial — no existe un "plan gratis" navegable. Por eso ya no tiene
 * salida sin pagar: se sacó "Continuar en el plan gratis" a propósito.
 *
 * Montada por `GatePaywallFinTrial.tsx`, que decide cuándo mostrarla — ver ese archivo para el
 * criterio completo (cubre tanto fin de trial sin pagar nunca como cancelación de un premium
 * previo, con textos distintos vía `titulo`/`etiquetaPeriodo`).
 *
 * Bloqueante por diseño: sin botón de cerrar, sin X, sin gesto de back (ver `BackHandler`
 * abajo), sin scroll, y ahora con una sola acción posible en el pie.
 */

import React, { useEffect } from 'react';
import {
  ActivityIndicator, BackHandler, Platform, Pressable, StyleSheet, Text, View,
} from 'react-native';
import { espacio, fuentes, pesosCorto, radio, texto } from '../theme';
import { useTema } from '../useTema';

export function PaywallFinTrial({
  montoAhorradoTrial, conteoComparaciones, precioMensual, onSuscribirse,
  titulo = 'TERMINÓ TU MES DE PRUEBA',
  etiquetaPeriodo = 'este mes de prueba',
  enviando = false,
  error = null,
}: {
  montoAhorradoTrial: number;
  conteoComparaciones: number;
  precioMensual: number;
  onSuscribirse: () => void;
  titulo?: string;
  etiquetaPeriodo?: string;
  /** true mientras se espera la respuesta de crear la suscripción, antes de abrir el checkout. */
  enviando?: boolean;
  /** Si crear la suscripción falla (red, backend, Mercado Pago), qué mostrar debajo del botón —
   *  sin esto no había ninguna señal visible de que el toque no llevó a ningún lado. */
  error?: string | null;
}) {
  const { paleta } = useTema();

  // Sin salida por back ni por ningún otro botón: la única forma de avanzar es suscribirse.
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => sub.remove();
  }, []);

  const montoTexto = pesosCorto(montoAhorradoTrial);
  const conteoTexto = `${conteoComparaciones} comparaci${conteoComparaciones === 1 ? 'ón' : 'ones'}`;

  return (
    <View style={[styles.pantalla, { backgroundColor: paleta.tinta }]}>
      <Text style={[texto.tituloSeccion, styles.tituloTope]}>{titulo}</Text>

      <View style={styles.bloqueCentral}>
        <View
          style={{ gap: 10 }}
          accessibilityLabel={`Ahorraste ${montoTexto} en ${conteoTexto}`}
        >
          <Text style={[texto.subtitulo, styles.textoBlanco]}>Ahorraste</Text>
          <Text style={[styles.montoTrial, { color: paleta.oferta }]}>{montoTexto}</Text>
          <Text style={[texto.cuerpoMedio, styles.textoBlancoGrande]}>
            en {conteoTexto}, {etiquetaPeriodo}.
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
        {error && (
          <Text style={[texto.cuerpo, styles.textoError]}>{error}</Text>
        )}
        <Pressable
          onPress={onSuscribirse}
          disabled={enviando}
          accessibilityRole="button"
          style={({ pressed }) => [
            styles.botonPrincipal,
            { backgroundColor: paleta.oferta, opacity: pressed || enviando ? 0.8 : 1 },
          ]}
        >
          {enviando ? (
            <ActivityIndicator color={paleta.ofertaTinta} />
          ) : (
            <>
              <Text style={[styles.textoBotonPrincipal, { color: paleta.ofertaTinta }]}>
                SEGUIR AHORRANDO
              </Text>
              <Text style={[styles.subtextoBotonPrincipal, { color: paleta.ofertaTinta }]}>
                {pesosCorto(precioMensual)} por mes
              </Text>
            </>
          )}
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
  textoError: { color: '#FF8A80', textAlign: 'center' },
  botonPrincipal: {
    borderRadius: radio.md, minHeight: 58, alignItems: 'center', justifyContent: 'center', gap: 2,
  },
  textoBotonPrincipal: { fontFamily: fuentes.precio, fontSize: 24, lineHeight: 26, letterSpacing: 1 },
  subtextoBotonPrincipal: { fontFamily: fuentes.medio, fontSize: 12, lineHeight: 14 },
});
