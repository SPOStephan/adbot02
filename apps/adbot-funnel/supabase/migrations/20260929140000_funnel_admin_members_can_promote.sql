-- Pro Funnel-Zugang: darf „Diesen Funnel in Adbot bewerben“ / „Zusätzlich für Landingpage-Aufrufe bewerben“ sehen.
-- Standard aus; der Konto-Inhaber schaltet es im Funnel-Admin unter „Konto“ ein.

alter table public.funnel_admin_members
  add column if not exists can_promote boolean not null default false;

comment on column public.funnel_admin_members.can_promote is
  'Zeigt dem Zugang die Bewerben-Buttons (Start in Adbot). Standard aus, gesetzt vom Konto-Inhaber unter Konto.';
