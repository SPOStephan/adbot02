-- Site-wide logo branding (light/dark variants) for chrome on marketing + portal.

begin;

create table if not exists public.site_branding (
  id smallint primary key default 1
    check (id = 1),
  logo_on_light_path text
    check (
      logo_on_light_path is null
      or char_length(logo_on_light_path) between 1 and 512
    ),
  logo_on_light_mime text
    check (
      logo_on_light_mime is null
      or logo_on_light_mime in ('image/png', 'image/jpeg', 'image/webp')
    ),
  logo_on_dark_path text
    check (
      logo_on_dark_path is null
      or char_length(logo_on_dark_path) between 1 and 512
    ),
  logo_on_dark_mime text
    check (
      logo_on_dark_mime is null
      or logo_on_dark_mime in ('image/png', 'image/jpeg', 'image/webp')
    ),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.users (id) on delete set null,
  check (
    (logo_on_light_path is null) = (logo_on_light_mime is null)
  ),
  check (
    (logo_on_dark_path is null) = (logo_on_dark_mime is null)
  )
);

insert into public.site_branding (id)
values (1)
on conflict (id) do nothing;

alter table public.site_branding enable row level security;

revoke all on table public.site_branding from public, anon, authenticated;
grant select on table public.site_branding to anon, authenticated;
grant select, insert, update, delete on table public.site_branding to service_role;

drop policy if exists site_branding_public_read on public.site_branding;
create policy site_branding_public_read
  on public.site_branding
  for select
  to anon, authenticated
  using (true);

comment on table public.site_branding is
  'Singleton site chrome logos: on-light (dark mark) and on-dark (light/negative mark). Files live in public storage bucket site-branding.';

commit;
