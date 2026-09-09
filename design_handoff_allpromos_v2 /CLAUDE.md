# Notas del proyecto

## Pendientes anotados por el usuario
- **"Tus tarjetas y promos"**: al usuario le gusta el bloque de tarjetas/promos creado en `Tutorial interactivo.dc.html` (turno del product tour, versión standalone). Quiere reemplazar con eso la sección de tarjetas que ya existe en la app. Pendiente de hacer cuando lo pida.
- **Grilla de promos por día (turno 17)**: implementada y luego PARKEADA el mismo día (2026-09-08). Motivo: un super puede tener hasta ~18 promos bancarias vigentes el mismo día, y mostrar solo "la mejor" en la celda le pareció al usuario confuso/engañoso — es una decisión de UX sin cerrar (¿lista?, ¿"+N más"?, ¿filtrar por tarjetas del usuario en vez de todas?), no un bug. El código completo quedó guardado, sin wirear: `backend/src/routes/_parked/promosBancariasGrilla.js` y `app/src/componentes/_parked/{GrillaPromosBancarias,LogoBanco}.tsx` — el espacio en `EstadoInicial` (`app/app/(tabs)/index.tsx`) volvió a quedar vacío (ni la grilla ni el bloque viejo de colores). Detalle completo en `CONTEXTO_TECNICO.md` § "Grilla de promos bancarias por día (turno 17) — implementada y luego PARKEADA". `PROMPT-claude-code-turno-17-grilla-promos.md`, en esta misma carpeta, queda como referencia histórica de los requisitos originales.

## Contexto de diseño
- La app real está recreada en `AllPromos Actual.dc.html` (Buscar / Carrito / Resultado). Cualquier pantalla nueva debe usar ese lenguaje visual: fondo `#EEF0F2`, tarjetas blancas con borde `#DFE3E7`, sombra `0 2px 10px rgba(11,18,32,.07)`, Archivo + Barlow Condensed + IBM Plex Mono para datos, amarillo `#FFD400` solo para promos y ahorro.
- El design system Corellia (SAP) adjunto no aplica a esta app.
