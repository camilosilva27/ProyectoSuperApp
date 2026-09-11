/**
 * Pantalla "Seguir un producto" (diseño 20b, Claude Design turno 20): mismo buscador que
 * Buscar (app/(tabs)/index.tsx) pero sin precio — acá solo importa elegir EAN + nombre, no
 * comparar. El usuario puede tildar varios resultados antes de guardar (checkbox amarillo, ver
 * FilaSeguido en alertas.tsx); GUARDAR aplica la diferencia contra lo que ya seguía en una sola
 * pasada al volver.
 */

import { useRouter } from 'expo-router';
import Head from 'expo-router/head';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { buscarProductos, type ProductoCatalogo } from '../src/api';
import { TOPE_PRODUCTOS_SEGUIDOS, useProductosSeguidos } from '../src/alertas';
import { useAuth } from '../src/auth';
import { BotonPrincipal, Vacio } from '../src/componentes/comunes';
import { espacio, fuentes, radio, texto, usePantallaBaja } from '../src/theme';
import { useTema } from '../src/useTema';

function useTextoDemorado(valor: string, ms = 300) {
  const [demorado, setDemorado] = useState(valor);
  useEffect(() => {
    const t = setTimeout(() => setDemorado(valor), ms);
    return () => clearTimeout(t);
  }, [valor, ms]);
  return demorado;
}

