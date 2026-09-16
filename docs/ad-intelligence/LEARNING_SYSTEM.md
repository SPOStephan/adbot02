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

## Wo der Code hängt

| Schritt | Ort |
| --- | --- |
| Muster + Signale laden | `src/lib/ad-learning/retrieve.ts` |
| Prompt-Block / Scoring | `src/lib/ad-learning/context.ts` |
| Copy | `suggestAdCopyForDestination` → OpenAI / Together |
| Creative Style-Refs | `enqueueCreativeAssetGenerationJob` → `attachCustomerWinnerStyleRefs` |
| Winner-Label | `apply_brand_asset_performance_winners` nach Meta-Sync |
| Sandbox / Staging | `ad_library_collector_items` → Admin `/dashboard/inspiration` |
| Live-Korpus (zentrales Gedächtnis) | `brand_assets` mit `library_scope=INSPIRATION` + `metadata.library=ad_example_library` |
