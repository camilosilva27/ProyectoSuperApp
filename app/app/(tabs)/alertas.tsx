/**
 * Pantalla Alertas (diseño 20a-20g, Claude Design turno 20, 2026-09-10): seguir productos
 * puntuales (y, en un modo separado, categorías — sin lógica de aviso todavía, ver
 * src/alertas.ts) para recibir mail + push apenas les aparece una promoción. Reemplaza a
 * "Ahorros" en la nav bar.
 *
 * El interruptor "Recibir notificaciones" (push + email juntos, sin split por canal) reusa
 * `FilaToggleAnimada` — el mismo componente que ya usa "Recordatorio semanal" en Ajustes — en
 * vez del switch tipo píldora del mockup: no vale la pena un componente nuevo para un solo uso
 * más cuando ya hay un patrón de toggle establecido en toda la app.
 */

import { useFocusEffect, useRouter } from 'expo-router';
import Head from 'expo-router/head';
import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { categoriasCatalogo, estadoProductosSeguidos, type CategoriaCatalogo, type EstadoPromoSeguido } from '../../src/api';
import {
  TOPE_PRODUCTOS_SEGUIDOS, useAlertasActivas, useCategoriasSeguidas, useProductosSeguidos,
} from '../../src/alertas';
import { useAuth } from '../../src/auth';
import { DejarDeSeguirHoja } from '../../src/componentes/DejarDeSeguirHoja';
import { Cargando, FilaToggleAnimada } from '../../src/componentes/comunes';
import { HeaderNegro, TituloHeader } from '../../src/componentes/HeaderNegro';
import { espacio, fuentes, radio, texto, usePantallaBaja, type Paleta } from '../../src/theme';
import { useTema } from '../../src/useTema';

type Modo = 'productos' | 'categorias';

