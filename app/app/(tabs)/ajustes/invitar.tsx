/**
 * "Invitá amigos" — referidos (.claude/docs/PLAN_REFERIDOS.md, backend en backend/src/referidos.js).
 *
 * Diseño: turno 22 de Claude Design (proyecto SuperApp, `Referidos.dc.html`), variante 22b con
 * nombre de pila en vez de "Invitado N" (decisión del usuario 12/10: si lo invitaste, lo conocés).
 * Los otros estados (premio ganado, suscripción paga, invitada expirada) salen de 22e. Mismo
 * esqueleto que Mis ahorros: header nativo "‹ Ajustes" (Stack de ajustes) + banda negra con el
 * título — el mock dibujaba la flecha adentro de la banda, como Resultado, pero las pantallas de
 * Ajustes ya usan el header nativo.
 *
 * Amarillo solo en el premio (es plata que se ahorra, ver theme.ts); el progreso va en tinta.
 */

import { useQuery } from '@tanstack/react-query';
import { useFocusEffect } from 'expo-router';
import Head from 'expo-router/head';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { estadoReferidos, type EstadoInvitada, type EstadoReferidos } from '../../../src/api';
import { useAuth } from '../../../src/auth';
import { BotonPrincipal, Cargando, Problema } from '../../../src/componentes/comunes';
import { HeaderNegro, TituloHeader } from '../../../src/componentes/HeaderNegro';
import { espacio, fuentes, radio, texto, usePantallaBaja, type Paleta } from '../../../src/theme';
import { useTema } from '../../../src/useTema';

const DIA_MS = 24 * 60 * 60 * 1000;

/** "60" → "2 meses"; cualquier otro número de días, tal cual. */
function textoPremio(dias: number): string {
  return dias % 30 === 0 ? `${dias / 30} meses` : `${dias} días`;
}

