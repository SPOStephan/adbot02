# Globales Kampagnen-Zielgebiet

Ein Adbot-Nutzer legt **einen Ort** und optional einen **Radius** fest. Dieselbe Vorgabe gilt für jede Plattform, die vergleichbares Geotargeting anbietet — nicht nur Meta.

## Kanonisches Modell

`customer_campaign_geo` (ein Datensatz pro Nutzer), UI unter `/dashboard/zielgruppen`:

- `place_label`, `place_kind` (`country` | `region` | `city` | `other`)
- `country_code` (ISO-2)
- `latitude` / `longitude`
- `radius_km` (1–80, optional)
- optionale Plattform-IDs (`openai_location_id`, `meta_location_key`)

Ortssuche ist plattformneutral (Nominatim). Launch-Adapter übersetzen danach.

## Adapter

| Plattform | Ort | Radius | Launch heute |
|---|---|---|---|
| Meta Ads | ja | `custom_locations` + `location_types: ["home"]` | Traffic- und Lead-Start |
| ChatGPT Ads | ja, OpenAI-Geo-ID | nein, nächster Standort | Launch-Form prefillt aus dem globalen Ort |
| Google Ads | ja | Proximity | Payload bereit, Launch folgt |
| TikTok Ads | ja | Radius | Payload bereit, Launch folgt |
| Pinterest Ads | Land/Ort | nein | nicht verdrahtet |

Ohne gespeichertes Zielgebiet bleibt Meta bei `countries: ["DE"]`.

Ohne Radius: Land bleibt Land. Für Stadt/Ort gilt intern 25 km, damit Meta einen Umkreis schicken kann (API verlangt Radius für `custom_locations`).

## Launch-Pfade

- Traffic- und Lead-Canaries schreiben `toMetaAdSetTargeting(geo)` in das Ad-Set, bevor das Blueprint gespeichert wird.
- ChatGPT Ads sucht zur OpenAI-Standort-ID und prefillt das Launch-Formular.
- Beitrag-Push speichert `default_countries` aus dem Land des Zielgebiets (sonst DE). Der SQL-Materializer bleibt unverändert und bleibt landesweit.

## Was dieser Stand nicht ändert

Beitrag-Push materialisiert weiter `default_countries`. Der SQL-Materializer und die Kill-/Freeze-Pfade bleiben unberührt.
