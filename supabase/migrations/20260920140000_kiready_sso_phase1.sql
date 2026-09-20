-- KIready OIDC Phase 1: local identity map + one Adbot org per KIready company.

begin;

create table if not exists public.adbot_organizations (
  id uuid primary key default gen_random_uuid(),
  kiready_organization_id uuid not null unique,
  name text not null,
  slug text,
  entitlement_status text not null default 'unknown',
  entitlement_plan_code text,
  entitlement_valid_until timestamptz,
  entitlement_has_access boolean not null default false,
  entitlement_source text,
  entitlement_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.adbot_organization_memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.adbot_organizations (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'member')),
  permissions text[] not null default '{}'::text[],
  has_adbot_use boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id)
);

create unique index if not exists adbot_organization_memberships_user_idx
  on public.adbot_organization_memberships (user_id);

create table if not exists public.kiready_external_identities (
  id uuid primary key default gen_random_uuid(),
  issuer text not null,
  subject text not null,
  local_user_id uuid not null references public.users (id) on delete cascade,
  kiready_organization_id uuid not null,
  email_at_link text,
  access_token_ciphertext text,
  access_token_iv text,
  access_token_tag text,
  refresh_token_ciphertext text,
  refresh_token_iv text,
  refresh_token_tag text,
  token_expires_at timestamptz,
  linked_at timestamptz not null default now(),
  last_login_at timestamptz,
  unique (issuer, subject),
  unique (local_user_id)
);

create index if not exists kiready_external_identities_org_idx
  on public.kiready_external_identities (kiready_organization_id);

alter table public.adbot_organizations enable row level security;
alter table public.adbot_organization_memberships enable row level security;
alter table public.kiready_external_identities enable row level security;

revoke all on table public.adbot_organizations from public, anon, authenticated;
revoke all on table public.adbot_organization_memberships from public, anon, authenticated;
revoke all on table public.kiready_external_identities from public, anon, authenticated;

grant select on table public.adbot_organizations to authenticated;
grant select on table public.adbot_organization_memberships to authenticated;
grant all on table public.adbot_organizations to service_role;
grant all on table public.adbot_organization_memberships to service_role;
grant all on table public.kiready_external_identities to service_role;

drop policy if exists adbot_organizations_select_member on public.adbot_organizations;
create policy adbot_organizations_select_member
on public.adbot_organizations
for select
to authenticated
using (
  exists (
    select 1
    from public.adbot_organization_memberships m
    where m.organization_id = adbot_organizations.id
      and m.user_id = auth.uid()
  )
);

drop policy if exists adbot_organization_memberships_select_own on public.adbot_organization_memberships;
create policy adbot_organization_memberships_select_own
on public.adbot_organization_memberships
for select
to authenticated
using (user_id = auth.uid());

comment on table public.adbot_organizations is
  'One Adbot company account per KIready organization. Entitlement snapshot is refreshed at SSO login.';
comment on table public.adbot_organization_memberships is
  'Personal Adbot assignment inside a shared company account. has_adbot_use comes from KIready adbot:use.';
comment on table public.kiready_external_identities is
  'OIDC issuer+subject is the durable SSO key. Email is evidence only.';

commit;
