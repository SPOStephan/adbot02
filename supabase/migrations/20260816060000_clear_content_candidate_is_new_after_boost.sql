-- Beitragskandidaten must leave the "Neu seit Ausgangsbestand" list once a
-- boost is past Freigeben / already talking to Meta. LIFETIME and REVIEW keep
-- is_new=true on materialize so Freigeben stays visible; nothing cleared it
-- after approve, freeze-heal, REMOTE_APPLIED, or campaign end — sticky cards.

begin;

create or replace function public.clear_meta_content_candidate_is_new(
  p_content_candidate_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_content_candidate_id is null then
    return;
  end if;

  update public.meta_content_candidates
  set
    is_new = false,
    updated_at = now()
  where id = p_content_candidate_id
    and is_new is true;
end;
$$;

comment on function public.clear_meta_content_candidate_is_new(uuid) is
  'Drop is_new once a Beitrag is no longer an open candidate (boost progressed).';

revoke all on function public.clear_meta_content_candidate_is_new(uuid)
  from public, anon, authenticated;
grant execute on function public.clear_meta_content_candidate_is_new(uuid)
  to service_role;

-- True when the linked plan is still held for Freigeben (not_before=infinity).
create or replace function public.meta_organic_boost_plan_is_held(
  p_not_before timestamptz,
  p_status text
)
returns boolean
language sql
immutable
as $$
  select coalesce(p_status, '') = 'HELD'
    or p_not_before = 'infinity'::timestamptz;
$$;

create or replace function public.trg_clear_candidate_is_new_on_boost_progress()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_candidate_id uuid;
  v_source_rule text;
  v_launch_kind text;
begin
  if tg_table_name = 'mutation_plans' then
    v_source_rule := coalesce(new.source_rule_key, '');
    v_launch_kind := coalesce(new.planned_payload->>'launch_kind', '');
    if v_source_rule is distinct from 'organic-boost'
      and v_launch_kind is distinct from 'ORGANIC_BOOST'
    then
      return new;
    end if;

    if (
      public.meta_organic_boost_plan_is_held(old.not_before, old.status)
      and not public.meta_organic_boost_plan_is_held(new.not_before, new.status)
    )
    or new.status in (
      'SUCCEEDED', 'RECONCILED', 'CANCELLED', 'FAILED', 'STALE', 'PREFLIGHT_FAILED'
    )
    then
      select link_row.content_candidate_id into v_candidate_id
      from public.meta_organic_boost_links link_row
      where link_row.plan_id = new.id
      limit 1;
      perform public.clear_meta_content_candidate_is_new(v_candidate_id);
    end if;

    return new;
  end if;

  if tg_table_name = 'remote_object_bindings' then
    select link_row.content_candidate_id into v_candidate_id
    from public.meta_organic_boost_links link_row
    where link_row.plan_id = new.plan_id
    limit 1;
    perform public.clear_meta_content_candidate_is_new(v_candidate_id);
    return new;
  end if;

  if tg_table_name = 'mutation_plan_steps' then
    if new.status = 'REMOTE_APPLIED'
      or (
        new.dispatch_state is not null
        and new.dispatch_state is distinct from 'NOT_DISPATCHED'
      )
      or new.remote_applied_at is not null
    then
      select link_row.content_candidate_id into v_candidate_id
      from public.meta_organic_boost_links link_row
      where link_row.plan_id = new.plan_id
      limit 1;
      perform public.clear_meta_content_candidate_is_new(v_candidate_id);
    end if;
    return new;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_clear_candidate_is_new_on_plan_progress
  on public.mutation_plans;
create trigger trg_clear_candidate_is_new_on_plan_progress
  after update of not_before, status on public.mutation_plans
  for each row
  execute function public.trg_clear_candidate_is_new_on_boost_progress();

drop trigger if exists trg_clear_candidate_is_new_on_binding
  on public.remote_object_bindings;
create trigger trg_clear_candidate_is_new_on_binding
  after insert on public.remote_object_bindings
  for each row
  execute function public.trg_clear_candidate_is_new_on_boost_progress();

drop trigger if exists trg_clear_candidate_is_new_on_step_progress
  on public.mutation_plan_steps;
create trigger trg_clear_candidate_is_new_on_step_progress
  after insert or update of status, dispatch_state, remote_applied_at
  on public.mutation_plan_steps
  for each row
  execute function public.trg_clear_candidate_is_new_on_boost_progress();

-- One-shot heal: sticky is_new after boost start / Meta apply / AUTO path.
update public.meta_content_candidates candidate
set
  is_new = false,
  updated_at = now()
where candidate.is_new is true
  and exists (
    select 1
    from public.meta_organic_boost_links link_row
    join public.mutation_plans plan_row
      on plan_row.id = link_row.plan_id
    where link_row.content_candidate_id = candidate.id
      and (
        not public.meta_organic_boost_plan_is_held(
          plan_row.not_before,
          plan_row.status
        )
        or exists (
          select 1
          from public.remote_object_bindings binding
          where binding.plan_id = plan_row.id
        )
        or exists (
          select 1
          from public.mutation_plan_steps step
          where step.plan_id = plan_row.id
            and (
              step.status = 'REMOTE_APPLIED'
              or (
                step.dispatch_state is not null
                and step.dispatch_state is distinct from 'NOT_DISPATCHED'
              )
              or step.remote_applied_at is not null
            )
        )
        or coalesce(
          (plan_row.planned_payload->>'require_manual_approval')::boolean,
          true
        ) = false
      )
  );

commit;
