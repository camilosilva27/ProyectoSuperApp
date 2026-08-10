import { useColorScheme } from 'react-native';
import { paletaDe, sombra, type Esquema, type Paleta } from './theme';

/** Paleta según el tema del sistema. La app declara userInterfaceStyle: automatic. */
export function useTema(): { esquema: Esquema; paleta: Paleta; sombra: object } {
  const esquema: Esquema = useColorScheme() === 'dark' ? 'dark' : 'light';
  return { esquema, paleta: paletaDe(esquema), sombra: sombra(esquema) ?? {} };
}
