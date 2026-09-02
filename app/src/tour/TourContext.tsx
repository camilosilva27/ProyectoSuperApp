/**
 * Motor del tour interactivo (reemplaza a ComoFunciona.tsx, ver TOUR-interactivo-handoff.md).
 *
 * Un solo mecanismo: `useTourPaso(id, cumplido)` se llama en el componente real que ya tiene
 * el dato que decide si el paso está cumplido (su propio estado local o un contexto global
 * existente) y devuelve un ref para ponerle al elemento real. No hay Context de React para el
 * estado del tour — es un store externo (`useSyncExternalStore`) para que escribir estado del
 * tour (ej. cada tecla tipeada en el buscador) no re-renderice todo el árbol que consume un
 * Context, solo lo que de verdad se suscribe acá (el propio overlay).
 *
 * `habilitado` (4to arg de `useTourPaso`): para componentes que se montan más de una vez a la
 * vez (ej. `HojaSupers` vive tanto en Buscar como en Carrito, con tabs que no desmontan al
 * perder foco) — sin esto, la instancia oculta igual registra su ref en `targets` y puede
 * "ganarle" a la visible, dejando al overlay midiendo un elemento que no está en pantalla
 * (bug real: pantalla negra bloqueada, nunca encuentra qué medir).
 *
 * `targets` es un registro module-level (no estado de React): cada `useTourPaso` activo se
 * anota ahí mientras SU paso está activo, y el overlay lo lee para saber qué medir. Vive fuera
 * de React a propósito — no hace falta re-renderizar nada para que un ref exista.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import type { View } from 'react-native';
import { useAuth } from '../auth';
import { useCarrito, type ItemCarrito } from '../carrito';
import { useFiltrosSupers } from '../filtrosSupers';
import { supabase } from '../supabase';
import { ORDEN_PASOS, type PasoId } from './pasos';
import { precargarTour } from './precarga';

const CLAVE_TOUR_VISTO = 'allpromos:tourVisto:v1';

/** Reportado por `useTour()` (efecto sobre `session?.user.id`) — module-level porque
 *  `salirTour` se importa directo en TourOverlay, sin pasar por el hook. Permite que
 *  `marcarVisto` sincronice a `perfil_usuario` sin tener que enhebrar el userId por firma. */
let usuarioIdReportado: string | null = null;

export function tourReportarUsuario(userId: string | null) {
  usuarioIdReportado = userId;
}

type EstadoTour = { activo: boolean; pasoActivo: PasoId | null };

let estado: EstadoTour = { activo: false, pasoActivo: null };
const oyentes = new Set<() => void>();

function fijarEstado(siguiente: EstadoTour) {
  estado = siguiente;
  oyentes.forEach(o => o());
}

function suscribirse(cb: () => void) {
  oyentes.add(cb);
  return () => oyentes.delete(cb);
}

export function useEstadoTour(): EstadoTour {
  return useSyncExternalStore(suscribirse, () => estado, () => estado);
}

/** Registro de refs de los targets activos — module-level, no dispara render por sí solo. Cada
 *  paso apunta a un tipo de elemento distinto (View, TextInput, Pressable...); todos exponen
 *  `measureInWindow`, que es lo único que el overlay necesita, así que el registro no fuerza
 *  un tipo único — `useTourPaso` es genérico y cada caller anota el suyo. */
const targets = new Map<PasoId, React.RefObject<unknown>>();

export function refDeTarget(id: PasoId): React.RefObject<unknown> | undefined {
  return targets.get(id);
}

/** Reportado una vez por la pantalla Buscar (ver index.tsx) — es un dato físico de layout, no
 *  una condición de avance, por eso no pasa por `useTourPaso`. */
let altoTabBarReportado: number | null = null;

export function tourReportarAltoTabBar(alto: number) {
  if (alto > 0) altoTabBarReportado = alto;
}

export function tourAltoTabBar(): number | null {
  return altoTabBarReportado;
}

