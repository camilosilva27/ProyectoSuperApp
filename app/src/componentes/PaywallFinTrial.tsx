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
 * abajo). La acción principal sigue siendo suscribirse; la única alternativa es el bloque
 * "Invitá amigos" (`invitar`, 26/10): si el premio de referidos todavía se puede ganar, se ofrece
 * copiar el link (mismo link y mismas reglas que Ajustes › Invitá amigos, PLAN_REFERIDOS.md).
 * Con ese bloque la pantalla puede no entrar en alto, por eso ahora scrollea.
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  BackHandler, Platform, Pressable, ScrollView, StyleSheet, Text, View,
} from 'react-native';
import { copiarAlPortapapeles } from '../portapapeles';
import { espacio, fuentes, pesosCorto, radio, texto } from '../theme';
import { useTema } from '../useTema';

export function PaywallFinTrial({
  montoAhorradoTrial, conteoComparaciones, precioMensual, onSuscribirse,
  invitar = null,
  titulo = 'TERMINÓ TU MES DE PRUEBA',
  etiquetaPeriodo = 'este mes de prueba',
}: {
  montoAhorradoTrial: number;
  conteoComparaciones: number;
  precioMensual: number;
  /** Turnos 12/13: ya no crea la suscripción directo — avanza a `PlanSelect`, donde se elige
   *  el plan y se confirma el mail de Mercado Pago antes de crear nada. */
  onSuscribirse: () => void;
  /** Datos de referidos si el premio todavía se puede ganar; null oculta el bloque. */
  invitar?: { link: string; necesarias: number; validas: number; diasPremio: number } | null;
  titulo?: string;
  etiquetaPeriodo?: string;
}) {
  const { paleta } = useTema();

  // Sin salida por back ni por ningún otro botón: la única forma de avanzar es suscribirse.
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => sub.remove();
  }, []);

  const [aviso, setAviso] = useState<string | null>(null);
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (temporizador.current) clearTimeout(temporizador.current); }, []);
  const copiar = (link: string) => {
    copiarAlPortapapeles(link).then(ok => {
      setAviso(ok
        ? 'Copiamos tu link: pegalo donde quieras.'
        : 'No se pudo copiar. Mantené apretado el link para copiarlo.');
      if (temporizador.current) clearTimeout(temporizador.current);
      temporizador.current = setTimeout(() => setAviso(null), 3000);
    });
  };
  const premio = invitar && invitar.diasPremio % 30 === 0
    ? `${invitar.diasPremio / 30} meses`
    : `${invitar?.diasPremio ?? 0} días`;

  const montoTexto = pesosCorto(montoAhorradoTrial);
  const conteoTexto = `${conteoComparaciones} comparaci${conteoComparaciones === 1 ? 'ón' : 'ones'}`;

  return (
    <ScrollView
      style={{ backgroundColor: paleta.tinta }}
      contentContainerStyle={styles.pantalla}
    >
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
        <Pressable
          onPress={onSuscribirse}
          accessibilityRole="button"
          style={({ pressed }) => [
            styles.botonPrincipal,
            { backgroundColor: paleta.oferta, opacity: pressed ? 0.8 : 1 },
          ]}
        >
          <Text style={[styles.textoBotonPrincipal, { color: paleta.ofertaTinta }]}>
            SEGUIR AHORRANDO
          </Text>
          <Text style={[styles.subtextoBotonPrincipal, { color: paleta.ofertaTinta }]}>
            desde {pesosCorto(precioMensual)} por mes
          </Text>
        </Pressable>
      </View>

      {invitar ? (
        <View style={styles.bloqueInvitar}>
          <Text style={[texto.tituloSeccion, { color: paleta.oferta, letterSpacing: 1.2 }]}>
            O SEGUÍ GRATIS
          </Text>
          <Text style={[styles.tituloInvitar, { color: '#FFFFFF' }]}>
            Invitá a {invitar.necesarias} amigos y llevate{' '}
            <Text style={{ color: paleta.oferta }}>{premio} gratis</Text>
          </Text>
          <Text style={[texto.cuerpo, styles.textoTenueOscuro]}>
            Cuando {invitar.necesarias} amigos se registren con tu link y hagan su primera comparación,
            te llevás {premio} gratis.
            {invitar.validas > 0 ? ` Ya llevás ${Math.min(invitar.validas, invitar.necesarias)} de ${invitar.necesarias}.` : ''}
          </Text>
          <Text selectable numberOfLines={1} style={[texto.etiqueta, styles.link]}>
            {invitar.link.replace(/^https?:\/\//, '')}
          </Text>
          <Pressable
            onPress={() => copiar(invitar.link)}
            accessibilityRole="button"
            style={({ pressed }) => [styles.botonSecundario, { opacity: pressed ? 0.7 : 1 }]}
          >
            <Text style={styles.textoBotonSecundario}>Copiar link</Text>
          </Pressable>
          {aviso ? <Text style={[texto.etiqueta, styles.textoTenueOscuro]}>{aviso}</Text> : null}
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  pantalla: { flexGrow: 1, paddingTop: 40, paddingHorizontal: 24, paddingBottom: 34 },
  tituloTope: { color: '#C6CCD3', letterSpacing: 1.2 },
  bloqueCentral: { flex: 1, justifyContent: 'center', paddingVertical: espacio.xl, gap: 26 },
  textoBlanco: { color: '#FFFFFF' },
  textoBlancoGrande: { color: '#FFFFFF', fontSize: 17, lineHeight: 24 },
  textoTenueOscuro: { color: '#C6CCD3' },
  montoTrial: { fontFamily: fuentes.precio, fontSize: 76, lineHeight: 66 },
  divisoria: { height: 1, backgroundColor: 'rgba(255,255,255,.18)' },
  precioDestacado: { fontFamily: fuentes.semi },
  pie: { gap: espacio.xs + 2 },
  bloqueInvitar: {
    marginTop: espacio.xl, padding: espacio.lg, gap: espacio.sm, borderRadius: radio.tarjeta,
    borderWidth: 1, borderColor: 'rgba(255,255,255,.18)',
  },
  tituloInvitar: { fontFamily: fuentes.semi, fontSize: 20, lineHeight: 26 },
  link: {
    color: '#FFFFFF', backgroundColor: 'rgba(255,255,255,.08)', borderRadius: radio.md,
    paddingHorizontal: 14, paddingVertical: 12, overflow: 'hidden',
  },
  botonSecundario: {
    borderRadius: radio.md, minHeight: 48, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5, borderColor: '#FFFFFF',
  },
  textoBotonSecundario: { fontFamily: fuentes.semi, fontSize: 16, color: '#FFFFFF' },
  botonPrincipal: {
    borderRadius: radio.md, minHeight: 58, alignItems: 'center', justifyContent: 'center', gap: 2,
  },
  textoBotonPrincipal: { fontFamily: fuentes.precio, fontSize: 24, lineHeight: 26, letterSpacing: 1 },
  subtextoBotonPrincipal: { fontFamily: fuentes.medio, fontSize: 12, lineHeight: 14 },
});
