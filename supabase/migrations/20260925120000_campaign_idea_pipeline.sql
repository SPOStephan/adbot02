-- Per-customer campaign idea pipeline.
-- Ideas sit until the customer clicks "Idee jetzt umsetzen".
-- Competitor screenshots are inspiration only — never 1:1 launch assets.
-- Does NOT redefine organic boost, kill-switch, or launch freeze.

begin;

create table if not exists public.campaign_ideas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete restrict,
  platform_account_id uuid not null
    references public.platform_accounts (id) on delete restrict,
  source_type text not null
    check (source_type in ('LINK', 'SCREENSHOT', 'KEYWORDS')),
  status text not null default 'QUEUED'
    check (status in (
      'QUEUED', 'READY', 'REALIZING', 'REALIZED', 'FAILED', 'ARCHIVED'
    )),
  source_url text
    check (
      source_url is null
      or (
        char_length(source_url) between 9 and 2048
        and source_url ~* '^https://'
      )
    ),
  keywords text
    check (keywords is null or char_length(keywords) <= 500),
  notes text
    check (notes is null or char_length(notes) <= 500),
  screenshot_asset_id uuid
    references public.brand_assets (id) on delete restrict,
  idea_hash text not null
    check (idea_hash ~ '^[0-9a-f]{64}$'),
  extracted_core jsonb not null default '{}'::jsonb,
  extracted_at timestamptz,
  last_error text
    check (last_error is null or char_length(last_error) <= 500),
  destination_url text
    check (
      destination_url is null
      or (
        char_length(destination_url) between 9 and 2048
        and destination_url ~* '^https://'
      )
    ),
  destination_hostname text
    check (
      destination_hostname is null
      or (
        char_length(destination_hostname) between 1 and 253
        and destination_hostname = lower(destination_hostname)
      )
    ),
  objective text
    check (
      objective is null
      or objective in (
        'OUTCOME_TRAFFIC',
        'OUTCOME_AWARENESS',
        'OUTCOME_ENGAGEMENT',
        'OUTCOME_LEADS',
        'OUTCOME_SALES',
        'OUTCOME_APP_PROMOTION'
      )
    ),
  realized_copy jsonb not null default '{}'::jsonb,
  realized_asset_id uuid
    references public.brand_assets (id) on delete restrict,
  realized_at timestamptz,
  campaign_brief_id uuid
    references public.campaign_briefs (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint campaign_ideas_json_object_check
    check (
      jsonb_typeof(extracted_core) = 'object'
      and jsonb_typeof(realized_copy) = 'object'
    ),
  constraint campaign_ideas_source_present_check
    check (
      source_url is not null
      or keywords is not null
      or screenshot_asset_id is not null
    )
);

create index if not exists campaign_ideas_account_created_idx
  on public.campaign_ideas (platform_account_id, created_at desc);

create index if not exists campaign_ideas_user_status_idx
  on public.campaign_ideas (user_id, status, created_at desc);

create unique index if not exists campaign_ideas_open_hash_uidx
  on public.campaign_ideas (platform_account_id, idea_hash)
  where status in ('QUEUED', 'READY', 'REALIZING', 'REALIZED', 'FAILED');

alter table public.campaign_ideas enable row level security;

revoke all on table public.campaign_ideas from public, anon, authenticated;
grant select (
  id, user_id, platform_account_id, source_type, status, source_url, keywords,
  notes, screenshot_asset_id, idea_hash, extracted_core, extracted_at,
  last_error, destination_url, destination_hostname, objective, realized_copy,
  realized_asset_id, realized_at, campaign_brief_id, created_at, updated_at
) on public.campaign_ideas to authenticated;
grant all on table public.campaign_ideas to service_role;

drop policy if exists campaign_ideas_select_own on public.campaign_ideas;
create policy campaign_ideas_select_own
on public.campaign_ideas
for select
to authenticated
using ((select auth.uid()) = user_id);

