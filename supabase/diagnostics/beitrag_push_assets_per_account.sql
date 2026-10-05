-- Read-only: Warum fließen nicht alle verbundenen FB-Seiten / IG-Profile
-- eines Kunden in den Beitrag-Push? Eine Zeile pro Asset mit Befund.
-- E-Mail in der CTE anpassen. Ändert keine Daten.

with target as (
  select pa.id as platform_account_id, pa.user_id, pa.instagram_account_ids
  from public.users u
  join public.platform_accounts pa
    on pa.user_id = u.id
   and pa.platform = 'meta'
   and pa.revoked_at is null
  where lower(u.email) = lower('marketing@lohbeck-privathotels.de')
),
settings as (
  select s.*
  from public.meta_boost_settings s
  join target t
    on t.user_id = s.user_id
   and t.platform_account_id = s.platform_account_id
  where s.is_current
)
select
  a.asset_type,
  coalesce(a.username, a.name) as asset,
  a.meta_asset_id,
  a.parent_meta_asset_id,
  a.created_at as connected_at,
  a.baseline_completed_at,
  a.last_synced_at,
  (a.asset_type <> 'instagram_account'
    or t.instagram_account_ids ? a.meta_asset_id) as selected_for_sync,
  st.asset_scope,
  st.source_filter,
  bas.included as asset_included,
  (select count(*) from public.meta_content_candidates c
    where c.meta_asset_id = a.id) as posts_total,
  (select count(*) from public.meta_content_candidates c
    where c.meta_asset_id = a.id and c.is_new) as posts_new,
  (select count(*) from public.meta_content_candidates c
    join public.meta_organic_boost_links l on l.content_candidate_id = c.id
    where c.meta_asset_id = a.id) as posts_boosted,
  (select max(c.published_at) from public.meta_content_candidates c
    where c.meta_asset_id = a.id) as newest_post_at,
  case
    when a.asset_type = 'instagram_account'
      and not (t.instagram_account_ids ? a.meta_asset_id)
      then 'FEHLER: IG nicht in instagram_account_ids – Abruf ignoriert es'
    when a.asset_type = 'instagram_account'
      and not exists (
        select 1 from public.meta_assets p
        where p.platform_account_id = a.platform_account_id
          and p.asset_type = 'facebook_page'
          and p.meta_asset_id = a.parent_meta_asset_id
      )
      then 'FEHLER: IG ohne verbundene FB-Seite – Push schlägt fehl'
    when coalesce(st.asset_scope, 'ALL') = 'SELECTED'
      and coalesce(bas.included, false) is not true
      then 'FEHLER: Asset in Boost-Einstellungen nicht ausgewählt'
    when st.source_filter is not null and st.source_filter <> 'both'
      and st.source_filter <> case a.asset_type
        when 'facebook_page' then 'facebook' else 'instagram' end
      then 'FEHLER: Quellen-Filter schließt diese Plattform aus'
    when a.last_synced_at is null
      then 'FEHLER: noch nie erfolgreich abgerufen'
    when a.last_synced_at < now() - interval '2 days'
      then 'WARNUNG: Abruf seit >2 Tagen fehlgeschlagen'
    else 'ok'
  end as befund
from target t
join public.meta_assets a
  on a.platform_account_id = t.platform_account_id
 and a.asset_type in ('facebook_page', 'instagram_account')
left join settings st on true
left join public.meta_boost_asset_settings bas
  on bas.meta_asset_id = a.id
 and bas.platform_account_id = a.platform_account_id
order by a.asset_type, asset;
