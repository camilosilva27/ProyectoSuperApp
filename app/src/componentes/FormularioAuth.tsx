/**
 * Formulario de registro/login — reusado en el prompt post-onboarding (PromptCuenta.tsx) y en
 * la sección de cuenta de Ajustes. No navega ni cierra nada por su cuenta: avisa con `onExito`
 * cuando hay sesión nueva, el que lo use decide qué hacer (cerrar un modal, no hacer nada, etc).
 */

import React, { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useAuth } from '../auth';
import { espacio, radio, texto } from '../theme';
import { useTema } from '../useTema';

export function FormularioAuth({ onExito }: { onExito?: () => void }) {
  const { paleta } = useTema();
  const { registrarse, iniciarSesion } = useAuth();
  const [modo, setModo] = useState<'registro' | 'login'>('registro');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mailPendiente, setMailPendiente] = useState<string | null>(null);

  const enviar = async () => {
    if (!email.trim() || !password) {
      setError('Completá mail y contraseña.');
      return;
    }
    setEnviando(true);
    setError(null);
    if (modo === 'registro') {
      const r = await registrarse(email.trim(), password);
      setEnviando(false);
      if (r.error) { setError(r.error); return; }
      if (r.necesitaConfirmarMail) { setMailPendiente(email.trim()); return; }
      onExito?.();
    } else {
      const r = await iniciarSesion(email.trim(), password);
      setEnviando(false);
      if (r.error) { setError(r.error); return; }
      onExito?.();
    }
  };

  if (mailPendiente) {
    return (
      <Text style={[texto.prosa, { color: paleta.tinta }]}>
        Te mandamos un mail a {mailPendiente} — confirmalo para poder entrar.
      </Text>
    );
  }

  return (
    <View style={{ gap: espacio.md }}>
      <View style={[styles.campo, { backgroundColor: paleta.superficieAlt }]}>
        <TextInput
          value={email}
          onChangeText={setEmail}
          placeholder="Mail"
          placeholderTextColor={paleta.tintaTenue}
          style={[texto.cuerpo, styles.input, { color: paleta.tinta }]}
          autoCorrect={false}
          autoCapitalize="none"
          keyboardType="email-address"
          textContentType="emailAddress"
          accessibilityLabel="Mail"
        />
      </View>
      <View style={[styles.campo, { backgroundColor: paleta.superficieAlt }]}>
        <TextInput
          value={password}
          onChangeText={setPassword}
          placeholder="Contraseña"
          placeholderTextColor={paleta.tintaTenue}
          style={[texto.cuerpo, styles.input, { color: paleta.tinta }]}
          secureTextEntry
          autoCapitalize="none"
          textContentType={modo === 'registro' ? 'newPassword' : 'password'}
          accessibilityLabel="Contraseña"
        />
      </View>

      {error ? <Text style={[texto.etiqueta, { color: paleta.alerta }]}>{error}</Text> : null}

      <Pressable
        onPress={enviar}
        disabled={enviando}
        accessibilityRole="button"
        style={[styles.boton, { backgroundColor: paleta.tinta, opacity: enviando ? 0.6 : 1 }]}
      >
        {enviando ? (
          <ActivityIndicator color={paleta.superficie} />
        ) : (
          <Text style={[texto.cuerpoMedio, { color: paleta.superficie }]}>
            {modo === 'registro' ? 'Crear cuenta' : 'Iniciar sesión'}
          </Text>
        )}
      </Pressable>

      <Pressable
        onPress={() => { setModo(m => (m === 'registro' ? 'login' : 'registro')); setError(null); }}
        accessibilityRole="button"
        style={styles.filaToggle}
      >
        <Text style={[texto.etiqueta, { color: paleta.tintaSuave, textDecorationLine: 'underline' }]}>
          {modo === 'registro' ? '¿Ya tenés cuenta? Iniciá sesión' : '¿No tenés cuenta? Registrate'}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  campo: {
    borderRadius: radio.md, paddingHorizontal: espacio.md, height: 50, justifyContent: 'center',
  },
  input: { outlineWidth: 0, outlineStyle: 'none' },
  boton: { height: 50, borderRadius: radio.md, alignItems: 'center', justifyContent: 'center' },
  filaToggle: { alignSelf: 'center', height: 44, justifyContent: 'center' },
});