/** "14/02". A mano: `toLocaleDateString('es-AR', { month: '2-digit' })` da "14/2" en Chrome. */
function fechaCorta(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** El texto que precarga Compartir (22f). La persona lo puede editar antes de mandarlo. */
function mensajeParaCompartir(link: string): string {
  return 'Estoy usando SuperAhorro para ver en qué súper me conviene comprar cada cosa, con las '
    + `promos de mis tarjetas ya calculadas. Probala gratis 30 días con mi link: ${link}`;
}

/**
 * Copia al portapapeles en web. Se llama directo desde el toque, sin `await` antes: Safari
 * rechaza `clipboard.writeText` fuera del gesto del usuario (WebKit bug 222262). En nativo no
 * hay portapapeles sin una dependencia nueva (no hay build nativo todavía): devuelve false.
 */
async function copiarAlPortapapeles(contenido: string): Promise<boolean> {
  if (Platform.OS !== 'web' || typeof navigator === 'undefined') return false;
  try {
    await navigator.clipboard.writeText(contenido);
    return true;
  } catch {
    // Navegadores sin Clipboard API (o sin permiso): el camino viejo.
    try {
      const area = document.createElement('textarea');
      area.value = contenido;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(area);
      return ok;
    } catch {
      return false;
    }
  }
}

function hayShareNativoDelNavegador(): boolean {
  return Platform.OS !== 'web' || (typeof navigator !== 'undefined' && typeof navigator.share === 'function');
}

export default function PantallaInvitar() {
  const { paleta } = useTema();
  const insets = useSafeAreaInsets();
  const pantallaBaja = usePantallaBaja();
  const { session } = useAuth();
  const accessToken = session?.access_token ?? null;

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['referidos'],
    queryFn: () => estadoReferidos(accessToken as string),
    enabled: !!accessToken,
  });
  // Al volver a la pantalla: una invitada pudo haber comparado mientras tanto.
  useFocusEffect(useCallback(() => { refetch(); }, [refetch]));

  const [aviso, setAviso] = useState<string | null>(null);
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (temporizador.current) clearTimeout(temporizador.current); }, []);
  const mostrarAviso = (texto: string) => {
    setAviso(texto);
    if (temporizador.current) clearTimeout(temporizador.current);
    temporizador.current = setTimeout(() => setAviso(null), 3000);
  };

  const copiar = (link: string) => {
    if (Platform.OS !== 'web') {
      Share.share({ message: link }).catch(() => undefined);
      return;
    }
    copiarAlPortapapeles(link).then(ok => mostrarAviso(ok
      ? 'Copiamos tu link.'
      : 'No se pudo copiar. Mantené apretado el link para copiarlo.'));
  };

  const compartir = (link: string) => {
    const mensaje = mensajeParaCompartir(link);
    if (!hayShareNativoDelNavegador()) {
      // Navegador de escritorio sin "Compartir" del sistema: se copia el mensaje entero.
      copiarAlPortapapeles(mensaje).then(ok => mostrarAviso(ok
        ? 'Copiamos el mensaje con tu link: pegalo donde quieras.'
        : 'No se pudo copiar. Mantené apretado el link para copiarlo.'));
      return;
    }
    // Si la persona cierra la hoja de compartir sin mandar nada, no hay nada que avisar.
    Share.share({ message: mensaje }).catch(() => undefined);
  };

  const encabezado = (subtitulo: React.ReactNode) => (
    <HeaderNegro
      paddingTop={pantallaBaja ? espacio.md : espacio.xxl}
      estilo={{ paddingBottom: espacio.xl, gap: espacio.md }}
    >
      <TituloHeader>INVITÁ AMIGOS</TituloHeader>
      <Text style={[texto.cuerpoMedio, { color: '#C6CCD3' }]}>{subtitulo}</Text>
    </HeaderNegro>
  );

  if (isLoading || (!data && !error)) {
    return (
      <View style={{ flex: 1, backgroundColor: paleta.fondo }}>
        <Head><title>Invitá amigos - SuperAhorro</title></Head>
        <Cargando />
      </View>
    );
  }

  if (!data) {
    return (
      <View style={{ flex: 1, backgroundColor: paleta.fondo }}>
        <Head><title>Invitá amigos - SuperAhorro</title></Head>
        {encabezado('Si 3 amigos se registran con tu link, te regalamos 2 meses gratis.')}
        <View style={styles.cuerpo}>
          <Problema mensaje="No pudimos cargar tus invitaciones." onReintentar={() => refetch()} />
        </View>
      </View>
    );
  }

  const premio = textoPremio(data.diasPremio);
  const ganado = data.premio?.estado === 'otorgado' ? data.premio : null;
  const noAplica = data.premio?.estado === 'no_aplica' ? data.premio.motivo : data.motivoNoAplica;
  const revertido = data.premio?.estado === 'revertido';
  const cerrada = !data.promoVigente && !data.premio;

  const subtitulo = ganado
    ? `Tus ${data.invitadasNecesarias} amigos ya se sumaron.`
    : noAplica || revertido || cerrada
      ? 'Compartí SuperAhorro con quien quieras.'
      : (
        <>
          Si {data.invitadasNecesarias} amigos se registran con tu link y hacen su primera comparación, te regalamos{' '}
          <Text style={{ color: paleta.oferta, fontFamily: fuentes.semi }}>{premio} gratis</Text>.
        </>
      );

  const seccionLink = (
    <View style={styles.seccion}>
      <Text style={[texto.tituloSeccion, { color: paleta.tintaSuave }]}>TU LINK</Text>
      <View style={[styles.cajaLink, { backgroundColor: paleta.superficieAlt, borderColor: paleta.borde }]}>
        <Text selectable numberOfLines={1} style={[texto.cuerpoMedio, { color: paleta.tinta }]}>
          {data.link.replace(/^https?:\/\//, '')}
        </Text>
      </View>
      <View style={styles.botones}>
        <BotonPrincipal variante="secundario" onPress={() => copiar(data.link)} estilo={{ flex: 1 }}>
          Copiar
        </BotonPrincipal>
        <BotonPrincipal onPress={() => compartir(data.link)} estilo={{ flex: 1 }}>
          Compartir
        </BotonPrincipal>
      </View>
      {aviso ? <Text style={[texto.etiqueta, { color: paleta.tintaSuave }]}>{aviso}</Text> : null}
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: paleta.fondo }}>
      <Head><title>Invitá amigos - SuperAhorro</title></Head>
      {encabezado(subtitulo)}
      <ScrollView contentContainerStyle={[styles.cuerpo, { paddingBottom: insets.bottom + espacio.xl }]}>
        {ganado ? (
          <>
            <View style={[styles.bloquePremio, { backgroundColor: paleta.oferta }]}>
              <Text style={[texto.tituloSeccion, { color: paleta.ofertaTinta }]}>GANASTE</Text>
              <Text style={[texto.precioHero, { color: paleta.ofertaTinta }]}>{premio.toUpperCase()} GRATIS</Text>
              {ganado.hasta ? (
                <Text style={[texto.cuerpoMedio, { color: paleta.ofertaTinta }]}>
                  {ganado.planAntes === 'trial'
                    ? `Tu prueba ahora vence el ${fechaCorta(ganado.hasta)}.`
                    : `Tenés premium gratis hasta el ${fechaCorta(ganado.hasta)}.`}
                </Text>
              ) : null}
            </View>
            <ListaInvitadas estado={data} paleta={paleta} />
            <View style={styles.seccion}>
              <Text style={[texto.prosa, { color: paleta.tintaProsa }]}>
                Podés seguir compartiendo tu link para que otros prueben gratis. El premio es uno por cuenta.
              </Text>
              <BotonPrincipal variante="secundario" onPress={() => compartir(data.link)}>
                Compartir mi link
              </BotonPrincipal>
              {aviso ? <Text style={[texto.etiqueta, { color: paleta.tintaSuave }]}>{aviso}</Text> : null}
            </View>
          </>
        ) : noAplica || revertido || cerrada ? (
          <>
            <View style={[styles.tarjetaInfo, { backgroundColor: paleta.superficieAlt }]}>
              <Text style={[texto.cuerpoMedio, { color: paleta.tinta, fontFamily: fuentes.semi }]}>
                {tituloSinPremio(noAplica, revertido, cerrada)}
              </Text>
              <Text style={[texto.prosa, { color: paleta.tintaProsa }]}>
                {detalleSinPremio(noAplica, revertido, cerrada, premio)}
              </Text>
            </View>
            {seccionLink}
          </>
        ) : (
          <>
            {seccionLink}
            <ListaInvitadas estado={data} paleta={paleta} />
            <Text style={[texto.etiqueta, { color: paleta.tintaSuave }]}>
              Una vez por cuenta. No aplica si tenés una suscripción paga.
            </Text>
          </>
        )}
      </ScrollView>
    </View>
  );
}

