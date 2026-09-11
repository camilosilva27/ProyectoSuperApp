/**
 * Datos de la pestaña Alertas (ver .claude/docs/mails_y_notificaciones.md tipo #8 y diseño 20a-20g
 * de Claude Design turno 20): productos/categorías seguidos y el interruptor único "Recibir
 * notificaciones" (push + email juntos). Mismo patrón que `plan.ts`/`push.ts` — el frontend
 * habla directo con Supabase (RLS), sin pasar por el backend Express.
 *
 * Tope de 20 productos seguidos: se valida acá para dar feedback inmediato en la UI, pero la
 * defensa real es el trigger `tope_producto_seguido` de la migración 0017 — esto es una
 * comodidad, no la fuente de verdad.
 */

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from './auth';
import { supabase } from './supabase';

export const TOPE_PRODUCTOS_SEGUIDOS = 20;

export type ProductoSeguido = { ean: string; nombre: string };

export function useProductosSeguidos() {
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  const [productos, setProductos] = useState<ProductoSeguido[]>([]);
  const [cargando, setCargando] = useState(true);

  const recargar = useCallback(async () => {
    if (!userId) {
      setProductos([]);
      setCargando(false);
      return;
    }
    setCargando(true);
    const { data } = await supabase
      .from('producto_seguido')
      .select('ean, nombre')
      .eq('usuario_id', userId)
      .order('creado_en', { ascending: true });
    setProductos(data ?? []);
    setCargando(false);
  }, [userId]);

  useEffect(() => { recargar(); }, [recargar]);

  const seguir = useCallback(async (ean: string, nombre: string): Promise<{ ok: boolean; error?: string }> => {
    if (!userId) return { ok: false, error: 'Sin sesión' };
    if (productos.length >= TOPE_PRODUCTOS_SEGUIDOS) {
      return { ok: false, error: `Ya seguís ${TOPE_PRODUCTOS_SEGUIDOS} productos, el máximo permitido` };
    }
    const { error } = await supabase.from('producto_seguido').insert({ usuario_id: userId, ean, nombre });
    if (error && error.code !== '23505') return { ok: false, error: error.message }; // 23505 = ya lo seguía
    await recargar();
    return { ok: true };
  }, [userId, productos.length, recargar]);

  const dejarDeSeguir = useCallback(async (ean: string): Promise<{ ok: boolean; error?: string }> => {
    if (!userId) return { ok: false, error: 'Sin sesión' };
    const { error } = await supabase.from('producto_seguido').delete().eq('usuario_id', userId).eq('ean', ean);
    if (error) return { ok: false, error: error.message };
    await recargar();
    return { ok: true };
  }, [userId, recargar]);

  return { productos, cargando, seguir, dejarDeSeguir, recargar, alTope: productos.length >= TOPE_PRODUCTOS_SEGUIDOS };
}

export function useCategoriasSeguidas() {
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  const [categorias, setCategorias] = useState<string[]>([]);
  const [cargando, setCargando] = useState(true);

  const recargar = useCallback(async () => {
    if (!userId) {
      setCategorias([]);
      setCargando(false);
      return;
    }
    setCargando(true);
    const { data } = await supabase
      .from('categoria_seguida')
      .select('categoria')
      .eq('usuario_id', userId)
      .order('creado_en', { ascending: true });
    setCategorias((data ?? []).map(f => f.categoria));
    setCargando(false);
  }, [userId]);

  useEffect(() => { recargar(); }, [recargar]);

  const alternar = useCallback(async (categoria: string) => {
    if (!userId) return;
    if (categorias.includes(categoria)) {
      await supabase.from('categoria_seguida').delete().eq('usuario_id', userId).eq('categoria', categoria);
    } else {
      const { error } = await supabase.from('categoria_seguida').insert({ usuario_id: userId, categoria });
      if (error && error.code !== '23505') { console.error('No se pudo seguir la categoría:', error.message); return; }
    }
    await recargar();
  }, [userId, categorias, recargar]);

  return { categorias, cargando, alternar, recargar };
}

/** El único interruptor "Recibir notificaciones" (push + email juntos, sin split por canal —
 *  ver diseño 20a). Vive en `perfil_usuario.alertas_activas`, no en su propia tabla. */
export function useAlertasActivas() {
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  const [activas, setActivas] = useState(true);
  const [cargando, setCargando] = useState(true);

  const recargar = useCallback(async () => {
    if (!userId) { setCargando(false); return; }
    setCargando(true);
    const { data } = await supabase.from('perfil_usuario').select('alertas_activas').eq('id', userId).single();
    setActivas(data?.alertas_activas ?? true);
    setCargando(false);
  }, [userId]);

  useEffect(() => { recargar(); }, [recargar]);

  const cambiar = useCallback(async (valor: boolean) => {
    if (!userId) return;
    setActivas(valor); // optimista: es un toggle de preferencia, no una acción con costo real
    const { error } = await supabase.from('perfil_usuario').update({ alertas_activas: valor }).eq('id', userId);
    if (error) { console.error('No se pudo actualizar alertas_activas:', error.message); setActivas(!valor); }
  }, [userId]);

  return { activas, cargando, cambiar, recargar };
}
