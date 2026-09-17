/**
 * Saca el premium permanente (premium_manual) otorgado a mano a un usuario puntual, y lo vuelve
 * a poner en trial con una nueva ventana de días — ver .claude/docs/Plan_Usuarios_y_cobros.md
 * § "Premium permanente otorgado a mano" para el update inverso documentado.
 *
 * Uso: node src/scripts/sacarPremiumManual.js <mail-del-usuario> <dias-trial>
 */

const { clienteSupabaseAdmin } = require('../clienteSupabaseAdmin');

async function buscarUsuarioPorEmail(cliente, email) {
  const { data, error } = await cliente.auth.admin.listUsers({ perPage: 1000 });
  if (error) throw error;
  return data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase()) ?? null;
}

async function sacarPremiumManual(email, diasTrial) {
  const cliente = clienteSupabaseAdmin();
  if (!cliente) throw new Error('Falta SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY');

  const usuario = await buscarUsuarioPorEmail(cliente, email);
  if (!usuario) return { encontrado: false, email };

  const { data: perfilAntes, error: errorAntes } = await cliente
    .from('perfil_usuario')
    .select('plan, tipo_plan, premium_manual, trial_termina_en, pasarela_suscripcion_id')
    .eq('id', usuario.id)
    .single();
  if (errorAntes) throw errorAntes;

  const trialTerminaEn = new Date(Date.now() + diasTrial * 24 * 60 * 60 * 1000).toISOString();

  const { data: perfilDespues, error: errorUpdate } = await cliente
    .from('perfil_usuario')
    .update({
      plan: 'trial',
      premium_manual: false,
      tipo_plan: null,
      trial_termina_en: trialTerminaEn,
    })
    .eq('id', usuario.id)
    .select('plan, tipo_plan, premium_manual, trial_termina_en, pasarela_suscripcion_id')
    .single();
  if (errorUpdate) throw errorUpdate;

  return { encontrado: true, email, antes: perfilAntes, despues: perfilDespues };
}

if (require.main === module) {
  const email = process.argv[2];
  const diasTrial = Number(process.argv[3]);
  if (!email || !diasTrial) {
    console.error('Uso: node src/scripts/sacarPremiumManual.js <mail-del-usuario> <dias-trial>');
    process.exit(1);
  }
  sacarPremiumManual(email, diasTrial)
    .then((r) => { console.log(JSON.stringify(r, null, 2)); process.exit(0); })
    .catch((err) => { console.error('❌ Error sacando premium manual:', err); process.exit(1); });
}

module.exports = { sacarPremiumManual };
