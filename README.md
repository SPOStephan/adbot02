# Adbot (AdPilot) – Multi-Platform Ad Portal

Adbot ist ein Werbeportal auf **Next.js 16 (App Router), Supabase und Vercel**. Kunden verbinden ihre Meta-Werbekonten, lassen Creatives und Anzeigentexte per KI erzeugen, starten Lead- und Traffic-Kampagnen über eine abgesicherte Write-Pipeline und pushen organische Beiträge automatisch als Anzeigen („Beitrag-Push“). Daneben gibt es einen ChatGPT/OpenAI-Ads-Connector und die Anbindung an die Funnel- und Freebie-Apps.

> **Stand:** 29.09.2026 (nach PR #365). Diese Datei ist der Einstiegspunkt. Detaildokumente liegen unter `docs/` (Übersicht unten). Bekannte Risiken und offene Befunde: [`docs/audits/ARCHITECTURE_RISKS_2026-09-29.md`](docs/audits/ARCHITECTURE_RISKS_2026-09-29.md).
>
> Für Agenten (Claude, Cursor): zuerst `AGENTS.md` lesen. Änderungen an Meta-Write-Pfaden nur nach `docs/meta-automation/META_WRITE_COLLATERAL_GUARDRAILS.md` und mit Smoke-SQL `supabase/diagnostics/meta_write_smoke_organic_after_traffic.sql`.

## Inhalt

1. [Überblick und Stack](#1-überblick-und-stack)
2. [Bereiche im Code](#2-bereiche-im-code)
3. [Datenflüsse](#3-datenflüsse)
4. [Hintergrundjobs (Vercel-Crons)](#4-hintergrundjobs-vercel-crons)
5. [Datenbank](#5-datenbank)
6. [Tests](#6-tests)
7. [Umgebungsvariablen](#7-umgebungsvariablen)
8. [Weiterführende Dokumente](#8-weiterführende-dokumente)

---

## 1. Überblick und Stack

| Komponente | Technologie |
|---|---|
| Web-App | Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS 4 |
| Auth | Supabase Auth (SSR-Cookies), zusätzlich KIready-OIDC-SSO |
| Datenbank | Supabase PostgreSQL mit RLS; Geschäftslogik der Meta-Writes überwiegend in SQL-Funktionen und Triggern |
| Hosting | Vercel (Serverless-Funktionen, Crons) |
| Meta | Graph API, Facebook Login for Business, Conversions API |
| KI | OpenRouter (Bilder, Extraktion, Captions), OpenAI oder Together (Anzeigentexte) |
| Credits | Legacy (SQL-Wallet) oder Waizr Credit API, umschaltbar über `ADBOT_CREDIT_PROVIDER` |

Es gibt **kein `middleware.ts`**. Host- und Session-Weiche liegen in `src/proxy.ts` → `src/lib/supabase/proxy.ts`:
- Marketing-Host ↔ Portal-Host
- `/dashboard*` ohne Session → `/login?next=…`
- Eingeloggt auf `/login`, `/registrieren` oder `/passwort-vergessen` → `/dashboard`

Im Repo liegen außerdem zwei eigenständige Apps (Vite/Express/Drizzle): `apps/adbot-funnel` und `apps/adbot-freebie`. GitHub-Workflows spiegeln sie in eigene Deploy-Repos (`.github/workflows/sync-adbot-*.yml`).

## 2. Bereiche im Code

### 2.1 `src/lib`

| Ordner/Datei | Zweck |
|---|---|
| `meta/` | Kern: Graph-Client, OAuth-Krypto, Sync, Marketing-Snapshot, Write-Client, **Executor**, Launch, Beitrag-Push, Budget-Planner, Creative-Format-Optimizer, CAPI, Kampagnenentwürfe |
| `creative-assets/` | Bildgenerierung per Job-Queue (Enqueue, Worker, Provider OpenRouter/HTTP, Storage, Meta-Crops) |
| `ad-copy/` | KI-Anzeigentexte (`suggestAdCopyForDestination`), Provider OpenAI/Together, Preisumrechnung |
| `ad-training/` | Admin-Trainingsplatz; `image.ts` enthält außerdem `generateMasterImageBytes` für die synchrone Bibliotheks-Generierung |
| `campaign-pipeline/` | Kampagnenideen aus Link, Screenshot oder Stichwort → Umsetzung auf Klick |
| `billing/` | Credit-Vertrag (`credit-contract.ts`), Legacy- und Waizr-Adapter, Settlement für Creative-Jobs |
| `kiready/` | KIready-OIDC-SSO, Identitätsverknüpfung, Entitlement-Gate |
| `custom-domains/` | Kundendomains mit CNAME-Prüfung, Sync mit den Tools |
| `openai-ads/` | ChatGPT/OpenAI-Ads-Connector (Connect, Sync, Launch-Saga) |
| `media-library/` | Kunden-Mediathek, Uploads, Meta-Formate |
| `ad-learning/`, `ad-intelligence/`, `ad-examples/`, `ad-library-collector/`, `chatgpt-ad-library/`, `platform-library/` | Lern- und Inspirationskorpus, Motivbibliothek, Scraper |
| `campaign-geo/`, `cross-platform-strategy/` | Geotargeting (Nominatim), kanalübergreifende Budgetplanung |
| `dashboard/`, `help/`, `legal/`, `site-branding/` | Dashboard-Daten, Hilfetexte, Rechtstexte, Branding |
| `platforms/` | Plattformkatalog, AES-GCM für Nicht-Meta-Credentials |
| `supabase/` | Browser-, Server-, Admin- und Proxy-Client (`SUPABASE_SECRET_KEY` bevorzugt vor Service-Role) |
| `funnel-*.ts`, `freebie-*.ts` | SSO-Token, Pixel-Sync, CAPI-Relay, Kampagnenstatus, Creative-Übergabe aus dem Funnel |

### 2.2 Dashboard (`src/app/dashboard`)

Alle Seiten laufen durch `DashboardShell` mit `RequireDashboardAuth`.

| Seite | Zweck |
|---|---|
| `/dashboard` | Übersicht: Plattformstatus, Kennzahlen |
| `kampagnen` | Meta-Konto, Kampagnenleistung, Empfehlungen |
| `traffic-launch` („Kampagne starten“) | Lead-Kampagne (`LeadLaunchCanary`) und Traffic-Kampagne (`TrafficLaunchCanary`), Funnel-Workspace, Geo, Pixel |
| `beitraege` | Beitragsabruf und Kandidaten für Beitrag-Push |
| `autonomie` | Policy, Kill-Switch, Boost-Einstellungen, Onboarding |
| `creatives` | Mediathek und Bildgenerierung |
| `kampagnen-pipeline`, `assistent`, `strategie` | Ideen-Pipeline, regelbasierte Hinweise, Budgetstrategie |
| `tracking`, `domains`, `zielgruppen` | Meta-Pixel, Kundendomains, Geo-Vorgabe |
| `chatgpt-ads` | OpenAI-Ads-Workspace |
| `hilfe` | Setup-Anleitung |
| Nur Site-Admins: `branding`, `rechtliches`, `training`, `motifs`, `inspiration`, `chatgpt-ads-anleitung` | Pflege von Branding, Rechtstexten, Trainings- und Motivbibliotheken |

### 2.3 API (`src/app/api`) und Auth-Modell

| Gruppe | Zweck | Absicherung |
|---|---|---|
| `cron/*` | Hintergrundjobs (Abschnitt 4) | `Authorization: Bearer CRON_SECRET` (konstantzeitiger Vergleich) |
| `connectors/meta/{start,callback,sync,disconnect,assets/*}` | OAuth, Abruf, Asset-Verwaltung | Supabase-Session plus Same-Origin-Prüfung; Callback zusätzlich HMAC-OAuth-State |
| `connectors/meta/{deauthorize,data-deletion}` | Compliance-Callbacks von Meta | Meta-`signed_request` mit `META_APP_SECRET` |
| `meta/automation/*` (~30 Routen) | Policy, Kill-Switch, Launch, Beitrag-Push, Budget, Creatives, Ad-Copy | `authenticateMetaCustomer()` plus `readControlJson` (Same-Origin, JSON, Größenlimit) |
| `internal/{funnel-capi,funnel-creatives,funnel-campaign-status,tool-domains}` | Server-zu-Server-Aufrufe aus Funnel/Freebie | HMAC-Token mit `FUNNEL_SSO_SECRET` bzw. `FREEBIE_SSO_SECRET`, je Zweck eigener `purpose` |
| `funnel/sso`, `freebie/sso` | SSO-Absprung in die Tool-Admins | Session, dann kurzlebiger HMAC-Token |
| `admin/*`, `legal/*`, `site-branding/*` | Pflege durch Site-Admins | Session plus `isSiteAdmin` |
| `connectors/openai-ads/*`, `openai-ads/*` | OpenAI-Ads | Session |
| `health` | Health-Check | öffentlich |

## 3. Datenflüsse

### 3.1 Login und Zugang

- **Supabase Auth:** Passwort-Login und Registrierung (`AuthForm.tsx`), Passwort-Reset, `/auth/callback`. Der DB-Trigger `on_auth_user_created` legt `public.users` an.
- **Dashboard-Gate:** Der Proxy verlangt eine Session. `RequireDashboardAuth` prüft zusätzlich per `getKireadyAccessForUser`, ob ein mit KIready verknüpfter Nutzer Zugang hat, sonst → `/auth/kiready/denied`. Kostenpflichtige Aktionen prüfen separat `assertAdbotPaidActionAllowed`.
- **KIready-SSO** (`src/lib/kiready`, Routen `src/app/auth/kiready/*`): OIDC mit PKCE → ID-Token-Prüfung (jose/JWKS) → Organisation, Mitgliedschaft und Entitlement laden → Identität zuordnen (bekannte Identität in `kiready_external_identities`, sonst Verknüpfung mit Bestätigung oder neues Konto) → Supabase-Session per Admin-Magic-Link (`establishAdbotSession`).
- **Funnel-/Freebie-SSO:** `/api/funnel/sso` erzeugt einen HMAC-Token (5 min, mit `aud` = Ziel-Host) und leitet zur Consume-URL der Funnel-App. Die Funnel-App prüft Signatur, Ablauf und `aud`.

### 3.2 Meta verbinden

1. `POST /api/connectors/meta/start`: signierter OAuth-State (10 min, Intent `connect` oder `extend`) und Login-for-Business-URL.
2. `GET /api/connectors/meta/callback`: Code-Tausch, Token-Prüfung (`debugMetaAccessToken`, Scope-Klassifizierung), Assets laden. Der Token wird mit **AES-256-GCM** (`META_TOKEN_ENCRYPTION_KEY`) verschlüsselt gespeichert. Bei `extend` werden Assets ergänzt (`extend_meta_connection`), sonst ersetzt (`replace_meta_connection`).
3. Danach erster Marketing-Snapshot. Asset-Prune, Werbekontoauswahl und Trennen laufen über eigene Routen.
4. Content-Soft-Baseline: Beim ersten Abruf eines neu verbundenen FB/IG-Assets gelten Beiträge ab Verbindungszeitpunkt als `is_new` (`record_meta_content_candidates`).

### 3.3 Meta-Write-Control-Plane (alle schreibenden Meta-Aufrufe)

Jede Änderung an Meta läuft als **Plan** (`mutation_plans`) mit **Schritten** (`mutation_plan_steps`) durch einen gemeinsamen Executor. Direkte Meta-Writes aus UI-Routen gibt es nicht.

- **Executor** (`src/lib/meta/executor.ts`): `processNextMetaMutation` (nächster fälliger Plan, global) bzw. `processMetaMutationPlan(planId)` (gezielt). Ablauf je Schritt: Claim → Heartbeat → `begin_meta_mutation_step_dispatch` → Meta-Write (`write-client.ts`, Timeout 15 s) → `complete_meta_mutation_remote_step` → Read-back/Reconcile. Schrittlimit pro Lauf (64); am Limit gibt `yield_meta_mutation_execution` den Plan sauber zurück.
- **Kill-Switch** (`kill_switch_state`, append-only): Scope SYSTEM/ACCOUNT/PLAN, Modus ALLOW/FREEZE_WRITES/PAUSE_MANAGED; effektiv berechnet von `get_effective_meta_kill_switch`, im Claim geprüft.
- **Freigaben:** Neue Launch- und Budget-Pläne werden per Trigger eingefroren und erst durch `approve_meta_*_canary_plan*` freigegeben. Freigegebene Launches warten auf das Account-Write-Gate statt BLOCKED zu werden. Nach Ausführung greift der Refreeze nur für den eigenen Plan, nicht für Nachbar-Launches.
- **Schutzmechanismen:** Account-Operation-Leases, Guard-Trigger gegen unzulässige Plan-/Schrittänderungen, append-only Audit (`mutation_audit_events`), Budget-Exposure-Ledger, Duplikatschutz für Launch-Freigaben (`guard_meta_launch_duplicate_approval`, `meta_launch_superseded_by_newer`).
- **Unklare Meta-Antworten:** Ein Timeout nach dem Absenden führt zu `REMOTE_UNKNOWN` → bei Launches `COMPENSATION_REQUIRED`, ohne automatischen Retry. Abgelehnte Aufrufe vor dem Dispatch werden `RETRYABLE`. Operator-Werkzeug: `resume_failed_meta_customer_launch`.

### 3.4 Kampagnenstart (Lead und Traffic)

1. **UI:** `LeadLaunchCanary` (`OUTCOME_LEADS`, Funnel-URL) bzw. `TrafficLaunchCanary` (`OUTCOME_TRAFFIC`, Optimierung `LANDING_PAGE_VIEWS`, bis 10 Motive pro Format, Vorschau über `MetaAdPreviewGallery`).
2. **Vorbereiten:** `POST /api/meta/automation/launch` → `materializeCustomerLaunch`: Marketing-Stand auffrischen, vorübergehender Account-Freeze, Budget-Exposure reservieren, Plan `LAUNCH_CHAIN` erzeugen (`materialize_meta_customer_launch_plan` bzw. `…_lifetime_launch_plan_v3`), Kill-Switch wiederherstellen.
3. **Plan-Schritte:** Bild hochladen → Kampagne, Anzeigengruppe, Creative und Anzeige jeweils validieren, **pausiert** anlegen und zurücklesen → aktivieren.
4. **Freigabe:** `PUT /api/meta/automation/launch` → `approveCustomerLaunch` → sofortiges Abarbeiten (`drainApprovedLaunchChainForAccount`); den Rest übernimmt der Cron `meta-executor`.
5. **Wartung:** Cron `meta-launch-maintenance` (Recovery unterbrochener Launches, Cleanup).

### 3.5 Beitrag-Push (Organic Boost)

1. **Abruf** (Cron `meta-sync` oder manuell): FB-Posts und IG-Media → `record_meta_content_candidates` → `meta_content_candidates` mit `is_new`.
2. **Planung:** `run_meta_organic_boost_planner` → `materialize_meta_organic_boost_plan`, gesteuert über `meta_boost_settings`, `meta_boost_asset_settings` und `meta_content_boost_overrides`.
3. **Autonomie:** Mit Vollautomatik + Freigeben + Autonomie startet die Planung für erkannte Beiträge automatisch (`planAndDrainOrganicBoostForAccount`). „Erneut prüfen“ ist nur Diagnose.
4. **Ausführung:** `prepare_meta_organic_boost_write_now` → Executor; Gate im Claim: `meta_organic_boost_executor_preflight_ok`.
5. **Auslieferung:** Cron `organic-boost-delivery` heilt pausierte oder unbestätigte Auslieferung konservativ (nie FREEZE → ALLOW).

### 3.6 Creatives und Texte

- **Asynchron (Standard):** `/api/meta/automation/creative-assets/enqueue` → Credits reservieren → `creative_asset_jobs` → Cron `creative-assets` → Provider (OpenRouter oder HTTP, mit Modell- und Host-Allowlist) → Storage → `brand_assets` + Meta-Formate → Credits abrechnen oder freigeben.
- **Synchron:** `generateLibraryCreativeNow` (über `ad-training/image.ts`), genutzt von Kampagnen-Pipeline, Funnel-Creative-Übergabe und dem Enqueue-Fallback ohne Werbekonto.
- **Anzeigentexte:** `suggestAdCopyForDestination`, abgerechnet nach tatsächlichen Provider-Kosten.
- **Funnel-Übergabe:** `/api/internal/funnel-creatives` → `processFunnelCreativeHandoff` (`funnel_creative_handoffs`, eindeutig je Funnel und Ziel-URL).

### 3.7 Credits

Kosten stehen in `src/lib/billing/credit-contract.ts` und in der Tabelle `credit_action_costs`. Reservierung → Commit oder Release über den gewählten Provider (Legacy-SQL-RPCs oder Waizr). **Tatsächlich abgerechnet werden derzeit nur Bildgenerierung (20) und Anzeigentexte (5)**; Kampagnenstart und Beitrag-Push sind bepreist, aber nicht angebunden (siehe Risiko-Dokument).

### 3.8 Weitere Integrationen

- **Kundendomains:** Registrierung und CNAME-Prüfung gegen `cname.vercel-dns.com`; Host-Routing selbst liegt in den Funnel-/Freebie-Apps. Sync über `/api/internal/tool-domains`.
- **Funnel ↔ Portal:** Pixel-Push in den Funnel, CAPI-Relay (`/api/internal/funnel-capi`), Kampagnenstatus für den Funnel.
- **OpenAI/ChatGPT Ads:** API-Key verschlüsselt in `platform_accounts`; Launch-Saga pausiert anlegen → Vorschau-Token → aktivieren.

## 4. Hintergrundjobs (Vercel-Crons)

| Pfad | Takt | Aufgabe |
|---|---|---|
| `/api/cron/meta-executor` | jede Minute | Fällige Meta-Pläne abarbeiten (`processNextMetaMutation`) |
| `/api/cron/meta-sync` | stündlich | Beiträge und Marketing-Snapshot abrufen, Budget-Planner, Creative-Format-Optimizer, Beitrag-Push planen und abarbeiten |
| `/api/cron/meta-launch-maintenance` | alle 4 h (Minute 17) | Unterbrochene Launches wiederaufnehmen, veraltete aufräumen |
| `/api/cron/organic-boost-delivery` | alle 15 min | Auslieferungs-Watchdog für Beitrag-Push (abschaltbar mit `ORGANIC_BOOST_DELIVERY_WATCHDOG=0`) |
| `/api/cron/creative-assets` | alle 5 min | Bildjobs und Credit-Settlement |
| `/api/cron/openai-ads-sync` | alle 5 min | OpenAI-Ads-Sync und Recovery hängender Launches |
| `/api/cron/chatgpt-ad-library-scrape` | alle 15 min | Scraper für den Inspirationskorpus (zusätzlich GitHub Action alle 2 h) |

## 5. Datenbank

- **Migrationen:** `supabase/migrations`, 161 Dateien (Stand 29.09.2026), chronologisch benannt. Viele SQL-Funktionen wurden mehrfach neu definiert; maßgeblich ist immer die **jüngste** Migration.
- **Anwenden:** Über den Supabase-SQL-Editor bzw. die Management-API, nach ausdrücklicher Freigabe des Owners. Stolperfalle im SQL-Editor: plpgsql `SELECT … INTO` wird als `CREATE TABLE AS` gelesen; in Migrationen deshalb `for … in select … loop … exit; end loop;` oder Zuweisungen verwenden.
- **Diagnose (nur lesend):** `supabase/diagnostics/` — insbesondere `meta_write_smoke_organic_after_traffic.sql` (Abschnitt 5 „FAILING“ muss 0 Zeilen liefern).

| Bereich | Wichtige Tabellen |
|---|---|
| Identität | `users`, `kiready_external_identities`, `adbot_organizations`, `adbot_organization_memberships`, `site_admins` |
| Meta-Verbindung und Content | `platform_accounts`, `meta_assets`, `meta_content_candidates`, `meta_confirmed_pixels` |
| Write-Control-Plane | `mutation_plans`, `mutation_plan_steps`, `mutation_executions`, `mutation_audit_events`, `remote_object_bindings`, `kill_switch_state`, `meta_account_operation_leases`, `meta_account_write_modes`, `daily_budget_exposures`, `budget_mutation_ledger`, `*_canary_approvals` |
| Beitrag-Push | `meta_boost_settings`, `meta_boost_asset_settings`, `meta_content_boost_overrides`, `meta_organic_boost_links` |
| Creatives | `brand_profiles`, `brand_assets`, `creative_asset_jobs`, `funnel_creative_handoffs`, `campaign_ideas` |
| Billing | `billing_plans`, `billing_subscriptions`, `credit_wallets`, `credit_ledger`, `credit_reservations`, `credit_action_costs` |
| Sonstiges | `customer_custom_domains`, `customer_campaign_geo`, `ad_platform_launches`, `ad_platform_sync_runs` |

## 6. Tests

- Tests sind Node-Skripte `scripts/test-*.mjs` mit `node:assert`, aufrufbar über die `test:*`-Skripte in `package.json` (Sammelskript: `test:meta-all`). Die meisten prüfen Quelltext bzw. transpilierte Funktionen mit Stubs.
- **Mit lokalem PostgreSQL** (Wegwerf-Instanz mit allen Migrationen): `test:meta-write-control-plane`, `test:meta-launch-queue-resume`, `test:openai-ads-database`. `initdb` läuft nicht als root; Workaround: Nutzer `pgtest` anlegen, Repo kopieren und z. B. `runuser -u pgtest -- env PATH=$PATH:$(pg_config --bindir) node scripts/test-meta-launch-queue-resume.mjs` ausführen.
- **Es gibt kein CI**, das Tests oder Lint ausführt. Vor Änderungen an Meta-Write-Pfaden mindestens die betroffenen Tests und das Smoke-SQL laufen lassen.
- Bekannt rot (vorbestehend): `test-campaign-geo`, `test-funnel-url-split`, `test-meta-customer-controls`, `test-structural-multi-ad`, `test-meta-write-control-plane.sql` Zeile 621 („Exact campaign hard cap was not accepted“).

```bash
npm ci
npm run lint
npm run build
npm run test:meta-all
```

## 7. Umgebungsvariablen

Nur Namen; Werte ausschließlich in Vercel. Geheime Werte dürfen nie mit `NEXT_PUBLIC_` beginnen. `.env.example` enthält die Basis.

| Bereich | Variablen |
|---|---|
| Supabase | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (Fallback `…_ANON_KEY`), `SUPABASE_SECRET_KEY` (Fallback `SUPABASE_SERVICE_ROLE_KEY`) |
| Meta | `META_APP_ID`, `META_APP_SECRET`, `META_LOGIN_CONFIG_ID`, `META_STATE_SECRET` (≥ 32 Zeichen), `META_TOKEN_ENCRYPTION_KEY` (Base64, 32 Byte) |
| URLs | `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_MARKETING_URL`, `NEXT_PUBLIC_FUNNEL_URL`, `NEXT_PUBLIC_FREEBIE_URL` |
| Crons | `CRON_SECRET` |
| Funnel/Freebie | `FUNNEL_SSO_SECRET`, `FREEBIE_SSO_SECRET` |
| KIready | `KIREADY_OIDC_CLIENT_ID`, `KIREADY_OIDC_CLIENT_SECRET`, `KIREADY_OIDC_ISSUER`, `KIREADY_OIDC_REDIRECT_URI`, `KIREADY_CONTEXT_URL`, `KIREADY_PORTAL_URL`, `NEXT_PUBLIC_KIREADY_PORTAL_URL`, `KIREADY_STATE_SECRET`, `KIREADY_TOKEN_ENCRYPTION_KEY` |
| Credits | `ADBOT_CREDIT_PROVIDER`, `WAIZR_CREDIT_API_URL`, `WAIZR_CREDIT_CLIENT_ID`, `WAIZR_CREDIT_CLIENT_SECRET`, `WAIZR_CREDIT_TIMEOUT_MS` |
| Creatives | `CREATIVE_ASSET_PROVIDER_*`, `CREATIVE_ASSET_OPENROUTER_*`, `CREATIVE_ASSET_STORAGE_BUCKET`, `OPENROUTER_API_KEY` |
| Texte/KI | `AD_COPY_PROVIDER`, `AD_COPY_OPENAI_*`, `AD_COPY_TOGETHER_*`, `OPENAI_API_KEY`, `TOGETHER_API_KEY`, `CAMPAIGN_IDEA_EXTRACT_MODEL`, `PLATFORM_LIBRARY_CAPTION_MODEL` |
| OpenAI Ads | `OPENAI_ADS_TOKEN_ENCRYPTION_KEY` |
| Sonstiges | `ORGANIC_BOOST_DELIVERY_WATCHDOG`, `SCRAPINGBEE_API_KEY`, `CHATGPT_AD_LIBRARY_UPLOADER_USER_ID`, `FUNNEL_SITE_URL` |

Staging und Produktion verwenden getrennte Supabase-Projekte, Meta-Apps und Secrets. Die Produktionsdatenbank ist das Supabase-Projekt „Adbot01“ (`aalmikwjyhdcmfeblofn`).

## 8. Weiterführende Dokumente

| Thema | Dokument |
|---|---|
| **Risiken und offene Befunde** | `docs/audits/ARCHITECTURE_RISKS_2026-09-29.md` |
| Leitplanken für Meta-Writes | `docs/meta-automation/META_WRITE_COLLATERAL_GUARDRAILS.md` |
| Write-Control-Plane (Konzept) | `docs/meta-automation/WRITE_CONTROL_PLANE_ARCHITECTURE.md` — Achtung: nennt teils RPC-Namen aus der Entwurfsphase (`claim_meta_mutation_plan`, `assert_meta_mutation_guard`), die es so nicht gibt; maßgeblich ist Abschnitt 3.3 oben |
| Meta-Write-API-Vertrag | `docs/meta-automation/META_WRITE_API_CONTRACT.md` |
| Beitrag-Push | `docs/meta-automation/ORGANIC_POST_BOOST.md`, `ORGANIC_POST_BOOST_LIVE_TEST.md` |
| Meta-Verbindung | `docs/meta-automation/META_CONNECT_LIVE_CONTRACT.md`, `META_ASSET_EXTEND.md`, `META_ASSET_PRUNE.md` |
| Budget | `docs/meta-automation/META_BUDGET_PLANNER.md`, `docs/strategy/CROSS_PLATFORM_BUDGET_STRATEGY.md` |
| Creatives | `docs/meta-automation/CREATIVE_GENERATION_PHASE1.md` … `PHASE8.md`, `CREATIVE_ASSET_PROVIDER.md`, `MEDIA_LIBRARY_AND_INSPIRATION_VAULT.md` |
| Funnel | `docs/customer/LEAD_FUNNEL_LIVE_SETUP.md`, `docs/meta-automation/FUNNEL_URL_SPLIT.md` |
| Credits | `docs/billing/WAIZR_CREDIT_SERVICE_ADAPTER.md` |
| OpenAI Ads | `docs/openai-ads/OPENAI_ADS_CONNECTOR.md`, `SAFE_PAUSED_DAILY_LAUNCH.md` |
| Geo | `docs/campaign-geo/CAMPAIGN_GEO_TARGETING.md` |
| Frühere Prüfung | `docs/audits/SYSTEM_INTEGRITY_2026-09-10.md` |
