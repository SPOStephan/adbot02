-- After a Lead/Traffic launch the account returns to the write gate state it
-- had before the launch (owner decision 2026-10-27: "Freigabe behalten").
--
-- Until now the canary refreeze (trigger and reconciler) appended ACCOUNT
-- FREEZE_WRITES after every accepted launch unless Beitrag-Push AUTO was on or
-- another accepted launch was still open. A customer who had pressed
-- "Freigeben" (or switched on budget autonomy) silently lost it with every
-- launch, so budget autonomy and the lead underperformer pause stopped.
--
-- meta_account_pre_launch_kill_mode reads the latest ACCOUNT event that is not
-- part of a launch window (system launch actors and the fixed prepare/approve
-- reasons of the launch flows). When that state was ALLOW, the refreeze keeps
-- the account ALLOW. FREEZE_WRITES / PAUSE_MANAGED / no event keep today's
-- refreeze. The PLAN-level freeze of the finished launch is unchanged.
--
-- One-shot: accounts whose latest ACCOUNT event is a system launch refreeze
-- and whose pre-launch state was ALLOW get that ALLOW back.

begin;

create or replace function public.meta_account_pre_launch_kill_mode(
  p_user_id uuid,
  p_platform_account_id uuid
)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select kss.mode
  from public.kill_switch_state kss
  where kss.scope_type = 'ACCOUNT'
    and kss.user_id = p_user_id
    and kss.platform_account_id = p_platform_account_id
    and not (kss.actor_type = 'SYSTEM' and kss.actor_id like 'meta-launch-%')
    and kss.reason not in (
      'Automatische Freeze-Phase für Kampagnen-Vorbereitung',
      'Lead-Canary: kurze Freeze-Phase für Freigabe',
      'Traffic-Canary: kurze Freeze-Phase für Freigabe',
      'Exakt bestätigter atomarer Aktiv-Launch',
      'Exakter Aktiv-Launch-Fingerprint kundenseitig bestätigt',
      'Schreibfreigabe nach Launch-Prepare wiederhergestellt — Beitrag-Push bleibt aktiv',
      'Vorheriger Sicherheitsmodus nach Launch-Prepare wiederhergestellt'
    )
  order by kss.sequence desc
  limit 1;
$$;

revoke all on function public.meta_account_pre_launch_kill_mode(uuid, uuid)
  from public, anon, authenticated;

comment on function public.meta_account_pre_launch_kill_mode(uuid, uuid) is
  'ACCOUNT write gate mode before the latest launch window (ignores launch prepare/approve/refreeze events).';

-- Reconciler path.
create or replace function public.meta_launch_refreeze_keeps_account_allow(
  p_user_id uuid,
  p_platform_account_id uuid,
  p_plan_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
      select 1
      from public.meta_boost_settings settings
      where settings.user_id = p_user_id
        and settings.platform_account_id = p_platform_account_id
        and settings.is_current
        and settings.enabled
        and settings.boost_mode = 'AUTO'
        and settings.auto_boost_new_candidates
        and settings.require_manual_approval is not true
    )
    or public.meta_account_has_open_approved_launch(
      p_user_id, p_platform_account_id, p_plan_id
    )
    or public.meta_account_pre_launch_kill_mode(
      p_user_id, p_platform_account_id
    ) is not distinct from 'ALLOW';
$$;

-- Trigger path: patched in place, everything else stays as deployed.
do $patch$
declare
  v_function regprocedure :=
    'public.refreeze_meta_launch_plan_after_execution()'::regprocedure;
  v_definition text;
  v_updated text;
begin
  select pg_get_functiondef(v_function) into v_definition;

  if position('launch_refreeze_restores_prior_state' in v_definition) > 0 then
    return;
  end if;

  v_updated := regexp_replace(
    v_definition,
    E'(v_keep_account_allow := v_keep_account_allow\\s+or public\\.meta_account_has_open_approved_launch\\(\\s+new\\.user_id, new\\.platform_account_id, new\\.id\\s+\\);)',
    E'\\1\n\n'
    || E'  -- launch_refreeze_restores_prior_state: a customer who had released\n'
    || E'  -- writes before the launch keeps that release afterwards.\n'
    || E'  v_keep_account_allow := v_keep_account_allow\n'
    || E'    or public.meta_account_pre_launch_kill_mode(\n'
    || E'      new.user_id, new.platform_account_id\n'
    || E'    ) is not distinct from ''ALLOW'';'
  );

  if v_updated = v_definition then
    raise exception 'refreeze_meta_launch_plan_after_execution keep-allow block not found';
  end if;

  execute v_updated;
end;
$patch$;

-- One-shot: give back a release that a system launch refreeze took away.
do $restore$
declare
  v_account record;
begin
  for v_account in
    select latest.user_id, latest.platform_account_id
    from (
      select distinct on (kss.platform_account_id)
        kss.user_id, kss.platform_account_id, kss.mode, kss.actor_type, kss.actor_id
      from public.kill_switch_state kss
      where kss.scope_type = 'ACCOUNT'
      order by kss.platform_account_id, kss.sequence desc
    ) latest
    join public.platform_accounts pa
      on pa.id = latest.platform_account_id
     and pa.user_id = latest.user_id
     and pa.platform = 'meta'
     and pa.revoked_at is null
    where latest.mode = 'FREEZE_WRITES'
      and latest.actor_type = 'SYSTEM'
      and latest.actor_id in (
        'meta-launch-canary-refreeze', 'meta-launch-canary-reconciler'
      )
      and public.meta_account_pre_launch_kill_mode(
        latest.user_id, latest.platform_account_id
      ) = 'ALLOW'
  loop
    perform public.append_meta_kill_switch_state(
      'ACCOUNT', v_account.user_id, v_account.platform_account_id, null,
      'ALLOW',
      'Freigabe von vor dem Launch wiederhergestellt',
      'SYSTEM', 'meta-launch-refreeze-restore'
    );
  end loop;
end;
$restore$;

commit;
