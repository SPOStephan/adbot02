-- Campaign Assistant v1: persist objective + landing URL briefs (drafts only).
-- No Meta writes, credits, or launch wiring yet.

begin;

create table if not exists public.campaign_briefs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete restrict,
  platform_account_id uuid not null
    references public.platform_accounts (id) on delete restrict,
  objective text not null
    check (objective in (
      'OUTCOME_TRAFFIC',
      'OUTCOME_AWARENESS',
      'OUTCOME_ENGAGEMENT',
      'OUTCOME_LEADS',
      'OUTCOME_SALES',
      'OUTCOME_APP_PROMOTION'
    )),
  landing_url text not null
    check (
      char_length(landing_url) between 9 and 2048
      and landing_url ~* '^https://'
    ),
  landing_hostname text not null
    check (
      char_length(landing_hostname) between 1 and 253
      and landing_hostname = lower(landing_hostname)
    ),
  status text not null default 'DRAFT'
    check (status in ('DRAFT', 'READY', 'CONSUMED', 'ARCHIVED')),
  brief_hash text not null
    check (brief_hash ~ '^[0-9a-f]{64}$'),
  notes text
    check (notes is null or char_length(notes) <= 500),
  brand_profile_id uuid references public.brand_profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists campaign_briefs_account_created_idx
  on public.campaign_briefs (platform_account_id, created_at desc);

create index if not exists campaign_briefs_user_created_idx
  on public.campaign_briefs (user_id, created_at desc);

create unique index if not exists campaign_briefs_open_hash_uidx
  on public.campaign_briefs (platform_account_id, brief_hash)
  where status in ('DRAFT', 'READY');

alter table public.campaign_briefs enable row level security;

revoke all on table public.campaign_briefs from public, anon, authenticated;
grant select (
  id, user_id, platform_account_id, objective, landing_url, landing_hostname,
  status, brief_hash, notes, brand_profile_id, created_at, updated_at
) on public.campaign_briefs to authenticated;
grant all on table public.campaign_briefs to service_role;

drop policy if exists campaign_briefs_select_own on public.campaign_briefs;
create policy campaign_briefs_select_own
on public.campaign_briefs
for select
to authenticated
using ((select auth.uid()) = user_id);

create or replace function public.put_campaign_brief(
  p_user_id uuid,
  p_platform_account_id uuid,
  p_objective text,
  p_landing_url text,
  p_landing_hostname text,
  p_brief_hash text,
  p_notes text default null,
  p_brand_profile_id uuid default null
)
returns table (
  brief_id uuid,
  status text,
  already_existed boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing public.campaign_briefs%rowtype;
  v_brand uuid;
  v_notes text;
begin
  if p_user_id is null or p_platform_account_id is null then
    raise exception 'Campaign brief scope is invalid';
  end if;

  if p_objective is null or p_objective not in (
    'OUTCOME_TRAFFIC',
    'OUTCOME_AWARENESS',
    'OUTCOME_ENGAGEMENT',
    'OUTCOME_LEADS',
    'OUTCOME_SALES',
    'OUTCOME_APP_PROMOTION'
  ) then
    raise exception 'Campaign brief objective is invalid';
  end if;

  if p_landing_url is null
    or char_length(p_landing_url) < 9
    or char_length(p_landing_url) > 2048
    or p_landing_url !~* '^https://' then
    raise exception 'Campaign brief landing URL is invalid';
  end if;

  if p_landing_hostname is null
    or char_length(p_landing_hostname) < 1
    or p_landing_hostname <> lower(p_landing_hostname) then
    raise exception 'Campaign brief hostname is invalid';
  end if;

  if p_brief_hash is null or p_brief_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Campaign brief hash is invalid';
  end if;

  if not exists (
    select 1
    from public.platform_accounts pa
    where pa.id = p_platform_account_id
      and pa.user_id = p_user_id
      and pa.platform = 'meta'
      and pa.revoked_at is null
  ) then
    raise exception 'Campaign brief account scope is invalid';
  end if;

  v_notes := nullif(btrim(coalesce(p_notes, '')), '');
  if v_notes is not null and char_length(v_notes) > 500 then
    raise exception 'Campaign brief notes are too long';
  end if;

  v_brand := null;
  if p_brand_profile_id is not null then
    if not exists (
      select 1
      from public.brand_profiles bp
      where bp.id = p_brand_profile_id
        and bp.user_id = p_user_id
        and bp.platform_account_id = p_platform_account_id
        and bp.status = 'ACTIVE'
    ) then
      raise exception 'Campaign brief brand profile is invalid';
    end if;
    v_brand := p_brand_profile_id;
  end if;

  select * into v_existing
  from public.campaign_briefs b
  where b.platform_account_id = p_platform_account_id
    and b.user_id = p_user_id
    and b.brief_hash = p_brief_hash
    and b.status in ('DRAFT', 'READY')
  limit 1;

  if v_existing.id is not null then
    update public.campaign_briefs b
    set
      notes = coalesce(v_notes, b.notes),
      brand_profile_id = coalesce(v_brand, b.brand_profile_id),
      updated_at = now()
    where b.id = v_existing.id;

    return query select v_existing.id, v_existing.status, true;
    return;
  end if;

  insert into public.campaign_briefs (
    user_id,
    platform_account_id,
    objective,
    landing_url,
    landing_hostname,
    status,
    brief_hash,
    notes,
    brand_profile_id
  ) values (
    p_user_id,
    p_platform_account_id,
    p_objective,
    p_landing_url,
    p_landing_hostname,
    'DRAFT',
    p_brief_hash,
    v_notes,
    v_brand
  )
  returning id, status into v_existing.id, v_existing.status;

  return query select v_existing.id, v_existing.status, false;
end;
$$;

revoke all on function public.put_campaign_brief(
  uuid, uuid, text, text, text, text, text, uuid
) from public, anon, authenticated;
grant execute on function public.put_campaign_brief(
  uuid, uuid, text, text, text, text, text, uuid
) to service_role;

create or replace function public.archive_campaign_brief(
  p_user_id uuid,
  p_platform_account_id uuid,
  p_brief_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_user_id is null or p_platform_account_id is null or p_brief_id is null then
    raise exception 'Campaign brief archive scope is invalid';
  end if;

  update public.campaign_briefs b
  set status = 'ARCHIVED', updated_at = now()
  where b.id = p_brief_id
    and b.user_id = p_user_id
    and b.platform_account_id = p_platform_account_id
    and b.status in ('DRAFT', 'READY');

  return found;
end;
$$;

revoke all on function public.archive_campaign_brief(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.archive_campaign_brief(uuid, uuid, uuid)
  to service_role;

comment on table public.campaign_briefs is
  'Kampagnen-Assistent: customer briefs (objective + landing URL) before creative generation.';

commit;