function tituloSinPremio(motivo: string | null, revertido: boolean, cerrada: boolean): string {
  if (revertido) return 'El premio de tu cuenta se dio de baja';
  if (cerrada) return 'La promo de invitar amigos terminó';
  if (motivo === 'permanente') return 'Tenés el plan permanente';
  if (motivo === 'premium_manual') return 'Tu cuenta ya tiene premium';
  return 'Tenés una suscripción paga';
}

function detalleSinPremio(motivo: string | null, revertido: boolean, cerrada: boolean, premio: string): string {
  if (revertido) return 'Si creés que es un error, escribinos a contacto@superahorro.com.ar.';
  if (cerrada) return 'Tus amigos igual tienen 30 días gratis para probar.';
  return `Por eso el premio de ${premio} no aplica a tu cuenta. Tus amigos igual tienen 30 días gratis para probar.`;
}

/** Lista "TUS INVITADOS" (22b/22e): las que se registraron con tu link + lugares libres. */
function ListaInvitadas({ estado, paleta }: { estado: EstadoReferidos; paleta: Paleta }) {
  const n = estado.invitadasNecesarias;
  const enCamino = estado.invitadas.filter(i => i.estado === 'pendiente').length;
  // Una expirada o descartada no cuenta: deja su lugar libre (22e).
  const libres = estado.premio ? 0 : Math.max(0, n - estado.validas - enCamino);
  const filas: (EstadoInvitada | null)[] = [...estado.invitadas, ...Array(libres).fill(null)];

  return (
    <View style={styles.seccion}>
      <View style={styles.encabezadoLista}>
        <Text style={[texto.tituloSeccion, { color: paleta.tintaSuave }]}>TUS INVITADOS</Text>
        <Text style={[texto.etiqueta, { color: paleta.tintaSuave, letterSpacing: 0.2 }]}>
          {Math.min(estado.validas, n)} de {n}
        </Text>
      </View>
      <View style={[styles.grupo, { borderColor: paleta.borde }]}>
        {filas.map((invitada, i) => (
          <React.Fragment key={i}>
            {i > 0 ? <View style={[styles.separador, { backgroundColor: paleta.borde }]} /> : null}
            <FilaInvitada invitada={invitada} numero={i + 1} paleta={paleta} />
          </React.Fragment>
        ))}
      </View>
    </View>
  );
}

