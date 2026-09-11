/**
 * Hoja "Qué supers comparar" (Parte 2 del turno "selector + hoja de selección"), abierta desde
 * la celda "+N otros" del selector en el header (ver `SelectorSupers` en HeaderNegro.tsx).
 *
 * Sube sobre la pantalla actual, no navega a otra — así no se pierde el carrito ni la búsqueda
 * en curso. Los cambios se acumulan en un borrador local y solo se aplican (recalculando el
 * resultado) al cerrar, sea con "Listo" o tocando el scrim — las dos vías cierran Y confirman,
 * no hay "cancelar" separado de "cerrar".
 *
 * Antes tenía arrastre para cerrar (`PanResponder` + `Animated`, sin gesture-handler): se sacó
 * porque dejó de responder en el build web (probablemente drift de versión de RN Web desde que
 * se implementó, ver panresponder-modal-gotchas-rn-web) y el usuario prefirió alinearla al mismo
 * patrón simple que las otras 3 hojas (`Modal` + fade, tocar el fondo cierra) antes que
 * reinvertir en diagnosticar el gesto.
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { comparar, type SuperKey } from '../api';
import { useAuth } from '../auth';
import { useCarrito } from '../carrito';
import {
  espacio, fuentes, pesosCorto, radio, texto, textoPretty, type Paleta,
} from '../theme';
import { avanzarTour, salirTour, useEstadoTour, useTourPaso } from '../tour/TourContext';
import { useTema } from '../useTema';
import { BotonPrincipal, NOMBRE_SUPER, ORDEN_SUPERS } from './comunes';
import { PlacaLogoSuper } from './LogoSuper';

/** `0` = sin tope explícito ("Los N") — no se guarda el N literal porque queda obsoleto en
 *  cuanto cambia la selección (ver normalizarTope en filtrosSupers.tsx, misma regla). */
function normalizarTope(tope: number, cantidadElegidos: number): number {
  return tope > 0 && tope < cantidadElegidos ? tope : 0;
}

/** Debounce del preview de costo — no hace falta pedirle al backend en cada tap si el usuario
 *  sigue tocando la fila de opciones. */
const DEMORA_PREVIEW_MS = 400;

/**
 * Cuánto "cuesta" en pesos el tope elegido, calculado en vivo contra el carrito real — la hoja
 * se abre hoy solo desde Buscar, que no tiene un plan de carrito calculado (eso solo existe en
 * Resultado), así que no hay otro dato del que partir: se le pide al backend, con el mismo
 * `borrador` que se está armando en la hoja. `null` = todavía no hay nada que mostrar (carrito
 * vacío, "Los N" seleccionado, o la respuesta no llegó/falló) — el caller decide qué texto
 * corresponde a cada uno de esos casos.
 */
function useCostoTope(
  pedido: { ean: string; cantidad: number }[],
  tarjetas: string[],
  borrador: SuperKey[],
  topeBorrador: number,
  accessToken: string | null,
): number | null {
  const [monto, setMonto] = useState<number | null>(null);
  // Contador de secuencia (mismo patrón que usePreciosProgresivos en la pantalla de Buscar):
  // ignora una respuesta que llega después de que el usuario ya cambió el tope o la selección.
  const turnoRef = useRef(0);

  useEffect(() => {
    if (!pedido.length || !topeBorrador || borrador.length <= 1 || !accessToken) {
      setMonto(null);
      return;
    }
    const miTurno = ++turnoRef.current;
    const id = setTimeout(() => {
      comparar(pedido, tarjetas, accessToken, borrador, topeBorrador)
        .then(({ resumen }) => {
          if (turnoRef.current !== miTurno) return;
          setMonto(
            resumen.totalOptimoSinTope != null
              ? Math.max(0, resumen.totalOptimo - resumen.totalOptimoSinTope)
              : 0
          );
        })
        .catch(() => {
          if (turnoRef.current === miTurno) setMonto(null);
        });
    }, DEMORA_PREVIEW_MS);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `pedido`/`tarjetas` son arrays
    // nuevos en cada render del padre; se comparan por contenido (JSON) para no re-pedir de
    // más cuando lo que cambió fue otra cosa del carrito que no afecta este cálculo.
  }, [JSON.stringify(pedido), JSON.stringify(tarjetas), JSON.stringify(borrador), topeBorrador, accessToken]);

  return monto;
}

