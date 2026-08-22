/**
 * Mapea el estado de una suscripción de Mercado Pago al plan que le corresponde en
 * `perfil_usuario`. Compartido entre el webhook (estado que manda MP async) y la ruta de
 * cancelación (estado que devuelve `preApproval.update` en la misma respuesta) para no
 * duplicar el criterio en dos lugares.
 */
function planSegunEstado(estado) {
  if (estado === 'authorized') return 'premium';
  if (estado === 'cancelled' || estado === 'paused') return 'gratis';
  return null;
}

module.exports = { planSegunEstado };
