-- Aktennotizen zu Bewerbungen: jede Notiz hält fest, wer (Name, E-Mail, Login-Art) wann was geschrieben hat.
-- Notizen werden nur angehängt, nie geändert. Beim endgültigen Löschen einer Bewerbung verschwinden sie mit.
-- Zugriff ausschließlich über service_role (Funnel-Server).

create table if not exists public.application_notes (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete cascade,
  author_email text not null,
  author_name text not null default '',
  author_login_method text not null default '',
  body text not null,
  created_at timestamptz not null default now(),
  constraint application_notes_body_length
    check (char_length(btrim(body)) between 1 and 5000)
);

create index if not exists application_notes_application_created_idx
  on public.application_notes (application_id, created_at);

alter table public.application_notes enable row level security;

revoke all on table public.application_notes from anon, authenticated;
-- Nur lesen und anhängen: Notizen sind ein Protokoll und bleiben unverändert.
revoke update, delete on table public.application_notes from service_role;
grant select, insert on public.application_notes to service_role;

comment on table public.application_notes is
  'Aktennotizen zu Bewerbungen aus der Funnel-Detailansicht. Nur anhängen; Autor und Zeitpunkt werden serverseitig gesetzt.';