create or replace function public.put_campaign_idea(
  p_user_id uuid,
  p_platform_account_id uuid,
  p_source_type text,
  p_idea_hash text,
  p_source_url text default null,
  p_keywords text default null,
  p_notes text default null,
  p_screenshot_asset_id uuid default null,
  p_destination_url text default null,
  p_destination_hostname text default null,
  p_objective text default null
)
returns table (
  idea_id uuid,
  status text,
  already_existed boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing public.campaign_ideas%rowtype;
  v_source_url text;
  v_keywords text;
  v_notes text;
  v_destination text;
  v_host text;
begin
  if p_user_id is null or p_platform_account_id is null then
    raise exception 'Campaign idea scope is invalid';
  end if;

  if p_source_type is null or p_source_type not in (
    'LINK', 'SCREENSHOT', 'KEYWORDS'
  ) then
    raise exception 'Campaign idea source type is invalid';
  end if;

  if p_idea_hash is null or p_idea_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Campaign idea hash is invalid';
  end if;

  if not exists (
    select 1
    from public.platform_accounts pa
    where pa.id = p_platform_account_id
      and pa.user_id = p_user_id
      and pa.platform = 'meta'
      and pa.revoked_at is null
  ) then
    raise exception 'Campaign idea account scope is invalid';
  end if;

  v_source_url := nullif(btrim(coalesce(p_source_url, '')), '');
  v_keywords := nullif(btrim(coalesce(p_keywords, '')), '');
  v_notes := nullif(btrim(coalesce(p_notes, '')), '');
  v_destination := nullif(btrim(coalesce(p_destination_url, '')), '');
  v_host := nullif(btrim(coalesce(p_destination_hostname, '')), '');

  if v_source_url is null and v_keywords is null and p_screenshot_asset_id is null then
    raise exception 'Campaign idea needs a link, screenshot, or keywords';
  end if;

  if p_source_type = 'LINK' and v_source_url is null then
    raise exception 'Campaign idea link is required';
  end if;
  if p_source_type = 'KEYWORDS' and v_keywords is null then
    raise exception 'Campaign idea keywords are required';
  end if;
  if p_source_type = 'SCREENSHOT' and p_screenshot_asset_id is null then
    raise exception 'Campaign idea screenshot is required';
  end if;

  if p_screenshot_asset_id is not null then
    if not exists (
      select 1
      from public.brand_assets ba
      where ba.id = p_screenshot_asset_id
        and ba.user_id = p_user_id
        and ba.library_scope = 'CUSTOMER'
        and ba.status is distinct from 'REVOKED'
    ) then
      raise exception 'Campaign idea screenshot must be a customer library asset';
    end if;
  end if;

  if v_notes is not null and char_length(v_notes) > 500 then
    raise exception 'Campaign idea notes are too long';
  end if;
  if v_keywords is not null and char_length(v_keywords) > 500 then
    raise exception 'Campaign idea keywords are too long';
  end if;

  if p_objective is not null and p_objective not in (
    'OUTCOME_TRAFFIC',
    'OUTCOME_AWARENESS',
    'OUTCOME_ENGAGEMENT',
    'OUTCOME_LEADS',
    'OUTCOME_SALES',
    'OUTCOME_APP_PROMOTION'
  ) then
    raise exception 'Campaign idea objective is invalid';
  end if;

  select * into v_existing
  from public.campaign_ideas idea
  where idea.platform_account_id = p_platform_account_id
    and idea.user_id = p_user_id
    and idea.idea_hash = p_idea_hash
    and idea.status in ('QUEUED', 'READY', 'REALIZING', 'REALIZED', 'FAILED')
  limit 1;

  if v_existing.id is not null then
    update public.campaign_ideas idea
    set
      notes = coalesce(v_notes, idea.notes),
      destination_url = coalesce(v_destination, idea.destination_url),
      destination_hostname = coalesce(v_host, idea.destination_hostname),
      objective = coalesce(p_objective, idea.objective),
      updated_at = now()
    where idea.id = v_existing.id;

    return query select v_existing.id, v_existing.status, true;
    return;
  end if;

  insert into public.campaign_ideas (
    user_id,
    platform_account_id,
    source_type,
    status,
    source_url,
    keywords,
    notes,
    screenshot_asset_id,
    idea_hash,
    destination_url,
    destination_hostname,
    objective
  ) values (
    p_user_id,
    p_platform_account_id,
    p_source_type,
    'QUEUED',
    v_source_url,
    v_keywords,
    v_notes,
    p_screenshot_asset_id,
    p_idea_hash,
    v_destination,
    v_host,
    p_objective
  )
  returning id, status into v_existing.id, v_existing.status;

  return query select v_existing.id, v_existing.status, false;
end;
$$;

revoke all on function public.put_campaign_idea(
  uuid, uuid, text, text, text, text, text, uuid, text, text, text
) from public, anon, authenticated;
grant execute on function public.put_campaign_idea(
  uuid, uuid, text, text, text, text, text, uuid, text, text, text
) to service_role;

create or replace function public.set_campaign_idea_core(
  p_user_id uuid,
  p_platform_account_id uuid,
  p_idea_id uuid,
  p_extracted_core jsonb,
  p_status text default 'READY',
  p_last_error text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_user_id is null or p_platform_account_id is null or p_idea_id is null then
    raise exception 'Campaign idea core scope is invalid';
  end if;
  if jsonb_typeof(coalesce(p_extracted_core, '{}'::jsonb)) <> 'object' then
    raise exception 'Campaign idea core must be a JSON object';
  end if;
  if p_status not in ('QUEUED', 'READY', 'FAILED') then
    raise exception 'Campaign idea core status is invalid';
  end if;

  update public.campaign_ideas idea
  set
    extracted_core = coalesce(p_extracted_core, '{}'::jsonb),
    extracted_at = now(),
    status = p_status,
    last_error = nullif(btrim(coalesce(p_last_error, '')), ''),
    updated_at = now()
  where idea.id = p_idea_id
    and idea.user_id = p_user_id
    and idea.platform_account_id = p_platform_account_id
    and idea.status in ('QUEUED', 'READY', 'FAILED');

  return found;
end;
$$;

revoke all on function public.set_campaign_idea_core(
  uuid, uuid, uuid, jsonb, text, text
) from public, anon, authenticated;
grant execute on function public.set_campaign_idea_core(
  uuid, uuid, uuid, jsonb, text, text
) to service_role;

create or replace function public.realize_campaign_idea(
  p_user_id uuid,
  p_platform_account_id uuid,
  p_idea_id uuid,
  p_destination_url text,
  p_destination_hostname text,
  p_objective text,
  p_realized_copy jsonb,
  p_realized_asset_id uuid default null,
  p_campaign_brief_id uuid default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_user_id is null or p_platform_account_id is null or p_idea_id is null then
    raise exception 'Campaign idea realize scope is invalid';
  end if;
  if p_destination_url is null or p_destination_url !~* '^https://' then
    raise exception 'Campaign idea realize needs a customer HTTPS destination';
  end if;
  if jsonb_typeof(coalesce(p_realized_copy, '{}'::jsonb)) <> 'object' then
    raise exception 'Campaign idea realized copy must be a JSON object';
  end if;
  if p_realized_asset_id is not null then
    if not exists (
      select 1
      from public.brand_assets ba
      where ba.id = p_realized_asset_id
        and ba.user_id = p_user_id
        and ba.library_scope = 'CUSTOMER'
        and ba.status is distinct from 'REVOKED'
        and coalesce(ba.source_type, '') is distinct from 'INSPIRATION'
    ) then
      raise exception 'Realized creative must be a customer-owned generated asset';
    end if;
    if exists (
      select 1
      from public.campaign_ideas idea
      where idea.id = p_idea_id
        and idea.screenshot_asset_id is not null
        and idea.screenshot_asset_id = p_realized_asset_id
    ) then
      raise exception 'Competitor screenshot must not be used as the launch creative';
    end if;
  end if;

  update public.campaign_ideas idea
  set
    status = 'REALIZED',
    destination_url = p_destination_url,
    destination_hostname = lower(p_destination_hostname),
    objective = p_objective,
    realized_copy = coalesce(p_realized_copy, '{}'::jsonb),
    realized_asset_id = p_realized_asset_id,
    campaign_brief_id = p_campaign_brief_id,
    realized_at = now(),
    last_error = null,
    updated_at = now()
  where idea.id = p_idea_id
    and idea.user_id = p_user_id
    and idea.platform_account_id = p_platform_account_id
    and idea.status in ('READY', 'REALIZING', 'FAILED', 'REALIZED');

  return found;
end;
$$;

revoke all on function public.realize_campaign_idea(
  uuid, uuid, uuid, text, text, text, jsonb, uuid, uuid
) from public, anon, authenticated;
grant execute on function public.realize_campaign_idea(
  uuid, uuid, uuid, text, text, text, jsonb, uuid, uuid
) to service_role;

create or replace function public.set_campaign_idea_status(
  p_user_id uuid,
  p_platform_account_id uuid,
  p_idea_id uuid,
  p_status text,
  p_last_error text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_status not in (
    'QUEUED', 'READY', 'REALIZING', 'REALIZED', 'FAILED', 'ARCHIVED'
  ) then
    raise exception 'Campaign idea status is invalid';
  end if;

  update public.campaign_ideas idea
  set
    status = p_status,
    last_error = nullif(btrim(coalesce(p_last_error, '')), ''),
    updated_at = now()
  where idea.id = p_idea_id
    and idea.user_id = p_user_id
    and idea.platform_account_id = p_platform_account_id
    and (
      (p_status = 'ARCHIVED' and idea.status <> 'ARCHIVED')
      or (p_status = 'REALIZING' and idea.status in ('READY', 'FAILED', 'REALIZED'))
      or (p_status = 'FAILED' and idea.status in ('QUEUED', 'READY', 'REALIZING'))
      or (p_status = 'QUEUED' and idea.status in ('FAILED'))
    );

  return found;
end;
$$;

revoke all on function public.set_campaign_idea_status(
  uuid, uuid, uuid, text, text
) from public, anon, authenticated;
grant execute on function public.set_campaign_idea_status(
  uuid, uuid, uuid, text, text
) to service_role;

comment on table public.campaign_ideas is
  'Customer campaign idea pipeline: link/screenshot/keywords sit until realize. Screenshots are never 1:1 launch assets.';

commit;
