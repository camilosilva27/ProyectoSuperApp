-- Revierte la pausa de 0019_pausar_trial_fase_pruebas.sql: termina la fase de pruebas, la app
-- vuelve a comercializarse con el trial normal de 30 días. Ver Plan_Usuarios_y_cobros.md §
-- "Pausa del trial durante fase de pruebas" para el contexto y los 3 pasos pendientes que este
-- archivo resuelve.
--
-- De paso corrige un bug real encontrado al hacer este revert: 0021_nombre_google_signup.sql
-- redefinió manejar_usuario_nuevo() sin la columna trial_termina_en en el insert, así que toda
-- cuenta creada desde el 2026-09-14 quedó con trial_termina_en = NULL — GatePaywallFinTrial.tsx
-- trata null como "nunca vence", así que eran trials infinitos, no de 365 días a propósito.
-- Los usuarios reales ya afectados por ese bug (no la pausa intencional) se backfillean acá con
-- el mismo criterio de 365 días que el resto de la cohorte de la pausa, por decisión explícita
-- del usuario al encontrar el bug (no se les da 30 días como a una cuenta nueva de hoy).
create or replace function public.manejar_usuario_nuevo()
returns trigger as $$
begin
  insert into public.perfil_usuario (id, nombre, trial_termina_en) values (
    new.id,
    coalesce(
      new.raw_user_meta_data->>'nombre',
      new.raw_user_meta_data->>'full_name',
      new.raw_user_meta_data->>'name'
    ),
    now() + interval '30 days'
  );
  return new;
end;
$$ language plpgsql security definer;

update public.perfil_usuario p
set trial_termina_en = u.created_at + interval '365 days'
from auth.users u
where p.id = u.id
  and p.trial_termina_en is null
  and p.plan = 'trial';
