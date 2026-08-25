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
        <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no" />
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
