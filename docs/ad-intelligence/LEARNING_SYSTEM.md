# Adbot Learning System

**Stand:** 16. September 2026

## Was „schlauer werden“ hier heißt

Adbot wird **nicht** bei jedem Import neu fine-getuned. Jedes eingespeiste Werbemittel und jedes First-Party-Leistungssignal landet in einem internen Korpus. Vor Copy- und Creative-Vorschlägen holt die KI passende Beispiele und Signale in den Prompt (**Retrieval**). Fine-Tuning ist eine spätere, getrennte Stufe.

„Mit Hunderttausenden Werbemitteln trainiert“ darf erst gesagt werden, wenn diese Menge **tatsächlich im Korpus** liegt **und** entweder Retrieval in dieser Größenordnung oder ein bestandenes Fine-Tune/Eval vorliegt. Bis dahin: wachsende interne Bibliothek + First-Party-Feedback, kein Marketing-Claim.

## Zwei getrennte Signalquellen

| Quelle | Was sie darf | Was sie nicht darf |
| --- | --- | --- |
| Inspiration-Vault (ChatGPT Ad Library, manuelle Beispiele, später Meta/Google/TikTok) | Muster: Hook, Nutzen, CTA, Prompt-Typ, Format | Als Erfolg gelten, kundensichtbar sein, unverändert kopiert werden, gelancht werden |
| Eigene ausgelieferte Ads (Meta Insights → `performance_winner`, Kunden-`marked_good`) | Als First-Party-Signal die nächste Generierung und Bewertung steuern | Mit Fremdanzeigen zu einem globalen „Winner“ vermischt werden |

Success-Control (Pausen, Budget-Umschichtung) bleibt die **operative** Auswertung. Dieser Loop macht dieselben Signale für die **nächste** Idee nutzbar.

## Fahrplan

### Phase 1 — Retrieval-Loop (dieser Stand)

- Interne Werbebeispiele (alle Plattformen im Vault) fließen als Textmuster in Copy-Vorschläge.
- `performance_winner` / `marked_good` des **gleichen Kontos** fließen als First-Party-Signale in Copy und als Style-Refs in die Creative-Generierung (max. 4, bestehende Auswahl hat Vorrang).
- Fremde Sichtbarkeit bleibt `visual_only` / `public_transparency` — kein Performance-Claim.

### Phase 2 — Volumen und Verlierer

- Offizielle Collector für Meta Ad Library, Google Transparency, TikTok (eigene Apps, nicht das Kunden-Token). Bau- und Zugangsplan: `docs/ad-examples/COLLECTOR_BUILD.md`.
- Explizites Underperformer-Label aus Success-Control (nicht nur Winner).
- OpenAI-Ads-Insights analog zu Meta-Winners verdrahten.
- Semantische Suche (Embeddings), sobald der Vault größer wird als ein Scan.

### Phase 3 — Echtes Training

- Nur autorisierte First-Party-Paare (besser vs. schlechter) nach `training/ad-intelligence/v1/preferences.jsonl`.
- Fremdanzeigen **nicht** automatisch in den Fine-Tune-Korpus.
- LoRA/DPO über den bestehenden Together-Pfad, Blind-Eval wie in `CROSS_PLATFORM_TRAINING.md`.
- Produktions-Umschaltung nur nach Eval-Gates.

### Phase 4 — Kontinuierlich

- Regelmäßiger Export → Train → Eval → Deploy.
- Claim „Hunderttausende“ erst mit belegbarer Korpusgröße plus bestandener Evaluation.

## Tägliches Lernen: KI-Training (URL → Ad → Bewertung)

Das ist **nicht** der Collector-Upload fremder Anzeigen. Site-Admin unter `/dashboard/training`: beliebige HTTPS-URL, Adbot erzeugt Text und Bild, Bewertung gut/schlecht. Jede Bewertung landet in `adbot_training_runs` und fließt **sofort** in `formatAdLearningPromptBlock` — auch in Kunden-Copy. Gewichte werden nicht stündlich neu trainiert; schlauer wird das System mit jedem Rating über Retrieval. Fine-Tune (Together) exportiert später genau diese Paare.

## Nächste Schritte (konkret, nach Vault + Sandbox)

