# Adbot Funnel

Arbeitskopie des Funnel-Builders im Adbot-Monorepo (`apps/adbot-funnel`).

- Quelle ursprünglich: `SPOStephan/social-recruiting-funnel` @ `598f6e1`
- Separates Deploy-Repo optional: `SPOStephan/adbot-funnel`
- **Manus entfernt:** Admin-Login per E-Mail/Passwort (JWT), Storage über Supabase

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
