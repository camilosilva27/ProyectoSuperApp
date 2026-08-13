import { paletaDe, sombra, type Esquema, type Paleta } from './theme';

/**
 * Fijo en claro por ahora. El rediseño v2 todavía no tiene versión oscura (ver
 * design_handoff_allpromos_v2/SPEC.md § 7.5: "pedido y no diseñado") y la paleta `dark` que
 * quedó de la versión anterior ya no es válida para las pantallas nuevas — invierte `tinta`
 * a un gris casi blanco, y componentes como HeaderNegro dan por sentado que `tinta` es
 * siempre oscuro. Seguir el `prefers-color-scheme`/tema del sistema acá rompía la pantalla
 * en cualquier teléfono con modo oscuro activado (fondo negro, header sin su negro propio).
 * Cuando el turno de tema oscuro se diseñe, esto vuelve a leer `useColorScheme()`.
 */
export function useTema(): { esquema: Esquema; paleta: Paleta; sombra: object } {
  const esquema: Esquema = 'light';
  return { esquema, paleta: paletaDe(esquema), sombra: sombra(esquema) ?? {} };
}