function FilaInvitada({ invitada, numero, paleta }: {
  invitada: EstadoInvitada | null; numero: number; paleta: Paleta;
}) {
  if (!invitada) {
    return (
      <View style={styles.fila}>
        <View style={[styles.circulo, styles.circuloLibre, { borderColor: paleta.bordeFuerte }]} />
        <Text style={[texto.cuerpoMedio, { color: paleta.tintaSuave, flex: 1 }]}>Lugar libre</Text>
      </View>
    );
  }

  const nombre = invitada.nombre ?? `Invitado ${numero}`;
  const noCuenta = invitada.estado === 'expirada' || invitada.estado === 'descartada';
  let detalle = 'Ya hizo su primera comparación';
  if (invitada.estado === 'pendiente') {
    const dias = invitada.venceEl
      ? Math.ceil((new Date(invitada.venceEl).getTime() - Date.now()) / DIA_MS)
      : null;
    detalle = dias && dias > 0
      ? `Le falta comparar · quedan ${dias} ${dias === 1 ? 'día' : 'días'}`
      : 'Le falta comparar';
  } else if (invitada.estado === 'expirada') {
    detalle = 'No usó la app en 30 días. Sumá otro.';
  } else if (invitada.estado === 'descartada') {
    detalle = 'No cuenta para el premio.';
  }

  return (
    <View style={[styles.fila, { minHeight: 68 }]}>
      {invitada.estado === 'valida' ? (
        <View style={[styles.circulo, { backgroundColor: paleta.tinta }]}>
          <View style={[styles.tilde, { borderColor: paleta.superficie }]} />
        </View>
      ) : invitada.estado === 'pendiente' ? (
        <View style={[styles.circulo, styles.circuloMitad, { borderColor: paleta.tinta }]}>
          <View style={[styles.mitadLlena, { backgroundColor: paleta.tinta }]} />
        </View>
      ) : (
        <View style={[styles.circulo, { backgroundColor: paleta.superficie2 }]}>
          <View style={[styles.guion, { backgroundColor: paleta.tintaSuave }]} />
        </View>
      )}
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[texto.cuerpoMedio, { color: noCuenta ? paleta.tintaSuave : paleta.tinta }]}>{nombre}</Text>
        <Text style={[texto.etiqueta, { color: paleta.tintaSuave, letterSpacing: 0.2 }]}>{detalle}</Text>
      </View>
      {noCuenta ? (
        <View style={[styles.chip, { backgroundColor: paleta.superficieAlt }]}>
          <Text style={[texto.micro, { color: paleta.tintaSuave }]}>
            {invitada.estado === 'expirada' ? 'EXPIRÓ' : 'NO CUENTA'}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  cuerpo: { padding: espacio.pantalla, gap: espacio.pantalla },
  seccion: { gap: espacio.sm },
  cajaLink: {
    minHeight: 52, borderRadius: radio.md, borderWidth: 1, paddingHorizontal: 14, justifyContent: 'center',
  },
  botones: { flexDirection: 'row', gap: 10 },
  encabezadoLista: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: espacio.sm },
  grupo: { borderWidth: 1, borderRadius: radio.tarjeta, paddingHorizontal: espacio.md },
  separador: { height: StyleSheet.hairlineWidth },
  fila: { flexDirection: 'row', alignItems: 'center', gap: espacio.md, minHeight: 52 },
  circulo: {
    width: 22, height: 22, borderRadius: radio.pill, alignItems: 'center', justifyContent: 'center',
  },
  circuloLibre: { borderWidth: 2, borderStyle: 'dashed' },
  circuloMitad: { borderWidth: 2, overflow: 'hidden', justifyContent: 'flex-end' },
  mitadLlena: { width: '100%', height: '50%' },
  tilde: {
    width: 9, height: 5, borderLeftWidth: 2, borderBottomWidth: 2, marginTop: -2,
    transform: [{ rotate: '-45deg' }],
  },
  guion: { width: 10, height: 2, borderRadius: 1 },
  chip: { borderRadius: radio.sm, paddingHorizontal: espacio.sm, paddingVertical: 3 },
  bloquePremio: { borderRadius: radio.tarjeta, padding: espacio.lg, gap: espacio.xs },
  tarjetaInfo: { borderRadius: radio.tarjeta, paddingVertical: 14, paddingHorizontal: espacio.lg, gap: espacio.xs },
});