Kein paralleles „alles auf einmal“. Zuerst den Retrieval-Loop füttern und messbar machen. Das eigene Modell kommt **danach**, und nur hinter Gates. Vektorsuche ist kein Schritt auf diesem Pfad, solange ein Scan den Vault noch vollständig sieht.

### Schritt 0 — Sandbox scharf schalten

| Wer | Was | Fertig wenn |
| --- | --- | --- |
| Stephan | PR Korpus-Sandbox mergen. Migration `20260916120000_ad_library_collector_items.sql` im produktiven Supabase. | `/dashboard/inspiration` zeigt die Korpus-Sandbox ohne Migrationshinweis. |
| Stephan | Erste eigenen Beispiele **in die Sandbox**, nicht direkt in die alte Upload-Maske. Review → bereit → Vault. | Gedächtnis-Probe für eine Kernbranche zeigt die neuen Texte erst **nach** Import im Live-Block. |

Ohne diesen Schritt bleibt jeder weitere Import ein Direktschreiben ins Gedächtnis. Die Sandbox ist die Qualitätsklappe.

### Schritt 1 — Korpus füllen, bis Retrieval greift

Ziel ist nicht „viele Ads“, sondern **abdeckende Textmuster**. Pro Kernbranche (zuerst Hotels/Reisen, SaaS, Beauty, lokale Dienstleistung, E-Commerce) mindestens drei Ziele (Traffic, Leads, Sales) und pro Zelle mehrere unterschiedliche Hooks.

| Wer | Was | Fertig wenn |
| --- | --- | --- |
| Stephan | Beispiele weiter sammeln: Screenshot + Hook/Body + Branche/Ziel + Quelllink. ChatGPT-Library nur über den bestehenden Unlocker, nicht per Hand-ID. | Vault hat nutzbaren Text (nicht nur Bilder). Probe für 5 typische Briefings liefert jeweils ≥ 3 Live-Treffer. |
| Code | Optional: Probe-Ergebnis als fester Qualitätscheck nach jedem Import-Batch (schon in der Sandbox-UI). | Du siehst vor dem nächsten Stapel, welche Zellen noch leer sind. |

Gate A: **Retrieval wirkt.** Copy-Vorschläge für ein bekanntes Briefing enthalten abstrahierte Muster aus dem Vault (im Prompt-Block sichtbar), ohne fremde Marken zu wiederholen. Erst dann Volumen-Collector.

### Schritt 2 — First-Party-Signale ehrlich machen

Das ist der Stoff fürs spätere Modell. Collector-Ads ersetzen das nicht.

| Wer | Was | Fertig wenn |
| --- | --- | --- |
| Code | Underperformer-Label aus Success-Control (Pendant zu `performance_winner`). | Pro Konto gibt es Gewinner **und** Verlierer, gleiches Ziel, vergleichbares Zeitfenster. |
| Code | OpenAI-Ads-Insights analog zu Meta-Winners verdrahten. | ChatGPT-Ads-Konten bekommen dieselben Labels. |
| Code | Export nur autorisierter First-Party-Paare nach `training/ad-intelligence/v1/preferences.jsonl` (kein Kunden-PII, keine Vault-Fremdanzeigen). | Trockener Export läuft; Manifest bleibt `contains_customer_data=false` für den Seed, First-Party-Datei ist getrennt versioniert. |
| Stephan | Verbundene Werbekonten laufen lassen, gute Creatives markieren (`marked_good`). | Es existieren echte Paare, nicht nur der synthetische Seed. |

Gate B: **Echte Paare.** Mindestens Dutzende besser-vs-schlechter Paare aus eigenen Konten (besser: dreistellig), gleiches Ziel, genug Auslieferung. Ohne Gate B kein kostenpflichtiges Training, das „besser werben“ behaupten darf.

### Schritt 3 — Volumen nur offiziell (optional, parallel zu 2)

Nur wenn Gate A steht und du Zugang hast.

1. Eigene Meta-App (nicht die Kunden-App) + Probe-Fetch `ads_archive` in DE/AT/CH unter `/dashboard/inspiration`. Wenn der kommerzielle Umfang leer ist, kein Volumen.
2. Google nur nach klarem API-Zugang.
3. TikTok nur nach Research-Approval und rechtlicher Freigabe.
4. Collector schreibt in die Sandbox (`fetched`), nie direkt in den Vault.

