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

  return null;
}

/**
 * Saca el `?ref=` de la barra de direcciones, para que un "agregar a inicio", un marcador o copiar
 * la URL para pasársela a otro no arrastren el código de quien invitó (el código ya quedó
 * guardado, ver capturarCodigoReferidoDeUrl).
 *
 * Va al lado del `<Stack>`, adentro del paywall (`app/_layout.tsx`): expo-router reescribe la URL
 * inicial, con su query string, recién cuando se monta la navegación — que en producción espera a
 * que el paywall lea el plan por red. Limpiarla antes no sirve (verificado: en producción volvía a
 * aparecer ~1 s después). Desde acá se revisa unos segundos por si el router la escribe después de
 * este efecto. `router.setParams` no sirve: `ref` no es parámetro de ninguna ruta.
 */
export function LimpiadorRefDeUrl() {
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    let intentos = 0;
    const id = setInterval(() => {
      intentos++;
      const url = new URL(window.location.href);
      if (url.searchParams.has('ref')) {
        url.searchParams.delete('ref');
        window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
      }
      if (intentos >= 10) clearInterval(id);
    }, 300);
    return () => clearInterval(id);
  }, []);

  return null;
}