// Debajo de esto no hace falta buscador — se ve toda la lista de un vistazo (con los 7 supers
// de hoy, esto nunca se muestra; queda listo para cuando la lista crezca).
const UMBRAL_BUSQUEDA = 10;

export function HojaSupers({
  visible, activos, tope, onCerrar, onAplicar, bloqueados = [],
}: {
  visible: boolean;
  activos: SuperKey[];
  tope: number;
  onCerrar: () => void;
  onAplicar: (keys: SuperKey[], tope: number) => void;
  /** Supers que no se pueden destildar (ver tour: Vea+Carrefour quedan fijos mientras está
   *  activo, para que sumar Coto sea la única acción posible en ese paso). */
  bloqueados?: SuperKey[];
}) {
  const { paleta } = useTema();
  const [borrador, setBorrador] = useState<SuperKey[]>(activos);
  const [topeBorrador, setTopeBorrador] = useState(tope);
  const [busqueda, setBusqueda] = useState('');
  const carrito = useCarrito();
  const { session } = useAuth();
  // El paso del tour "marcá Coto" NO puede mirar si Coto está en `borrador`: por defecto los 7
  // supers vienen activos, así que ya estaría "cumplido" apenas se abre la hoja, sin que el
  // usuario toque nada — pasaba justo eso (saltaba directo al paso del tope). En cambio, esto
  // se pone en `true` con el toque real sobre la fila, la marque o la desmarque.
  const [tocoCoto, setTocoCoto] = useState(false);
  // Mismo problema con "tope-elegido", agravado: como esta hoja es un `<Modal>` (ver más abajo,
  // `bloqueaCierreIndirecto`), el overlay del tour NO puede bloquear ningún toque adentro — con solo
  // comparar `topeBorrador` contra el snapshot inicial (como estaba antes), tocar cualquier botón
  // de tope DURANTE el paso "coto" (antes de que "tope-elegido" siquiera se active) ya dejaba la
  // condición en `true` de entrada, saltando ese paso sin que el usuario tocara nada mientras su
  // cartel estaba en pantalla (bug real, encontrado en auditoría). Por eso, igual que `tocoCoto`,
  // esto solo se pone en `true` con el toque real sobre un botón de tope Y mientras ese paso en
  // particular está activo (ver el handler pasado a `BloqueTope` más abajo).
  const [tocoTope, setTocoTope] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setBorrador(activos);
    setTopeBorrador(normalizarTope(tope, activos.length));
    setTocoCoto(false);
    setTocoTope(false);
    setBusqueda('');
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo al abrir, no en cada cambio de `activos`/`tope`
  }, [visible]);

  // Necesario ya acá arriba (no solo más abajo, donde vivía antes): tanto el handler del tope
  // como `cerrarYConfirmar` necesitan saber el paso activo del tour para decidir si la acción
  // cuenta como la que ese paso pide.
  const { activo: tourActivo, pasoActivo } = useEstadoTour();
  // Mientras dura "coto"/"tope-elegido", ninguna acción que no sea la del propio paso puede
  // cerrar la hoja (ni el botón "Listo" ni el scrim/back, ver más abajo) — fuerza a que el
  // usuario haga real la acción pedida en vez de saltarla. "listo" no entra acá: en ese paso el
  // botón "Listo" SÍ es la acción correcta.
  const bloqueaAccionPrevia = tourActivo && (pasoActivo === 'coto' || pasoActivo === 'tope-elegido');

  const cerrarYConfirmar = () => {
    if (bloqueaAccionPrevia) return;
    onAplicar(borrador, topeBorrador);
    onCerrar();
    // Imperativo, no vía `useTourPaso`: para cuando esto corre, la hoja ya se está por
    // desmontar (onCerrar) — no hay forma de que un booleano "cumplido" lo detecte a tiempo.
    avanzarTour('listo');
  };

  // No usa la forma de updater (prev => ...): tiene que ajustar `topeBorrador` como efecto del
  // mismo toggle ("si destildás y el tope queda >= la cantidad elegida, pasa a Los N"), y
  // anidar un setState dentro del callback de otro es frágil. `borrador` ya está fresco en
  // este closure porque el componente se re-renderiza en cada cambio de estado.
  const toggle = (key: SuperKey) => {
    if (bloqueados.includes(key)) return;
    if (key === 'coto') setTocoCoto(true);
    const siguiente = borrador.includes(key)
      ? (borrador.length === 1 ? borrador : borrador.filter(k => k !== key)) // no se puede destildar el último activo
      : [...borrador, key];
    setBorrador(siguiente);
    setTopeBorrador(t => normalizarTope(t, siguiente.length));
  };

  // Ver el comentario de `tocoTope` más arriba: solo cuenta como "hizo lo que este paso pide" si
  // el toque pasa mientras el paso "tope-elegido" está realmente activo.
  const cambiarTope = (valor: number) => {
    if (pasoActivo === 'tope-elegido') setTocoTope(true);
    setTopeBorrador(valor);
  };

  const filtro = busqueda.trim().toLowerCase();
  const visiblesPorFiltro = ORDEN_SUPERS.filter(key => NOMBRE_SUPER[key].toLowerCase().includes(filtro));
  const comparando = visiblesPorFiltro.filter(key => borrador.includes(key));
  const afuera = visiblesPorFiltro.filter(key => !borrador.includes(key));

  const pedido = carrito.items.map(i => ({ ean: i.ean, cantidad: i.cantidad }));
  const montoTope = useCostoTope(pedido, carrito.tarjetas, borrador, topeBorrador, session?.access_token ?? null);

  // `habilitado: visible` — esta pantalla puede tener más de una instancia de `HojaSupers`
  // montada a la vez (Buscar y Carrito), y una no visible igual corre sus hooks (solo hace
  // `return null` en el render). Sin esto, la instancia oculta puede registrar su target y
  // "ganarle" a la visible (ver comentario en useTourPaso).
  const refCoto = useTourPaso('coto', tocoCoto, undefined, visible);
  const refTope = useTourPaso('tope-elegido', tocoTope, undefined, visible);
  // `cumplido` siempre en `false`: este paso se completa con `avanzarTour('listo')` imperativo
  // dentro de `cerrarYConfirmar` (arriba), no con una condición — para cuando se cumple, la
  // hoja ya se está desmontando. El hook igual sirve para registrar el target a medir.
  const refListo = useTourPaso('listo', false, undefined, visible);

  // Coto puede no entrar en la primera pantalla de la lista (depende de cuántos supers y cuánto
  // ocupa BloqueTope arriba) — el overlay del tour bloquea todo menos la fila de Coto, así que
  // si queda tapada por el borde del scroll, no hay forma de llegar a ella. Se la trae a la
  // vista sola apenas arranca este paso, en vez de depender de que el usuario adivine que puede
  // scrollear dentro del hueco bloqueado.
  const scrollRef = useRef<ScrollView>(null);
  const scrollYRef = useRef(0);
  const refContenedorLista = useRef<View>(null);
  // El botón físico de "atrás" (Android) dispara `onRequestClose` del Modal sin pasar por el
  // overlay del tour (que solo bloquea toques sobre la pantalla, no ese evento del SO) — sin
  // este freno, cerraba la hoja en medio de cualquiera de los 3 pasos que viven acá ("coto",
  // "tope-elegido", "listo") y dejaba el tour trabado para siempre pidiendo un paso sobre una
  // hoja que ya no existe (bug real reportado). Durante "listo" el botón "Listo" SÍ tiene que
  // seguir andando (`bloqueaAccionPrevia`, declarado más arriba, no incluye ese paso) — es la
  // acción que ese paso pide; el scrim y el back físico quedan bloqueados igual, para que solo
  // cuente tocar el botón real. Mientras dura cualquiera de los 3, la única salida sigue siendo
  // "Finalizar" del propio cartel.
  const bloqueaCierreIndirecto = bloqueaAccionPrevia || (tourActivo && pasoActivo === 'listo');
  // Red de seguridad: la hoja no se desmonta al cerrarse (vive montada en Buscar/Carrito todo
  // el tiempo, solo cambia `visible`, ver comentario del componente) — si por cualquier otro
  // camino queda invisible mientras el tour sigue parado en uno de estos pasos (en vez de
  // quedar trabado sin target, se corta el tour prolijo).
  const eraVisibleRef = useRef(visible);
  useEffect(() => {
    const eraVisible = eraVisibleRef.current;
    eraVisibleRef.current = visible;
    if (eraVisible && !visible && (pasoActivo === 'coto' || pasoActivo === 'tope-elegido' || pasoActivo === 'listo')) {
      salirTour();
    }
  }, [visible, pasoActivo]);
  useEffect(() => {
    if (pasoActivo !== 'coto') return;
    // Espera a que termine la animación de apertura de la hoja — antes de eso, medir la fila
    // da su posición todavía en tránsito (offscreen), y el scroll calculado sale mal.
    const id = setTimeout(() => {
      const fila = refCoto.current;
      const contenedor = refContenedorLista.current;
      if (!fila || !contenedor) return;
      fila.measureInWindow((xF, yF, wF, hF) => {
        if (!wF) return;
        contenedor.measureInWindow((xC, yC, wC, hC) => {
          if (yF >= yC && yF + hF <= yC + hC) return; // ya está a la vista
          const delta = (yF + hF / 2) - (yC + hC / 2);
          scrollRef.current?.scrollTo({ y: Math.max(0, scrollYRef.current + delta), animated: true });
        });
      });
    }, 500);
    return () => clearTimeout(id);
  }, [pasoActivo]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={bloqueaCierreIndirecto ? () => {} : cerrarYConfirmar}
    >
      <View style={[styles.fondo, { backgroundColor: paleta.overlay }]}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={bloqueaCierreIndirecto ? undefined : cerrarYConfirmar}
          accessibilityLabel="Cerrar"
          accessibilityRole="button"
        />

        <View style={[styles.hoja, { backgroundColor: paleta.superficie }]}>
          <View style={styles.encabezado}>
            {/* Mismo patrón de título que GuardarCarritoHoja/MercadoPagoEmailSheet: `texto.subtitulo`
                con fontSize 22 — las 4 hojas modales comparten esta tipografía de encabezado. */}
            <Text style={[texto.subtitulo, { color: paleta.tinta, fontSize: 22 }]}>Qué supers comparar</Text>
            <Text style={[texto.cuerpo, { color: paleta.tintaSuave }, textoPretty]}>
              Los que dejes afuera no aparecen en resultados ni en el plan de compra.
            </Text>
          </View>
          {ORDEN_SUPERS.length > UMBRAL_BUSQUEDA ? (
            <TextInput
              value={busqueda}
              onChangeText={setBusqueda}
              placeholder="Buscar supermercado"
              placeholderTextColor={paleta.tintaSuave}
              style={[
                styles.inputBusqueda,
                { color: paleta.tinta, boxShadow: `inset 0 0 0 1px ${paleta.bordeFuerte}` },
              ]}
              autoCorrect={false}
              autoCapitalize="none"
              accessibilityLabel="Buscar supermercado"
            />
          ) : null}

          {ORDEN_SUPERS.length > 1 ? (
            <View ref={refTope}>
              <BloqueTope
                paleta={paleta}
                n={borrador.length}
                total={ORDEN_SUPERS.length}
                topeBorrador={topeBorrador}
                onCambiarTope={cambiarTope}
                monto={montoTope}
                carritoVacio={pedido.length === 0}
              />
            </View>
          ) : null}

          <View style={styles.contenedorLista} ref={refContenedorLista}>
            <ScrollView
              ref={scrollRef}
              onScroll={e => { scrollYRef.current = e.nativeEvent.contentOffset.y; }}
              scrollEventThrottle={32}
              style={styles.lista}
              contentContainerStyle={styles.listaContenido}
              // Con el tour activo en 'coto' el spotlight resalta la fila de Coto dentro de esta
              // misma lista scrolleable: si el usuario scrollea, la fila se desplaza por debajo
              // del recorte fijo del overlay (mismo bug que en la lista de resultados, ver index.tsx).
              scrollEnabled={pasoActivo !== 'coto'}
            >
              {comparando.length > 0 ? (
                <View style={styles.grupo}>
                  <Text style={[texto.tituloSeccion, { color: paleta.tintaSuave }]}>COMPARANDO</Text>
                  {comparando.map((key, i) => (
                    <React.Fragment key={key}>
                      {i > 0 ? <View style={[styles.separador, { backgroundColor: paleta.borde }]} /> : null}
                      <FilaSuper
                        paleta={paleta}
                        superKey={key}
                        activo
                        bloqueado={bloqueados.includes(key)}
                        onPress={() => toggle(key)}
                        tourRef={key === 'coto' ? refCoto : undefined}
                      />
                    </React.Fragment>
                  ))}
                </View>
              ) : null}

              {afuera.length > 0 ? (
                <View style={styles.grupo}>
                  <Text style={[texto.tituloSeccion, { color: paleta.tintaSuave }]}>AFUERA</Text>
                  {afuera.map((key, i) => (
                    <React.Fragment key={key}>
                      {i > 0 ? <View style={[styles.separador, { backgroundColor: paleta.borde }]} /> : null}
                      <FilaSuper
                        paleta={paleta}
                        superKey={key}
                        activo={false}
                        onPress={() => toggle(key)}
                        tourRef={key === 'coto' ? refCoto : undefined}
                      />
                    </React.Fragment>
                  ))}
                </View>
              ) : null}
            </ScrollView>
          </View>

          <BotonPrincipal botonRef={refListo} onPress={cerrarYConfirmar}>Listo</BotonPrincipal>
        </View>
      </View>
    </Modal>
  );
}