Fremde Ads bleiben `reference_only` / `public_transparency` / `use_for_generation=false`. Sie füttern Retrieval, **nicht** Fine-Tune.

### Schritt 4 — Eigenes Modell (Together LoRA)

Der Pfad existiert schon (`scripts/train-ad-intelligence-together.py`, Eval, `AD_COPY_PROVIDER=adbot_intelligence`). Es fehlen Gewichte und ein Endpoint.

Reihenfolge, nicht umkehrbar:

1. **Kostenschätzung ohne Job.** `python3 scripts/train-ad-intelligence-together.py` (ohne `--submit`). Nur Pipeline-Rauch, keine Verbesserung.
2. **Kein Seed-only-Produktionsmodell.** 116 synthetische Paare lehren Struktur. Sie schlagen `gpt-4o-mini` / die aktuelle Baseline nicht zuverlässig bei echter Werbung. Ein Seed-Job nur, wenn du den Together-Weg einmal end-to-end sehen willst — dann Endpoint wieder auf null.
3. **Erstes ernstes Training** erst nach Gate B: Seed + getrennte First-Party-Preferences. SFT und danach DPO auf `preferences.jsonl`.
4. **Blind-Eval** gegen die aktuelle Produktions-Baseline (`scripts/evaluate-ad-intelligence.py`). Pflicht: ≥ 60 % gewonnene Fälle, ≥ 5 Punkte Vorsprung, null Faktentreue- und Policy-Ausfälle.
5. **Canary:** `AD_COPY_PROVIDER=adbot_intelligence` plus Together-Endpoint und EUR/MTok-Allokation. Eine Variable, jederzeit zurück auf `openai`.
6. Dedizierten Endpoint im Leerlauf auf null skalieren. Together rechnet Laufzeit, nicht nur Tokens.

Gate C: Eval bestanden **und** interner Canary ohne Policy-/Faktenbruch. Erst dann darf intern von „Adbot-Modell“ die Rede sein. Der Marketing-Satz „mit Hunderttausenden trainiert“ bleibt verboten, bis Korpusgröße **und** bestandene Eval belegt sind.

### Schritt 5 — Erst dann kontinuierlich / Embeddings

- Regelmäßiger Export → Train → Eval → Deploy, nur First-Party in die Weights.
- Embeddings erst, wenn der Vault größer ist als der Scan (heute 500) **und** die Probe offensichtlich passende Texte verfehlt, weil die Heuristik (Plattform/Ziel/Branche) zu grob ist.
- Embeddings bleiben ein zweites Ranking, kein Ersatz für Evidenz und kein Training.

### Bewusst nicht

- Vault- oder ChatGPT-Library-Ads ins Fine-Tune kippen.
- Trainieren, „weil die Sandbox voll ist“.
- Vektordatenbank bauen, solange der Korpus in einen Scan passt.
- Erfolg aus Library-Sichtbarkeit ableiten.
- Produktions-Copy auf Together legen, bevor Gate C grün ist.

## Wo der Code hängt

| Schritt | Ort |
| --- | --- |
| Muster + Signale laden | `src/lib/ad-learning/retrieve.ts` |
| Prompt-Block / Scoring | `src/lib/ad-learning/context.ts` |
| Copy | `suggestAdCopyForDestination` → OpenAI / Together |
| Creative Style-Refs | `enqueueCreativeAssetGenerationJob` → `attachCustomerWinnerStyleRefs` |
| Winner-Label | `apply_brand_asset_performance_winners` nach Meta-Sync |
| Sandbox / Staging | `ad_library_collector_items` → Admin `/dashboard/inspiration` |
| Meta Ad Library App | `META_AD_LIBRARY_*` + `ads_archive` → Admin `/dashboard/inspiration` |
| KI-Training (URL → Ad → Rating) | `adbot_training_runs` → Admin `/dashboard/training` |
| Live-Korpus (zentrales Gedächtnis) | `brand_assets` mit `library_scope=INSPIRATION` + `metadata.library=ad_example_library` |
