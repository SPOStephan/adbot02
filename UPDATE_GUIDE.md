# AdPilot-Update übernehmen

**Autor:** Manus AI  
**Stand:** 22. Juli 2026

Dieses Paket ersetzt die bisherige Testseite durch das erste geprüfte Produktinkrement. Es enthält Supabase-Registrierung und -Anmeldung, einen geschützten Dashboard-Bereich, eine responsive Portal-Oberfläche sowie eine sichere Basis für spätere Werbeplattform-Connectoren.

## Was du einmalig erledigen musst

| Schritt | Ort | Ergebnis |
|---|---|---|
| 1. Projektdateien hochladen | GitHub | Vercel startet automatisch einen neuen Build |
| 2. Sicherheitsmigration ausführen | Supabase SQL Editor | Auth-Nutzer und Connector-Rechte sind korrekt eingerichtet |
| 3. Auth-URLs eintragen | Supabase URL Configuration | Bestätigungslinks führen zurück zu deinem Portal |
| 4. Ergebnis prüfen | Vercel-URL | Registrierung, Anmeldung und Dashboard funktionieren |

## 1. Dateien in GitHub übernehmen

Entpacke `adpilot-product-increment-1.zip`. Öffne dein bestehendes, funktionierendes GitHub-Repository und wähle **Add file → Upload files**. Ziehe den **Inhalt des entpackten Ordners** in das Upload-Fenster, nicht den äußeren Ordner selbst. GitHub überschreibt gleichnamige Dateien und ergänzt die neuen Ordner. `node_modules` und `.next` sind bewusst nicht im Paket enthalten.

Speichere den Upload mit einer Commit-Nachricht wie `Add authentication and dashboard`. Da dein Vercel-Projekt bereits mit diesem Repository verbunden ist, sollte danach automatisch ein neues Deployment starten.[1]

> In Vercel müssen weiterhin nur `NEXT_PUBLIC_SUPABASE_URL` und `NEXT_PUBLIC_SUPABASE_ANON_KEY` vorhanden sein. Ein früher eingetragener `NEXTAUTH_SECRET` wird von diesem Projekt nicht mehr verwendet und kann entfernt werden.

## 2. Supabase-Migration ausführen

Öffne im entpackten Paket die Datei:

```text
supabase/migrations/20260722_auth_and_connector_security.sql
```

Kopiere ihren vollständigen Inhalt in **Supabase → SQL Editor → New query** und klicke einmal auf **Run**. Die Migration ergänzt einen Trigger für neue Auth-Nutzer und verschärft die Row-Level-Security der Connector-Tabelle. Row Level Security sorgt dafür, dass Datenbankzeilen anhand der angemeldeten Nutzeridentität freigegeben oder gesperrt werden können.[2]

Die Migration ist so geschrieben, dass sie nach dem bereits ausgeführten Basisschema laufen kann. Bei Erfolg zeigt Supabase eine Erfolgsmeldung ohne Ergebniszeilen.

## 3. Supabase-Auth-URLs konfigurieren

Öffne in Supabase den Bereich **Authentication → URL Configuration**. Trage als **Site URL** deine aktuelle Produktionsadresse ein, beispielsweise:

```text
https://DEIN-PROJEKT.vercel.app
```

Ergänze bei **Redirect URLs** mindestens:

```text
https://DEIN-PROJEKT.vercel.app/auth/callback
```

Für lokale Entwicklung kannst du zusätzlich `http://localhost:3000/auth/callback` erlauben. Supabase verwendet diese Positivliste, um Nutzer nach E-Mailbestätigung oder OAuth sicher zu einer erlaubten App-Adresse zurückzuführen.[3]

## 4. Ergebnis prüfen

Warte in Vercel auf den grünen Status **Ready** und öffne danach deine Produktionsadresse. Die folgende Prüfung dauert ungefähr zwei Minuten:

| Prüfung | Erwartetes Ergebnis |
|---|---|
| Startseite öffnen | Neue dunkle AdPilot-Landingpage erscheint |
| `/registrieren` öffnen | Registrierungsformular erscheint |
| Testkonto anlegen | Supabase erstellt einen Auth-Nutzer oder versendet eine Bestätigungs-E-Mail |
| E-Mail bestätigen | Rückleitung zu `/auth/callback` und anschließend zum Dashboard |
| Abmelden | Rückleitung zur Startseite |
| `/dashboard` ohne Sitzung öffnen | Automatische Weiterleitung zu `/login` |
| `/api/health` öffnen | JSON mit `"status":"ok"` |

Die serverseitige Session-Erneuerung folgt dem von Supabase empfohlenen SSR-Muster mit Cookies und geschützter Weiterleitung.[4]

## Was bewusst noch nicht aktiviert ist

Die angezeigten Leistungswerte sind als **Demoansicht** gekennzeichnet. Es werden noch keine realen Kampagnendaten geladen, keine Werbekonten verbunden und keine Anzeigen gestartet. Plattform-Credentials gehören erst in Vercel, nachdem die jeweilige Developer-App eingerichtet und geprüft wurde. Echte OAuth-Tokens werden im aktuellen Stand noch nicht gespeichert.

Der nächste klar abgegrenzte Baustein sollte ein **read-only Meta-Ads-Connector** sein: Meta-OAuth, sichere Tokenablage, Auswahl eines Werbekontos und Import vorhandener Kampagnen. Schreibende Aktionen wie Kampagnenstart oder Budgetänderung folgen erst nach erfolgreichem Test dieses Lesezugriffs.

## Technischer Prüfstatus des Pakets

| Prüfung | Ergebnis |
|---|---|
| Frische Installation mit `npm ci` | Erfolgreich |
| ESLint | Erfolgreich |
| Next.js-Produktions-Build | Erfolgreich |
| `npm audit --omit=dev` | 0 bekannte Schwachstellen |
| Öffentlicher Health-Endpunkt | HTTP 200 |
| Connector-Endpunkt ohne Sitzung | HTTP 401 wie vorgesehen |
| Dashboard ohne Sitzung | Weiterleitung zur Anmeldung |

## References

[1]: https://vercel.com/docs/deployments/git "Vercel – Git Deployments"
[2]: https://supabase.com/docs/guides/database/postgres/row-level-security "Supabase – Row Level Security"
[3]: https://supabase.com/docs/guides/auth/redirect-urls "Supabase – Redirect URLs"
[4]: https://supabase.com/docs/guides/auth/server-side/creating-a-client "Supabase – Creating SSR clients"
