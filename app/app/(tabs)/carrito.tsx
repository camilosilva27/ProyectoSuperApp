/**
 * Pantalla Carrito: revisar cantidades y disparar la comparación.
 *
 * Las tarjetas que marcás acá son solo el default: no hace falta elegir ninguna para
 * comparar. El resultado siempre muestra qué promos de tarjeta existen para cada producto,
 * y se pueden activar ahí mismo con un toque — esto es solo para no tener que activarlas
 * cada vez si siempre pagás con las mismas.
 *
 * Rediseño v2 (SPEC.md § 4.3): header negro, filas de producto sin EAN, bloque de tarjetas
 * ("Mis descuentos" — el nombre completo y la pantalla propia son turno 5, todavía no
 * implementados acá), y confirmación antes de vaciar (era deuda de UX, ver SPEC § 7.1).
 *
 * Turno 4: carritos guardados (§ 4.4) — guardar es una foto de la compra actual, no la vacía;
 * cargar reemplaza la compra actual entera por la guardada.
 */

import { useRouter } from 'expo-router';
import Head from 'expo-router/head';
import React, { useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
// expo-router (v57) vendorea su propio bottom-tabs y no lo reexporta desde el root del
// paquete: no hay `@react-navigation/bottom-tabs` instalado por separado, así que este es
// el único import que existe hoy para este hook.
import { useBottomTabBarHeight } from 'expo-router/build/react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TARJETAS_DISPONIBLES, useCarrito } from '../../src/carrito';
import { useCarritosGuardados, type CarritoGuardado } from '../../src/carritosGuardados';
import { ConfirmacionModal, IconoTacho } from '../../src/componentes/Confirmacion';
import { BotonPrincipal, Stepper, Vacio } from '../../src/componentes/comunes';
import { FotoProducto } from '../../src/componentes/FotoProducto';
import { GuardarCarritoHoja, ToastGuardado } from '../../src/componentes/GuardarCarritoHoja';
import { HeaderNegro, SelectorSupers, TituloHeader } from '../../src/componentes/HeaderNegro';
import { HojaSupers } from '../../src/componentes/HojaSupers';
import { useFiltrosSupers } from '../../src/filtrosSupers';
import { espacio, fuentes, radio, texto, usePantallaBaja } from '../../src/theme';
import { avanzarTour, useCerrarModalDeTour, useTourPaso } from '../../src/tour/TourContext';
import { useTema } from '../../src/useTema';

export default function PantallaCarrito() {
  const { paleta } = useTema();
  const pantallaBaja = usePantallaBaja();
  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight();
  const router = useRouter();
  const carrito = useCarrito();
  const carritosGuardados = useCarritosGuardados();
  const { supersActivos, toggleSuper, topeSupers, setSupersYTope, usoPorSuper } = useFiltrosSupers();
  // 'comparar-precios' NO mira `pathname === '/resultado'` (como antes): cualquier llegada a esa
  // ruta por otro camino (atrás/adelante del navegador, deep link, o ya estar ahí) contaba igual
  // sin tocar "Comparar precios" — mismo bug que 'tab-descuentos'/'volver-buscar'/'ver-carrito'
  // (ver auditoría). Se completa imperativo con `avanzarTour('comparar-precios')` en el propio
  // `onPress` del botón (más abajo), mismo patrón que 'listo' en HojaSupers.tsx y 'ver-carrito'
  // en index.tsx. El hook acá solo registra el target a medir (`cumplido` siempre `false`).
  const refComparar = useTourPaso('comparar-precios', false);
  const [mostrarHoja, setMostrarHoja] = useState(false);
  const [recienGuardadoId, setRecienGuardadoId] = useState<string | null>(null);
  const [toastNombre, setToastNombre] = useState<string | null>(null);
  const [mostrarConfirmarVaciar, setMostrarConfirmarVaciar] = useState(false);
  const [mostrarHojaSupers, setMostrarHojaSupers] = useState(false);
  // Cierra la hoja sola si quedó abierta de una navegación anterior (blur de la tab o arranque
  // del tour) — mismo mecanismo que en Buscar (index.tsx), centralizado en TourContext.tsx.
  useCerrarModalDeTour(setMostrarHojaSupers);
  // Reserva real del scroll para no quedar tapado por "Comparar precios": antes era un 140
  // fijo a ojo, que sobraba y dejaba un espacio vacío entre el botón y el tab bar.
  const [altoBarraInferior, setAltoBarraInferior] = useState(0);

  const vacia = carrito.items.length === 0;
  const reservaInferior = vacia ? 0 : altoBarraInferior + (Platform.OS === 'web' ? 0 : tabBarHeight);

  const vaciarConfirmado = () => {
    setMostrarConfirmarVaciar(false);
    carrito.vaciar();
  };

  const guardarCarrito = (nombre: string) => {
    const nuevo = carritosGuardados.guardar(nombre, carrito.items);
    setRecienGuardadoId(nuevo.id);
    setToastNombre(nuevo.nombre);
    setMostrarHoja(false);
  };

  return (
    <View style={[styles.pantalla, { backgroundColor: paleta.fondo }]}>
      <Head><title>Carrito - Super App</title></Head>
      <HeaderNegro paddingTop={insets.top + (pantallaBaja ? espacio.md : espacio.xl)}>
        <View style={styles.headerCarrito}>
          <TituloHeader>Carrito</TituloHeader>
          {!vacia ? (
            <Text style={[texto.etiqueta, styles.subtituloHeader]}>
              {carrito.items.length} producto{carrito.items.length === 1 ? '' : 's'} · {carrito.totalUnidades} u
            </Text>
          ) : null}
        </View>
        {/* Carrito comparaba siempre con lo que hubiera quedado activo en Buscar, sin forma de
            tocarlo sin pasar por ahí primero (un carrito guardado se abre directo acá, sin
            haber buscado nada). Mismo selector/hoja que Buscar — es el mismo filtro global
            (useFiltrosSupers), no un estado propio de esta pantalla. */}
        {!vacia ? (
          <SelectorSupers
            activos={supersActivos}
            usoPorSuper={usoPorSuper}
            onQuitar={toggleSuper}
            onAbrirHoja={() => setMostrarHojaSupers(true)}
          />
        ) : null}
      </HeaderNegro>

      <ScrollView
        contentContainerStyle={[styles.contenido, { paddingBottom: reservaInferior || espacio.xl }]}
        keyboardShouldPersistTaps="handled"
      >
        {/* Vive fuera del "vacia ? …" de abajo a propósito: si el carrito activo está vacío,
            es justo cuando hace falta poder cargar uno guardado — no solo cuando ya hay algo
            para guardar. */}
        {!vacia || carritosGuardados.carritos.length > 0 ? (
          <View style={styles.seccion}>
            <View style={styles.filaCabeceraGuardados}>
              <Text style={[styles.tituloDeSeccion, { color: paleta.tinta }]}>Carritos Guardados</Text>
              {!vacia ? (
                <Pressable
                  onPress={() => setMostrarHoja(true)}
                  accessibilityRole="button"
                  style={[styles.botonGuardarCarrito, { backgroundColor: paleta.oferta }]}
                >
                  <Text style={[texto.etiqueta, { color: paleta.ofertaTinta }]}>Guardar carrito</Text>
                </Pressable>
              ) : null}
            </View>
            {carritosGuardados.carritos.length > 0 ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filaCarritosGuardados}>
                {carritosGuardados.carritos.map(guardado => (
                  <TarjetaCarritoGuardado
                    key={guardado.id}
                    guardado={guardado}
                    destacado={guardado.id === recienGuardadoId}
                    onCargar={() => carrito.reemplazarItems(guardado.items)}
                  />
                ))}
              </ScrollView>
            ) : null}
          </View>
        ) : null}

        {vacia ? (
          <Vacio
            titulo="Todavía no elegiste nada"
            detalle="Andá a Buscar y tocá los productos que querés comparar."
          />
        ) : (
          <>
            <View style={styles.seccion}>
              <View style={styles.filaCabeceraGuardados}>
                <Text style={[styles.tituloDeSeccion, { color: paleta.tinta }]}>En esta Compra</Text>
                <Pressable
                  onPress={() => setMostrarConfirmarVaciar(true)}
                  accessibilityRole="button"
                  style={styles.vaciar}
                >
                  <Text style={[texto.etiqueta, { color: paleta.tintaSuave, textDecorationLine: 'underline' }]}>
                    Vaciar carrito
                  </Text>
                </Pressable>
              </View>
              {carrito.items.map(item => (
                <View
                  key={item.ean}
                  style={[styles.filaProducto, { backgroundColor: paleta.superficieAlt, borderColor: paleta.borde }]}
                >
                  <FotoProducto nombre={item.nombre} imagen={item.imagen} tamano={44} />
                  <Text style={[texto.cuerpoMedio, styles.filaNombre, { color: paleta.tinta }]} numberOfLines={2}>
                    {item.nombre}
                  </Text>
                  <Stepper
                    cantidad={item.cantidad}
                    onCambiar={n => carrito.cambiarCantidad(item.ean, n)}
                    compacto
                  />
                </View>
              ))}
            </View>

            {/* Tocar un chip prende/apaga esa tarjeta directamente (misma fuente de verdad que
                el switch de Mis descuentos, turno 5a) — no hace falta entrar a esa pantalla
                para lo que es solo activar/desactivar. Tocar la cabecera sigue llevando a Mis
                descuentos, que es donde está el detalle de cada promo. Cabecera y chips son
                Pressables hermanos, no anidados: HTML no permite <button> dentro de <button>,
                y react-native-web renderiza accessibilityRole="button" como <button>. */}
            <View style={[styles.tarjetaDescuentos, { borderColor: paleta.borde }]}>
              <Pressable
                onPress={() => router.push('/mis-descuentos')}
                accessibilityRole="button"
                style={[styles.cabeceraDescuentos, { backgroundColor: paleta.oferta }]}
              >
                <Text style={[texto.micro, { color: paleta.ofertaTinta, letterSpacing: 1.2 }]}>
                  MIS DESCUENTOS · {carrito.tarjetas.length}
                </Text>
                <Text style={[texto.micro, { color: paleta.ofertaTinta, opacity: 0.7, letterSpacing: 0.7 }]}>
                  SUMAN SUS PROMOS
                </Text>
              </Pressable>
              <View style={styles.chipsDescuentos}>
                {TARJETAS_DISPONIBLES.map(tarjeta => {
                  const activa = carrito.tarjetas.includes(tarjeta);
                  return (
                    <Pressable
                      key={tarjeta}
                      onPress={() =>
                        carrito.setTarjetas(
                          activa
                            ? carrito.tarjetas.filter(t => t !== tarjeta)
                            : [...carrito.tarjetas, tarjeta]
                        )
                      }
                      accessibilityRole="button"
                      accessibilityLabel={`${activa ? 'Tengo' : 'No tengo'} ${tarjeta}`}
                      accessibilityState={{ selected: activa }}
                      style={[
                        styles.chip,
                        activa
                          ? { backgroundColor: paleta.tinta }
                          : { borderWidth: 1, borderColor: paleta.borde },
                      ]}
                    >
                      <Text style={[texto.etiqueta, { color: activa ? paleta.superficie : paleta.tintaSuave }]}>
                        {tarjeta}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          </>
        )}
      </ScrollView>

      {/* Oculta mientras la hoja de supers está abierta: mismo bug que en Buscar (ver comentario
          en index.tsx) — sin esto se podía tocar "Comparar precios" con la hoja todavía abierta
          y navegar sin pasar por cerrarYConfirmar, comparando con la selección/tope viejos. */}
      {!vacia && !mostrarHojaSupers ? (
        <View
          onLayout={e => setAltoBarraInferior(e.nativeEvent.layout.height)}
          style={[
            styles.barraInferior,
            {
              backgroundColor: paleta.superficie, borderTopColor: paleta.borde,
              // Ver el comentario equivalente en index.tsx: en native hay que subir esta
              // barra tabBarHeight para no quedar detrás del tab bar; en web la escena ya lo
              // excluye (son hermanos), así que sumarlo ahí solo dejaba un hueco vacío.
              bottom: Platform.OS === 'web' ? 0 : tabBarHeight,
            },
          ]}
        >
          <BotonPrincipal
            botonRef={refComparar}
            onPress={() => { avanzarTour('comparar-precios'); router.push('/resultado'); }}
            iconoBalanza
          >
            Comparar precios
          </BotonPrincipal>
          <ToastGuardado nombre={toastNombre} onFin={() => setToastNombre(null)} />
        </View>
      ) : null}

      <GuardarCarritoHoja
        visible={mostrarHoja}
        productos={carrito.items.length}
        unidades={carrito.totalUnidades}
        onCancelar={() => setMostrarHoja(false)}
        onGuardar={guardarCarrito}
      />

      <ConfirmacionModal
        visible={mostrarConfirmarVaciar}
        titulo="Vaciar carrito"
        mensaje={`Se van a borrar los ${carrito.items.length} productos que agregaste.`}
        textoConfirmar="Vaciar"
        icono={IconoTacho}
        onCancelar={() => setMostrarConfirmarVaciar(false)}
        onConfirmar={vaciarConfirmado}
      />

      <HojaSupers
        visible={mostrarHojaSupers}
        activos={supersActivos}
        tope={topeSupers}
        onCerrar={() => setMostrarHojaSupers(false)}
        onAplicar={setSupersYTope}
      />
    </View>
  );
}

function TarjetaCarritoGuardado({
  guardado, destacado, onCargar,
}: { guardado: CarritoGuardado; destacado: boolean; onCargar: () => void }) {
  const { paleta } = useTema();
  const unidades = guardado.items.reduce((n, i) => n + i.cantidad, 0);

  return (
    <View
      style={[
        styles.tarjetaGuardado,
        destacado
          ? { borderWidth: 2, borderColor: paleta.oferta }
          : { borderWidth: 1, borderColor: paleta.borde },
      ]}
    >
      <Text style={[texto.tituloHeader, styles.nombreGuardado, { color: paleta.tinta }]} numberOfLines={2}>
        {guardado.nombre}
      </Text>
      <Text style={[texto.etiqueta, { color: paleta.tintaSuave, letterSpacing: 0.2 }]}>
        {guardado.items.length} producto{guardado.items.length === 1 ? '' : 's'} · {unidades} u
      </Text>
      <Pressable onPress={onCargar} accessibilityRole="button" style={styles.linkCargar}>
        <Text style={[texto.cuerpoMedio, { color: paleta.tinta, textDecorationLine: 'underline' }]}>
          Cargar
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  pantalla: { flex: 1 },
  headerCarrito: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  subtituloHeader: { color: '#FFFFFF', opacity: 0.7 },
  contenido: { paddingHorizontal: espacio.pantalla, paddingTop: espacio.pantalla, gap: espacio.pantalla },
  seccion: { gap: espacio.sm },
  filaCabeceraGuardados: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  tituloDeSeccion: { fontFamily: fuentes.titulo, fontSize: 16, lineHeight: 20 },
  botonGuardarCarrito: {
    height: 44, paddingHorizontal: espacio.md, borderRadius: radio.sm,
    alignItems: 'center', justifyContent: 'center',
  },
  filaCarritosGuardados: { marginTop: espacio.xs },
  tarjetaGuardado: {
    width: 180, borderRadius: radio.tarjeta, padding: espacio.md, gap: espacio.xs,
    marginRight: espacio.sm,
  },
  nombreGuardado: { fontSize: 19, lineHeight: 20, letterSpacing: 0.4 },
  linkCargar: {
    alignSelf: 'flex-start', height: 44, justifyContent: 'center',
    marginTop: -espacio.xs, marginBottom: -espacio.sm,
  },
  filaProducto: {
    flexDirection: 'row', alignItems: 'center', gap: espacio.md, borderWidth: 1,
    borderRadius: radio.tarjeta, padding: espacio.md, marginTop: espacio.sm,
  },
  filaNombre: { flex: 1 },
  tarjetaDescuentos: { borderWidth: 1, borderRadius: radio.tarjeta, overflow: 'hidden' },
  cabeceraDescuentos: {
    paddingHorizontal: espacio.md, paddingVertical: espacio.sm,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: espacio.sm,
  },
  chipsDescuentos: { flexDirection: 'row', flexWrap: 'wrap', gap: espacio.sm, padding: espacio.md },
  chip: { paddingHorizontal: espacio.md, paddingVertical: espacio.sm, borderRadius: radio.sm },
  vaciar: {
    height: 44, paddingHorizontal: espacio.md,
    alignItems: 'center', justifyContent: 'center',
  },
  barraInferior: {
    position: 'absolute', left: 0, right: 0,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: espacio.pantalla, paddingTop: espacio.md,
  },
});
