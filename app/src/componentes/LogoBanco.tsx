/**
 * Logo de banco/tarjeta para la grilla de promos (turno 17). Mismo patrón que LogoSuper.tsx:
 * mapa indexado por el nombre canónico (el de ALIAS_TARJETAS en AllPromos/promos-bancarias.js,
 * no el slug del archivo — ej. "Banco Macro", no "Macro"), `contain`, sin recolorear ni recortar
 * — son marcas de terceros.
 *
 * 22 de los ~25 canónicos posibles tienen logo bajado (20 SVG + MODO/Cuenta DNI en PNG — ningún
 * sitio oficial ofrece esas dos en vectorial, solo raster, mismo patrón LOGOS_RASTER que
 * LogoSuper.tsx con `expo-image`). El resto cae en el fallback de iniciales, que no bloquea el turno.
 */

import { Image } from 'expo-image';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import BancoCiudadLogo from '../../assets/logos-bancos/banco-ciudad.svg';
import BancoColumbiaLogo from '../../assets/logos-bancos/banco-columbia.svg';
import BancoNacionLogo from '../../assets/logos-bancos/banco-nacion.svg';
import BancoPatagoniaLogo from '../../assets/logos-bancos/banco-patagonia.svg';
import BancoProvinciaLogo from '../../assets/logos-bancos/banco-provincia.svg';
import BbvaLogo from '../../assets/logos-bancos/bbva.svg';
import CarrefourLogo from '../../assets/logos-bancos/carrefour.svg';
import CencopayLogo from '../../assets/logos-bancos/cencopay.svg';
import ComafiLogo from '../../assets/logos-bancos/comafi.svg';
import CredicoopLogo from '../../assets/logos-bancos/credicoop.svg';
import GaliciaLogo from '../../assets/logos-bancos/galicia.svg';
import HsbcLogo from '../../assets/logos-bancos/hsbc.svg';
import IcbcLogo from '../../assets/logos-bancos/icbc.svg';
import MacroLogo from '../../assets/logos-bancos/macro.svg';
import MasClubLogo from '../../assets/logos-bancos/masclub.svg';
import MercadoPagoLogo from '../../assets/logos-bancos/mercado-pago.svg';
import NaranjaXLogo from '../../assets/logos-bancos/naranja-x.svg';
import SantanderLogo from '../../assets/logos-bancos/santander.svg';
import SupervielleLogo from '../../assets/logos-bancos/supervielle.svg';
import TciLogo from '../../assets/logos-bancos/tci.svg';
import { texto } from '../theme';
import { useTema } from '../useTema';

const LOGOS_VECTOR: Record<string, React.FC<{ width?: number | string; height?: number | string }>> = {
  'Galicia': GaliciaLogo,
  'Galicia Modo': GaliciaLogo,
  'BBVA': BbvaLogo,
  'Banco Macro': MacroLogo,
  'Banco Nación': BancoNacionLogo,
  'Santander': SantanderLogo,
  'HSBC': HsbcLogo,
  'Banco Ciudad': BancoCiudadLogo,
  'Mercado Pago': MercadoPagoLogo,
  'Banco Provincia': BancoProvinciaLogo,
  'Mi Carrefour': CarrefourLogo,
  'Cuenta Digital Carrefour': CarrefourLogo,
  'Tarjeta Carrefour Crédito': CarrefourLogo,
  'MasClub': MasClubLogo,
  'ICBC': IcbcLogo,
  'Comafi': ComafiLogo,
  'Naranja X': NaranjaXLogo,
  'Credicoop': CredicoopLogo,
  'Supervielle': SupervielleLogo,
  'Banco Columbia': BancoColumbiaLogo,
  'Banco Patagonia': BancoPatagoniaLogo,
  'Cencopay': CencopayLogo,
  'TCI': TciLogo,
};

const LOGOS_RASTER: Record<string, number> = {
  'MODO': require('../../assets/logos-bancos/modo.png'),
  'Cuenta DNI': require('../../assets/logos-bancos/cuenta-dni.png'),
};

