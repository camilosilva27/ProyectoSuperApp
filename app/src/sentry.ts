/**
 * Monitoreo de errores (Sentry), solo web — mismo criterio que `@vercel/analytics`/
 * `@vercel/speed-insights` en `_layout.tsx`: no hay build nativo (App Store/Play Store)
 * todavía, así que no tiene sentido sumar `@sentry/react-native` (SDK nativo, requiere config
 * plugin + rebuild) para una plataforma que no existe. Cuando exista un build nativo real, se
 * suma ahí — hoy sería trabajo sin forma real de probarlo, mismo razonamiento que Google
 * Sign-In (ver FormularioAuth.tsx).
 *
 * Sin `EXPO_PUBLIC_SENTRY_DSN` configurado, `inicializarSentry()` no hace nada — la app sigue
 * funcionando exactamente igual, solo que sin reportar errores.
 *
 * Tampoco se inicializa en desarrollo local (`__DEV__`, es decir `npx expo start`, sea con
 * `localhost` o la IP de la red WiFi) — solo interesa monitorear errores del build de
 * producción real.
 */

import * as Sentry from '@sentry/react';
import { Platform } from 'react-native';

export function inicializarSentry() {
  const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN;
  if (Platform.OS !== 'web' || !dsn || __DEV__) return;
  Sentry.init({ dsn });
}
