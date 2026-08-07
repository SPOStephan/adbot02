-- Editable public legal pages (Impressum / Datenschutzerklärung) for Meta Live
-- app review and site-wide footer links.

begin;

create table if not exists public.site_legal_pages (
  slug text primary key
    check (slug in ('impressum', 'datenschutz')),
  title text not null
    check (char_length(btrim(title)) between 1 and 120),
  body text not null
    check (char_length(body) between 1 and 200000),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.users (id) on delete set null
);

alter table public.site_legal_pages enable row level security;

revoke all on table public.site_legal_pages from public, anon, authenticated;
grant select on table public.site_legal_pages to anon, authenticated;
grant select, insert, update on table public.site_legal_pages to service_role;

drop policy if exists site_legal_pages_public_read on public.site_legal_pages;
create policy site_legal_pages_public_read
  on public.site_legal_pages
  for select
  to anon, authenticated
  using (true);

comment on table public.site_legal_pages is
  'Public Impressum/Datenschutz bodies; writable only via service-role API after auth.';

commit;
