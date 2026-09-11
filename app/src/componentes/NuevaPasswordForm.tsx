/**
 * Pantalla "Escribí tu nueva contraseña" — se muestra en vez de la app cuando `necesitaNuevaPassword`
 * está en `true` (GateSesion.tsx), justo después de verificar el link de "olvidé mi contraseña"
 * (auth.tsx § pedirRecuperacion/actualizarPassword). La sesión de recuperación ya es una sesión
 * válida en ese momento, pero forzamos este paso antes de dejar pasar a la app: el usuario vino
 * específicamente a cambiar la contraseña, no a usar la app con la contraseña vieja sin cambiar.
 *
 * Mismos tokens/estructura de tarjeta que FormularioAuth.tsx, sin el hero (no aplica acá).
 */

import React, { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useAuth } from '../auth';
import { espacio, radio, texto } from '../theme';
import { useTema } from '../useTema';

export function NuevaPasswordForm({
  pantallaCompleta, insetSuperior = 0,
}: { pantallaCompleta?: boolean; insetSuperior?: number }) {
  const { paleta } = useTema();
  const { actualizarPassword, cerrarSesion } = useAuth();
  const [password, setPassword] = useState('');
  const [confirmarPassword, setConfirmarPassword] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirmar = async () => {
    if (enviando) return;
    if (!password || password.length < 6) {
      setError('La contraseña tiene que tener al menos 6 caracteres.');
      return;
    }
    if (password !== confirmarPassword) {
      setError('Las contraseñas no coinciden.');
      return;
    }
    setEnviando(true);
    setError(null);
    const r = await actualizarPassword(password);
    setEnviando(false);
    if (r.error) setError(r.error);
    // Sin error: `necesitaNuevaPassword` ya pasó a false dentro de actualizarPassword,
    // GateSesion re-renderiza solo y deja pasar a la app con la sesión ya activa.
  };

  return (
    <View
      style={[
        styles.tarjeta,
        pantallaCompleta && styles.tarjetaCompleta,
        { backgroundColor: paleta.superficie, borderColor: paleta.bordeFuerte, padding: pantallaCompleta ? espacio.xl : espacio.xxl, paddingTop: (pantallaCompleta ? espacio.xl : espacio.xxl) + insetSuperior },
      ]}
    >
      <Text style={[texto.tituloSeccion, { color: paleta.tintaSuave }]}>RECUPERAR CONTRASEÑA</Text>
      <View style={{ gap: espacio.xs, marginTop: espacio.md, marginBottom: espacio.lg }}>
        <Text style={[texto.titulo, { color: paleta.tinta }]}>Escribí tu nueva contraseña</Text>
        <Text style={[texto.cuerpo, { color: paleta.tintaProsa }]}>
          Ya verificamos tu mail — ahora escribí la contraseña que vas a usar de acá en adelante.
        </Text>
      </View>

      <View style={{ gap: espacio.md }}>
        <View style={[styles.campo, { backgroundColor: paleta.superficieAlt }]}>
          <TextInput
            value={password}
            onChangeText={setPassword}
            placeholder="Contraseña nueva · Mínimo 6 caracteres"
            placeholderTextColor={paleta.tintaTenue}
            style={[texto.cuerpo, styles.input, { color: paleta.tinta }]}
            secureTextEntry
            autoCapitalize="none"
            textContentType="newPassword"
            accessibilityLabel="Contraseña nueva"
          />
        </View>
        <View style={[styles.campo, { backgroundColor: paleta.superficieAlt }]}>
          <TextInput
            value={confirmarPassword}
            onChangeText={setConfirmarPassword}
            placeholder="Repetí la contraseña nueva"
            placeholderTextColor={paleta.tintaTenue}
            style={[texto.cuerpo, styles.input, { color: paleta.tinta }]}
            secureTextEntry
            autoCapitalize="none"
            textContentType="newPassword"
            accessibilityLabel="Repetir contraseña nueva"
            returnKeyType="done"
            onSubmitEditing={confirmar}
          />
        </View>

        {error ? <Text style={[texto.etiqueta, { color: paleta.errorTexto }]}>{error}</Text> : null}

        <Pressable
          onPress={confirmar}
          disabled={enviando}
          accessibilityRole="button"
          style={[styles.botonPrincipal, { backgroundColor: paleta.oferta, opacity: enviando ? 0.6 : 1 }]}
        >
          {enviando ? (
            <ActivityIndicator color={paleta.ofertaTinta} />
          ) : (
            <Text style={[styles.textoBotonPrincipal, { color: paleta.ofertaTinta }]}>GUARDAR</Text>
          )}
        </Pressable>

        <Pressable onPress={() => cerrarSesion()} accessibilityRole="button" style={styles.filaToggle}>
          <Text style={[texto.etiqueta, { color: paleta.tintaSuave, textDecorationLine: 'underline' }]}>
            Cancelar y cerrar sesión
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  tarjeta: { flex: 1, borderRadius: radio.lg, borderWidth: 1 },
  tarjetaCompleta: { borderRadius: 0, borderWidth: 0 },
  campo: {
    flexDirection: 'row', alignItems: 'center', gap: espacio.sm,
    borderRadius: radio.md, paddingHorizontal: espacio.md, height: 52,
  },
  input: { flex: 1, outlineWidth: 0, outlineStyle: 'none' },
  botonPrincipal: { minHeight: 56, borderRadius: radio.md, alignItems: 'center', justifyContent: 'center' },
  textoBotonPrincipal: { fontFamily: 'BarlowCondensed_700Bold', fontSize: 22, letterSpacing: 1 },
  filaToggle: { alignSelf: 'center', height: 44, justifyContent: 'center' },
});
