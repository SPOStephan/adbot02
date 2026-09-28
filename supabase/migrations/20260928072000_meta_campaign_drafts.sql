begin;

create table if not exists public.meta_campaign_drafts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete restrict,
  platform_account_id uuid not null
    references public.platform_accounts (id) on delete restrict,
  status text not null default 'DRAFT'
    check (status in ('DRAFT', 'LAUNCHED', 'ARCHIVED')),
  campaign_name text not null
    check (char_length(campaign_name) between 1 and 240),
  destination_url text not null
    check (char_length(destination_url) between 1 and 2048),
  payload jsonb not null
    check (
      jsonb_typeof(payload) = 'object'
      and octet_length(payload::text) <= 131072
    ),
  revision bigint not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists meta_campaign_drafts_user_status_updated_idx
  on public.meta_campaign_drafts (user_id, status, updated_at desc);
create index if not exists meta_campaign_drafts_account_status_updated_idx
  on public.meta_campaign_drafts (platform_account_id, status, updated_at desc);

alter table public.meta_campaign_drafts enable row level security;
revoke all on table public.meta_campaign_drafts from public, anon, authenticated;
grant select (
  id, user_id, platform_account_id, status, campaign_name, destination_url,
  payload, revision, created_at, updated_at
) on public.meta_campaign_drafts to authenticated;
grant all on table public.meta_campaign_drafts to service_role;

drop policy if exists meta_campaign_drafts_select_own on public.meta_campaign_drafts;
create policy meta_campaign_drafts_select_own
on public.meta_campaign_drafts
for select
to authenticated
using ((select auth.uid()) = user_id);

create or replace function public.save_meta_campaign_draft(
  p_user_id uuid,
  p_platform_account_id uuid,
  p_draft_id uuid,
  p_payload jsonb,
  p_revision bigint
)
returns table (
  draft_id uuid,
  saved_revision bigint,
  saved_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_revision bigint;
  v_updated_at timestamptz;
  v_campaign_name text;
  v_destination_url text;
begin
  if p_user_id is null or p_platform_account_id is null then
    raise exception 'Campaign draft scope is invalid';
  end if;
  if p_payload is null
    or jsonb_typeof(p_payload) <> 'object'
    or octet_length(p_payload::text) > 131072 then
    raise exception 'Campaign draft payload is invalid';
  end if;
  if p_revision is null or p_revision < 1 then
    raise exception 'Campaign draft revision is invalid';
  end if;
  if not exists (
    select 1
    from public.platform_accounts pa
    where pa.id = p_platform_account_id
      and pa.user_id = p_user_id
      and pa.platform = 'meta'
      and pa.revoked_at is null
  ) then
    raise exception 'Campaign draft account scope is invalid';
  end if;

  v_campaign_name := left(nullif(btrim(p_payload ->> 'campaignName'), ''), 240);
  v_destination_url := left(nullif(btrim(p_payload ->> 'destinationUrl'), ''), 2048);
  if v_campaign_name is null or v_destination_url is null then
    raise exception 'Campaign draft name or destination is invalid';
  end if;

  if p_draft_id is null then
    insert into public.meta_campaign_drafts (
      user_id, platform_account_id, status, campaign_name, destination_url,
      payload, revision
    ) values (
      p_user_id, p_platform_account_id, 'DRAFT', v_campaign_name,
      v_destination_url, p_payload, p_revision
    )
    returning id, revision, updated_at into v_id, v_revision, v_updated_at;
  else
    update public.meta_campaign_drafts d
    set
      campaign_name = v_campaign_name,
      destination_url = v_destination_url,
      payload = p_payload,
      revision = p_revision,
      updated_at = now()
    where d.id = p_draft_id
      and d.user_id = p_user_id
      and d.platform_account_id = p_platform_account_id
      and d.status = 'DRAFT'
      and d.revision < p_revision
    returning d.id, d.revision, d.updated_at
    into v_id, v_revision, v_updated_at;

    if v_id is null then
      select d.id, d.revision, d.updated_at
      into v_id, v_revision, v_updated_at
      from public.meta_campaign_drafts d
      where d.id = p_draft_id
        and d.user_id = p_user_id
        and d.platform_account_id = p_platform_account_id
        and d.status = 'DRAFT';
    end if;
    if v_id is null then
      raise exception 'Campaign draft was not found';
    end if;
  end if;

  return query select v_id, v_revision, v_updated_at;
end;
$$;

revoke all on function public.save_meta_campaign_draft(
  uuid, uuid, uuid, jsonb, bigint
) from public, anon, authenticated;
grant execute on function public.save_meta_campaign_draft(
  uuid, uuid, uuid, jsonb, bigint
) to service_role;

create or replace function public.set_meta_campaign_draft_status(
  p_user_id uuid,
  p_platform_account_id uuid,
  p_draft_id uuid,
  p_status text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_status not in ('LAUNCHED', 'ARCHIVED') then
    raise exception 'Campaign draft status is invalid';
  end if;
  update public.meta_campaign_drafts d
  set status = p_status, updated_at = now()
  where d.id = p_draft_id
    and d.user_id = p_user_id
    and d.platform_account_id = p_platform_account_id
    and d.status = 'DRAFT';
  return found;
end;
$$;

revoke all on function public.set_meta_campaign_draft_status(
  uuid, uuid, uuid, text
) from public, anon, authenticated;
grant execute on function public.set_meta_campaign_draft_status(
  uuid, uuid, uuid, text
) to service_role;

comment on table public.meta_campaign_drafts is
  'Autosaved customer form drafts for Meta campaigns; never executable plans.';

commit;
