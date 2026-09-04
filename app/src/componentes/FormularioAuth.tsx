/**
 * Formulario de registro/login — reusado en el gate de sesión obligatoria (GateSesion.tsx,
 * Fase 2) y en la sección de cuenta de Ajustes. No navega ni cierra nada por su cuenta: avisa
 * con `onExito` cuando hay sesión nueva, el que lo use decide qué hacer (cerrar un modal, no
 * hacer nada, etc).
 *
 * Diseño de la tarjeta de registro y de la pantalla "confirmá tu mail" siguen
 * design_handoff_allpromos_v2/14b-landing-cuenta.md — con una adaptación deliberada: el spec
 * pide mail solo en el paso 1 y contraseña recién en un paso 3 (después de confirmar el mail),
 * pero `signUp` de Supabase necesita mail+contraseña+nombre juntos para crear la cuenta y
 * mandar el mail (ver `auth.tsx`). Se restyleó la pantalla sin tocar ese mecanismo: el paso 1
 * de acá pide los 3 datos juntos, no uno por pantalla como en el mock.
 *
 * Modo inicial (2026-09-04): quién entra por primera vez ve "Registrate"; quien ya vio esta
 * pantalla antes en este dispositivo (haya llegado a crear cuenta o no) ve "Iniciar sesión" —
 * es la situación más común después del primer uso. Se guarda con un flag simple en
 * AsyncStorage, no con `carrito`/`carritosGuardados` (esos son datos de negocio que migran a
 * Supabase al loguearse; esto es una preferencia de UI local al dispositivo, no del usuario).
 *
 * Google (solo web, ver auth.tsx § iniciarSesionConGoogle): no hay build nativo (App
 * Store/Play Store) todavía — armar el flujo con deep link para nativo se deja para cuando
 * exista ese build, hoy sería trabajo sin forma real de probarlo.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Animated, Linking, Platform, Pressable, StyleSheet, Text, TextInput, View,
} from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useAuth } from '../auth';
import { espacio, radio, texto } from '../theme';
import { useTema } from '../useTema';
import { esEmailValido } from '../validacion';

const CLAVE_YA_VISITO = 'superapp_ya_visito_landing_auth_v1';

// El código de Google Sign-In (auth.tsx § iniciarSesionConGoogle) ya está armado y probado —
// falta solo el paso manual pendiente en Supabase (Authentication > Providers > Google, ver
// Plan_Usuarios_y_cobros.md § "Landing v2 + Google Sign-In"). Hasta que ese paso esté hecho,
// el botón tira "provider is not enabled" para cualquiera que lo toque, así que se oculta acá
// con un flag simple en vez de sacar el código — prender esto de vuelta es cambiar `false` por
// `true`, ver el doc.
const GOOGLE_SIGNIN_HABILITADO = false;

/** "G" de Google a color, tal como pide su guía de marca para el botón de login social — no
 *  hay un asset .svg en assets/logos/ (esos son supermercados) así que va inline, mismo
 *  mecanismo (react-native-svg) que usa LogoSuper.tsx para los logos vectoriales. */
function IconoGoogle({ tamano }: { tamano: number }) {
  return (
    <Svg width={tamano} height={tamano} viewBox="0 0 18 18">
      <Path fill="#4285F4" d="M17.64 9.2045c0-.6381-.0573-1.2518-.1636-1.8409H9v3.4818h4.8436c-.2086 1.125-.8427 2.0782-1.7959 2.7164v2.2581h2.9087c1.7018-1.5668 2.6836-3.874 2.6836-6.6154z" />
      <Path fill="#34A853" d="M9 18c2.43 0 4.4673-.8059 5.9564-2.1805l-2.9087-2.2581c-.8059.54-1.8368.8591-3.0477.8591-2.3436 0-4.3282-1.5831-5.0359-3.7104H.9573v2.3318C2.4382 15.9832 5.4818 18 9 18z" />
      <Path fill="#FBBC05" d="M3.9641 10.71c-.18-.54-.2822-1.1168-.2822-1.71s.1023-1.17.2822-1.71V4.9582H.9573C.3477 6.1732 0 7.5477 0 9s.3477 2.8268.9573 4.0418L3.9641 10.71z" />
      <Path fill="#EA4335" d="M9 3.5795c1.3214 0 2.5077.4541 3.4405 1.346l2.5813-2.5814C13.4632.8918 11.4259 0 9 0 5.4818 0 2.4382 2.0168.9573 4.9582L3.9641 7.29C4.6718 5.1627 6.6564 3.5795 9 3.5795z" />
    </Svg>
  );
}

