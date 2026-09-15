# ChatGPT Ad Library → interner Inspiration Vault

**Stand:** 15. September 2026  
**Quelle:** https://www.chatgptadlibrary.com/library  
**Sichtbarkeit:** nur Site-Admins + interne KI. Niemals kundensichtbar.

## Zweck

Fremde ChatGPT-Ads als **interne Inspirations- und Wissensquelle** speichern. Adbot-Kunden sehen diese Assets nicht. Creative-Generation bleibt standardmäßig aus (`use_for_generation=false`); Admins können einzelne Beispiele später bewusst freigeben.

## Automatischer Klein-Scrape (empfohlen)

Die Library-HTML ist hinter einem **Vercel Security Checkpoint** (oft HTTP 429). CDN-Bilder (`img.chatgptadlibrary.com`) sind öffentlich. Deshalb scrapen wir **nicht** massenhaft von der Vercel-App aus, sondern in **kleinen Batches (max. 5 Ads)** mit einem echten Browser:

| Komponente | Rolle |
| --- | --- |
| Tabelle `chatgpt_ad_library_crawl_state` | Queue, Cursor, Zähler |
| `GET/POST /api/cron/chatgpt-ad-library-scrape` | Plan / Ingest / Discover (CRON_SECRET) |
| GitHub Action `chatgpt-ad-library-scrape.yml` | alle 2h Playwright ≤5 Ads |
| Admin `/dashboard/inspiration` | Auto an/aus, IDs in Queue, Status |
| Vercel Cron (6h) | Best-Effort HTTP; bei 429 no-op |

Secrets für die Action (GitHub → Settings → Secrets and variables → Actions — **nicht** nur Vercel):

| Name | Wo | Beispiel |
| --- | --- | --- |
| `CRON_SECRET` | Repository **Secret** | gleicher Wert wie Vercel `CRON_SECRET` |
| `ADBOT_APP_URL` | Repository Secret **oder** Variable | `https://app.adbot.one` |

Optional Vercel: `CHATGPT_AD_LIBRARY_UPLOADER_USER_ID` (Site-Admin-UUID).


Migration: `20260915140000_chatgpt_ad_library_crawl_state.sql`

Ablauf pro Lauf (vollautomatisch, keine manuellen IDs):

1. Browser öffnet `/library` + aktuellen Sitemap-Shard und extrahiert Ad-IDs.
2. IDs werden in `chatgpt_ad_library_crawl_state.pending_ids` gelegt (`action=discover`).
3. `?mode=plan` nimmt bis zu 5 noch nicht importierte IDs.
4. Diese 5 Ad-Seiten werden gelesen → `action=ingest` (WebP→JPEG → Vault).

Manuelles JSONL bleibt nur als Notfall-Fallback.

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

## Admin-Oberfläche

- Seite: `/dashboard/inspiration`
- Auto-Scrape-Panel + optionaler JSON-Import
- Status: `GET /api/admin/chatgpt-ad-library/crawl`
- Interner KI-Abruf: `GET /api/admin/chatgpt-ad-library/intelligence?q=…`

## KI-Nutzung

`loadChatGPTAdLibraryForInternalIntelligence()` liefert Treffer nur aus dem Inspiration Vault mit `use_for_internal_intelligence=true`. Style-Referenzen für Kundengenerierung brauchen weiterhin explizites `use_for_generation=true`.

## Abgrenzung

- **Nicht** OpenAI-Ads-Manager-Kampagnen von Kunden in diesen Korpus mischen.
- **Nicht** Performance-Claims aus Library-Sichtbarkeit ableiten.
- Synthetischer Seed unter `training/ad-intelligence/` bleibt getrennt und rechtebereinigt.
