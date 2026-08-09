# Adbot Funnel

Arbeitskopie des Funnel-Builders im Adbot-Monorepo (`apps/adbot-funnel`).

- Quelle ursprünglich: `SPOStephan/social-recruiting-funnel` @ `598f6e1`
- Separates Deploy-Repo (Vercel): `SPOStephan/adbot-funnel`
- **Manus entfernt:** Admin-Login per E-Mail/Passwort (JWT), Storage über Supabase
- Spiegelung: Workflow `.github/workflows/sync-adbot-funnel.yml` pusht `apps/adbot-funnel` → `adbot-funnel`

## Spiegel-Repo einmalig freischalten

1. GitHub → **Settings → Developer settings → Personal access tokens**
   - Fine-grained: nur Repo `adbot-funnel`, Permission **Contents: Read and write**
   - oder Classic: Scope **`repo`**
2. In **`adbot02`** → Settings → Secrets and variables → Actions  
   Secret-Name: **`ADBOT_FUNNEL_SYNC_TOKEN`** → Token einfügen
3. Actions → **Sync adbot-funnel mirror** → **Run workflow** (erster Sync)
4. Danach läuft der Sync automatisch bei Änderungen unter `apps/adbot-funnel/**` auf `main`
5. Vercel (Projekt an `adbot-funnel`) redeployt nach dem Push

## Vercel-Projekt (Deploy-Repo `adbot-funnel`)

Architektur (eine klare Trennung):

| Schicht | Zuständig |
|---|---|
| `public/` (Vite-Build) | CDN: HTML/JS/CSS |
| `api/index.js` (Express-Bundle) | Nur `/api/*` (+ Legacy `/manus-storage/*`) |
| `vercel.json` rewrites | `/api/*` → Function; alles andere → `/index.html` (Rewrite, **kein** Redirect) |

Build:
- Vercel führt `pnpm install` + `pnpm run vercel-build` aus
- Sync-Workflow baut zusätzlich vor und committed Artefakte (Absicherung)

| Einstellung | Wert |
|---|---|
| Root Directory | `/` |
| Framework Preset | Other / leer (nicht Vite mit Output `dist`) |
| Output Directory | `public` (steht in `vercel.json`) |
| Deployment Protection | **für Production aus** — sonst SSO-Redirect-Loops auf `*.vercel.app` |

**URL:** Im Vercel-Projekt unter **Deployments → Visit** die Production-URL öffnen.  
Alte Deployment-URLs (`*-xxxx-fportal.vercel.app`) veralten.  
Smoke: `/api/health` → `{"ok":true,"service":"adbot-funnel"}`.

## Erforderliche Env

Siehe `.env.example`: `JWT_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `SUPABASE_*`, optional Resend.

## Integration in Adbot

- Dashboard-Nav + Workspace-Card → `NEXT_PUBLIC_FUNNEL_URL` (Default `https://funnel.adbot.one`)
- Mandantenfelder: `funnels.owner_user_id` / `owner_email` (Migration `20260808210000_funnel_owner_binding.sql`)
- Admin-API: `funnel.setOwner`, optional Filter `funnels({ ownerUserId })`
- Meta: `metaTracking.conversionTrigger` = `submit` | `doi` (Default `submit`; bei `doi` keine Conversion beim Absenden)

## Adbot-SSO (Kunden-Login per Link)

1. In **beiden** Vercel-Projekten (`adbot02` und `adbot-funnel`) denselben Wert setzen:
   - `FUNNEL_SSO_SECRET` (≥32 Zeichen, z. B. `openssl rand -base64 48`)
2. Redeploy beider Projekte
3. Im Adbot-Dashboard: **Funnel öffnen** → `/api/funnel/sso` → Funnel setzt Session → `/admin`
4. Kunde sieht/bearbeitet nur Funnel mit seiner `owner_user_id`
5. Plattform-Admin weiterhin per `ADMIN_EMAIL`/`ADMIN_PASSWORD` (sieht alle Funnel)

## Nächste Schritte

- DOI-Mailfluss + Conversion nach Bestätigung
- Optional: Funnel im Dashboard per iframe statt neuer Tab
- Freebie-Builder unter `freebie.adbot.one`
