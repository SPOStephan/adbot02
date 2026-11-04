-- Zentrale Tabelle der Meta-Conversion-Ereignisse (Spiegel von
-- src/lib/meta/conversion-events.ts; scripts/test-meta-conversion-events.mjs
-- prüft, dass beide übereinstimmen).
--
-- Rein additiv: neue Nachschlagetabelle + Lookup-Funktion. Keine bestehende
-- Tabelle, Funktion, Policy, kein Trigger und kein Plan wird verändert; nichts
-- im Launch-/Materializer-/Gate-Pfad liest diese Tabelle bisher. Laufende
-- Kampagnen und meta_confirmed_pixels (Default 'LEAD') bleiben unberührt.

begin;

create table if not exists public.meta_conversion_events (
  custom_event_type text primary key,
  pixel_event_name text not null,
  insights_action_types text[] not null,
  campaign_objective text not null,
  expects_value boolean not null default false,
  label_de text not null,
  sort_order integer not null default 0,
  constraint meta_conversion_events_custom_event_type_format
    check (custom_event_type ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  constraint meta_conversion_events_pixel_event_name_format
    check (pixel_event_name ~ '^[A-Za-z][A-Za-z0-9]{0,63}$'),
  constraint meta_conversion_events_objective
    check (campaign_objective in ('OUTCOME_LEADS', 'OUTCOME_SALES')),
  constraint meta_conversion_events_action_types_not_empty
    check (cardinality(insights_action_types) > 0)
);

insert into public.meta_conversion_events
  (custom_event_type, pixel_event_name, insights_action_types, campaign_objective, expects_value, label_de, sort_order)
values
  ('LEAD', 'Lead', array['lead', 'omni_lead', 'onsite_conversion.lead_grouped', 'offsite_conversion.fb_pixel_lead'], 'OUTCOME_LEADS', false, 'Lead', 10),
  ('COMPLETE_REGISTRATION', 'CompleteRegistration', array['complete_registration', 'omni_complete_registration', 'offsite_conversion.fb_pixel_complete_registration'], 'OUTCOME_LEADS', false, 'Registrierung abgeschlossen', 20),
  ('CONTACT', 'Contact', array['contact_total', 'contact_website'], 'OUTCOME_LEADS', false, 'Kontaktaufnahme', 30),
  ('SUBMIT_APPLICATION', 'SubmitApplication', array['submit_application_total', 'submit_application_website'], 'OUTCOME_LEADS', false, 'Bewerbung eingereicht', 40),
  ('SCHEDULE', 'Schedule', array['schedule_total', 'schedule_website'], 'OUTCOME_LEADS', false, 'Termin gebucht', 50),
  ('PURCHASE', 'Purchase', array['purchase', 'omni_purchase', 'offsite_conversion.fb_pixel_purchase'], 'OUTCOME_SALES', true, 'Kauf', 60),
  ('SUBSCRIBE', 'Subscribe', array['subscribe_total', 'subscribe_website'], 'OUTCOME_SALES', true, 'Abo abgeschlossen', 70),
  ('START_TRIAL', 'StartTrial', array['start_trial_total', 'start_trial_website'], 'OUTCOME_SALES', true, 'Testphase gestartet', 80),
  ('INITIATED_CHECKOUT', 'InitiateCheckout', array['initiate_checkout', 'omni_initiated_checkout', 'offsite_conversion.fb_pixel_initiate_checkout'], 'OUTCOME_SALES', false, 'Bezahlvorgang gestartet', 90),
  ('ADD_PAYMENT_INFO', 'AddPaymentInfo', array['add_payment_info', 'offsite_conversion.fb_pixel_add_payment_info'], 'OUTCOME_SALES', false, 'Zahlungsdaten hinzugefügt', 100),
  ('ADD_TO_CART', 'AddToCart', array['add_to_cart', 'omni_add_to_cart', 'offsite_conversion.fb_pixel_add_to_cart'], 'OUTCOME_SALES', false, 'In den Warenkorb gelegt', 110),
  ('SEARCH', 'Search', array['search', 'omni_search', 'offsite_conversion.fb_pixel_search'], 'OUTCOME_SALES', false, 'Suche', 120),
  ('CONTENT_VIEW', 'ViewContent', array['view_content', 'omni_view_content', 'offsite_conversion.fb_pixel_view_content'], 'OUTCOME_SALES', false, 'Inhalt angesehen', 130)
on conflict (custom_event_type) do update set
  pixel_event_name = excluded.pixel_event_name,
  insights_action_types = excluded.insights_action_types,
  campaign_objective = excluded.campaign_objective,
  expects_value = excluded.expects_value,
  label_de = excluded.label_de,
  sort_order = excluded.sort_order;

alter table public.meta_conversion_events enable row level security;

revoke all on table public.meta_conversion_events from anon, authenticated;
grant select on table public.meta_conversion_events to authenticated;
grant select, insert, update, delete on table public.meta_conversion_events to service_role;

drop policy if exists meta_conversion_events_select_all on public.meta_conversion_events;
create policy meta_conversion_events_select_all
  on public.meta_conversion_events
  for select
  to authenticated
  using (true);

-- Portal-custom_event_type (oder Pixel-Name) -> Pixel-/CAPI-event_name.
-- Leer/unbekannt -> 'Lead' (bisheriger Default). Wird noch nirgends aufgerufen.
create or replace function public.meta_conversion_event_pixel_name(p_event text)
returns text
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(
    (
      select e.pixel_event_name
      from public.meta_conversion_events e
      where e.custom_event_type = case upper(btrim(coalesce(p_event, '')))
          when 'VIEW_CONTENT' then 'CONTENT_VIEW'
          when 'INITIATE_CHECKOUT' then 'INITIATED_CHECKOUT'
          else upper(btrim(coalesce(p_event, '')))
        end
        or upper(e.pixel_event_name) = upper(btrim(coalesce(p_event, '')))
      limit 1
    ),
    'Lead'
  );
$$;

revoke all on function public.meta_conversion_event_pixel_name(text) from public, anon;
grant execute on function public.meta_conversion_event_pixel_name(text) to authenticated, service_role;

commit;
