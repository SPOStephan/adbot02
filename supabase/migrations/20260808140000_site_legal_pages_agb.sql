-- Allow AGB as a third editable public legal page.

begin;

alter table public.site_legal_pages
  drop constraint if exists site_legal_pages_slug_check;

alter table public.site_legal_pages
  add constraint site_legal_pages_slug_check
  check (slug in ('impressum', 'datenschutz', 'agb'));

comment on table public.site_legal_pages is
  'Public Impressum/Datenschutz/AGB bodies; writable only via service-role API after admin auth.';

commit;
