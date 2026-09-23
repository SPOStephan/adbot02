# Funnel-URL-Splittest (Adbot-intern + optionales Meta-Experiment)

Zwei Funnel gegeneinander in **einer** Kampagne.

## 1. Adbot-intern (Standard)

Opt-in im Traffic- und Lead-Launch: **Funnel-Splittest**.

- Eine Kampagne, **2 Ad Sets**, je eine Anzeige
- Funnel A = `destination_url` (wie bisher)
- Funnel B = `variant_destination_url` nur auf Creative 2 / Ad 2
- Gleiche Budget-Logik wie der bestehende 2-Ad-Set-Struktur-Test (hälftig, danach Erfolgsumschichtung)
- Andere Hostname braucht `variant_allowed_domain_id` (verifizierte Domain)
- Nicht kombinierbar mit Multi-Image Dynamic Creative
- Approve prüft weiter nur die primäre Ziel-URL

SQL: `supabase/migrations/20260923180000_launch_funnel_url_split.sql`  
Kopiert den aktuellen Launch-Materializer und ändert nur Varianten-URL + `conversion_domain` von Ad 2. **Kein** `materialize_meta_organic_boost_plan`.

## 2. Meta-Experiment (best effort)

Checkbox **Offizielles Meta-Experiment nach dem Launch versuchen** (bei 2 Ad Sets oder Funnel-Splittest).

- Liegt **nicht** in der Launch-Kette — ein Meta-Fehler darf den Canary nicht kippen
- Nach Freigabe: `POST /api/meta/automation/ad-study` → `POST /{meta_user_id}/ad_studies` Typ `SPLIT_TEST`, 50/50, zwei Ad-Set-Zellen
- Audit: `META_AD_STUDY_CREATED` über `append_meta_mutation_audit_event`
- Retry-Button, falls Ad Sets bei Meta noch fehlen oder Meta ablehnt

## Felder (`parseLaunchCommand`)

| Client | `launch_inputs` | Pflicht |
|---|---|---|
| `variantDestinationUrl` | `variant_destination_url` | für Funnel-Splittest; braucht `structuralAdSetCount=2` |
| `variantAllowedDomainId` | `variant_allowed_domain_id` | nur wenn Funnel B anderen Host hat |
| `useMetaExperiment` | `use_meta_experiment` | optional; braucht 2 Ad Sets |

## Guardrails

Keine Änderung an Kill-Switch, Freeze/Refreeze, organic materializer/preflight/claim. Traffic-Prepare bleibt transient freeze + Freigeben restore.
