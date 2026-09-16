# Phase-2-Collector: wie wir sie bekommen, was gebaut werden muss

**Stand:** 16. September 2026  
**Bezug:** `docs/ad-intelligence/LEARNING_SYSTEM.md` · `docs/meta-automation/AD_LIBRARY_COLLECTOR_PLAN.md` · `docs/ad-examples/SOURCE_STRATEGY.md`

Die Collector sind **keine** Erweiterung der Kunden-Meta-App und **kein** Scraping der öffentlichen Library-Websites. Sie sind eigene, langsame Importe in den internen Inspiration-Vault. ChatGPT-Ad-Library-Scrape ist der Prototyp — für Meta, Google und TikTok gilt dasselbe Ziel, aber **offizielle APIs und getrennte Tokens**.

## Prinzip

```
Offizielle Library-API (eigene App / eigener Token)
        │
        ▼
Collector-Dienst (außerhalb der Produkt-App)
  Suche · Throttle · Bild-Download · Roh-JSON
        │
        ▼
Staging  fetched → reviewed → ready_for_import → imported
        │
        ▼
Adbot Admin-Import
  uploadInspirationVaultImage + ad_example_library
  library_scope=INSPIRATION · never_launch · customer_visible=false
  evidence_level=public_transparency
```

Adbot ruft die Fremd-APIs **nicht** mit Kunden-Tokens. Rate-Limits und App-Reviews treffen nur den Collector.

## Was du (Stephan) zuerst besorgen musst

Ohne diese Zugänge gibt es keinen legalen Massenimport. Code allein füllt den Vault nicht.

| Plattform | Zugang | Wer beantragt | Realistische Blockade |
| --- | --- | --- | --- |
| **Meta** (zuerst) | Neue **eigene** Meta-App + System-User. Graph `ads_archive` / Ad Library API. Nicht die Adbot-Kunden-App. | Du in Meta for Developers, App Review | Felende/Region oft begrenzt. Kommerzielle Ads nicht so offen wie politische. Vor dem Bau aktuelle `ads_archive`-Felder und erlaubte `ad_type` prüfen. |
| **Google** | Ads Transparency Center. Offizieller API-Zugang nur eingeschränkt (u. a. EWR), nicht als Universal-Feed belegt. | Google Transparency / API-Antrag, Nutzungsbedingungen lesen | Website scrapen ist kein Weg. Ohne bestätigten API-Zugang bleibt Google bei kuratierten Screenshots. |
| **TikTok** | Commercial Content API: **Research-Zugang**, zweckgebunden. Creative Center / Top Ads hat keine Bulk-API für uns. | TikTok Research-Antrag + rechtliche Freigabe | Kommerzielles Produkttraining kann den Research-Zweck verfehlen. Dann bleibt TikTok manuell. |

Zusätzlich: Keyword-/Branchenliste (Hotels, SaaS, Beauty, …), Zielländer (`DE`, `AT`, `CH`, `US`, …), Tagesbudget (z. B. 200–2 000 Ads/Tag, nicht „alles auf einmal“).

## Was in Adbot gebaut werden muss

Das ist der gemeinsame Kern. Einmal bauen, alle Collector andocken. Kann **vor** den API-Keys stehen.

1. **Staging-Tabelle** `ad_library_collector_items`  
   `provider` (`meta` / `google` / `tiktok`), `external_id`, `platform`, `status`, `source_url`, Roh-JSON, Bild-Hash, normalisierte Textfelder, `collector_batch_id`. Unique `(provider, external_id)`.

2. **Normalizer pro Plattform** (wie `normalizeChatGPTAdLibraryRecord`)  
   Pflicht: Bild (JPEG/PNG nach Download), Hook/Body wenn vorhanden, Advertiser, Quell-URL, `source_kind`, `evidence_level=public_transparency`, `rights_basis=reference_only`, `use_for_generation=false`, `use_for_internal_intelligence=true`.

3. **Admin-Import**  
   `POST /api/admin/ad-library-collector/import` (Site-Admin oder `CRON_SECRET`). Liest `ready_for_import`, ruft `uploadInspirationVaultImage` / `register_inspiration_vault_asset`, schreibt `imported` oder Fehler. Dedup über `external_source.external_id` wie beim ChatGPT-Import.

4. **Admin-Sicht** unter `/dashboard/inspiration`  
   Letzter Batch, Fehler, Pending-Zähler. Kein Kunden-UI.

5. **Learning-Retrieval**  
   Schon in Phase 1 (`src/lib/ad-learning/retrieve.ts`). Neue Vault-Zeilen fließen automatisch in Copy-Muster, sobald Text da ist. Bilder als Style-Ref weiter nur bei `use_for_generation=true`.

## Was außerhalb von Adbot gebaut werden muss

Eigener Dienst (Ordner `collectors/` oder Mini-Repo). Pro Plattform ein Worker:

| Baustein | Aufgabe |
| --- | --- |
| Auth | Nur Collector-Secrets. Nie Adbot-Kunden-Tokens. |
| Search-Queue | Keywords × Land × Plattform, Cursor, Restart ohne Duplikate |
| Throttle | Sleep, Tagesdeckel, 429-Backoff |
| Fetch | Offizielle API, Rohantwort speichern |
| Media | Creative-URL sofort laden (Snapshots laufen ab), als JPEG/PNG ablegen |
| Emit | Zeile auf `ready_for_import` oder Packet an den Adbot-Import |

Meta-Felder typischerweise: Ad-Library-ID, Page-Name, Body, CTA, `ad_snapshot_url`, Laufzeit, Länder. Keine Insights, keine ROAS — das bleibt First-Party.

## Reihenfolge

1. **Adbot-Importvertrag + Staging** — entblockt alle drei Quellen.  
2. **Meta-Collector**, sobald die eigene App `ads_archive` wirklich kommerzielle Ads in den Zielländern liefert (ein Probe-Fetch vor dem Volumen).  
3. **Google** nur nach schriftlich klarem API-Zugang.  
4. **TikTok** nur nach Research-Approval **und** Freigabe, dass interne Inspiration zulässig ist.  
5. Parallel weiter: ChatGPT-Unlocker + **eigene** ausgelieferte Ads (Meta-Sync, später OpenAI-Ads-Winner). Das ist das echte Leistungssignal, kein Collector-Ersatz.

## Was wir bewusst nicht tun

- Library-Websites scrapen (Meta/Google/TikTok-UI).  
- Kunden-`ads_management`-Token für Fremdanzeigen nutzen.  
- Collector-Ads launchen oder Kunden zeigen.  
- Aus Library-Sichtbarkeit „hat funktioniert“ ableiten.  
- TikTok-Research-Daten in ein öffentliches Kundenfeature kippen.

## Volumen-Erwartung

Collector skalieren **Sichtbarkeit** (Muster, Hooks, Formate). Hunderttausende Zeilen sind möglich, wenn Zugang und Tagesbudget stehen — das ist kein Trainingsbeleg. Die belastbare Lernkurve kommt aus verbundenen Werbekonten (`performance_winner`, später Underperformer). Collector füttern Phase-1-Retrieval; Fine-Tune (Phase 3) bleibt First-Party.
