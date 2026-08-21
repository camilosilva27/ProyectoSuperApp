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
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../auth';
import { espacio, texto } from '../theme';
import { useTema } from '../useTema';
import { FormularioAuth } from './FormularioAuth';

export function GateSesion({ children }: { children: React.ReactNode }) {
  const { paleta } = useTema();
  const insets = useSafeAreaInsets();
  const { session, cargando } = useAuth();

  // Mismo criterio que _layout.tsx con las fuentes: pantalla lisa del color de fondo mientras
  // se resuelve si hay sesión guardada, no un spinner ni (peor) un parpadeo mostrando el gate.
  if (cargando) {
    return <View style={{ flex: 1, backgroundColor: paleta.fondo }} />;
  }

  if (!session) {
    return (
      <ScrollView
        style={{ flex: 1, backgroundColor: paleta.fondo }}
        contentContainerStyle={[styles.cuerpo, { paddingTop: insets.top + espacio.xl }]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ gap: espacio.xs }}>
          <Text style={[texto.titulo, { color: paleta.tinta }]}>Super App</Text>
          <Text style={[texto.cuerpo, { color: paleta.tintaSuave }]}>
            Creá una cuenta o iniciá sesión para seguir — así tu carrito, tarjetas y listas
            guardadas se sincronizan entre tus dispositivos.
          </Text>
        </View>
        <FormularioAuth />
      </ScrollView>
    );
  }

  return <>{children}</>;
}

const styles = StyleSheet.create({
  cuerpo: { padding: espacio.pantalla, gap: espacio.lg, flexGrow: 1 },
});
