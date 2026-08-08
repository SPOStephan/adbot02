create extension if not exists pgcrypto;

create table if not exists public.funnels (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  config jsonb not null,
  notification_email text not null default '',
  allowed_embed_origins text[] not null default '{}',
  is_published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.applications (
  id uuid primary key default gen_random_uuid(),
  funnel_id uuid not null references public.funnels(id) on delete cascade,
  funnel_slug text not null,
  status text not null default 'new' check (status in ('new', 'reviewing', 'contacted', 'rejected', 'hired')),
  answers jsonb not null default '{}'::jsonb,
  contact jsonb not null default '{}'::jsonb,
  consent_at timestamptz not null,
  resume jsonb,
  source_url text,
  utm jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists applications_funnel_created_idx
  on public.applications (funnel_id, created_at desc);

create index if not exists applications_status_idx
  on public.applications (status);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists funnels_set_updated_at on public.funnels;
create trigger funnels_set_updated_at
before update on public.funnels
for each row execute function public.set_updated_at();

alter table public.funnels enable row level security;
alter table public.applications enable row level security;

revoke all on table public.funnels from anon, authenticated;
revoke all on table public.applications from anon, authenticated;

grant usage on schema public to service_role;
grant select, insert, update, delete on table public.funnels to service_role;
grant select, insert, update, delete on table public.applications to service_role;

revoke execute on function public.set_updated_at() from public;
grant execute on function public.set_updated_at() to service_role;

comment on table public.funnels is 'Versioned recruiting funnel configuration consumed only through the application server.';
comment on table public.applications is 'Submitted applicant data. Access is restricted to the server-side service role.';
