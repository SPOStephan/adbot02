-- AdBot: restore least-privilege authenticated dashboard reads.
--
-- Row-level security remains the tenant boundary on every relation below.
-- This migration intentionally grants only the columns required by the
-- authenticated dashboard. It grants no INSERT, UPDATE, DELETE, TRUNCATE,
-- REFERENCES, or TRIGGER privileges and never exposes connector secrets.

-- Connector metadata: keep access_token, refresh_token, access_token_encrypted,
-- token_iv, token_auth_tag, and other secret-bearing columns inaccessible.
grant select (
  id,
  user_id,
  platform,
  account_name,
  connected_at,
  revoked_at,
  meta_scopes,
  sync_status,
  sync_error_code,
  last_sync_started_at,
  last_synced_at,
  next_sync_at,
  baseline_completed_at,
  last_sync_seen_count,
  last_sync_new_count,
  marketing_currency,
  marketing_sync_status,
  marketing_sync_error_code,
  marketing_sync_id,
  marketing_last_success_at,
  marketing_campaign_count,
  marketing_ad_set_count,
  marketing_ad_count,
  marketing_creative_count,
  marketing_insight_count,
  marketing_recommendation_count,
  marketing_insights_since,
  marketing_insights_until
) on table public.platform_accounts to authenticated;

grant select (
  id,
  user_id,
  platform_account_id,
  asset_type,
  name,
  username,
  last_synced_at
) on table public.meta_assets to authenticated;

grant select (
  id,
  user_id,
  platform_account_id,
  source,
  content_type,
  caption_excerpt,
  permalink_url,
  preview_url,
  published_at,
  first_seen_at,
  is_new
) on table public.meta_content_candidates to authenticated;

grant select (
  id,
  user_id,
  platform_account_id,
  name,
  objective,
  status,
  effective_status,
  platform_updated_time,
  is_current
) on table public.campaigns to authenticated;

grant select (
  id,
  user_id,
  platform_account_id,
  campaign_id,
  rule_key,
  rule_version,
  severity,
  priority,
  title,
  summary,
  evidence,
  window_start,
  window_end,
  status,
  expires_at,
  generated_at
) on table public.campaign_recommendations to authenticated;

grant select (
  id,
  user_id,
  platform_account_id,
  version,
  status,
  account_daily_hard_cap_minor,
  default_campaign_daily_hard_cap_minor,
  budget_change_limit_bps,
  cooldown_seconds,
  allow_budget_changes,
  allow_status_changes,
  allow_new_launches,
  customer_confirmed_at,
  is_current
) on table public.automation_policies to authenticated;

grant select (
  user_id,
  platform_account_id,
  mode,
  reason,
  actor_type,
  created_at,
  scope_type,
  sequence
) on table public.kill_switch_state to authenticated;

grant select (
  user_id,
  platform_account_id,
  event_sequence,
  event_type,
  actor_type,
  error_class,
  occurred_at
) on table public.mutation_audit_events to authenticated;

grant select (
  id,
  user_id,
  platform_account_id,
  hostname,
  registrable_domain,
  status,
  customer_confirmed_at,
  revoked_at,
  created_at
) on table public.allowed_domains to authenticated;

grant select (
  id,
  user_id,
  platform_account_id,
  objective,
  name,
  version,
  status,
  activated_at
) on table public.objective_blueprints to authenticated;

grant select (
  id,
  user_id,
  platform_account_id,
  original_filename,
  source_meta_asset_id,
  width,
  height,
  meta_image_hash,
  status,
  moderation_status,
  created_at
) on table public.brand_assets to authenticated;

grant select (
  id,
  user_id,
  platform_account_id,
  status,
  created_at,
  action_type
) on table public.mutation_plans to authenticated;

comment on table public.platform_accounts is
  'Meta connector accounts. Authenticated users receive RLS-scoped column-level dashboard reads only; token columns remain service-role only.';
