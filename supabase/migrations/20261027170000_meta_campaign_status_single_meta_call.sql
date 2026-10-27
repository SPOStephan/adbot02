-- Pause/Fortsetzen sends exactly one write to Meta.
--
-- queue_meta_campaign_status_plan_internal built VALIDATE (validate_only) +
-- UPDATE for the same campaign. Meta allows one such call per campaign every
-- 30 seconds, so the real UPDATE right after the validation was rejected with
-- (#613) "concurrent request rate limit of 1 calls per 30 seconds" and the
-- customer pause waited for the 15 minute rate-limit retry (2026-10-27,
-- Boncred Immo02_01). A campaign status change has nothing to pre-validate;
-- the read-after-write and reconcile steps still confirm the result.
--
-- New plans: UPDATE (index 0) -> READ (1) -> RECONCILE (2). Patched in place so
-- the earlier gate patches in this function stay untouched. Open plans keep
-- their steps; their remaining UPDATE runs on the next retry.

begin;

do $patch$
declare
  v_function regprocedure :=
    'public.queue_meta_campaign_status_plan_internal(uuid, uuid, uuid, text, text, jsonb, text, text, timestamptz)'::regprocedure;
  v_definition text;
  v_updated text;
  v_from text;
  v_to text;
  v_pairs text[][] := array[
    array[
      E'  (\n    v_step_validate, v_plan_id, p_user_id, p_platform_account_id, 0,\n    ''validate-'' || v_step_prefix, ''VALIDATE'', ''CAMPAIGN'', null,\n    v_validate_request, public.meta_sha256(v_validate_request::text),\n    jsonb_build_object(''validated'', true), ''NONE'', ''PENDING''\n  ),\n',
      E'  -- campaign_status_single_meta_call: no validate_only pre-call; Meta\n  -- allows one campaign write per 30 seconds.\n'
    ],
    array[
      E'v_step_mutate, v_plan_id, p_user_id, p_platform_account_id, 1,\n    ''execute-'' || v_step_prefix, ''UPDATE'', ''CAMPAIGN'', v_step_validate,',
      E'v_step_mutate, v_plan_id, p_user_id, p_platform_account_id, 0,\n    ''execute-'' || v_step_prefix, ''UPDATE'', ''CAMPAIGN'', null,'
    ],
    array[
      E'v_step_read, v_plan_id, p_user_id, p_platform_account_id, 2,',
      E'v_step_read, v_plan_id, p_user_id, p_platform_account_id, 1,'
    ],
    array[
      E'v_step_reconcile, v_plan_id, p_user_id, p_platform_account_id, 3,',
      E'v_step_reconcile, v_plan_id, p_user_id, p_platform_account_id, 2,'
    ]
  ];
  v_index integer;
begin
  select pg_get_functiondef(v_function) into v_definition;

  if position('campaign_status_single_meta_call' in v_definition) > 0 then
    return;
  end if;

  v_updated := v_definition;
  for v_index in 1 .. array_length(v_pairs, 1) loop
    v_from := v_pairs[v_index][1];
    v_to := v_pairs[v_index][2];
    if position(v_from in v_updated) = 0 then
      raise exception 'queue_meta_campaign_status_plan_internal step block % not found', v_index;
    end if;
    v_updated := replace(v_updated, v_from, v_to);
  end loop;

  execute v_updated;
end;
$patch$;

commit;
