-- Persiste "el usuario ya vio el tour" por cuenta (antes solo vivía en AsyncStorage, por
-- dispositivo — un mismo usuario en otro dispositivo o navegador volvía a verlo).

alter table public.perfil_usuario
  add column tour_visto boolean not null default false;

comment on column public.perfil_usuario.tour_visto is
  'true si el usuario ya completó (o cerró) el tour interactivo — viaja entre dispositivos.';
