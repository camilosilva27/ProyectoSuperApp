/**
 * Pantalla "Mis ahorros" (PANTALLAS-ahorros-y-paywall.md § Pantalla 1): historial de cuánto
 * fue ahorrando el usuario al repartir la compra en vez de comprar todo en un solo super.
 * Pantalla libre, no bloquea nada — a diferencia de la de fin de trial (ver
 * `src/componentes/PaywallFinTrial.tsx`), esta no depende de cuentas ni de cobro.
 *
 * Regla de transparencia (no negociable, ver el .md de arriba): el ahorro se calcula sobre
 * cada comparación vista, no sobre compras confirmadas, así que la cantidad de comparaciones
 * viaja siempre pegada al monto, nunca en letra chica aparte.
 */

import Head from 'expo-router/head';
import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Vacio } from '../../src/componentes/comunes';
import { HeaderNegro, TituloHeader } from '../../src/componentes/HeaderNegro';
import {
  calcularResumenAhorro, useHistorialAhorro, type ResumenAhorro, type ResumenMes,
} from '../../src/historialAhorro';
import { espacio, fuentes, pesosCorto, radio, texto, type Paleta } from '../../src/theme';
import { useTema } from '../../src/useTema';

const NOMBRES_MES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];
const SIGLAS_MES = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'];

// Fijos (no dependen del tema claro/oscuro), tal como los da el mockup: el mes en curso tiene
// que leerse primero sin perder la escala de amarillo, y la pista es un gris propio de esta
// pantalla, no uno de los tokens de `theme.ts`.
const AMARILLO_APAGADO = '#E4C74A';
const PISTA_BARRA = '#F0F2F4';

function textoComparaciones(conteo: number): string {
  return `${conteo} comparaci${conteo === 1 ? 'ón' : 'ones'}`;
}

export default function PantallaAhorros() {
  const { paleta } = useTema();
  const insets = useSafeAreaInsets();
  const { eventos } = useHistorialAhorro();
  const resumen = useMemo(() => calcularResumenAhorro(eventos), [eventos]);
  const sinHistorial = resumen.totalConteo === 0;

  const subtituloHeader = sinHistorial
    ? 'El ahorro aparece después de tu primera comparación de precios.'
    : `en ${textoComparaciones(resumen.totalConteo)}, desde ${desdeMesTexto(resumen)}`;

  return (
    <View style={{ flex: 1, backgroundColor: paleta.fondo }}>
      <Head><title>Mis ahorros - Super App</title></Head>
      <HeaderNegro paddingTop={insets.top + 32} estilo={{ paddingBottom: 22, gap: 14 }}>
        <TituloHeader>MIS AHORROS</TituloHeader>
        <View
          style={{ gap: 6 }}
          accessibilityLabel={
            sinHistorial
              ? 'Todavía no ahorraste nada'
              : `Ahorraste ${pesosCorto(resumen.totalMonto)} en ${textoComparaciones(resumen.totalConteo)}`
          }
        >
          <Text style={[texto.tituloSeccion, { color: paleta.oferta }]}>Desde que usás Super App</Text>
          <Text style={[styles.montoTotal, { color: paleta.oferta }]}>{pesosCorto(resumen.totalMonto)}</Text>
          <Text style={[texto.cuerpoMedio, { color: '#FFFFFF' }]}>{subtituloHeader}</Text>
        </View>
      </HeaderNegro>

      {sinHistorial ? (
        <Vacio
          titulo="Todavía no hay ahorro que mostrar"
          detalle="Compará precios desde Buscar y acá vas a ver cuánto fuiste ahorrando."
        />
      ) : (
        <ScrollView contentContainerStyle={[styles.cuerpo, { paddingBottom: insets.bottom + espacio.xl }]}>
          <SeccionMesActualYAnterior resumen={resumen} paleta={paleta} />
          {resumen.tieneHistorialSuficiente ? (
            <SeccionMesAMes ultimosMeses={resumen.ultimosMeses} paleta={paleta} />
          ) : null}
          <Text style={[texto.prosa, { color: paleta.tintaProsa }]}>
            Cada comparación suma la diferencia entre el plan más barato y comprar todo en un solo super.
          </Text>
        </ScrollView>
      )}
    </View>
  );
}

function desdeMesTexto(resumen: ResumenAhorro): string {
  if (!resumen.primerMes) return '';
  const mismoAnio = resumen.primerMes.anio === new Date().getFullYear();
  return `${NOMBRES_MES[resumen.primerMes.mes]}${mismoAnio ? '' : ` de ${resumen.primerMes.anio}`}`;
}

/** "Este mes y el anterior" (§ Pantalla 1 · a): dos montos del mismo tamaño a propósito — son
 *  comparables entre sí, y el borde amarillo es lo único que marca cuál es el mes en curso. */
