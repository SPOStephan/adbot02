-- AdBot: Skalierungsoptimierungen aus dem Supabase Performance Advisor.

-- auth.uid() wird als InitPlan einmal pro Statement ausgewertet statt pro Zeile.
drop policy if exists "Nutzer verwalten eigene Creatives." on public.creatives;

create policy "Nutzer verwalten eigene Creatives."
on public.creatives
for all
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

-- Fremdschlüsselspalten erhalten explizite Indizes für Joins und Löschprüfungen.
create index if not exists creatives_user_id_idx
  on public.creatives (user_id);

create index if not exists ads_creative_id_idx
  on public.ads (creative_id);
