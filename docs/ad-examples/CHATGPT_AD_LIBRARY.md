# ChatGPT Ad Library → interner Inspiration Vault

**Stand:** 15. September 2026  
**Quelle:** https://www.chatgptadlibrary.com/library  
**Sichtbarkeit:** nur Site-Admins + interne KI. Niemals kundensichtbar.

## Zweck

Fremde ChatGPT-Ads als **interne Inspirations- und Wissensquelle** speichern. Adbot-Kunden sehen diese Assets nicht. Creative-Generation bleibt standardmäßig aus (`use_for_generation=false`); Admins können einzelne Beispiele später bewusst freigeben.

## Automatischer Klein-Scrape (empfohlen)

Die Library-HTML, Ad-Seiten und Sitemap-Shards sind hinter einem **Vercel Security Checkpoint** (HTTP 429). Öffentlich bleiben:

- `sitemap.xml` (Werbetreibende, keine `/ad/{id}`)
- `ad/sitemap.xml` (Index, `x-ad-sitemap-count` ≈ 16k)
- CDN-Bilder `img.chatgptadlibrary.com`

Deshalb scrapen wir **nicht** massenhaft von der Vercel-App aus. Die GitHub Action plant ≤5 IDs und öffnet **nur diese Ad-Seiten** in einem frischen Browser (Gästelimit der Quelle).

| Komponente | Rolle |
| --- | --- |
| `CHATGPT_AD_LIBRARY_SYSTEM_IDS` | Verifizierter Systemkatalog. Queue braucht keine manuellen IDs. |
| Sequenz-Probe bis 30 000 | Wenn Katalog + Live-Discover leer sind, liefert `mode=plan` die nächsten unimportierten IDs. |
| Tabelle `chatgpt_ad_library_crawl_state` | Queue, Cursor, Zähler, `next_probe_id` |
| `GET/POST /api/cron/chatgpt-ad-library-scrape` | Status / Plan / Ingest / Discover (CRON_SECRET) |
| GitHub Action `chatgpt-ad-library-scrape.yml` | alle 2h Playwright ≤5 Ads |
| Admin `/dashboard/inspiration` | Auto an/aus, Status. Manuelle IDs nur Notfall. |
| Vercel Cron (6h) | HTTP-Probe. Bei 429 **keine** Queue-Entnahme — sonst verhungert der Worker. |

Secrets für die Action (GitHub → Settings → Secrets and variables → Actions — **nicht** nur Vercel):

| Name | Wo | Beispiel |
| --- | --- | --- |
| `CRON_SECRET` | Repository **Secret** | gleicher Wert wie Vercel `CRON_SECRET` |
| `ADBOT_APP_URL` | Repository Secret **oder** Variable | `https://app.adbot.one` |

Optional Vercel: `CHATGPT_AD_LIBRARY_UPLOADER_USER_ID` (Site-Admin-UUID).

Migration: `20260915140000_chatgpt_ad_library_crawl_state.sql`

Ablauf pro Lauf (vollautomatisch):

1. Worker lädt Systemkatalog + HTTP-Sitemap (Shards oft 429 — das ist egal).
2. `POST action=discover` akzeptiert `ids[]` und leeres XML (kein `xml_required`).
3. `GET ?mode=plan` mischt Katalog + Queue, überspringt schon Importiertes, sonst sequenzieller Probe.
4. Frischer Browser öffnet nur diese ≤5 Ad-Seiten. Related-IDs aus der Seite gehen zurück in die Queue.
5. Checkpoint/Timeout wird requeued. 404 / ohne Bild wird verworfen (kein Endlos-Loop).
6. Wenn alle Ad-Seiten checkpoint-blockiert sind (typisch auf GitHub-Runnern): `ingest_seed` legt den mitgebrachten GlossGenius-Datensatz an. Das CDN-Bild ist öffentlich.
7. `action=ingest` → WebP→JPEG → Inspiration Vault.

Admin kann denselben Seed jederzeit unter `/dashboard/inspiration` mit **GlossGenius-Seed jetzt importieren** nachziehen.

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

- Seite: `/dashboard/inspiration` — Status, letzter Lauf und importierte Ads stehen **in der Scrape-Karte** (serverseitig geladen, kein Toast).
- Auto-Scrape-Panel + optionaler JSON-Import
- Status: `GET /api/admin/chatgpt-ad-library/crawl`
- Interner KI-Abruf: `GET /api/admin/chatgpt-ad-library/intelligence?q=…`

## KI-Nutzung

`loadChatGPTAdLibraryForInternalIntelligence()` liefert Treffer nur aus dem Inspiration Vault mit `use_for_internal_intelligence=true`. Style-Referenzen für Kundengenerierung brauchen weiterhin explizites `use_for_generation=true`.

## Abgrenzung

- **Nicht** OpenAI-Ads-Manager-Kampagnen von Kunden in diesen Korpus mischen.
- **Nicht** Performance-Claims aus Library-Sichtbarkeit ableiten.
- Synthetischer Seed unter `training/ad-intelligence/` bleibt getrennt und rechtebereinigt.
