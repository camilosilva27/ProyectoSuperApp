/**
 * Gate de sesión obligatoria (Fase 2, Plan_Usuarios_y_cobros.md): sin sesión no se entra a la
 * app — se bloquea acá, antes de montar el `Stack` (onboarding incluido). Fase 1 dejaba la
 * cuenta opcional; esta fase la vuelve obligatoria envolviendo TODA la navegación con esto en
 * `_layout.tsx`, no solo un prompt puntual (por eso `PromptCuenta.tsx`, el prompt opcional post
 * onboarding de Fase 1, se sacó — quedaba inalcanzable: para llegar a esa pantalla ya hacía
 * falta haber pasado este gate con sesión).
 *
 * La migración local→cuenta de Fase 1 no se toca: sigue corriendo igual la primera vez que
 * alguien se loguea desde acá, dentro de `useSincronizacionPersistente`.
 */

import React from 'react';
import { ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../auth';
import { espacio } from '../theme';
import { useTema } from '../useTema';
import { FormularioAuth } from './FormularioAuth';

// Ancho de referencia del mock (design_handoff_allpromos_v2/14b-landing-cuenta.md): 390px,
// pensado para iPhone. Por debajo de este ancho de viewport la tarjeta deja de ser una tarjeta
// y pasa a ocupar toda la pantalla (sin margen ni bordes) — con margen alrededor quedaba
// flotando como un widget chico rodeado de aire en vez de leerse como la pantalla en sí.
const ANCHO_QUIEBRE_PANTALLA_COMPLETA = 420;

// Por encima del quiebre (web/desktop) la tarjeta sigue siendo una tarjeta centrada, pero con
// más aire que en mobile — un ancho igual al de mobile se veía chico y angosto en una pantalla
// de escritorio real.
const ANCHO_MAXIMO_TARJETA_ESCRITORIO = 520;

export function GateSesion({ children }: { children: React.ReactNode }) {
  const { paleta } = useTema();
  const insets = useSafeAreaInsets();
  const { session, cargando } = useAuth();
  const { width } = useWindowDimensions();
  const pantallaCompleta = width < ANCHO_QUIEBRE_PANTALLA_COMPLETA;
  // Ancho real que le queda a la tarjeta — se lo pasamos a FormularioAuth como prop en vez de
  // que lo mida con `onLayout`: en react-native-web ese `onLayout` no estaba disparando de
  // nuevo cuando el ancho real terminaba de resolverse, y la tarjeta se quedaba calculando los
  // tamaños del hero con el valor de antes de montar (mucho más chico que el real).
  const anchoTarjeta = pantallaCompleta ? width : Math.min(width - espacio.pantalla * 2, ANCHO_MAXIMO_TARJETA_ESCRITORIO);

  // Mismo criterio que _layout.tsx con las fuentes: pantalla lisa del color de fondo mientras
  // se resuelve si hay sesión guardada, no un spinner ni (peor) un parpadeo mostrando el gate.
  if (cargando) {
    return <View style={{ flex: 1, backgroundColor: paleta.fondo }} />;
  }

  if (!session) {
    // La tarjeta de FormularioAuth ya trae su propio hero/copy (pantalla 1 del mock) — acá no
    // hace falta un título genérico repitiendo lo mismo por encima.
    return (
      <ScrollView
        style={{ flex: 1, backgroundColor: paleta.fondo }}
        contentContainerStyle={[
          styles.cuerpo,
          pantallaCompleta
            ? { padding: 0, paddingBottom: insets.bottom }
            : { paddingTop: insets.top + espacio.xl, paddingBottom: insets.bottom + espacio.xl },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ flex: 1, width: '100%', maxWidth: pantallaCompleta ? undefined : ANCHO_MAXIMO_TARJETA_ESCRITORIO }}>
          {/* En pantalla completa no hay margen blanco arriba: el inset del status bar se lo
              comemos dentro del hero (FormularioAuth) para que su color de fondo llegue hasta
              arriba, en vez de dejar una franja blanca del alto del status bar por encima. */}
          <FormularioAuth
            pantallaCompleta={pantallaCompleta}
            anchoTarjeta={anchoTarjeta}
            insetSuperior={pantallaCompleta ? insets.top : 0}
          />
        </View>
      </ScrollView>
    );
  }

  return <>{children}</>;
}

const styles = StyleSheet.create({
  cuerpo: {
    padding: espacio.pantalla, flexGrow: 1,
    alignItems: 'center', justifyContent: 'center',
  },
});
