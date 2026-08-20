-- Favicon for site chrome (admin Branding). Additive to site_branding singleton.

begin;

alter table public.site_branding
  add column if not exists favicon_path text
    check (
      favicon_path is null
      or char_length(favicon_path) between 1 and 512
    );

alter table public.site_branding
  add column if not exists favicon_mime text
    check (
      favicon_mime is null
      or favicon_mime in (
        'image/png',
        'image/jpeg',
        'image/webp',
        'image/x-icon',
        'image/vnd.microsoft.icon'
      )
    );

alter table public.site_branding
  drop constraint if exists site_branding_favicon_pair;

alter table public.site_branding
  add constraint site_branding_favicon_pair
  check ((favicon_path is null) = (favicon_mime is null));

comment on column public.site_branding.favicon_path is
  'Public storage path for browser tab icon (favicon).';

commit;
