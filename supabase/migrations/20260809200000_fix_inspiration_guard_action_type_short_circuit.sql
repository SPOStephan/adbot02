-- Fix: guard_brand_asset_not_inspiration_for_launch is shared by mutation_plans
-- and mutation_plan_steps. PL/pgSQL evaluates `AND` operands even when
-- tg_table_name differs, so `new.action_type` on mutation_plan_steps raised:
--   record "new" has no field "action_type"
-- Nested IF confines action_type access to mutation_plans only.
-- Symptom: MATERIALIZE_FAILED during Beitrag-Push plan creation.

create or replace function public.guard_brand_asset_not_inspiration_for_launch()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_asset_ids uuid[] := array[]::uuid[];
  v_asset_id uuid;
  v_payload jsonb;
begin
  -- Nested IF: never touch new.action_type / planned_payload on steps.
  if tg_table_name = 'mutation_plans' then
    if new.action_type = 'LAUNCH_CHAIN' then
      if jsonb_typeof(new.planned_payload->'brand_asset_ids') = 'array' then
        select coalesce(array_agg(value::uuid), array[]::uuid[])
        into v_asset_ids
        from jsonb_array_elements_text(new.planned_payload->'brand_asset_ids') as t(value)
        where value ~* '^[0-9a-f-]{36}$';
      end if;

      if exists (
        select 1
        from public.brand_assets asset
        where asset.id = any (v_asset_ids)
          and asset.library_scope <> 'CUSTOMER'
      ) then
        raise exception 'Inspiration vault assets cannot be used in Meta launch plans';
      end if;
    end if;
  end if;

  if tg_table_name = 'mutation_plan_steps' then
    v_payload := coalesce(new.planned_request, '{}'::jsonb);
    if coalesce(v_payload->>'operation', '') = 'UPLOAD_IMAGE'
      or coalesce(new.object_type, '') = 'IMAGE' then
      begin
        v_asset_id := nullif(v_payload->>'brand_asset_id', '')::uuid;
      exception when others then
        v_asset_id := null;
      end;
      if v_asset_id is not null and exists (
        select 1
        from public.brand_assets asset
        where asset.id = v_asset_id
          and asset.library_scope <> 'CUSTOMER'
      ) then
        raise exception 'Inspiration vault assets cannot be used in Meta mutation steps';
      end if;
    end if;
  end if;

  return new;
end;
$$;

comment on function public.guard_brand_asset_not_inspiration_for_launch() is
  'Blocks inspiration-vault assets in launch plans/steps; nested IF avoids action_type on mutation_plan_steps.';
