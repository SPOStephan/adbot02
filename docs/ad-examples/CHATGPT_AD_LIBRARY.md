# ChatGPT Ad Library → interner Inspiration Vault

**Stand:** 16. September 2026  
**Quelle:** https://www.chatgptadlibrary.com/library  
**Sichtbarkeit:** nur Site-Admins + interne KI. Niemals kundensichtbar.

## Zweck

Fremde ChatGPT-Ads als **interne Inspirations- und Wissensquelle** speichern. Adbot-Kunden sehen diese Assets nicht. Creative-Generation bleibt standardmäßig aus (`use_for_generation=false`); Admins können einzelne Beispiele später bewusst freigeben.

## Automatischer Klein-Scrape (empfohlen)

Die Library-HTML, Ad-Seiten und Sitemap-Shards sind hinter einem **Vercel Security Checkpoint** (HTTP 429). Öffentlich bleiben:

- `sitemap.xml` (Werbetreibende, keine `/ad/{id}`)
- `ad/sitemap.xml` (Index, `x-ad-sitemap-count` ≈ 16k)
- CDN-Bilder `img.chatgptadlibrary.com`

Deshalb scrapen wir **nicht** massenhaft von der Vercel-App aus. Ist ScrapingBee in Production gesetzt, ruft die GitHub Action nur `unlock_discover` + `unlock` auf der App auf — **ohne Playwright zu installieren oder zu importieren**. Fehlt der Key, fällt sie auf ≤5 Ad-Seiten in einem frischen Browser zurück (Gästelimit der Quelle).

| Komponente | Rolle |
| --- | --- |
| `CHATGPT_AD_LIBRARY_SYSTEM_IDS` | Verifizierter Systemkatalog. Queue braucht keine manuellen IDs. |
| Sequenz-Probe bis 30 000 | Wenn Katalog + Live-Discover leer sind, liefert `mode=plan` die nächsten unimportierten IDs. |
| Tabelle `chatgpt_ad_library_crawl_state` | Queue, Cursor, Zähler, `next_probe_id` |
| `GET/POST /api/cron/chatgpt-ad-library-scrape` | Status / Plan / Ingest / Discover (CRON_SECRET) |
| GitHub Action `chatgpt-ad-library-scrape.yml` | alle 2h: Unlocker-Batch oder Playwright-Fallback |
| Admin `/dashboard/inspiration` | Auto an/aus, Unlocker-Probe + Import #7341, Copy auf den Karten |
| Vercel Cron (6h) | Mit Unlocker: dieselben ≤5 Ads. Ohne Key: Seed-Fallback, keine Queue-Entnahme. |
| ScrapingBee | Unlocker. Trial zuerst (1000 Credits, keine Karte). Freelance erst nach grüner Probe. Key nur in **Vercel Production**. |

Secrets für die Action (GitHub → Settings → Secrets and variables → Actions — **nicht** nur Vercel):

| Name | Wo | Beispiel |
| --- | --- | --- |
| `CRON_SECRET` | Repository **Secret** | gleicher Wert wie Vercel `CRON_SECRET` |
| `ADBOT_APP_URL` | Repository Secret **oder** Variable | `https://app.adbot.one` |

**ScrapingBee ist gegen diesen Checkpoint nicht bewiesen.** Headless Chrome, Jina und Crawler-UAs scheitern. FlareSolverr scheitert oft an „Failed to verify your browser.“ Auto-Mode *kann* klappen — oder dieselbe Challenge sehen. Freelance ändert nur das Credit-Kontingent, nicht den Schutz.

Deshalb: **keine 50 USD, bevor die Admin-Probe grün ist.**

1. Account auf https://www.scrapingbee.com/ — **Trial, 1000 Credits, keine Kreditkarte**.
2. API-Key nach **Vercel → Project → Settings → Environment Variables → Production** als `SCRAPINGBEE_API_KEY`.
3. Production **neu deployen**.
4. Unter `/dashboard/inspiration` **Unlocker-Probe + Import #7341** (eine Seite). Erfolg nur bei **Bild + Anzeigentext oder Trigger-Prompts**. Image-only wird nicht importiert.
5. **Grün mit Copy** → erst dann Freelance (~50 USD/Monat, 250k Credits). 5 Ads/2h + Shard ≈ 160k Credits/Monat.
6. **Rot + Checkpoint** → Freelance nicht kaufen. Mehr Credits lösen denselben Block nicht.
7. **HTTP 400 / Credits 0** ist kein Checkpoint — ungültige ScrapingBee-Parameter (früher `wait_browser=networkidle`). Nach dem Fix erneut probe, nicht kaufen.

Die Probe prüft den unbekannten Teil: Unlocker schafft `/ad/7341` und der Parser findet **Bild + echte Copy**. Such-Chrome, Theme-Scripts, og-Titel und der SEO-Zusatz „A sponsored ChatGPT ad by … and the N prompts that trigger it“ zählen nicht. Fehlen Live-Prompts, bleibt der verifizierte Seed.

Was nach einer grünen Probe noch knirschen *kann* (kein 50-Dollar-Risiko): fünf Seiten vs. 300s Cron-Timeout, Sitemap-Shards, HTML-Varianten anderer Ads, Trial-Credits (≈13 Stealth-Seiten).

Optional Vercel: `CHATGPT_AD_LIBRARY_UPLOADER_USER_ID` (Site-Admin-UUID).

Migration: `20260915140000_chatgpt_ad_library_crawl_state.sql`

Ablauf pro Lauf mit Unlocker:

1. `GET ?mode=unlock_discover` holt den aktuellen Sitemap-Shard über ScrapingBee.
2. `GET ?mode=unlock` plant ≤5 IDs, unlockt die Ad-Seiten, parsed HTML, ingest (WebP→JPEG).
3. Ohne Key: Playwright auf dem Runner (meist Checkpoint) und Seed-Fallback.

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
- **Unlocker-Probe + Import #7341**: Bild + Copy + Prompts. Karten zeigen Anzeigentext und die echten Trigger-Prompts aus der Quelle — keinen Platzhalter wie „ChatGPT-Kontextanzeige“.
- Auto-Scrape-Panel + optionaler JSON-Import
- Status: `GET /api/admin/chatgpt-ad-library/crawl` · `POST { action: "probe_unlocker" }`
- Interner KI-Abruf: `GET /api/admin/chatgpt-ad-library/intelligence?q=…`

## KI-Nutzung

`loadChatGPTAdLibraryForInternalIntelligence()` liefert Treffer nur aus dem Inspiration Vault mit `use_for_internal_intelligence=true`. Copy-Vorschläge ziehen Textmuster über `src/lib/ad-learning/` — ohne fremde Ads als Gewinner zu behandeln. Bild-Style-Referenzen für Kundengenerierung brauchen weiterhin explizites `use_for_generation=true`.

## Abgrenzung

- **Nicht** OpenAI-Ads-Manager-Kampagnen von Kunden in diesen Korpus mischen.
- **Nicht** Performance-Claims aus Library-Sichtbarkeit ableiten.
- Synthetischer Seed unter `training/ad-intelligence/` bleibt getrennt und rechtebereinigt.