function avanzarDesde(id: PasoId) {
  // Guarda contra llamadas rezagadas: si el paso ya cambió (por otra vía) entre que se disparó
  // el efecto y que corrió, no hay que volver a avanzar.
  if (!estado.activo || estado.pasoActivo !== id) return;
  const idx = ORDEN_PASOS.indexOf(id);
  const siguiente = ORDEN_PASOS[idx + 1] ?? null;
  if (siguiente) {
    fijarEstado({ activo: true, pasoActivo: siguiente });
  } else {
    // Paso de cierre: sin cartel, sin bloqueo — es el premio (handoff §3), la pantalla de
    // resultado se ve tal cual.
    marcarVisto();
    fijarEstado({ activo: false, pasoActivo: null });
  }
}

/** Avance imperativo, para los pocos pasos donde la acción que completa el paso es que el
 *  propio componente se desmonte (cerrar la hoja de supers) — ahí no sirve un booleano
 *  `cumplido` porque para cuando se cumple, el componente ya no está. */
export function avanzarTour(id: PasoId) {
  avanzarDesde(id);
}

function marcarVisto() {
  AsyncStorage.setItem(CLAVE_TOUR_VISTO, '1').catch(() => {});
  // Además de local: así viaja entre dispositivos/navegadores de la misma cuenta, en vez de
  // depender de un storage que no se comparte entre ellos.
  if (usuarioIdReportado) {
    supabase.from('perfil_usuario').update({ tour_visto: true }).eq('id', usuarioIdReportado).then(() => {}, () => {});
  }
}

/** `userId`: si se pasa (usuario logueado), `perfil_usuario.tour_visto` es la fuente de verdad
 *  (viaja entre dispositivos); si no hay fila o falla la consulta, cae al storage local. */
export async function tourYaVisto(userId: string | null): Promise<boolean> {
  if (userId) {
    const { data } = await supabase.from('perfil_usuario').select('tour_visto').eq('id', userId).single();
    if (data) return !!data.tour_visto;
  }
  return !!(await AsyncStorage.getItem(CLAVE_TOUR_VISTO));
}

/** Reset de estado de pantalla "en progreso" que las pantallas (Buscar, Carrito) registran acá
 *  — texto ya escrito en el buscador, la hoja de supers ya abierta, etc. Sin esto, arrancar el
 *  tour con ese estado dejado de una navegación previa deja el primer paso ya "cumplido" de
 *  entrada (mismo bug de fondo que `useTourPaso` ya evita con el patrón de "toque real", pero
 *  acá aplicado a estado que existe ANTES de que el tour arranque, no durante un paso activo) o
 *  la hoja tapando la pantalla sin que nada la cierre. Corre en cada arranque real del tour
 *  (los 3 puntos de entrada pasan por `iniciarTour`), nunca durante los pasos en sí. */
const reiniciadoresDePantalla = new Set<() => void>();

export function tourRegistrarReinicio(fn: () => void): () => void {
  reiniciadoresDePantalla.add(fn);
  return () => reiniciadoresDePantalla.delete(fn);
}

export function iniciarTour() {
  reiniciadoresDePantalla.forEach(fn => fn());
  fijarEstado({ activo: true, pasoActivo: ORDEN_PASOS[0] });
}

export function salirTour() {
  marcarVisto();
  fijarEstado({ activo: false, pasoActivo: null });
}

/**
 * Hook colocado: se llama donde ya vive el dato que decide si el paso está cumplido. Mientras
 * el paso `id` está activo, registra el ref devuelto en `targets` (para que el overlay lo
 * mida) y, apenas `cumplido` pasa a `true`, avanza al siguiente paso. `alCompletar` corre justo
 * antes de avanzar — para efectos que necesitan algo del propio componente (ej. `useRouter()`
 * en la pantalla de Descuentos para volver a Buscar).
 */
