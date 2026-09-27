begin;

-- Alle vor Einführung der Zweckauswahl angelegten Funnel sind bestehende
-- Recruiting-Funnel. Bereits gesetzte Zwecke bleiben unverändert.
update public.funnels
set config = jsonb_set(config, '{purpose}', '"recruiting"'::jsonb, true)
where not (config ? 'purpose');

commit;
