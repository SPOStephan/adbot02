# ChatGPT Ad Library → interner Inspiration Vault

**Stand:** 15. September 2026  
**Quelle:** https://www.chatgptadlibrary.com/library  
**Sichtbarkeit:** nur Site-Admins + interne KI. Niemals kundensichtbar.

## Zweck

Fremde ChatGPT-Ads als **interne Inspirations- und Wissensquelle** speichern. Adbot-Kunden sehen diese Assets nicht. Creative-Generation bleibt standardmäßig aus (`use_for_generation=false`); Admins können einzelne Beispiele später bewusst freigeben.

## Datenvertrag

| Feld | Wert |
| --- | --- |
| `library_scope` | `INSPIRATION` |
| `source_kind` | `chatgpt_ad_library` |
| `rights_basis` | `reference_only` |
| `evidence_level` | `public_transparency` |
| `use_for_generation` | `false` (Default) |
| `external_source.customer_visible` | `false` |
| `external_source.use_for_internal_intelligence` | `true` |
| `never_launch` | `true` |

Bilder werden vom CDN `img.chatgptadlibrary.com` geladen, per **sharp** von WebP nach JPEG konvertiert und über `uploadInspirationVaultImage` registriert. Placeholder-URLs werden abgelehnt.

## Admin-Oberfläche

- Seite: `/dashboard/inspiration`
- Import-Panel: JSON oder JSONL einfügen → `POST /api/admin/chatgpt-ad-library/import`
- Status: `GET /api/admin/chatgpt-ad-library/import`
- Interner KI-Abruf: `GET /api/admin/chatgpt-ad-library/intelligence?q=…`

Batch-Limit: 25 Datensätze pro Request. Duplikate werden über `external_source.external_id` übersprungen.

## Crawl / Bulk außerhalb der Cloud

Die Website setzt einen Vercel-Bot-Checkpoint; Server-side HTML-Fetch liefert oft HTTP 429. CDN-Bilder sind dagegen öffentlich. Für Massenextraktion lokal:

```bash
# Playwright o. ä. im Browser-Kontext, dann:
node scripts/chatgpt-ad-library-normalize-fixture.mjs path/to/raw.jsonl > fixtures/chatgpt-ad-library/seed.jsonl
```

Fixture-Beispiel: `fixtures/chatgpt-ad-library/seed.jsonl`

## KI-Nutzung

`loadChatGPTAdLibraryForInternalIntelligence()` liefert Treffer nur aus dem Inspiration Vault mit `use_for_internal_intelligence=true`. Style-Referenzen für Kundengenerierung brauchen weiterhin explizites `use_for_generation=true` (siehe `style-reference-load.ts`).

## Abgrenzung

- **Nicht** OpenAI-Ads-Manager-Kampagnen von Kunden in diesen Korpus mischen.
- **Nicht** Performance-Claims aus Library-Sichtbarkeit ableiten.
- Synthetischer Seed unter `training/ad-intelligence/` bleibt getrennt und rechtebereinigt.
