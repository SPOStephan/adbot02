-- Durable credit settlement outbox for asynchronous creative jobs.
-- Financial finality is retried independently after job completion/failure.

begin;

alter table public.creative_asset_jobs
  add column if not exists credit_provider text,
  add column if not exists credit_external_reservation_id text,
  add column if not exists credit_settlement_status text not null default 'NONE',
  add column if not exists credit_settlement_attempt_count integer not null default 0,
  add column if not exists credit_settlement_next_attempt_at timestamptz,
  add column if not exists credit_settlement_lease_token uuid,
  add column if not exists credit_settlement_lease_expires_at timestamptz,
  add column if not exists credit_settlement_last_error text,
  add column if not exists credit_settled_at timestamptz;

alter table public.creative_asset_jobs
  drop constraint if exists creative_asset_jobs_credit_provider_check,
  add constraint creative_asset_jobs_credit_provider_check
    check (credit_provider is null or credit_provider in ('legacy', 'waizr')),
  drop constraint if exists creative_asset_jobs_credit_settlement_status_check,
  add constraint creative_asset_jobs_credit_settlement_status_check
    check (credit_settlement_status in (
      'NONE', 'RESERVED', 'PENDING_CAPTURE', 'PENDING_RELEASE',
      'PROCESSING', 'SETTLED', 'DEAD'
    )),
  drop constraint if exists creative_asset_jobs_credit_settlement_attempt_count_check,
  add constraint creative_asset_jobs_credit_settlement_attempt_count_check
    check (credit_settlement_attempt_count between 0 and 100),
  drop constraint if exists creative_asset_jobs_credit_settlement_reference_check,
  add constraint creative_asset_jobs_credit_settlement_reference_check check (
    (credit_provider is null and credit_external_reservation_id is null)
    or (credit_provider is not null and nullif(credit_external_reservation_id, '') is not null)
  );

create or replace function public.sync_creative_credit_settlement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_external_provider text;
  v_external_reservation_id text;