export default function PantallaSeguirProducto() {
  const { paleta } = useTema();
  const pantallaBaja = usePantallaBaja();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { session } = useAuth();
  const { productos: seguidos, cargando: cargandoSeguidos, seguir, dejarDeSeguir } = useProductosSeguidos();

  const [consulta, setConsulta] = useState('');
  const consultaDemorada = useTextoDemorado(consulta.trim());
  const consultaValida = consultaDemorada.length >= 2;
  const [resultados, setResultados] = useState<ProductoCatalogo[]>([]);
  const [buscando, setBuscando] = useState(false);

  // Estado local: parte de lo que ya se seguía, y el usuario lo va tildando/destildando acá
  // sin tocar el servidor hasta tocar GUARDAR.
  const [eansElegidos, setEansElegidos] = useState<Set<string>>(new Set());
  const [nombrePorEan, setNombrePorEan] = useState<Map<string, string>>(new Map());
  const [guardando, setGuardando] = useState(false);

  // Recién cuando termina el fetch inicial de `seguidos` (no en el montaje: en ese momento
  // todavía viene vacío porque `useProductosSeguidos` arranca en `cargando=true` y puebla la
  // lista de forma asíncrona) — si esto sembrara `eansElegidos` antes de tiempo, el diff de
  // `guardar()` interpretaría lo ya seguido como "destildado" y lo desseguiría al guardar.
  const sembrado = useRef(false);
  useEffect(() => {
    if (cargandoSeguidos || sembrado.current) return;
    sembrado.current = true;
    const mapa = new Map(seguidos.map(p => [p.ean, p.nombre]));
    setEansElegidos(new Set(seguidos.map(p => p.ean)));
    setNombrePorEan(mapa);
  }, [cargandoSeguidos, seguidos]);

  useEffect(() => {
    if (!consultaValida || !session?.access_token) { setResultados([]); return; }
    setBuscando(true);
    buscarProductos(consultaDemorada, session.access_token, { limit: 20 })
      .then(r => setResultados(r.resultados))
      .catch(() => setResultados([]))
      .finally(() => setBuscando(false));
  }, [consultaValida, consultaDemorada, session?.access_token]);

  const alTope = eansElegidos.size >= TOPE_PRODUCTOS_SEGUIDOS;

  const alternar = (p: ProductoCatalogo) => {
    setEansElegidos(actual => {
      const nuevo = new Set(actual);
      if (nuevo.has(p.ean)) {
        nuevo.delete(p.ean);
      } else {
        if (nuevo.size >= TOPE_PRODUCTOS_SEGUIDOS) return actual;
        nuevo.add(p.ean);
        setNombrePorEan(m => new Map(m).set(p.ean, p.nombre));
      }
      return nuevo;
    });
  };

  const volver = () => (router.canGoBack() ? router.back() : router.replace('/alertas'));

  const guardar = async () => {
    setGuardando(true);
    const antes = new Set(seguidos.map(p => p.ean));
    const aAgregar = [...eansElegidos].filter(ean => !antes.has(ean));
    const aQuitar = [...antes].filter(ean => !eansElegidos.has(ean));
    for (const ean of aAgregar) await seguir(ean, nombrePorEan.get(ean) ?? ean);
    for (const ean of aQuitar) await dejarDeSeguir(ean);
    setGuardando(false);
    volver();
  };

  return (
    <View style={{ flex: 1, backgroundColor: paleta.fondo }}>
      <Head><title>Seguir un producto - Super App</title></Head>
      <View style={[styles.header, { backgroundColor: paleta.tinta, paddingTop: insets.top + espacio.lg }]}>
        <Pressable onPress={volver} accessibilityRole="button" style={styles.filaVolver}>
          <Text style={styles.flechaVolver}>‹</Text>
          <Text style={[texto.tituloHeader, pantallaBaja && styles.tituloCompacto, { color: '#FFFFFF' }]}>
            SEGUIR UN PRODUCTO
          </Text>
        </Pressable>
        <View style={[styles.buscador, { backgroundColor: paleta.superficie }]}>
          <TextInput
            value={consulta}
            onChangeText={setConsulta}
            placeholder="yerba, fideos, shampoo…"
            placeholderTextColor={paleta.tintaTenue}
            style={[texto.cuerpo, styles.input, { color: paleta.tinta }]}
            autoCorrect={false}
            autoCapitalize="none"
            returnKeyType="search"
            accessibilityLabel="Buscar un producto para seguir"
          />
          {buscando ? <ActivityIndicator size="small" color={paleta.tintaTenue} /> : null}
        </View>
      </View>

      {!consultaValida ? (
        <Vacio
          titulo="Buscá el producto que querés seguir"
          detalle="Te avisamos cada vez que aparezca una promo, con los supers y medios de pago que ya tenés elegidos."
        />
      ) : (
        <FlatList
          data={resultados}
          keyExtractor={p => p.ean}
          contentContainerStyle={[styles.lista, { paddingBottom: insets.bottom + espacio.xl }]}
          ItemSeparatorComponent={() => <View style={{ height: espacio.sm }} />}
          ListEmptyComponent={!buscando ? (
            <Text style={[texto.cuerpo, { color: paleta.tintaSuave, textAlign: 'center', marginTop: espacio.xl }]}>
              No encontramos productos con ese nombre.
            </Text>
          ) : null}
          renderItem={({ item }) => {
            const elegido = eansElegidos.has(item.ean);
            return (
              <Pressable
                onPress={() => alternar(item)}
                disabled={!elegido && alTope}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: elegido, disabled: !elegido && alTope }}
                style={[
                  styles.filaResultado,
                  elegido
                    ? { backgroundColor: paleta.ofertaSuave, borderColor: paleta.oferta }
                    : { backgroundColor: paleta.superficie, borderColor: paleta.borde, opacity: alTope ? 0.5 : 1 },
                ]}
              >
                <Text style={[texto.cuerpoMedio, { color: paleta.tinta, flex: 1 }]} numberOfLines={1}>
                  {item.nombre}
                </Text>
                <View style={[
                  styles.check,
                  elegido ? { backgroundColor: paleta.tinta, borderColor: paleta.tinta } : { borderColor: paleta.bordeFuerte },
                ]}>
                  {elegido ? <Text style={{ color: paleta.oferta, fontFamily: fuentes.semi, fontSize: 13, lineHeight: 13 }}>✓</Text> : null}
                </View>
              </Pressable>
            );
          }}
        />
      )}

      <View style={[styles.pieGuardar, { backgroundColor: paleta.fondo, paddingBottom: insets.bottom + espacio.md }]}>
        <BotonPrincipal onPress={guardar} cargando={guardando}>Guardar</BotonPrincipal>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: espacio.pantalla, paddingBottom: espacio.lg, gap: espacio.md },
  filaVolver: { flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start' },
  flechaVolver: { fontSize: 22, color: '#FFFFFF' },
  tituloCompacto: { fontSize: 26, lineHeight: 26 },
  buscador: { borderRadius: radio.sm, paddingHorizontal: espacio.md, height: 50, flexDirection: 'row', alignItems: 'center', gap: espacio.sm },
  input: { flex: 1, height: '100%', outlineWidth: 0, outlineStyle: 'none' },
  lista: { padding: espacio.pantalla, gap: espacio.sm },
  filaResultado: {
    borderWidth: 1, borderRadius: radio.tarjeta, padding: espacio.md,
    flexDirection: 'row', alignItems: 'center', gap: espacio.sm,
  },
  check: { width: 22, height: 22, borderRadius: 6, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  pieGuardar: { padding: espacio.pantalla, paddingTop: espacio.sm },
});