export default function PantallaAlertas() {
  const { paleta } = useTema();
  const pantallaBaja = usePantallaBaja();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { session } = useAuth();
  const [modo, setModo] = useState<Modo>('productos');
  const { activas, cambiar: cambiarActivas, recargar: recargarActivas } = useAlertasActivas();
  const { productos, cargando: cargandoProductos, dejarDeSeguir, recargar: recargarProductos } = useProductosSeguidos();
  const { categorias: categoriasSeguidas, alternar: alternarCategoria, recargar: recargarCategorias } = useCategoriasSeguidas();
  const [catalogoCategorias, setCatalogoCategorias] = useState<CategoriaCatalogo[]>([]);
  const [paraDejarDeSeguir, setParaDejarDeSeguir] = useState<{ ean: string; nombre: string } | null>(null);
  const [promoPorEan, setPromoPorEan] = useState<Map<string, EstadoPromoSeguido>>(new Map());

  // Las tabs de expo-router no se desmontan al cambiar de tab, así que el efecto de carga
  // inicial de cada hook (useProductosSeguidos, etc.) no vuelve a correr solo. Sin esto, volver
  // acá después de seguir un producto en /seguir-producto seguía mostrando la lista vieja —
  // encontrado probando en navegador antes de dar la feature por terminada.
  useFocusEffect(useCallback(() => {
    recargarProductos();
    recargarCategorias();
    recargarActivas();
  }, [recargarProductos, recargarCategorias, recargarActivas]));

  useEffect(() => {
    if (modo !== 'categorias' || !session?.access_token || catalogoCategorias.length) return;
    categoriasCatalogo(session.access_token)
      .then(r => setCatalogoCategorias(r.categorias))
      .catch(() => setCatalogoCategorias([]));
  }, [modo, session?.access_token, catalogoCategorias.length]);

  // Chip amarillo con el % de descuento de cada producto seguido (estado EN VIVO, no lo que se
  // usó para el último aviso) — se re-pide cada vez que cambia la lista de seguidos.
  useEffect(() => {
    if (!session?.access_token || !productos.length) { setPromoPorEan(new Map()); return; }
    estadoProductosSeguidos(productos.map(p => p.ean), session.access_token)
      .then(r => setPromoPorEan(new Map(r.resultados.map(e => [e.ean, e]))))
      .catch(() => setPromoPorEan(new Map()));
  }, [productos, session?.access_token]);

  return (
    <View style={{ flex: 1, backgroundColor: paleta.fondo }}>
      <Head><title>Alertas - Super App</title></Head>
      <HeaderNegro paddingTop={insets.top + (pantallaBaja ? espacio.md : espacio.xl)}>
        <TituloHeader>ALERTAS</TituloHeader>
        <Text style={[texto.cuerpoMedio, { color: '#C6CCD3' }]}>
          Te avisamos cuando salga una promo de lo que seguís.
        </Text>
      </HeaderNegro>

      <ScrollView contentContainerStyle={[styles.cuerpo, { paddingBottom: insets.bottom + espacio.xl }]}>
        <SegmentadoModo modo={modo} onCambiar={setModo} paleta={paleta} />

        <FilaToggleAnimada
          paleta={paleta}
          nombre="Recibir notificaciones"
          activa={activas}
          onCambiar={cambiarActivas}
          accessibilityLabel={`Recibir notificaciones ${activas ? 'activado' : 'desactivado'}`}
        />

        {modo === 'categorias' ? (
          <View style={[styles.bannerEnCamino, { backgroundColor: paleta.ofertaSuave, borderColor: paleta.oferta }]}>
            <Text style={[texto.etiqueta, { color: paleta.ofertaTinta, letterSpacing: 0.9 }]}>EN CAMINO</Text>
            <Text style={[texto.cuerpo, { color: paleta.tinta }]}>
              Las alertas por categoría se activan en la próxima versión. Podés elegirlas ahora y quedan guardadas.
            </Text>
          </View>
        ) : null}

        {modo === 'productos' ? (
          cargandoProductos ? (
            <Cargando />
          ) : (
            <View style={{ gap: espacio.sm }}>
              <View style={styles.filaTitulo}>
                <Text style={[texto.subtitulo, { color: paleta.tinta }]}>Productos que seguís</Text>
                <Text style={[texto.etiqueta, { color: paleta.tintaSuave }]}>
                  {productos.length} de {TOPE_PRODUCTOS_SEGUIDOS}
                </Text>
              </View>
              {productos.map(p => (
                <FilaSeguido
                  key={p.ean}
                  nombre={p.nombre}
                  paleta={paleta}
                  descuentoPct={promoPorEan.get(p.ean)?.descuentoPct ?? null}
                  onDestildar={() => setParaDejarDeSeguir(p)}
                />
              ))}
              <BotonSeguirNuevo
                texto="Seguir un producto"
                deshabilitado={productos.length >= TOPE_PRODUCTOS_SEGUIDOS}
                onPress={() => router.push('/seguir-producto')}
                paleta={paleta}
              />
            </View>
          )
        ) : (
          <View style={{ gap: espacio.sm }}>
            <View style={styles.filaTitulo}>
              <Text style={[texto.subtitulo, { color: paleta.tinta }]}>Categorías</Text>
              <Text style={[texto.etiqueta, { color: paleta.tintaSuave }]}>
                {categoriasSeguidas.length} elegida{categoriasSeguidas.length === 1 ? '' : 's'}
              </Text>
            </View>
            {catalogoCategorias.map(c => (
              <FilaSeguido
                key={c.nombre}
                nombre={c.nombre}
                seguido={categoriasSeguidas.includes(c.nombre)}
                paleta={paleta}
                onDestildar={() => alternarCategoria(c.nombre)}
                onSeguir={() => alternarCategoria(c.nombre)}
              />
            ))}
            <Text style={[texto.cuerpo, { color: paleta.tintaSuave }]}>
              Una categoría puede tener muchas promos por día, así que en cuanto se active vamos a mandar un solo aviso agrupado.
            </Text>
          </View>
        )}
      </ScrollView>

      <DejarDeSeguirHoja
        producto={paraDejarDeSeguir}
        onCancelar={() => setParaDejarDeSeguir(null)}
        onConfirmar={async () => {
          if (paraDejarDeSeguir) await dejarDeSeguir(paraDejarDeSeguir.ean);
          setParaDejarDeSeguir(null);
        }}
      />
    </View>
  );
}

