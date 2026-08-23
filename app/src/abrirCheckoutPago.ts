import { Linking, Platform } from 'react-native';

/**
 * Abre el checkout de Mercado Pago evitando el bloqueo de popups del navegador en web.
 *
 * El problema: `crearSuscripcion` hace un fetch (async real) antes de tener la URL de MP, así
 * que para cuando llamamos a `Linking.openURL` ya pasó tiempo desde el click original y el
 * navegador ya no lo asocia al gesto del usuario — Chrome/Safari lo tratan como popup no
 * solicitado y muestran el cartel de confirmación. La solución es reservar la pestaña en blanco
 * de forma síncrona, todavía dentro del gesto de click, y recién asignarle la URL real cuando
 * el fetch resuelve.
 *
 * En nativo (iOS/Android app) no aplica: `Linking.openURL` dispara un intent/deep-link, no pasa
 * por el bloqueador de popups del navegador.
 */
export async function abrirCheckoutPago(crearPreferencia: () => Promise<{ initPoint: string }>) {
  const pestañaReservada = Platform.OS === 'web' ? window.open('', '_blank') : null;
  try {
    const { initPoint } = await crearPreferencia();
    if (pestañaReservada) {
      pestañaReservada.location.href = initPoint;
    } else {
      await Linking.openURL(initPoint);
    }
  } catch (err) {
    pestañaReservada?.close();
    throw err;
  }
}
