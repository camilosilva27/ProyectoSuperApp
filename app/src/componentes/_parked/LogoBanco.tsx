/**
 * PARKEADO 2026-09-08 junto con GrillaPromosBancarias.tsx (ver el comentario ahí para el
 * motivo) — no lo importa nada de la app.
 *
 * Logo de banco/tarjeta para la grilla de promos (turno 17). Mismo patrón que LogoSuper.tsx:
 * mapa indexado por el nombre canónico (el de ALIAS_TARJETAS en AllPromos/promos-bancarias.js,
 * no el slug del archivo — ej. "Banco Macro", no "Macro"), `contain`, sin recolorear ni recortar
 * — son marcas de terceros.
 *
 * Solo hay 7 de los ~25 canónicos posibles con SVG bajado (ver el apéndice del turno 17 en
 * design_handoff_allpromos_v2/PROMPT-claude-code-turno-17-grilla-promos.md para sumar más);
 * el resto cae en el fallback de iniciales, que no bloquea el turno.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import BancoCiudadLogo from '../../../assets/logos-bancos/banco-ciudad.svg';
import BancoNacionLogo from '../../../assets/logos-bancos/banco-nacion.svg';
import BbvaLogo from '../../../assets/logos-bancos/bbva.svg';
import GaliciaLogo from '../../../assets/logos-bancos/galicia.svg';
import HsbcLogo from '../../../assets/logos-bancos/hsbc.svg';
import MacroLogo from '../../../assets/logos-bancos/macro.svg';
import SantanderLogo from '../../../assets/logos-bancos/santander.svg';
import { texto } from '../../theme';
import { useTema } from '../../useTema';

const LOGOS_VECTOR: Record<string, React.FC<{ width?: number | string; height?: number | string }>> = {
  'Galicia': GaliciaLogo,
  'BBVA': BbvaLogo,
  'Banco Macro': MacroLogo,
  'Banco Nación': BancoNacionLogo,
  'Santander': SantanderLogo,
  'HSBC': HsbcLogo,
  'Banco Ciudad': BancoCiudadLogo,
};

function iniciales(nombreBanco: string): string {
  const palabras = nombreBanco.split(' ').filter(Boolean);
  const relevantes = palabras.filter(p => !['de', 'del', 'la', 'los'].includes(p.toLowerCase()));
  return (relevantes.length ? relevantes : palabras).slice(0, 2).map(p => p[0]).join('').toUpperCase();
}

/** El logo solo, o un chip con iniciales si todavía no hay SVG para ese banco. */
export function LogoBanco({ banco, alto }: { banco: string; alto: number }) {
  const { paleta } = useTema();
  const Vector = LOGOS_VECTOR[banco];

  if (!Vector) {
    return (
      <View
        style={[styles.fallback, { height: alto, backgroundColor: paleta.superficieAlt }]}
        accessibilityRole="image"
        accessibilityLabel={banco}
      >
        <Text style={[texto.microSuper, { color: paleta.tintaSuave }]}>{iniciales(banco)}</Text>
      </View>
    );
  }

  return (
    <View
      style={{ width: '100%', height: alto }}
      accessibilityRole="image"
      accessibilityLabel={`Logo de ${banco}`}
    >
      <Vector width="100%" height={alto} />
    </View>
  );
}

const styles = StyleSheet.create({
  fallback: {
    width: '100%', paddingHorizontal: 4, borderRadius: 4, alignItems: 'center', justifyContent: 'center',
  },
});
