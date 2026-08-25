/**
 * Logo real de cada super (assets/logos/), siempre sobre placa blanca: varios son de un solo
 * color y desaparecen contra el header negro o un fondo oscuro. `contain`, sin recolorear ni
 * recortar — son marcas de terceros, se usan tal como vienen.
 *
 * Carrefour/Día/Coto/Disco son .svg (ver metro.config.js — react-native-svg-transformer los
 * importa como componente React, no como asset); Vea/Chango Más/Jumbo son .png (expo-image).
 * El `preserveAspectRatio` default de SVG ("xMidYMid meet") ya se comporta como `contain`, así
 * que alcanza con darle alto fijo y ancho 100% igual que a la versión PNG.
 */

import { Image } from 'expo-image';
import React from 'react';
import { StyleSheet, View } from 'react-native';
import type { SuperKey } from '../api';
import CarrefourLogo from '../../assets/logos/carrefour.svg';
import CotoLogo from '../../assets/logos/coto.svg';
import DiaLogo from '../../assets/logos/dia.svg';
import DiscoLogo from '../../assets/logos/disco.svg';
import { NOMBRE_SUPER } from './comunes';

const LOGOS_VECTOR: Partial<Record<SuperKey, React.FC<{ width?: number | string; height?: number | string }>>> = {
  carr: CarrefourLogo,
  dia: DiaLogo,
  coto: CotoLogo,
  disco: DiscoLogo,
};

const LOGOS_RASTER: Partial<Record<SuperKey, number>> = {
  vea: require('../../assets/logos/vea.png'),
  changomas: require('../../assets/logos/changomas.png'),
  jumbo: require('../../assets/logos/jumbo.png'),
};

/** El logo solo, sin placa — para cuando el caller ya arma su propio fondo blanco alrededor. */
export function LogoSuper({ superKey, alto }: { superKey: SuperKey; alto: number }) {
  const Vector = LOGOS_VECTOR[superKey];
  return (
    // El SVG (react-native-svg-transformer) no acepta accessibilityLabel de forma confiable
    // en web, así que el nombre accesible va en este contenedor, no en el logo en sí.
    <View
      style={{ width: '100%', height: alto }}
      accessibilityRole="image"
      accessibilityLabel={`Logo de ${NOMBRE_SUPER[superKey]}`}
    >
      {Vector ? (
        <Vector width="100%" height={alto} />
      ) : (
        <Image
          source={LOGOS_RASTER[superKey]}
          style={{ width: '100%', height: alto }}
          contentFit="contain"
        />
      )}
    </View>
  );
}

/**
 * Logo + placa blanca, el patrón que se repite en el selector y la hoja de selección.
 * `ancho` fijo (celda del selector, fila de la hoja) o `'100%'` (celda del header, que ya
 * viene angosta por el `flex: 1` del padre). `padding` deja aire entre el logo y el borde de
 * la placa cuando esta tiene un tamaño fijo chico (la hoja: 54×22, padding 2).
 */
export function PlacaLogoSuper({
  superKey, ancho, alto, padding = 0, radio: radioPlaca,
}: {
  superKey: SuperKey; ancho: number | '100%'; alto: number; padding?: number; radio: number;
}) {
  return (
    <View style={[styles.placa, { width: ancho, height: alto, padding, borderRadius: radioPlaca }]}>
      <LogoSuper superKey={superKey} alto={alto - padding * 2} />
    </View>
  );
}

const styles = StyleSheet.create({
  placa: {
    backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
});
