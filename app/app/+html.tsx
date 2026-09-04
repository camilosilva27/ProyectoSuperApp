/**
 * Documento HTML raíz del build web (solo corre en Node, en tiempo de export estático).
 *
 * Antes no existía este archivo, así que Expo generaba un <head> mínimo sin meta tags:
 * por eso compartir el link de la app no mostraba ni ícono ni descripción, solo texto pelado.
 */

import { ScrollViewStyleReset } from 'expo-router/html';
import { type PropsWithChildren } from 'react';

const URL_APP = 'https://mi-superapp.vercel.app';
const DESCRIPCION = 'Compará precios entre Vea, Carrefour, Chango Más, Día, Coto, Jumbo y Disco, y armá la compra más barata.';

export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="es">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        {/* maximum-scale=1 + user-scalable=no bloquean el pinch-to-zoom y el double-tap-zoom
            en navegadores mobile (Safari/Chrome Android); el zoom de escritorio (ctrl +/-)
            no lee esta meta, así que esto no afecta desktop.
            viewport-fit=cover habilita las variables CSS env(safe-area-inset-*): sin esto,
            Safari en iPhones con Dynamic Island/notch no las expone con un valor útil, y la
            tab bar queda pegada al borde curvo de la pantalla. */}
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, shrink-to-fit=no, viewport-fit=cover" />
        {/* El <title> lo maneja expo-router/head desde _layout.tsx: si también lo pusiéramos
            acá, el navegador usa el PRIMER <title> del documento y quedaba vacío. */}
        <meta name="description" content={DESCRIPCION} />

        {/* Preview al compartir el link (WhatsApp, iMessage, redes) */}
        <meta property="og:type" content="website" />
        <meta property="og:title" content="Super App" />
        <meta property="og:description" content={DESCRIPCION} />
        <meta property="og:image" content={`${URL_APP}/og-image.png`} />
        <meta property="og:url" content={URL_APP} />
        <meta property="og:locale" content="es_AR" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content="Super App" />
        <meta name="twitter:description" content={DESCRIPCION} />
        <meta name="twitter:image" content={`${URL_APP}/og-image.png`} />

        {/* Ícono nítido al agregar como acceso directo (antes escalaba el favicon de 48px y se veía borroso) */}
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#14161A" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <meta name="apple-mobile-web-app-title" content="Super App" />

        {/* Splash del acceso directo en iOS: a diferencia de Android, Safari IGNORA
            background_color/icons del manifest para esto — solo lee estos <link> con media
            query exacta por tamaño de pantalla (ver CONTEXTO_TECNICO.md). Imágenes generadas
            en public/splash/ (logo + "Super App" sobre blanco). Solo portrait: la app está
            fijada a esa orientación (app.json → "orientation": "portrait"). */}
        <link rel="apple-touch-startup-image" href="/splash/apple-splash-1290-2796.png" media="(device-width: 430px) and (device-height: 932px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)" />
        <link rel="apple-touch-startup-image" href="/splash/apple-splash-1179-2556.png" media="(device-width: 393px) and (device-height: 852px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)" />
        <link rel="apple-touch-startup-image" href="/splash/apple-splash-1170-2532.png" media="(device-width: 390px) and (device-height: 844px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)" />
        <link rel="apple-touch-startup-image" href="/splash/apple-splash-1284-2778.png" media="(device-width: 428px) and (device-height: 926px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)" />
        <link rel="apple-touch-startup-image" href="/splash/apple-splash-1125-2436.png" media="(device-width: 375px) and (device-height: 812px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)" />
        <link rel="apple-touch-startup-image" href="/splash/apple-splash-1242-2688.png" media="(device-width: 414px) and (device-height: 896px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)" />
        <link rel="apple-touch-startup-image" href="/splash/apple-splash-828-1792.png" media="(device-width: 414px) and (device-height: 896px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)" />
        <link rel="apple-touch-startup-image" href="/splash/apple-splash-750-1334.png" media="(device-width: 375px) and (device-height: 667px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)" />

        <ScrollViewStyleReset />
        {/* Sin esto, el navegador toma cualquier drag horizontal sobre elementos que no
            son ScrollView (texto, botones) como paneo/rubber-banding nativo del documento.
            overscroll-behavior-x (no el shorthand de ambos ejes) para no romper el gesto
            vertical de "tirar desde arriba para recargar" en Safari iOS. */}
        <style
          dangerouslySetInnerHTML={{
            __html: `
              html, body, #root {
                overflow-x: hidden;
                overscroll-behavior-x: none;
                touch-action: pan-y;
              }
            `,
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
