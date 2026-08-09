# Adbot Freebie

Arbeitskopie des Freebie-Builders im Adbot-Monorepo (`apps/adbot-freebie`).

- Separates Deploy-Repo (Vercel, geplant): `SPOStephan/adbot-freebie`
- Pattern analog Funnel: Express API + Vite SPA, Adbot-SSO, kein separates Kunden-Login
- Spiegelung: Workflow `.github/workflows/sync-adbot-freebie.yml` pusht `apps/adbot-freebie` → `adbot-freebie`

## Produktziel (MVP)

1. Freebie hochladen (Datei → Bunny.net Storage/CDN)
2. Öffentliche Lead-Seite (`/o/:slug`)
3. E-Mail-Bestätigung per **DOI-Link** oder **OTP** (Angebotseinstellung)
4. Nach Bestätigung: Download-Link per Resend + Browser

Media Library: Postgres-Katalog `media_assets` + Bunny-Bytes. Funnel-/Meta-Creatives können später denselben Katalog nutzen.

## Spiegel-Repo einmalig freischalten

1. GitHub PAT mit Schreibrecht auf `adbot-freebie`
2. In **`adbot02`** → Secrets → Actions: **`ADBOT_FREEBIE_SYNC_TOKEN`**
3. Actions → **Sync adbot-freebie mirror** → **Run workflow**
4. Vercel-Projekt an `adbot-freebie` hängen (Root `/`, Output `public`, Framework leer)

## Erforderliche Env (Freebie-App)

Siehe `.env.example`:

| Variable | Zweck |
|---|---|
| `JWT_SECRET` | Session-Cookie |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | Plattform-Admin (Fallback) |
| `FREEBIE_SSO_SECRET` | Identisch mit Portal |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | Offers/Leads/Media |
| `BUNNY_*` | Storage Zone + CDN |
| `RESEND_API_KEY` / `MAIL_FROM` | DOI/OTP/Delivery |
| `PUBLIC_APP_URL` | DOI-Links (`https://freebie.adbot.one`) |

## Portal-Integration (adbot02)

| Portal | Freebie |
|---|---|
| `NEXT_PUBLIC_FREEBIE_URL` | Default `https://freebie.adbot.one` |
| `FREEBIE_SSO_SECRET` | ≥32 Zeichen, identisch |
| `/api/freebie/sso` | Token → Freebie `/api/auth/adbot-sso` |
| Dashboard-Card + Nav | „Freebie öffnen“ (neuer Tab) |

SSO-Purpose: `freebie_admin_sso` (getrennt von Funnel).

## SQL

Migration: `supabase/migrations/20260809180000_freebie_core.sql`

## Smoke

- `/api/health` → `{"ok":true,"service":"adbot-freebie"}`
- Portal: Freebie öffnen → Session auf Freebie → `/admin`

## Nächste Schritte

- Deploy-Repo `adbot-freebie` anlegen + Vercel + DNS `freebie.adbot.one`
- Bunny Zone/Pull Zone produktiv verbinden
- Optional: iframe-Embed im Dashboard statt neuer Tab
- Media Library UI als eigener Bereich (consumers: Freebie, Funnel, Meta)
