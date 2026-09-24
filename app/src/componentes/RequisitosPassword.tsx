/**
 * Requisitos de contraseña (decisión del usuario 2026-09-24): mínimo 8 caracteres y al menos una
 * mayúscula. El mínimo de 8 también lo exige Supabase (Auth → password_min_length); la mayúscula
 * solo se valida acá, porque Supabase no tiene una opción "solo mayúscula" (sus opciones siempre
 * combinan mayúsculas con números).
 *
 * El aviso se muestra ANTES de que la persona escriba (en gris) y se pone en rojo, junto con el
 * borde del campo, apenas lo escrito no cumple.
 */

import React from 'react';
import { Text } from 'react-native';
import { texto } from '../theme';
import { useTema } from '../useTema';

export const TEXTO_REQUISITOS_PASSWORD = 'Mínimo 8 caracteres y al menos una mayúscula.';

export function passwordCumpleRequisitos(password: string): boolean {
  return password.length >= 8 && /[A-ZÁÉÍÓÚÑ]/.test(password);
}

/** true si ya escribió algo y no cumple — para pintar el campo en rojo. */
export function passwordInvalida(password: string): boolean {
  return password.length > 0 && !passwordCumpleRequisitos(password);
}

export function AvisoRequisitosPassword({ password }: { password: string }) {
  const { paleta } = useTema();
  const invalida = passwordInvalida(password);
  return (
    <Text
      style={[texto.etiqueta, { color: invalida ? paleta.errorTexto : paleta.tintaSuave }]}
      accessibilityLiveRegion="polite"
    >
      {TEXTO_REQUISITOS_PASSWORD}
    </Text>
  );
}