begin
  v_external_provider := nullif(new.input_payload #>> '{_billing,credit_provider}', '');
  v_external_reservation_id := nullif(new.input_payload #>> '{_billing,credit_reservation_id}', '');

  if v_external_provider in ('legacy', 'waizr') and v_external_reservation_id is not null then
    new.credit_provider := v_external_provider;
    new.credit_external_reservation_id := v_external_reservation_id;
  elsif new.credit_reservation_id is not null then
    new.credit_provider := 'legacy';
    new.credit_external_reservation_id := new.credit_reservation_id::text;
  else
    new.credit_provider := null;
    new.credit_external_reservation_id := null;
  end if;

  if new.credit_provider is null then
    new.credit_settlement_status := 'NONE';
    new.credit_settlement_next_attempt_at := null;
  elsif tg_op = 'INSERT'
    or old.status is distinct from new.status
    or old.credit_reservation_id is distinct from new.credit_reservation_id
    or old.input_payload is distinct from new.input_payload then
    if new.status = 'SUCCEEDED' then
      new.credit_settlement_status := 'PENDING_CAPTURE';
      new.credit_settlement_next_attempt_at := now();
    elsif new.status in ('FAILED', 'AMBIGUOUS', 'CANCELLED') then
      new.credit_settlement_status := 'PENDING_RELEASE';
      new.credit_settlement_next_attempt_at := now();
    else
      new.credit_settlement_status := 'RESERVED';
      new.credit_settlement_next_attempt_at := null;
    end if;
    new.credit_settlement_lease_token := null;
    new.credit_settlement_lease_expires_at := null;
    new.credit_settlement_last_error := null;
  end if;

  return new;
end;
$$;

revoke all on function public.sync_creative_credit_settlement() from public, anon, authenticated;
grant execute on function public.sync_creative_credit_settlement() to service_role;

drop trigger if exists creative_asset_jobs_sync_credit_settlement
  on public.creative_asset_jobs;
create trigger creative_asset_jobs_sync_credit_settlement
before insert or update of status, credit_reservation_id, input_payload
on public.creative_asset_jobs
for each row execute function public.sync_creative_credit_settlement();

-- Existing rows were handled by the former synchronous settlement path. Mark
-- them financially final instead of replaying historic captures/releases.
update public.creative_asset_jobs
set
  credit_provider = case
    when nullif(input_payload #>> '{_billing,credit_provider}', '') in ('legacy', 'waizr')
      then input_payload #>> '{_billing,credit_provider}'
    when credit_reservation_id is not null then 'legacy'
    else null
  end,
  credit_external_reservation_id = coalesce(
    nullif(input_payload #>> '{_billing,credit_reservation_id}', ''),
    credit_reservation_id::text
  ),
  credit_settlement_status = case
    when coalesce(
      nullif(input_payload #>> '{_billing,credit_reservation_id}', ''),
      credit_reservation_id::text
    ) is null then 'NONE'
    when status in ('SUCCEEDED', 'FAILED', 'AMBIGUOUS', 'CANCELLED') then 'SETTLED'
    else 'RESERVED'
  end,
  credit_settled_at = case
    when status in ('SUCCEEDED', 'FAILED', 'AMBIGUOUS', 'CANCELLED')
      and coalesce(
        nullif(input_payload #>> '{_billing,credit_reservation_id}', ''),
        credit_reservation_id::text
      ) is not null then coalesce(completed_at, updated_at, now())
    else null
  end,
  credit_settlement_next_attempt_at = null,
  credit_settlement_lease_token = null,
  credit_settlement_lease_expires_at = null;

create index if not exists creative_asset_jobs_credit_settlement_due_idx
  on public.creative_asset_jobs (
    credit_settlement_status,
    credit_settlement_next_attempt_at,
    credit_settlement_lease_expires_at,
    created_at
  )
  where credit_settlement_status in (
    'PENDING_CAPTURE', 'PENDING_RELEASE', 'PROCESSING'
  );

create or replace function public.claim_next_creative_credit_settlement(
  p_lease_seconds integer default 60
)
returns table (
  job_id uuid,
  user_id uuid,
  credit_provider text,
  credit_reservation_id text,
  settlement_outcome text,
  lease_token uuid,
  attempt_count integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.creative_asset_jobs%rowtype;
  v_token uuid := gen_random_uuid();
begin
  if p_lease_seconds < 10 or p_lease_seconds > 300 then
    raise exception 'Credit settlement lease must be between 10 and 300 seconds';
  end if;

  select job.* into v_job
  from public.creative_asset_jobs job
  where (
      job.credit_settlement_status in ('PENDING_CAPTURE', 'PENDING_RELEASE')
      and coalesce(job.credit_settlement_next_attempt_at, now()) <= now()
    ) or (
      job.credit_settlement_status = 'PROCESSING'
      and job.credit_settlement_lease_expires_at <= now()
    )
  order by coalesce(job.credit_settlement_next_attempt_at, job.created_at), job.created_at
  for update skip locked
  limit 1;

  if v_job.id is null then
    return;
  end if;

  update public.creative_asset_jobs job
  set
    credit_settlement_status = 'PROCESSING',
    credit_settlement_attempt_count = least(job.credit_settlement_attempt_count + 1, 100),
    credit_settlement_lease_token = v_token,
    credit_settlement_lease_expires_at = now() + make_interval(secs => p_lease_seconds),
    updated_at = now()
  where job.id = v_job.id;

  return query
  select
    v_job.id,
    v_job.user_id,
    v_job.credit_provider,
    v_job.credit_external_reservation_id,
    case when v_job.status = 'SUCCEEDED' then 'capture' else 'release' end,
    v_token,
    least(v_job.credit_settlement_attempt_count + 1, 100);
end;
$$;

create or replace function public.complete_creative_credit_settlement(
  p_job_id uuid,
  p_lease_token uuid,
  p_succeeded boolean,
  p_safe_error text default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.creative_asset_jobs%rowtype;
  v_next_status text;
  v_delay_seconds integer;
begin
  select * into v_job
  from public.creative_asset_jobs job
  where job.id = p_job_id
    and job.credit_settlement_status = 'PROCESSING'
    and job.credit_settlement_lease_token = p_lease_token
  for update;

  if v_job.id is null then
    raise exception 'Creative credit settlement lease is invalid';
  end if;

  if p_succeeded then
    update public.creative_asset_jobs
    set
      credit_settlement_status = 'SETTLED',
      credit_settlement_next_attempt_at = null,
      credit_settlement_lease_token = null,
      credit_settlement_lease_expires_at = null,
      credit_settlement_last_error = null,
      credit_settled_at = now(),
      updated_at = now()
    where id = v_job.id;
    return 'SETTLED';
  end if;

  v_next_status := case
    when v_job.credit_settlement_attempt_count >= 10 then 'DEAD'
    when v_job.status = 'SUCCEEDED' then 'PENDING_CAPTURE'
    else 'PENDING_RELEASE'
  end;
  v_delay_seconds := least(
    3600,
    15 * (2 ^ greatest(0, least(8, v_job.credit_settlement_attempt_count - 1)))::integer
  );

  update public.creative_asset_jobs
  set
    credit_settlement_status = v_next_status,
    credit_settlement_next_attempt_at = case
      when v_next_status = 'DEAD' then null
      else now() + make_interval(secs => v_delay_seconds)
    end,
    credit_settlement_lease_token = null,
    credit_settlement_lease_expires_at = null,
    credit_settlement_last_error = left(coalesce(nullif(p_safe_error, ''), 'settlement_failed'), 500),
    updated_at = now()
  where id = v_job.id;

  return v_next_status;
end;
$$;

revoke all on function public.claim_next_creative_credit_settlement(integer)
  from public, anon, authenticated;
revoke all on function public.complete_creative_credit_settlement(uuid, uuid, boolean, text)
  from public, anon, authenticated;
grant execute on function public.claim_next_creative_credit_settlement(integer)
  to service_role;
grant execute on function public.complete_creative_credit_settlement(uuid, uuid, boolean, text)
  to service_role;

commit;