function FilaSuper({
  paleta, superKey, activo, onPress, tourRef, bloqueado = false,
}: {
  paleta: Paleta;
  superKey: SuperKey;
  activo: boolean;
  onPress: () => void;
  /** Solo lo pasa el tour, y solo para la fila de Coto (ver más arriba). */
  tourRef?: React.RefObject<View | null>;
  /** Fijo mientras dura el tour (Vea+Carrefour) — se ve como el resto de las filas, pero
   *  grisado y sin acción, igual criterio visual que los botones deshabilitados de BloqueTope. */
  bloqueado?: boolean;
}) {
  return (
    <Pressable
      ref={tourRef}
      onPress={bloqueado ? undefined : onPress}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: activo, disabled: bloqueado }}
      accessibilityLabel={`${NOMBRE_SUPER[superKey]}, ${activo ? 'comparando' : 'afuera'}${bloqueado ? ', fijo durante el tour' : ''}`}
      style={[styles.fila, bloqueado && styles.filaBloqueada]}
    >
      <View
        style={[
          styles.checkbox,
          activo
            ? { backgroundColor: paleta.tinta }
            : { backgroundColor: 'transparent', boxShadow: `inset 0 0 0 1.5px ${paleta.tinta}` },
          bloqueado && { backgroundColor: paleta.bordeFuerte },
        ]}
      >
        {activo ? <Text style={[styles.check, { color: paleta.superficie }]}>✓</Text> : null}
      </View>
      <View style={[styles.barraColorFila, { backgroundColor: paleta.supers[superKey] }]} />
      <PlacaLogoSuper superKey={superKey} ancho={54} alto={22} padding={2} radio={5} />
      <Text
        style={[texto.cuerpoMedio, styles.nombreFila, { color: bloqueado ? paleta.tintaSuave : paleta.tinta }]}
        numberOfLines={1}
      >
        {NOMBRE_SUPER[superKey]}
      </Text>
    </Pressable>
  );
}

