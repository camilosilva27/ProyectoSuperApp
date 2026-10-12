/**
 * Sin UI: ya con sesión, le avisa al backend con qué código de invitación llegó esta cuenta
 * (POST /api/referidos/asociar, ver .claude/docs/PLAN_REFERIDOS.md). Va adentro de GateSesion
 * y afuera del paywall, en `app/_layout.tsx`.
 *
 * El código sale del storage local (lo guardó `capturarCodigoReferidoDeUrl` al abrir el link) o,
 * si no está (confirmó el mail desde otro dispositivo), de `user_metadata.ref`, que se guardó al
 * registrarse. El backend decide si cuenta (cuenta nueva, no es el propio código, etc.); acá solo
 * se manda una vez. Si falla la red, se reintenta en la próxima apertura.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import { asociarReferido } from '../api';
import { useAuth } from '../auth';
import { leerCodigoReferidoGuardado, normalizarCodigoReferido, olvidarCodigoReferido } from '../codigoReferido';

// Por usuario: el código de `user_metadata` queda para siempre, no hay que mandarlo en cada apertura.
const CLAVE_ENVIADO = 'superahorro:referidoEnviado:v1';

export function AsociadorReferido() {
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  // Token y metadata por ref: el efecto depende solo del usuario, no de cada refresh del token.
  const tokenRef = useRef<string | null>(null);
  tokenRef.current = session?.access_token ?? null;
  const metaRef = useRef<unknown>(null);
  metaRef.current = session?.user.user_metadata?.ref ?? null;

  useEffect(() => {
    if (!userId) return;
    let cancelado = false;
    (async () => {
      const claveEnviado = `${CLAVE_ENVIADO}:${userId}`;
      const guardado = await leerCodigoReferidoGuardado();
      let codigo = guardado;
      if (!codigo) {
        if (await AsyncStorage.getItem(claveEnviado).catch(() => null)) return;
        codigo = normalizarCodigoReferido(metaRef.current);
      }
      const token = tokenRef.current;
      if (!codigo || !token || cancelado) return;
      try {
        await asociarReferido(codigo, token);
      } catch {
        return;
      }
      await olvidarCodigoReferido();
      await AsyncStorage.setItem(claveEnviado, '1').catch(() => undefined);
    })();
    return () => { cancelado = true; };
  }, [userId]);

  // Saca el `?ref=` de la barra de direcciones, para que un "agregar a inicio", un marcador o
  // copiar la URL para pasársela a otro no arrastren el código de quien invitó (el código ya
  // quedó guardado, ver capturarCodigoReferidoDeUrl). No alcanza con hacerlo una vez al cargar:
  // expo-router reescribe la URL inicial cuando se monta la navegación (el <Stack>, que espera a
  // que el paywall lea el plan), así que se revisa un rato hasta que quede limpia dos veces
  // seguidas. `router.setParams` no sirvió: `ref` no es un parámetro de ninguna ruta.
  useEffect(() => {
    if (!userId || Platform.OS !== 'web' || typeof window === 'undefined') return;
    let intentos = 0;
    let limpiasSeguidas = 0;
    const id = setInterval(() => {
      intentos++;
      const url = new URL(window.location.href);
      if (url.searchParams.has('ref')) {
        limpiasSeguidas = 0;
        url.searchParams.delete('ref');
        window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
      } else {
        limpiasSeguidas++;
      }
      if (limpiasSeguidas >= 2 || intentos > 30) clearInterval(id);
    }, 500);
    return () => clearInterval(id);
  }, [userId]);

  return null;
}
