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
  ActivityIndicator, Animated, Image, Linking, Platform, Pressable, StyleSheet, Text, TextInput, View,
} from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { useAuth } from '../auth';
import { espacio, radio, texto } from '../theme';
import { useTema } from '../useTema';
import { esEmailValido } from '../validacion';

const CLAVE_YA_VISITO = 'superapp_ya_visito_landing_auth_v1';

// Alto/ancho reales del archivo en assets/ilustraciones — para no deformar la imagen al
// escalarla según el ancho disponible del hero. Ancho/alto se calculan a mano (no con
// `flex: 1` + `aspectRatio`): esa combinación tiene un bug conocido de Yoga donde el alto se
// deriva del ancho ANTES de aplicarle el `maxWidth`, así que el ancho queda recortado pero el
// alto termina siendo el de un ancho mucho más grande — el header crecía sin límite.
const PROPORCION_IMAGEN_HERO = 976 / 1080;

// Ancho (en px) de la línea más larga del título del hero ("TODOS LOS SUPERS") por cada punto
// de `fontSize`, en Barlow Condensed Bold — medido con canvas.measureText a fontSize 34
// (230.93px / 34 ≈ 6.79). Sirve para calcular el tamaño de letra que hace que esa línea ocupe
// casi todo el ancho de su columna, así el título con su salto de línea fijo siempre entra en
// exactamente 2 renglones en vez de wrappear a 3 o 4 en pantallas angostas.
const ANCHO_POR_PUNTO_TITULO_HERO = 6.79;

// A diferencia del título, el subtítulo no tiene un salto de línea fijo — envuelve solo, así
// que "que ocupe siempre 3 líneas" no sale de medir una línea sino de encontrar qué ancho de
// contenedor produce 3 líneas al aplicar el wrap normal de palabras. Se simuló ese wrap greedy
// (mismo algoritmo que usa el navegador) contra el texto real del subtítulo probando distintos
// anchos de contenedor en varios `fontSize` (10/12/15/20): el punto medio del rango que da
// exactamente 3 líneas escala de forma consistente en ~15.03px por punto de `fontSize`, sin
// importar el tamaño. `numberOfLines={3}` donde se usa queda como resguardo (trunca en vez de
// pasar a una 4ta línea) para el caso límite de una columna muy angosta.
const ANCHO_POR_PUNTO_SUBTITULO_HERO = 15.03;

function clamp(minimo: number, valor: number, maximo: number) {
  return Math.min(Math.max(valor, minimo), maximo);
}

// El código de Google Sign-In (auth.tsx § iniciarSesionConGoogle) ya está armado y probado.
// Provider habilitado en Supabase (Authentication > Providers > Google) el 2026-09-04 — ver
// Plan_Usuarios_y_cobros.md § "Landing v2 + Google Sign-In" para el detalle de esa config.
const GOOGLE_SIGNIN_HABILITADO = true;

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

/** Íconos de línea (estilo Feather) para los campos del formulario — mismo mecanismo inline con
 *  react-native-svg que IconoGoogle, sin sumar una librería de íconos nueva al proyecto. */
function IconoPersona({ tamano, color }: { tamano: number; color: string }) {
  return (
    <Svg width={tamano} height={tamano} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <Circle cx={12} cy={7} r={4} />
    </Svg>
  );
}

function IconoMail({ tamano, color }: { tamano: number; color: string }) {
  return (
    <Svg width={tamano} height={tamano} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Rect x={2} y={4} width={20} height={16} rx={2} />
      <Path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
    </Svg>
  );
}

function IconoCandado({ tamano, color }: { tamano: number; color: string }) {
  return (
    <Svg width={tamano} height={tamano} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Rect x={3} y={11} width={18} height={11} rx={2} />
      <Path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </Svg>
  );
}