export function FormularioAuth({ onExito }: { onExito?: () => void }) {
  const { paleta } = useTema();
  const { registrarse, iniciarSesion, reenviarConfirmacion, iniciarSesionConGoogle } = useAuth();
  const [modo, setModo] = useState<'registro' | 'login'>('registro');
  const [modoListo, setModoListo] = useState(false);
  const [nombre, setNombre] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [enviandoGoogle, setEnviandoGoogle] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mailPendiente, setMailPendiente] = useState<string | null>(null);
  const [reenviando, setReenviando] = useState(false);
  const [avisoReenvio, setAvisoReenvio] = useState<string | null>(null);
  const opacidad = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    AsyncStorage.getItem(CLAVE_YA_VISITO).then(valor => {
      if (valor) setModo('login');
      else AsyncStorage.setItem(CLAVE_YA_VISITO, '1').catch(() => {});
      setModoListo(true);
    });
  }, []);

  // El campo Nombre aparece/desaparece según el modo (solo hace falta al registrarse) — sin
  // esto el cambio se sentía como un salto brusco, no una transición. Fade simple, no algo
  // sofisticado: solo hay que suavizar el corte, no animar cada campo por separado.
  //
  // `useNativeDriver: false` a propósito: en web no existe el native driver, y con `true`
  // react-native-web cae a un fallback silencioso (con warning) — más simple no pedirlo. La
  // salida es cortita (lo justo para no sentirse instantánea) y la entrada más larga, que es
  // la parte que en verdad se percibe como "aparece".
  const cambiarModo = () => {
    Animated.timing(opacidad, { toValue: 0, duration: 100, useNativeDriver: false }).start(() => {
      setModo(m => (m === 'registro' ? 'login' : 'registro'));
      setError(null);
      Animated.timing(opacidad, { toValue: 1, duration: 250, useNativeDriver: false }).start();
    });
  };

  const enviar = async () => {
    if (enviando) return;
    if (modo === 'registro' && !nombre.trim()) {
      setError('Completá tu nombre.');
      return;
    }
    if (!email.trim() || !password) {
      setError('Completá mail y contraseña.');
      return;
    }
    if (modo === 'registro' && !esEmailValido(email)) {
      setError('Ese mail no es válido.');
      return;
    }
    setEnviando(true);
    setError(null);
    if (modo === 'registro') {
      const r = await registrarse(email.trim(), password, nombre.trim());
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

  const reenviar = async () => {
    if (reenviando || !mailPendiente) return;
    setReenviando(true);
    setAvisoReenvio(null);
    const r = await reenviarConfirmacion(mailPendiente);
    setReenviando(false);
    setAvisoReenvio(r.error ?? 'Te lo volvimos a mandar.');
  };

  const abrirCorreo = () => {
    // No hay forma de resolver la app de mail del sistema desde web/Expo de forma confiable
    // (el spec lo anota como caso a definir) — mailto: es lo más cercano sin sumar deep
    // linking nuevo, y si el dispositivo no tiene un cliente de mail asociado no hace nada.
    Linking.openURL('mailto:').catch(() => {});
  };

  const continuarConGoogle = async () => {
    if (enviandoGoogle) return;
    setEnviandoGoogle(true);
    setError(null);
    const r = await iniciarSesionConGoogle();
    // Si arrancó bien, la página ya está navegando hacia Google — este componente ni llega a
    // seguir vivo para mostrar el `setEnviandoGoogle(false)`. Solo hace falta para el caso de
    // error (provider mal configurado, sin red).
    if (r.error) { setEnviandoGoogle(false); setError(r.error); }
  };

  // Antes de saber si este dispositivo ya vio esta pantalla, no se muestra nada — evita el
  // parpadeo de "Registrate" para alguien que en realidad ya la había visto antes.
  if (!modoListo) return null;

  // Pantalla 2 del spec: "confirmá tu mail", con el recibo (ENVIADO A / Cambiar), el aviso de
  // spam siempre visible (razón número uno de abandono en este paso, según el spec) y el botón
  // de reenvío.
  if (mailPendiente) {
    return (
      <View style={[styles.tarjeta, { backgroundColor: paleta.superficie, borderColor: paleta.bordeFuerte, padding: espacio.xl }]}>
        <Text style={[texto.tituloSeccion, { color: paleta.tintaSuave }]}>PASO 2 DE 2 · CONFIRMÁ TU MAIL</Text>

        <View style={{ gap: espacio.xs, marginTop: espacio.md }}>
          <Text style={[texto.titulo, { color: paleta.tinta }]}>Te mandamos un mail</Text>
          <Text style={[texto.cuerpo, { color: paleta.tintaProsa }]}>
            Abrilo y tocá el botón para confirmar. Después ya podés entrar.
          </Text>
        </View>

        <View style={[styles.recibo, { borderColor: paleta.bordeFuerte, marginTop: espacio.lg }]}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={[texto.tituloSeccion, { color: paleta.tintaSuave }]}>ENVIADO A</Text>
            <Text style={[texto.cuerpoMedio, { color: paleta.tinta }]}>{mailPendiente}</Text>
          </View>
          <Pressable onPress={() => setMailPendiente(null)} accessibilityRole="button" hitSlop={8}>
            <Text style={[texto.etiqueta, { color: paleta.tinta, textDecorationLine: 'underline' }]}>Cambiar</Text>
          </Pressable>
        </View>

        <View style={{ gap: espacio.sm, marginTop: espacio.lg }}>
          <Pressable
            onPress={abrirCorreo}
            accessibilityRole="button"
            style={[styles.botonPrincipal, { backgroundColor: paleta.oferta }]}
          >
            <Text style={[styles.textoBotonPrincipal, { color: paleta.ofertaTinta }]}>ABRIR MI CORREO</Text>
          </Pressable>
          <Pressable
            onPress={reenviar}
            disabled={reenviando}
            accessibilityRole="button"
            style={[styles.botonSecundario, { borderColor: paleta.bordeFuerte, opacity: reenviando ? 0.6 : 1 }]}
          >
            {reenviando ? (
              <ActivityIndicator color={paleta.tinta} />
            ) : (
              <Text style={[texto.cuerpoMedio, { color: paleta.tinta }]}>Reenviar el mail</Text>
            )}
          </Pressable>
        </View>

        {avisoReenvio ? (
          <Text style={[texto.etiqueta, { color: paleta.tintaSuave, marginTop: espacio.sm }]}>{avisoReenvio}</Text>
        ) : null}

        <View style={[styles.avisoSpam, { backgroundColor: paleta.superficieAlt, marginTop: espacio.lg }]}>
          <Text style={[texto.etiqueta, { color: paleta.tintaProsa }]}>
            Si no llega en un par de minutos, mirá en spam o correo no deseado.
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.tarjeta, { backgroundColor: paleta.superficie, borderColor: paleta.bordeFuerte, overflow: 'hidden' }]}>
      {modo === 'registro' ? (
        // Hero amarillo: excepción deliberada del amarillo (reservado a promos/ahorro en el
        // resto de la app) — acá no hay precios con los que competir, ver el spec.
        <View style={[styles.hero, { backgroundColor: paleta.oferta }]}>
          <Text style={[styles.tituloHero, { color: paleta.ofertaTinta }]}>TU CARRITO,{'\n'}EN TODOS LOS SUPERS</Text>
          <Text style={[texto.cuerpoMedio, { color: paleta.ofertaTinta, marginTop: espacio.xs }]}>
            Un solo carrito. Los precios y las promos de cada super, al lado.
          </Text>
        </View>
      ) : (
        // El login no tiene su propio diseño en el spec (solo la landing de registro) — en vez
        // de repetir el amarillo (que el spec reserva a propósito para la landing de registro,
        // "acá no hay precios con los que competir") se reusa el lenguaje del header negro que
        // ya tiene el resto de la app (HeaderNegro.tsx: fondo tinta + Barlow Condensed blanco).
        <View style={[styles.hero, { backgroundColor: paleta.tinta }]}>
          <Text style={[styles.tituloHero, { color: paleta.superficie }]}>QUÉ BUENO{'\n'}VERTE DE NUEVO</Text>
          <Text style={[texto.cuerpoMedio, { color: paleta.superficie, marginTop: espacio.xs, opacity: 0.8 }]}>
            Iniciá sesión para ver tu carrito, tus tarjetas y tus listas guardadas.
          </Text>
        </View>
      )}

      <Animated.View style={{ gap: espacio.md, opacity: opacidad, padding: espacio.xl }}>
        <Text style={[texto.tituloSeccion, { color: paleta.tintaSuave }]}>
          {modo === 'registro' ? 'PASO 1 DE 2 · CREÁ TU CUENTA' : 'INICIAR SESIÓN'}
        </Text>

        {GOOGLE_SIGNIN_HABILITADO && Platform.OS === 'web' ? (
          <>
            <Pressable
              onPress={continuarConGoogle}
              disabled={enviandoGoogle}
              accessibilityRole="button"
              style={[
                styles.botonGoogle,
                { backgroundColor: paleta.superficie, borderColor: paleta.bordeFuerte, opacity: enviandoGoogle ? 0.6 : 1 },
              ]}
            >
              {enviandoGoogle ? (
                <ActivityIndicator color={paleta.tinta} />
              ) : (
                <>
                  <IconoGoogle tamano={18} />
                  <Text style={[texto.cuerpoMedio, { color: paleta.tinta }]}>Continuar con Google</Text>
                </>
              )}
            </Pressable>
            <View style={styles.divisor}>
              <View style={[styles.lineaDivisor, { backgroundColor: paleta.borde }]} />
              <Text style={[texto.etiqueta, { color: paleta.tintaTenue }]}>O</Text>
              <View style={[styles.lineaDivisor, { backgroundColor: paleta.borde }]} />
            </View>
          </>
        ) : null}

        {modo === 'registro' ? (
          <View style={[styles.campo, { backgroundColor: paleta.superficieAlt }]}>
            <TextInput
              value={nombre}
              onChangeText={setNombre}
              placeholder="Nombre"
              placeholderTextColor={paleta.tintaTenue}
              style={[texto.cuerpo, styles.input, { color: paleta.tinta }]}
              autoCorrect={false}
              textContentType="name"
              accessibilityLabel="Nombre"
            />
          </View>
        ) : null}
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
            placeholder={modo === 'registro' ? 'Al menos 6 caracteres' : 'Contraseña'}
            placeholderTextColor={paleta.tintaTenue}
            style={[texto.cuerpo, styles.input, { color: paleta.tinta }]}
            secureTextEntry
            autoCapitalize="none"
            textContentType={modo === 'registro' ? 'newPassword' : 'password'}
            accessibilityLabel="Contraseña"
            returnKeyType="done"
            onSubmitEditing={enviar}
          />
        </View>

        {error ? <Text style={[texto.etiqueta, { color: paleta.errorTexto }]}>{error}</Text> : null}

        <Pressable
          onPress={enviar}
          disabled={enviando}
          accessibilityRole="button"
          style={[styles.botonPrincipal, { backgroundColor: paleta.oferta, opacity: enviando ? 0.6 : 1 }]}
        >
          {enviando ? (
            <ActivityIndicator color={paleta.ofertaTinta} />
          ) : (
            <Text style={[styles.textoBotonPrincipal, { color: paleta.ofertaTinta }]}>
              {modo === 'registro' ? 'SEGUIR' : 'ENTRAR'}
            </Text>
          )}
        </Pressable>

        {modo === 'registro' ? (
          <View style={[styles.beneficios, { borderColor: paleta.borde }]}>
            {[
              '30 días gratis, sin poner tarjeta',
              'Promos de tus tarjetas aplicadas al total',
              'Listas guardadas para volver a comprar',
            ].map(linea => (
              <View key={linea} style={styles.filaBeneficio}>
                <View style={[styles.bala, { backgroundColor: paleta.oferta }]} />
                <Text style={[texto.cuerpo, { flex: 1, color: paleta.tintaProsa }]}>{linea}</Text>
              </View>
            ))}
          </View>
        ) : null}

        <Pressable onPress={cambiarModo} accessibilityRole="button" style={styles.filaToggle}>
          <Text style={[texto.etiqueta, { color: paleta.tintaSuave, textDecorationLine: 'underline' }]}>
            {modo === 'registro' ? '¿Ya tenés cuenta? Iniciá sesión' : '¿No tenés cuenta? Registrate'}
          </Text>
        </Pressable>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  tarjeta: { borderRadius: radio.lg, borderWidth: 1 },
  hero: { paddingHorizontal: espacio.xl, paddingVertical: espacio.lg },
  tituloHero: {
    fontFamily: 'BarlowCondensed_700Bold', fontSize: 34, lineHeight: 32, letterSpacing: 0.5,
  },
  campo: {
    borderRadius: radio.md, paddingHorizontal: espacio.md, height: 52, justifyContent: 'center',
  },
  input: { outlineWidth: 0, outlineStyle: 'none' },
  botonPrincipal: { minHeight: 56, borderRadius: radio.md, alignItems: 'center', justifyContent: 'center' },
  textoBotonPrincipal: { fontFamily: 'BarlowCondensed_700Bold', fontSize: 22, letterSpacing: 1 },
  botonSecundario: {
    minHeight: 44, borderRadius: radio.md, borderWidth: 1, alignItems: 'center', justifyContent: 'center',
  },
  filaToggle: { alignSelf: 'center', height: 44, justifyContent: 'center' },
  beneficios: { gap: espacio.sm, paddingTop: espacio.md, borderTopWidth: 1 },
  filaBeneficio: { flexDirection: 'row', alignItems: 'flex-start', gap: espacio.sm },
  bala: { width: 8, height: 8, borderRadius: 999, marginTop: 6 },
  recibo: {
    flexDirection: 'row', alignItems: 'center', gap: espacio.md,
    borderWidth: 1, borderRadius: radio.md, padding: espacio.md,
  },
  avisoSpam: { borderRadius: radio.md, padding: espacio.md },
  botonGoogle: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: espacio.sm,
    minHeight: 52, borderRadius: radio.md, borderWidth: 1,
  },
  divisor: { flexDirection: 'row', alignItems: 'center', gap: espacio.sm },
  lineaDivisor: { flex: 1, height: 1 },
});
