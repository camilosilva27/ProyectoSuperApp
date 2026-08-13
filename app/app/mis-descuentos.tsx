/**
 * Pantalla Mis descuentos (rediseño v2, SPEC.md § 4.7). Reemplaza a "Tus tarjetas": el
 * nombre viejo era incorrecto — Mi Carrefour es un programa, MODO una app, MasClub un club,
 * Cuenta DNI una billetera. Lo que los une es que son cosas que el usuario ya tiene y que
 * desbloquean descuentos, no "tarjetas".
 *
 * El switch de cada fila es la MISMA selección que las tarjetas del carrito (`carrito.
 * tarjetas`) — no hay un estado separado que sincronizar, es una sola fuente de verdad con
 * dos lugares para tocarla.
 */

import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import React from 'react';
import {
  ActivityIndicator, Pressable, ScrollView, StyleSheet, Switch, Text, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ErrorApi, misDescuentos, type Descuento } from '../src/api';
import { useCarrito } from '../src/carrito';
import { Problema } from '../src/componentes/comunes';
import { HeaderNegro } from '../src/componentes/HeaderNegro';
import { espacio, pesos, radio, texto } from '../src/theme';
import { useTema } from '../src/useTema';

function descripcionDe(d: Descuento): string {
  if (!d.disponible || d.descuentoPct == null) return 'Sin promo vigente ahora';
  const pct = `${Math.round(d.descuentoPct * 100)}%`;
  const dias = d.dias.length ? ` los ${d.dias.join(', ')}` : '';
  const tope = d.tope != null ? ` · tope ${pesos(d.tope)}` : '';
  return `${pct}${dias}${tope}`;
}

export default function PantallaMisDescuentos() {
  const { paleta } = useTema();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const carrito = useCarrito();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['mis-descuentos'],
    queryFn: misDescuentos,
    staleTime: 10 * 60 * 1000,
  });

  return (
    <View style={{ flex: 1, backgroundColor: paleta.fondo }}>
      <HeaderNegro paddingTop={insets.top + espacio.md} estilo={{ gap: espacio.sm }}>
        <Pressable onPress={() => router.back()} accessibilityRole="button" style={styles.filaVolver}>
          <Text style={styles.flecha}>‹</Text>
          <Text style={[texto.tituloHeader, styles.titulo]}>Mis descuentos</Text>
        </Pressable>
        <Text style={[texto.cuerpo, styles.bajada]}>
          Tarjetas, apps y clubes que tenés. Sus promos se suman al comparar.
        </Text>
      </HeaderNegro>

      {isLoading ? (
        <View style={styles.centrado}>
          <ActivityIndicator color={paleta.tintaSuave} />
        </View>
      ) : error || !data ? (
        <View style={styles.centrado}>
          <Problema
            mensaje={error instanceof ErrorApi ? error.message : 'No se pudieron consultar las promos bancarias.'}
            onReintentar={refetch}
          />
        </View>
      ) : (
        <ScrollView contentContainerStyle={[styles.contenido, { paddingBottom: insets.bottom + espacio.xl }]}>
          <View style={[styles.lista, { borderColor: paleta.borde }]}>
            {data.descuentos.map((d, i) => {
              const activa = carrito.tarjetas.includes(d.nombre);
              return (
                <View key={d.nombre}>
                  {i > 0 ? <View style={[styles.separador, { backgroundColor: paleta.borde }]} /> : null}
                  <View style={styles.fila}>
                    <View style={{ flex: 1, gap: 3 }}>
                      <Text style={[texto.cuerpoMedio, { color: activa ? paleta.tinta : paleta.tintaSuave }]}>
                        {d.nombre}
                      </Text>
                      <Text style={[texto.dato, { color: paleta.tintaTenue }]}>{descripcionDe(d)}</Text>
                    </View>
                    <Switch
                      value={activa}
                      onValueChange={valor =>
                        carrito.setTarjetas(
                          valor
                            ? [...carrito.tarjetas, d.nombre]
                            : carrito.tarjetas.filter(t => t !== d.nombre)
                        )
                      }
                      trackColor={{ false: paleta.borde, true: paleta.oferta }}
                      thumbColor="#FFFFFF"
                      accessibilityLabel={`${activa ? 'Tengo' : 'No tengo'} ${d.nombre}`}
                    />
                  </View>
                </View>
              );
            })}
          </View>

          <View style={[styles.bloqueInfo, { backgroundColor: paleta.superficieAlt }]}>
            <Text style={[texto.cuerpo, { color: paleta.tintaSuave }]}>
              Marcá solo las que tenés de verdad. Las promos de las demás igual se muestran al
              comparar, avisando que no están contadas.
            </Text>
          </View>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  filaVolver: { flexDirection: 'row', alignItems: 'center', gap: espacio.md },
  flecha: { fontSize: 22, color: '#FFFFFF' },
  titulo: { fontSize: 26, lineHeight: 26, color: '#FFFFFF' },
  bajada: { color: '#FFFFFF', opacity: 0.7 },
  centrado: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: espacio.xl },
  contenido: { padding: espacio.pantalla, gap: espacio.pantalla },
  lista: { borderWidth: 1, borderRadius: radio.tarjeta, paddingHorizontal: espacio.md },
  fila: { flexDirection: 'row', alignItems: 'center', gap: espacio.md, paddingVertical: espacio.md },
  separador: { height: StyleSheet.hairlineWidth },
  bloqueInfo: { borderRadius: radio.tarjeta, padding: espacio.md },
});