function SegmentadoModo({
  modo, onCambiar, paleta,
}: { modo: Modo; onCambiar: (m: Modo) => void; paleta: Paleta }) {
  return (
    <View style={[styles.segmentado, { backgroundColor: paleta.superficieAlt }]}>
      {(['productos', 'categorias'] as const).map(m => (
        <Pressable
          key={m}
          onPress={() => onCambiar(m)}
          accessibilityRole="button"
          accessibilityState={{ selected: modo === m }}
          style={[
            styles.segmento,
            modo === m && { backgroundColor: paleta.superficie, shadowOpacity: 0.1 },
          ]}
        >
          <Text style={[texto.cuerpoMedio, { color: modo === m ? paleta.tinta : paleta.tintaSuave }]}>
            {m === 'productos' ? 'Productos' : 'Categorías'}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

/** Fila de un producto/categoría seguido, con tinte amarillo — mismo criterio visual que las
 *  filas de "Mis descuentos" (ver diseño 20a: "mismo tinte amarillo de Mis descuentos"). Si
 *  recibe `onSeguir` (modo categorías) también sirve para elegir algo que todavía no se sigue,
 *  mostrado sin tinte. */
function FilaSeguido({
  nombre, paleta, onDestildar, onSeguir, seguido = true, descuentoPct = null,
}: {
  nombre: string;
  paleta: Paleta;
  onDestildar: () => void;
  onSeguir?: () => void;
  seguido?: boolean;
  descuentoPct?: number | null;
}) {
  return (
    <Pressable
      onPress={seguido ? onDestildar : onSeguir}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: seguido }}
      accessibilityLabel={`${nombre}, ${seguido ? 'seguido' : 'no seguido'}${descuentoPct ? `, ${descuentoPct}% off` : ''}`}
      style={[
        styles.filaSeguido,
        seguido
          ? { backgroundColor: paleta.ofertaSuave, borderColor: paleta.oferta }
          : { backgroundColor: paleta.superficie, borderColor: paleta.borde },
      ]}
    >
      <Text style={[texto.cuerpoMedio, { color: paleta.tinta, flex: 1 }]} numberOfLines={1}>{nombre}</Text>
      {descuentoPct ? (
        <View style={[styles.chipDescuento, { backgroundColor: paleta.oferta }]}>
          <Text style={[texto.micro, { color: paleta.ofertaTinta }]}>-{descuentoPct}%</Text>
        </View>
      ) : null}
      <View style={[
        styles.checkSeguido,
        seguido ? { backgroundColor: paleta.tinta, borderColor: paleta.tinta } : { borderColor: paleta.bordeFuerte },
      ]}>
        {seguido ? <Text style={{ color: paleta.oferta, fontFamily: fuentes.semi, fontSize: 13, lineHeight: 13 }}>✓</Text> : null}
      </View>
    </Pressable>
  );
}

function BotonSeguirNuevo({
  texto: textoBoton, onPress, paleta, deshabilitado,
}: { texto: string; onPress: () => void; paleta: Paleta; deshabilitado?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={deshabilitado}
      accessibilityRole="button"
      style={[styles.botonSeguirNuevo, { borderColor: paleta.bordeFuerte, opacity: deshabilitado ? 0.5 : 1 }]}
    >
      <Text style={[texto.cuerpoMedio, { color: paleta.tinta }]}>+ {textoBoton}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  cuerpo: { padding: espacio.pantalla, gap: espacio.lg },
  segmentado: { flexDirection: 'row', borderRadius: radio.sm, padding: 3, gap: 3 },
  segmento: { flex: 1, height: 36, borderRadius: radio.sm - 2, alignItems: 'center', justifyContent: 'center' },
  bannerEnCamino: { borderWidth: 1, borderRadius: radio.tarjeta, padding: espacio.md, gap: 4 },
  filaTitulo: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  filaSeguido: {
    borderWidth: 1, borderRadius: radio.tarjeta, padding: espacio.md,
    flexDirection: 'row', alignItems: 'center', gap: espacio.sm,
  },
  chipDescuento: { borderRadius: radio.chip, paddingHorizontal: espacio.sm, paddingVertical: 3 },
  checkSeguido: {
    width: 22, height: 22, borderRadius: 6, borderWidth: 2,
    alignItems: 'center', justifyContent: 'center',
  },
  botonSeguirNuevo: {
    borderWidth: 1.5, borderStyle: 'dashed', borderRadius: radio.tarjeta, height: 52,
    alignItems: 'center', justifyContent: 'center',
  },
});
