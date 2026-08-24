/**
 * Hoja "confirmá tu mail de Mercado Pago" (turno 13, design_handoff_allpromos_v2/PANTALLA-12-
 * eleccion-de-plan.md § "Turno 13"). Resuelve un bug de producto real, no un paso decorativo:
 * el `payer_email` de una suscripción tiene que coincidir con la cuenta de MP del pagador, y
 * hoy se manda siempre el mail de la sesión de Super App sin preguntar (opciones_planes.md,
 * "Problema real de producto confirmado"). Se abre después de `PlanSelect`, antes del checkout.
 *
 * Mismo patrón de bottom sheet que `GuardarCarritoHoja.tsx`: `Modal` transparente + backdrop +
 * hoja `flex-end`.
 */

import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator, Modal, Pressable, StyleSheet, Text, TextInput, View,
} from 'react-native';
import type { Plan } from '../plan';
import { espacio, pesosCorto, radio, texto } from '../theme';
import { useTema } from '../useTema';

const REGEX_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const NOMBRE_PLAN: Record<Plan['id'], string> = {
  mensual: 'Mensual', anual: 'Anual', permanente: 'Permanente',
};

export function MercadoPagoEmailSheet({
  visible, plan, mailApp, mailInicial, enviando = false, error = null,
  onConfirmar, onCancelar, onElegirOtroPlan,
}: {
  visible: boolean;
  plan: Plan | null;
  /** Mail de la cuenta de Super App — se compara contra lo que el usuario deja en el campo
   *  para decidir si mostrar el aviso informativo de "mail distinto". */
  mailApp: string;
  /** Prellenado: `mailMercadoPago` guardado de un intento anterior, o `mailApp` si nunca hubo uno. */
  mailInicial: string;
  enviando?: boolean;
  /** Si `POST /checkout` falló o no devolvió `initPoint` — dispara el estado 13c. La hoja no se
   *  cierra ni pierde el mail escrito mientras esto esté seteado. */
  error?: string | null;
  onConfirmar: (email: string) => void;
  onCancelar: () => void;
  onElegirOtroPlan: () => void;
}) {
  const { paleta } = useTema();
  const [email, setEmail] = useState(mailInicial);

  useEffect(() => {
    if (!visible) return;
    setEmail(mailInicial);
  }, [visible, mailInicial]);

  const emailLimpio = email.trim();
  const formatoValido = REGEX_EMAIL.test(emailLimpio);
  const esDistintoDelApp = formatoValido && emailLimpio.toLowerCase() !== mailApp.trim().toLowerCase();
  const puedeConfirmar = formatoValido && !enviando;

  const confirmar = () => {
    if (!puedeConfirmar) return;
    onConfirmar(emailLimpio);
  };

  if (!plan) return null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancelar}>
      <View style={styles.fondo}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={enviando ? undefined : onCancelar}
          accessibilityLabel="Cerrar"
        />
        <View style={[styles.hoja, { backgroundColor: paleta.superficie }]}>
          <View style={{ gap: espacio.xs }}>
            <Text style={[texto.subtitulo, { color: paleta.tinta, fontSize: 22 }]}>
              Confirmá tu mail de Mercado Pago
            </Text>
            <Text style={[texto.cuerpo, { color: paleta.tintaProsa }]}>
              El cobro se hace a la cuenta de Mercado Pago de este mail. Si no es el mismo que
              usás en Super App, no hay problema — solo confirmalo antes de seguir.
            </Text>
          </View>

          <View style={[styles.filaPlan, { borderColor: paleta.borde }]}>
            <Text style={[texto.cuerpoMedio, { color: paleta.tinta }]}>Plan {NOMBRE_PLAN[plan.id]}</Text>
            <Text style={[texto.cuerpoMedio, { color: paleta.tintaSuave }]}>
              {pesosCorto(plan.precio)}{plan.periodo === 'unico' ? ' único' : plan.periodo === 'año' ? '/año' : '/mes'}
            </Text>
          </View>

          <View style={{ gap: espacio.xs }}>
            <Text style={[texto.tituloSeccion, { color: paleta.tintaSuave }]}>MAIL DE MERCADO PAGO</Text>
            <TextInput
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              selectTextOnFocus
              editable={!enviando}
              style={[
                texto.subtitulo, styles.input,
                {
                  color: paleta.tinta,
                  backgroundColor: paleta.superficie,
                  borderColor: emailLimpio && !formatoValido ? paleta.errorTexto : paleta.borde,
                  borderWidth: emailLimpio && !formatoValido ? 2 : 1,
                },
              ]}
              returnKeyType="done"
              onSubmitEditing={confirmar}
              accessibilityLabel="Mail de Mercado Pago"
            />

            {emailLimpio && !formatoValido ? (
              <Text style={[texto.dato, { color: paleta.errorTexto }]}>
                Falta el final del mail (.com, .com.ar).
              </Text>
            ) : esDistintoDelApp ? (
              <View style={[styles.avisoInfo, { backgroundColor: paleta.superficieAlt }]}>
                <Text style={[texto.dato, { color: paleta.tintaProsa }]}>
                  Es distinto del mail de tu cuenta de Super App — está bien si es el que usás en
                  Mercado Pago.
                </Text>
              </View>
            ) : null}

            <Text style={[texto.dato, { color: paleta.tintaSuave }]}>
              No se guardan datos de tarjeta: el pago se hace en Mercado Pago.
            </Text>
          </View>

          {error ? (
            <View style={[styles.avisoError, { backgroundColor: paleta.errorFondo, borderColor: paleta.errorBorde }]}>
              <Text style={[texto.cuerpoMedio, { color: paleta.errorTexto }]}>
                No se te cobró nada. {error}
              </Text>
              <View style={styles.filaBotonesError}>
                <Pressable onPress={confirmar} disabled={!puedeConfirmar} accessibilityRole="button">
                  <Text style={[texto.cuerpoMedio, { color: paleta.errorTexto, textDecorationLine: 'underline' }]}>
                    Probar de nuevo
                  </Text>
                </Pressable>
                <Pressable onPress={onElegirOtroPlan} accessibilityRole="button">
                  <Text style={[texto.cuerpo, { color: paleta.errorTexto }]}>Elegir otro plan</Text>
                </Pressable>
              </View>
            </View>
          ) : (
            <Pressable
              onPress={confirmar}
              disabled={!puedeConfirmar}
              accessibilityRole="button"
              style={[
                styles.botonConfirmar,
                { backgroundColor: paleta.tinta, opacity: puedeConfirmar ? 1 : 0.4 },
              ]}
            >
              {enviando ? (
                <ActivityIndicator color={paleta.superficie} />
              ) : (
                <Text style={[texto.cuerpoMedio, { color: paleta.superficie }]}>Confirmar y continuar</Text>
              )}
            </Pressable>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fondo: { flex: 1, backgroundColor: 'rgba(20,22,26,.55)', justifyContent: 'flex-end' },
  hoja: {
    borderTopLeftRadius: radio.pantalla, borderTopRightRadius: radio.pantalla,
    padding: espacio.pantalla, gap: espacio.lg,
  },
  filaPlan: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    borderWidth: 1, borderRadius: radio.md, padding: espacio.md,
  },
  input: {
    height: 52, borderRadius: radio.sm, paddingHorizontal: espacio.md,
    outlineWidth: 0, outlineStyle: 'none',
  },
  avisoInfo: { borderRadius: radio.sm, padding: espacio.sm },
  avisoError: { borderWidth: 1, borderRadius: radio.md, padding: espacio.md, gap: espacio.sm },
  filaBotonesError: { flexDirection: 'row', gap: espacio.lg },
  botonConfirmar: {
    height: 52, borderRadius: radio.md, alignItems: 'center', justifyContent: 'center',
  },
});
