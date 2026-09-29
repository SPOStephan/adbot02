-- Versandprotokoll für E-Mails des Funnel-Servers (z. B. Benachrichtigung über neue Einsendungen).
-- Jeder Versuch wird protokolliert: gesendet, fehlgeschlagen oder übersprungen (fehlende Konfiguration).
-- Bewusst ohne Fremdschlüssel, damit Einträge auch nach dem Löschen von Funnel oder Einsendung erhalten bleiben.
-- Zugriff ausschließlich über service_role (Funnel-Server); sichtbar nur für freigegebene Konten.

create table if not exists public.funnel_mail_log (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'application_notification',
  funnel_id uuid,
  funnel_title text not null default '',
  application_id uuid,
  recipients text[] not null default '{}',
  sender text not null default '',
  subject text not null default '',
  status text not null,
  provider_message_id text,
  error text,
  created_at timestamptz not null default now(),
  constraint funnel_mail_log_status_check check (status in ('sent', 'failed', 'skipped'))
);

create index if not exists funnel_mail_log_created_at_idx
  on public.funnel_mail_log (created_at desc);

create index if not exists funnel_mail_log_funnel_idx
  on public.funnel_mail_log (funnel_id, created_at desc);

alter table public.funnel_mail_log enable row level security;

revoke all on table public.funnel_mail_log from anon, authenticated;
grant select, insert, update, delete on public.funnel_mail_log to service_role;

comment on table public.funnel_mail_log is
  'Versandprotokoll der Funnel-E-Mails (wann, an wen, Status, Resend-ID). Nur für freigegebene Konten im Funnel-Admin unter Konto sichtbar.';