export function FormularioAuth({
  onExito, pantallaCompleta, anchoTarjeta = 390, insetSuperior = 0,
}: { onExito?: () => void; pantallaCompleta?: boolean; anchoTarjeta?: number; insetSuperior?: number }) {
  const { paleta } = useTema();
  const { registrarse, iniciarSesion, reenviarConfirmacion, iniciarSesionConGoogle } = useAuth();
  const [modo, setModo] = useState<'registro' | 'login'>('registro');
  const [modoListo, setModoListo] = useState(false);
  const [nombre, setNombre] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmarPassword, setConfirmarPassword] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [enviandoGoogle, setEnviandoGoogle] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mailPendiente, setMailPendiente] = useState<string | null>(null);
  const [reenviando, setReenviando] = useState(false);
  const [avisoReenvio, setAvisoReenvio] = useState<string | null>(null);
  const opacidad = useRef(new Animated.Value(1)).current;

  // `anchoTarjeta` lo calcula GateSesion con useWindowDimensions y nos llega como prop — de ahí
  // salen los tamaños de la imagen y del título/subtítulo, para que los tres se escalen juntos
  // según el espacio disponible. No se mide acá con `onLayout`: en react-native-web ese evento
  // no volvía a dispararse cuando el ancho real terminaba de resolverse, y todo quedaba
  // calculado con el tamaño de antes de montar (mucho más chico que el real).
  const anchoContenidoHero = anchoTarjeta - espacio.xl * 2;
  // La imagen se lleva ~30% del ancho de contenido (con techo, para que no domine en pantallas
  // muy anchas) y el resto queda para el texto — en 42% el título ("UN SOLO CARRITO, TODOS LOS
  // SUPERS") terminaba envolviendo en 4 líneas en celulares como el iPhone 13.
  const tamanoImagenHero = clamp(56, anchoContenidoHero * 0.3, 140);
  const anchoColumnaTexto = anchoContenidoHero - tamanoImagenHero - espacio.md;
  // El tamaño del título sale de "hacer que la línea más larga ocupe el ancho de la columna",
  // no de un porcentaje arbitrario — así el salto de línea fijo del título siempre da 2
  // renglones, ni más (se desbordaría a 3-4 en pantallas angostas) ni menos (se vería
  // desproporcionado en pantallas anchas). El 0.94 es margen de seguridad: sin él, el texto
  // tocaría el borde exacto de la columna, muy justo para variaciones de rendering entre
  // plataformas (la calibración se hizo en Chrome/web, no en el motor nativo de iOS/Android).
  const tamanoTituloHero = clamp(18, (anchoColumnaTexto * 0.94) / ANCHO_POR_PUNTO_TITULO_HERO, 40);
  // Techo en `texto.cuerpoMedio.fontSize` (15, su tamaño base) para que nunca compita en tamaño
  // con el título — el `maxWidth` que fuerza los 3 renglones sale de `ANCHO_POR_PUNTO_SUBTITULO_HERO`,
  // no de este cálculo (ver su comentario de definición).
  const tamanoSubtituloHero = clamp(12, anchoColumnaTexto * 0.09, texto.cuerpoMedio.fontSize);

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
      setConfirmarPassword('');
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
    if (modo === 'registro' && password !== confirmarPassword) {
      setError('Las contraseñas no coinciden.');
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
    // mailto: abre un compositor de mail nuevo, no la bandeja de entrada — para los webmails
    // más comunes vamos directo a su inbox por dominio (funciona bien en web, que es donde hoy
    // se usa este botón). Si el dominio no está en la lista no hay URL de inbox universal, así
    // que cae a mailto: como antes (mejor que nada, y no rompe en dispositivos sin cliente).
    const dominio = mailPendiente?.split('@')[1]?.toLowerCase();
    const inboxPorDominio: Record<string, string> = {
      'gmail.com': 'https://mail.google.com/mail/u/0/#inbox',
      'outlook.com': 'https://outlook.live.com/mail/0/inbox',
      'hotmail.com': 'https://outlook.live.com/mail/0/inbox',
      'live.com': 'https://outlook.live.com/mail/0/inbox',
      'yahoo.com': 'https://mail.yahoo.com/d/folders/1',
      'yahoo.com.ar': 'https://mail.yahoo.com/d/folders/1',
      'icloud.com': 'https://www.icloud.com/mail',
    };
    const url = (dominio && inboxPorDominio[dominio]) ?? 'mailto:';
    Linking.openURL(url).catch(() => {});
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
  // spam siempre visible en el texto principal (razón número uno de abandono en este paso,
  // según el spec) y el botón de reenvío.
  if (mailPendiente) {
    return (
      <View style={[styles.tarjeta, pantallaCompleta && styles.tarjetaCompleta, { backgroundColor: paleta.superficie, borderColor: paleta.bordeFuerte, padding: espacio.xl }]}>
        <Text style={[texto.tituloSeccion, { color: paleta.tintaSuave }]}>PASO 2 DE 2 · CONFIRMÁ TU MAIL</Text>

        <View style={{ gap: espacio.xs, marginTop: espacio.md }}>
          <Text style={[texto.titulo, { color: paleta.tinta }]}>Te mandamos un mail</Text>
          <Text style={[texto.cuerpo, { color: paleta.tintaProsa }]}>
            Abrilo y tocá el botón para confirmar. Si no lo ves, revisá spam o correo no deseado. (Puede tomar un minuto para llegar)
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
      </View>
    );
  }

  return (
    <View style={[styles.tarjeta, pantallaCompleta && styles.tarjetaCompleta, { backgroundColor: paleta.superficie, borderColor: paleta.bordeFuerte, overflow: 'hidden' }]}>
      {modo === 'registro' ? (
        // Hero amarillo: excepción deliberada del amarillo (reservado a promos/ahorro en el
        // resto de la app) — acá no hay precios con los que competir, ver el spec.
        //
        // Texto e imagen van siempre en fila, con tamaños calculados a partir de `anchoTarjeta`
        // (no un corte fijo mobile/desktop): así se adaptan solos a cualquier ancho de tarjeta y
        // ambos quedan siempre visibles, en vez de que la imagen aparezca o desaparezca de
        // golpe en un punto de quiebre.
        <View style={[styles.hero, !pantallaCompleta && styles.heroEscritorio, { backgroundColor: paleta.oferta }, insetSuperior ? { paddingTop: espacio.lg + insetSuperior } : null]}>
          <View style={styles.heroFila}>
            <View style={{ width: anchoColumnaTexto }}>
              <Text style={[styles.tituloHero, { color: paleta.ofertaTinta, fontSize: tamanoTituloHero, lineHeight: tamanoTituloHero * 0.94 }]}>
                UN SOLO CARRITO,{'\n'}TODOS LOS SUPERS
              </Text>
              <Text
                numberOfLines={3}
                style={[
                  texto.cuerpoMedio,
                  {
                    color: paleta.ofertaTinta, marginTop: espacio.xs,
                    maxWidth: tamanoSubtituloHero * ANCHO_POR_PUNTO_SUBTITULO_HERO,
                    fontSize: tamanoSubtituloHero, lineHeight: tamanoSubtituloHero * 1.4,
                  },
                ]}
              >
                Compará precios y promos de distintos supermercados en un solo lugar.
              </Text>
            </View>
            <Image
              source={require('../../assets/ilustraciones/carrito-supers.jpg')}
              style={{ width: tamanoImagenHero, height: tamanoImagenHero * PROPORCION_IMAGEN_HERO }}
              resizeMode="contain"
              accessibilityLabel="Carrito con productos y logos de los supers comparados"
            />
          </View>
        </View>
      ) : (
        // El login no tiene su propio diseño en el spec (solo la landing de registro) — por
        // pedido del usuario (2026-09-09) reusa el mismo hero amarillo del registro en vez del
        // header negro que tenía antes, para que ambos modos se vean consistentes.
        <View style={[styles.hero, !pantallaCompleta && styles.heroEscritorio, { backgroundColor: paleta.oferta }, insetSuperior ? { paddingTop: espacio.lg + insetSuperior } : null]}>
          <View style={styles.heroFila}>
            <View style={{ width: anchoColumnaTexto }}>
              <Text style={[styles.tituloHero, { color: paleta.ofertaTinta, fontSize: tamanoTituloHero, lineHeight: tamanoTituloHero * 0.94 }]}>
                QUÉ BUENO{'\n'}VERTE DE NUEVO
              </Text>
              <Text
                numberOfLines={3}
                style={[
                  texto.cuerpoMedio,
                  {
                    color: paleta.ofertaTinta, marginTop: espacio.xs,
                    maxWidth: tamanoSubtituloHero * ANCHO_POR_PUNTO_SUBTITULO_HERO,
                    fontSize: tamanoSubtituloHero, lineHeight: tamanoSubtituloHero * 1.4,
                  },
                ]}
              >
                Iniciá sesión para ver tu carrito y tus tarjetas.
              </Text>
            </View>
            <Image
              source={require('../../assets/ilustraciones/carrito-supers.jpg')}
              style={{ width: tamanoImagenHero, height: tamanoImagenHero * PROPORCION_IMAGEN_HERO }}
              resizeMode="contain"
              accessibilityLabel="Carrito con productos y logos de los supers comparados"
            />
          </View>
        </View>
      )}

      <Animated.View style={{ gap: espacio.md, opacity: opacidad, padding: pantallaCompleta ? espacio.xl : espacio.xxl }}>
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
            <IconoPersona tamano={18} color={paleta.tintaTenue} />
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
          <IconoMail tamano={18} color={paleta.tintaTenue} />
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
          <IconoCandado tamano={18} color={paleta.tintaTenue} />
          <TextInput
            value={password}
            onChangeText={setPassword}
            placeholder={modo === 'registro' ? 'Contraseña · Mínimo 6 caracteres' : 'Contraseña'}
            placeholderTextColor={paleta.tintaTenue}
            style={[texto.cuerpo, styles.input, { color: paleta.tinta }]}
            secureTextEntry
            autoCapitalize="none"
            textContentType={modo === 'registro' ? 'newPassword' : 'password'}
            accessibilityLabel="Contraseña"
            returnKeyType="done"
            onSubmitEditing={modo === 'registro' ? undefined : enviar}
          />
        </View>
        {modo === 'registro' ? (
          <View style={[styles.campo, { backgroundColor: paleta.superficieAlt }]}>
            <IconoCandado tamano={18} color={paleta.tintaTenue} />
            <TextInput
              value={confirmarPassword}
              onChangeText={setConfirmarPassword}
              placeholder="Repetí tu contraseña"
              placeholderTextColor={paleta.tintaTenue}
              style={[texto.cuerpo, styles.input, { color: paleta.tinta }]}
              secureTextEntry
              autoCapitalize="none"
              textContentType="newPassword"
              accessibilityLabel="Confirmar contraseña"
              returnKeyType="done"
              onSubmitEditing={enviar}
            />
          </View>
        ) : null}

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
              {modo === 'registro' ? 'CONTINUAR' : 'ENTRAR'}
            </Text>
          )}
        </Pressable>

        {modo === 'registro' ? (
          <View style={[styles.beneficios, { borderColor: paleta.borde }]}>
            {[
              'Promos de tus tarjetas aplicadas al total',
              'Carritos guardados para volver a comprar',
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
  // `flex: 1` siempre: GateSesion envuelve esto en un contenedor de alto completo (mobile y
  // desktop) para que la tarjeta llene la pantalla en vez de quedar chica con aire arriba/abajo.
  tarjeta: { flex: 1, borderRadius: radio.lg, borderWidth: 1 },
  // En mobile (GateSesion la pasa cuando la pantalla es angosta) la tarjeta ocupa toda la
  // pantalla sin borde ni esquinas redondeadas — en desktop se mantiene el look de tarjeta.
  tarjetaCompleta: { borderRadius: 0, borderWidth: 0 },
  hero: { paddingHorizontal: espacio.xl, paddingVertical: espacio.lg },
  // Más aire vertical que en mobile — en una tarjeta angosta este padding extra se sentiría
  // desperdiciado, pero en la tarjeta más ancha de escritorio evita que el hero se vea achatado.
  heroEscritorio: { paddingVertical: espacio.xxl },
  heroFila: { flexDirection: 'row', alignItems: 'center', gap: espacio.md },
  tituloHero: {
    fontFamily: 'BarlowCondensed_700Bold', fontSize: 34, lineHeight: 32, letterSpacing: 0.5,
  },
  campo: {
    flexDirection: 'row', alignItems: 'center', gap: espacio.sm,
    borderRadius: radio.md, paddingHorizontal: espacio.md, height: 52,
  },
  input: { flex: 1, outlineWidth: 0, outlineStyle: 'none' },
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
  botonGoogle: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: espacio.sm,
    minHeight: 52, borderRadius: radio.md, borderWidth: 1,
  },
  divisor: { flexDirection: 'row', alignItems: 'center', gap: espacio.sm },
  lineaDivisor: { flex: 1, height: 1 },
});