/** Fila de botones numéricos fijos (1..total de supers del catálogo) + la línea que dice
 *  cuánto cuesta el tope elegido. Vive entre el título de la hoja y el grupo "COMPARANDO" —
 *  cambia el resultado del cálculo, no es una preferencia de vista, por eso no va mezclado
 *  con la lista de supers.
 *
 *  No hay botón "Todos": tocar el número que coincide con la cantidad de supers elegidos
 *  (`n`) ES la opción de "sin tope" (internamente se guarda como el sentinel 0, ver
 *  normalizarTope más arriba). Los números por encima de `n` no desaparecen al destildar un
 *  super de la lista — quedan visibles pero deshabilitados/grisados, así los botones no
 *  saltan de lugar mientras el usuario arma la selección. */
function BloqueTope({
  paleta, n, total, topeBorrador, onCambiarTope, monto, carritoVacio,
}: {
  paleta: Paleta;
  n: number;
  total: number;
  topeBorrador: number;
  onCambiarTope: (tope: number) => void;
  monto: number | null;
  carritoVacio: boolean;
}) {
  const opciones = Array.from({ length: total }, (_, i) => i + 1);

  return (
    <View style={[styles.bloqueTope, { borderBottomColor: paleta.borde }]}>
      <Text style={[texto.tituloSeccion, { color: paleta.tintaSuave }]}>CUÁNTOS QUERÉS VISITAR COMO MÁXIMO?</Text>
      <View style={styles.filaTope}>
        {opciones.map(valor => {
          const deshabilitado = valor > n;
          // El botón que coincide con `n` manda el sentinel 0 (sin tope, "Los N" de antes) en
          // vez de su propio número — es el mismo botón, no uno aparte.
          const valorEfectivo = valor === n ? 0 : valor;
          const seleccionado = !deshabilitado
            && (topeBorrador === 0 ? valor === n : valor === topeBorrador);
          return (
            <Pressable
              key={valor}
              onPress={() => onCambiarTope(valorEfectivo)}
              disabled={deshabilitado}
              accessibilityRole="button"
              accessibilityState={{ selected: seleccionado, disabled: deshabilitado }}
              accessibilityLabel={
                deshabilitado
                  ? `${valor}, deshabilitado — elegí al menos ${valor} supers para usar esta opción`
                  : valor === n
                    ? `Sin tope, comparar los ${n} supers elegidos`
                    : `Como mucho ${valor} super${valor === 1 ? '' : 's'}`
              }
              style={[
                styles.opcionTope,
                deshabilitado
                  ? { backgroundColor: paleta.superficieAlt }
                  : seleccionado
                    ? { backgroundColor: paleta.tinta }
                    : { boxShadow: `inset 0 0 0 1px ${paleta.bordeFuerte}` },
              ]}
            >
              <Text
                style={[
                  texto.cuerpoMedio,
                  {
                    fontFamily: seleccionado ? fuentes.semi : fuentes.medio,
                    color: deshabilitado
                      ? paleta.tintaTenue
                      : seleccionado ? paleta.superficie : paleta.tinta,
                  },
                ]}
              >
                {valor}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <LineaCostoTope paleta={paleta} n={n} tope={topeBorrador} monto={monto} carritoVacio={carritoVacio} />
    </View>
  );
}

function LineaCostoTope({
  paleta, n, tope, monto, carritoVacio,
}: { paleta: Paleta; n: number; tope: number; monto: number | null; carritoVacio: boolean }) {
  if (tope === 0) {
    return (
      <Text style={[texto.cuerpo, { color: paleta.tintaSuave }, textoPretty]}>
        Estás comparando los {n} supers elegidos.
      </Text>
    );
  }
  // Sin carrito no hay nada que comparar (la hoja se abre hoy desde Buscar, donde puede no
  // haber nada agregado todavía) — y `monto === null` también cubre "todavía no llegó la
  // respuesta"/"falló": en ningún caso hay un spinner, la línea directamente "aparece".
  if (carritoVacio || monto === null) return null;
}

const styles = StyleSheet.create({
  fondo: { flex: 1, justifyContent: 'flex-end' },
  hoja: {
    maxHeight: '85%',
    borderTopLeftRadius: radio.pantalla, borderTopRightRadius: radio.pantalla,
    paddingTop: espacio.pantalla, paddingHorizontal: espacio.pantalla, paddingBottom: espacio.xl, gap: espacio.lg,
  },
  encabezado: { gap: 4 },
  inputBusqueda: {
    height: 44, borderRadius: radio.md, paddingHorizontal: espacio.md, marginTop: espacio.md,
    fontFamily: fuentes.cuerpo, fontSize: 15, lineHeight: 21,
    outlineWidth: 0, outlineStyle: 'none',
  },
  bloqueTope: { gap: 10, borderBottomWidth: 1, paddingBottom: espacio.lg },
  filaTope: { flexDirection: 'row', gap: 6 },
  opcionTope: { flex: 1, height: 44, borderRadius: radio.chip, alignItems: 'center', justifyContent: 'center' },
  contenedorLista: { position: 'relative', flex: 1, minHeight: 0 },
  lista: { flex: 1 },
  listaContenido: { gap: espacio.lg },
  grupo: { gap: espacio.sm },
  separador: { height: 1 },
  fila: {
    flexDirection: 'row', alignItems: 'center', gap: espacio.md, paddingVertical: espacio.sm,
  },
  filaBloqueada: { opacity: 0.5 },
  checkbox: {
    width: 22, height: 22, borderRadius: radio.sm, alignItems: 'center', justifyContent: 'center',
  },
  check: { fontFamily: fuentes.semi, fontSize: 13 },
  barraColorFila: { width: 24, height: 8, borderRadius: radio.pill },
  nombreFila: { flex: 1 },
});