export function useTourPaso<T = View>(
  id: PasoId, cumplido: boolean, alCompletar?: () => void, habilitado = true
): React.RefObject<T | null> {
  const ref = useRef<T>(null);
  const { activo, pasoActivo } = useEstadoTour();
  const esPasoActivo = activo && pasoActivo === id && habilitado;

  useEffect(() => {
    if (!esPasoActivo) return;
    targets.set(id, ref);
    return () => {
      if (targets.get(id) === ref) targets.delete(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `ref` es estable (useRef)
  }, [esPasoActivo, id]);

  useEffect(() => {
    if (!esPasoActivo || !cumplido) return;
    alCompletar?.();
    avanzarDesde(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `alCompletar` se recrea cada
    // render en los callers (closures sobre router/estado local); solo importa que corra una
    // vez cuando `cumplido` pasa a true en el paso activo, no en cada identidad nueva de la función.
  }, [esPasoActivo, cumplido, id]);

  return ref;
}

/** Para los 3 puntos de entrada (auto-onboarding, botón en Buscar, botón en Ajustes). Centraliza
 *  acá la precarga de productos y el forzado de supers (ver precarga.ts) en vez de tocar la
 *  firma de `iniciarTour` — así los 3 call-sites la reciben gratis con solo llamar a `iniciar()`.
 *
 *  A pedido: iniciar el tour (incluso reabriéndolo manualmente) SIEMPRE fuerza Vea+Carrefour
 *  como únicos supers activos y pisa el carrito con la demo — no hay guard de "solo si está
 *  vacío". El forzado de supers es síncrono (no espera red); la precarga de productos si falla
 *  no toca el carrito (ver precarga.ts). */
export function useTour() {
  const { activo, pasoActivo } = useEstadoTour();
  const carrito = useCarrito();
  const { setSupersYTope } = useFiltrosSupers();
  const { session } = useAuth();
  const userId = session?.user.id ?? null;

  useEffect(() => {
    tourReportarUsuario(userId);
  }, [userId]);

  // Se actualiza en CADA render (no depende del closure memoizado de `iniciar`, que solo se
  // recrea cuando cambia `session?.access_token`) — así, al arrancar el tour, siempre se
  // guarda el carrito real tal cual está en ese momento, no una foto vieja de cuando `iniciar`
  // se creó por última vez.
  const carritoActualRef = useRef(carrito.items);
  carritoActualRef.current = carrito.items;
  // Foto del carrito real justo antes de que la precarga lo pise con la demo — se restaura al
  // terminar el tour (ver el efecto de más abajo), sea que se complete entero o se corte con
  // "Finalizar": todo lo que pasa con el carrito durante el tour (la demo + lo que el usuario
  // toque siguiendo los pasos) es parte de la práctica, no compras reales.
  const carritoAntesDelTourRef = useRef<ItemCarrito[] | null>(null);

  const iniciar = useCallback(() => {
    carritoAntesDelTourRef.current = carritoActualRef.current;
    setSupersYTope(['vea', 'carr'], 0);
    precargarTour(session?.access_token ?? null, carrito.vaciar, carrito.agregar);
    iniciarTour();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `carrito`/`setSupersYTope` son
    // estables por render (mismo patrón que el resto del archivo); solo importa que `iniciar`
    // no cambie de identidad en cada render de quien lo consume.
  }, [session?.access_token]);

  // Restaura el carrito apenas el tour deja de estar activo (`activo` pasa de `true` a
  // `false`) — cubre tanto llegar al último paso como cortar con "Finalizar" en cualquier
  // punto, las dos formas de "terminar el tutorial".
  const activoAnteriorRef = useRef(activo);
  useEffect(() => {
    if (activoAnteriorRef.current && !activo && carritoAntesDelTourRef.current) {
      carrito.reemplazarItems(carritoAntesDelTourRef.current);
      carritoAntesDelTourRef.current = null;
    }
    activoAnteriorRef.current = activo;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `carrito` es estable por render
  }, [activo]);

  return { activo, pasoActivo, iniciar, salir: salirTour };
}
