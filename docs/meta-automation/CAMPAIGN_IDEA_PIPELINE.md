# Kampagnen-Pipeline (kundenindividuell)

Ideen sammeln, liegen lassen, auf Klick umsetzen. Fremde Kampagnen sind **nur Inspiration**.

## Aufnahme

Kunde legt ab:

- HTTPS-Link
- Screenshot (PNG/JPEG → `CUSTOMER` brand_asset, nie Launch-Motiv)
- Stichworte (Produkt, Angebot, Zielgruppe)

Ideen bleiben in `campaign_ideas` (`QUEUED` / `READY`), bis **Idee jetzt umsetzen**.

## Verstehen

Beim Ablegen (und per „Kern neu lesen“) extrahiert Adbot:

- Produkt, Angebot, Zielgruppe
- Hook-Muster, Ton, visuelles Motiv, Funnel-Winkel
- `core_summary`
- `forbidden_verbatim` (nicht abschreiben)
- `not_for_direct_use: true`

Vision/Text über OpenRouter. Ohne Key bleibt ein grober Kern.

## Umsetzen

Button fordert die **eigene** Ziel-URL. Dann:

1. Originelle Texte aus dem Kern + eigener Landingpage
2. Optional neues Motiv — **nie** der Screenshot
3. Prefill Traffic-Launch `?ideaId=`

SQL blockiert `realized_asset_id = screenshot_asset_id`.

## Guardrails

- Kein `INSPIRATION`-Write durch Kunden
- Kein Organic-/Kill-Switch-/Freeze-Umbau
- Writes nur über service_role RPCs; Kunde hat SELECT auf eigene Zeilen
