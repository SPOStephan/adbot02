-- Mandantenbindung: Funnel gehören einem Adbot-User (Supabase Auth UUID).
-- Bis zum SSO-Bridge bleiben die Spalten nullable; der Admin kann sie setzen.

alter table public.funnels
  add column if not exists owner_user_id uuid,
  add column if not exists owner_email text;

create index if not exists funnels_owner_user_id_idx
  on public.funnels (owner_user_id);

comment on column public.funnels.owner_user_id is
  'Adbot auth.users.id (UUID). Null = noch nicht zugewiesen / Legacy-Single-Tenant.';
comment on column public.funnels.owner_email is
  'Denormalisierte Owner-E-Mail zur Anzeige und manuellen Zuordnung vor SSO.';
