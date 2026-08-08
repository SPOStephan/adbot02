# Adbot Funnel

Arbeitskopie des Funnel-Builders im Adbot-Monorepo (`apps/adbot-funnel`).

- Quelle ursprünglich: `SPOStephan/social-recruiting-funnel` @ `598f6e1`
- Separates Deploy-Repo optional: `SPOStephan/adbot-funnel`
- **Manus entfernt:** Admin-Login per E-Mail/Passwort (JWT), Storage über Supabase

## Erforderliche Env

Siehe `.env.example`: `JWT_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `SUPABASE_*`, optional Resend.

## Nächste Schritte

- Adbot-Navigation / `funnel.adbot.one`
- Mandantenfähigkeit an Adbot-User
- DOI + Meta-Conversion-Schalter
- Freebie-Builder unter `freebie.adbot.one`
