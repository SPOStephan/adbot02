-- Firmenangaben pro Adbot-Konto für das Kunden-Dashboard.
-- company_name: vollständiger Firmenname inkl. Rechtsform (z. B. "Boncred Finanzvermittlungs GmbH").
-- display_name: Kurzname für die Anzeige, z. B. im Dashboard-Kopf ("Boncred" → "Boncred Funnel").
-- Zugriff ausschließlich über service_role (Funnel-Server).

create table if not exists public.funnel_account_profiles (
  owner_user_id uuid primary key,
  company_name text not null default '',
  display_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint funnel_account_profiles_company_name_length check (char_length(company_name) <= 200),
  constraint funnel_account_profiles_display_name_length check (char_length(display_name) <= 80)
);

drop trigger if exists funnel_account_profiles_set_updated_at on public.funnel_account_profiles;
create trigger funnel_account_profiles_set_updated_at
before update on public.funnel_account_profiles
for each row execute function public.set_updated_at();

alter table public.funnel_account_profiles enable row level security;

revoke all on table public.funnel_account_profiles from anon, authenticated;
grant select, insert, update, delete on public.funnel_account_profiles to service_role;

comment on table public.funnel_account_profiles is
  'Firmenname (vollständig) und angezeigter Kurzname je Adbot-Konto. Gepflegt im Funnel-Admin unter Konto.';
