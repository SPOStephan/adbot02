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

Konfiguration:
- **Sync-Workflow** baut `public/` + `api/index.js` und committed sie ins Deploy-Repo (Vercel hat den Build zuvor oft übersprungen → 3s Deploy ohne Function → 404)
- `vercel.json`: Rewrite `/(.*) → /api`, Install/Build nur Platzhalter
- Entry: `api/index.js` (CJS-Bundle)

| Einstellung | Wert |
|---|---|
| Root Directory | `/` |
| Output Directory | nicht auf `dist` setzen |

**URL:** Im Vercel-Projekt unter **Deployments → Visit** die Production-URL öffnen.  
`https://adbot-funnel.vercel.app` ist oft nicht zugewiesen (404).  
Wenn **Deployment Protection** aktiv ist, brauchst du Vercel-Login oder Protection temporär aus.

## Erforderliche Env

Siehe `.env.example`: `JWT_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `SUPABASE_*`, optional Resend.

## Integration in Adbot

- Dashboard-Nav + Workspace-Card → `NEXT_PUBLIC_FUNNEL_URL` (Default `https://funnel.adbot.one`)
- Mandantenfelder: `funnels.owner_user_id` / `owner_email` (Migration `20260808210000_funnel_owner_binding.sql`)
- Admin-API: `funnel.setOwner`, optional Filter `funnels({ ownerUserId })`
- Meta: `metaTracking.conversionTrigger` = `submit` | `doi` (Default `submit`; bei `doi` keine Conversion beim Absenden)

## Nächste Schritte

- Adbot-SSO in den Funnel-Admin (Owner automatisch setzen)
- DOI-Mailfluss + Conversion nach Bestätigung
- Freebie-Builder unter `freebie.adbot.one`