function SeccionMesActualYAnterior({ resumen, paleta }: { resumen: ResumenAhorro; paleta: Paleta }) {
  const hayAnterior = resumen.tieneHistorialSuficiente && !!resumen.mesAnterior;

  return (
    <View style={{ gap: espacio.sm }}>
      <Text style={[texto.tituloSeccion, styles.labelSeccion, { color: paleta.tintaSuave }]}>
        {hayAnterior ? 'ESTE MES Y EL ANTERIOR' : 'ESTE MES'}
      </Text>
      <View style={styles.filaMeses}>
        <TarjetaMes mes={resumen.mesActual} actual paleta={paleta} />
        {hayAnterior && resumen.mesAnterior ? (
          <TarjetaMes mes={resumen.mesAnterior} actual={false} paleta={paleta} />
        ) : null}
      </View>
    </View>
  );
}

function TarjetaMes({ mes, actual, paleta }: { mes: ResumenMes; actual: boolean; paleta: Paleta }) {
  return (
    <View
      style={[
        styles.tarjetaMes,
        actual ? { borderWidth: 2, borderColor: paleta.oferta } : { borderWidth: 1, borderColor: paleta.borde },
      ]}
    >
      <Text style={[texto.tituloSeccion, { color: actual ? paleta.tinta : paleta.tintaSuave }]}>
        {NOMBRES_MES[mes.mes].toUpperCase()}
      </Text>
      <Text style={[styles.montoMes, { color: paleta.tinta }]}>{pesosCorto(mes.monto)}</Text>
      <Text style={[styles.conteoMes, { color: actual ? paleta.tinta : paleta.tintaProsa }]}>
        en {textoComparaciones(mes.conteo)}
      </Text>
    </View>
  );
}

/** "Mes a mes" (§ Pantalla 1 · b): barra proporcional al mes más alto de los 6, mes en curso
 *  en amarillo pleno y el resto en el amarillo apagado para que se lea primero sin más texto. */
function SeccionMesAMes({ ultimosMeses, paleta }: { ultimosMeses: ResumenMes[]; paleta: Paleta }) {
  const ahora = new Date();
  const claveActual = `${ahora.getFullYear()}-${ahora.getMonth()}`;
  const montoMax = Math.max(1, ...ultimosMeses.map(m => m.monto));

  return (
    <View style={{ gap: espacio.sm }}>
      <Text style={[texto.tituloSeccion, styles.labelSeccion, { color: paleta.tintaSuave }]}>MES A MES</Text>
      <View style={{ gap: espacio.md }}>
        {ultimosMeses.map(mes => {
          const esActual = `${mes.anio}-${mes.mes}` === claveActual;
          const ancho = `${Math.max(4, Math.round((mes.monto / montoMax) * 100))}%` as const;
          return (
            <View key={`${mes.anio}-${mes.mes}`} style={styles.filaMesAMes}>
              <Text
                style={[
                  styles.siglaMes,
                  {
                    color: esActual ? paleta.tinta : paleta.tintaSuave,
                    fontFamily: esActual ? fuentes.titulo : fuentes.semi,
                  },
                ]}
              >
                {SIGLAS_MES[mes.mes]}
              </Text>
              <View style={{ flex: 1, gap: 5 }}>
                <View style={styles.filaMontoConteo}>
                  <Text
                    style={[
                      esActual ? styles.montoMesActual : styles.montoMesOtro,
                      { fontFamily: esActual ? fuentes.precio : fuentes.precioMedio, color: paleta.tinta },
                    ]}
                  >
                    {pesosCorto(mes.monto)}
                  </Text>
                  <Text style={[texto.etiqueta, { color: esActual ? paleta.tinta : paleta.tintaSuave, letterSpacing: 0.2 }]}>
                    {mes.conteo} comp.
                  </Text>
                </View>
                <View style={[styles.pistaBarra, { backgroundColor: PISTA_BARRA }]}>
                  <View
                    style={[
                      styles.rellenoBarra,
                      { width: ancho, backgroundColor: esActual ? paleta.oferta : AMARILLO_APAGADO },
                    ]}
                  />
                </View>
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  cuerpo: { padding: espacio.pantalla, gap: espacio.xl },
  montoTotal: { fontFamily: fuentes.precio, fontSize: 60, lineHeight: 54 },
  labelSeccion: { letterSpacing: 1.2 },
  filaMeses: { flexDirection: 'row', gap: 10 },
  tarjetaMes: { flex: 1, borderRadius: radio.tarjeta, padding: 14, gap: 8 },
  montoMes: { fontFamily: fuentes.precio, fontSize: 34, lineHeight: 32 },
  conteoMes: { fontFamily: fuentes.medio, fontSize: 14, lineHeight: 19 },
  filaMesAMes: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  siglaMes: { width: 34, fontSize: 11, lineHeight: 14, letterSpacing: 0.5 },
  filaMontoConteo: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  montoMesActual: { fontSize: 17, lineHeight: 16 },
  montoMesOtro: { fontSize: 15, lineHeight: 16 },
  pistaBarra: { height: 8, borderRadius: radio.pill, overflow: 'hidden' },
  rellenoBarra: { height: 8, borderRadius: radio.pill },
});
