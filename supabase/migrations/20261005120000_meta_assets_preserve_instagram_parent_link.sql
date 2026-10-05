-- Beitrag-Push for multi-page accounts: Instagram organic boosts require
-- meta_assets.parent_meta_asset_id → a connected Facebook page
-- (materialize_meta_organic_boost_plan raises "Instagram account must be
-- linked to a Facebook page" otherwise).
--
-- extend_meta_connection / replace_meta_connection upsert
-- `parent_meta_asset_id = excluded.parent_meta_asset_id`. When an
-- "Konto erweitern" dialog contains an IG profile but not its page, the
-- payload carries NULL and wipes a previously correct link — that IG then
-- silently drops out of Beitrag-Push. Keep the existing link whenever an
-- update would only clear it. A new non-null link still wins.
--
-- Missing links are healed by the content sync (Abruf) from /me/accounts.

create or replace function public.trg_meta_assets_preserve_instagram_parent()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.asset_type = 'instagram_account'
    and (
      new.parent_meta_asset_id is null
      or char_length(new.parent_meta_asset_id) < 5
    )
    and old.parent_meta_asset_id is not null
    and char_length(old.parent_meta_asset_id) >= 5
  then
    new.parent_meta_asset_id := old.parent_meta_asset_id;
  end if;
  return new;
end;
$$;

comment on function public.trg_meta_assets_preserve_instagram_parent() is
  'Keeps an existing Instagram→Facebook page link when a connection upsert would only clear it (Beitrag-Push needs the link).';

revoke all on function public.trg_meta_assets_preserve_instagram_parent()
  from public, anon, authenticated;

drop trigger if exists meta_assets_preserve_instagram_parent
  on public.meta_assets;

create trigger meta_assets_preserve_instagram_parent
  before update of parent_meta_asset_id on public.meta_assets
  for each row
  execute function public.trg_meta_assets_preserve_instagram_parent();

notify pgrst, 'reload schema';