// El fondo gris suave (`paleta.superficieAlt`) no alcanza para MasClub: el "Más" de su isologo
// es blanco puro, pensado para un fondo de marca oscuro, y sobre gris claro sigue sin leerse.
// Fijo (no depende de `paleta`) porque el problema es de contraste con el logo en sí, no del
// tema claro/oscuro de la app.
const FONDOS_OSCUROS: Record<string, string> = {
  'MasClub': '#1A1A1A',
};

// El isologo de MODO (wordmark) viene con muy poco margen propio alrededor de las letras, así
// que a igual caja se ve notablemente más grande que el resto (isotipos de banco, más compactos)
// — no es un problema de la imagen en sí, achicamos el % que ocupa dentro de su caja para que
// quede visualmente parejo con los demás.
const ESCALAS: Record<string, number> = {
  'MODO': 0.75,
};

function iniciales(nombreBanco: string): string {
  const palabras = nombreBanco.split(' ').filter(Boolean);
  const relevantes = palabras.filter(p => !['de', 'del', 'la', 'los'].includes(p.toLowerCase()));
  return (relevantes.length ? relevantes : palabras).slice(0, 2).map(p => p[0]).join('').toUpperCase();
}

/** El logo solo, o un chip con iniciales si todavía no hay SVG para ese banco.
 *
 *  `ancho`/`alto` son una CAJA fija, no solo un alto: bajamos logos de fuentes muy distintas
 *  (isotipos cuadrados como Banco Nación, wordmarks apaisados como Cencopay/Carrefour) y varios
 *  no traen un `viewBox` limpio — pasarles solo `alto` y `width="100%"` (versión anterior) los
 *  dejaba escalar sin límite de ancho real, así que un logo apaisado se salía de la celda y
 *  rompía la grilla entera. Acá el contenedor tiene ancho Y alto fijos con `overflow: hidden`
 *  como garantía dura: pase lo que pase con el `viewBox` del SVG, nunca se puede salir de la
 *  celda — como mucho un logo muy apaisado queda recortado en los bordes en vez de invadir la
 *  celda de al lado. */
export function LogoBanco({ banco, ancho, alto }: { banco: string; ancho: number; alto: number }) {
  const { paleta } = useTema();
  const Vector = LOGOS_VECTOR[banco];
  const raster = LOGOS_RASTER[banco];

  if (!Vector && !raster) {
    return (
      <View
        style={[styles.fallback, { width: ancho, height: alto, backgroundColor: paleta.superficieAlt }]}
        accessibilityRole="image"
        accessibilityLabel={banco}
      >
        <Text style={[texto.microSuper, { color: paleta.tintaSuave }]} numberOfLines={1}>
          {iniciales(banco)}
        </Text>
      </View>
    );
  }

  return (
    <View
      style={[
        styles.fallback,
        { width: ancho, height: alto, backgroundColor: FONDOS_OSCUROS[banco] ?? paleta.superficieAlt },
      ]}
      accessibilityRole="image"
      accessibilityLabel={`Logo de ${banco}`}
    >
      {Vector ? (
        <Vector width={`${(ESCALAS[banco] ?? 1) * 100}%`} height={`${(ESCALAS[banco] ?? 1) * 100}%`} />
      ) : (
        <Image
          source={raster}
          style={{ width: `${(ESCALAS[banco] ?? 1) * 100}%`, height: `${(ESCALAS[banco] ?? 1) * 100}%` }}
          contentFit="contain"
        />
      )}
    </View>
  );
}

// Todos los logos (SVG real o fallback de iniciales) comparten el mismo chip de fondo gris
// suave: algunos SVG bajados tienen partes en blanco pensadas para un fondo de color (ej.
// MasClub, "Más" en blanco) y quedaban invisibles sobre el blanco de la celda — el fondo
// soluciona eso de raíz para cualquier logo futuro con el mismo problema, no solo para MasClub.
const styles = StyleSheet.create({
  fallback: {
    paddingHorizontal: 4, borderRadius: 4, alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
});
