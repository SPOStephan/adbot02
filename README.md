# AdPilot – Multi-Platform Ad Portal

AdPilot ist die portable Grundlage für ein kanalübergreifendes Marketing-Portal auf **Next.js, Supabase und Vercel**. Der Code bleibt in einem eigenen GitHub-Repository und kann unabhängig weiterentwickelt oder zu einem anderen Hosting-Anbieter migriert werden.

## Aktueller Funktionsumfang

| Bereich | Stand |
|---|---|
| Öffentliche Landingpage | Fertig |
| Registrierung mit Supabase Auth | Fertig |
| Anmeldung und Abmeldung | Fertig |
| Serverseitig geschütztes Dashboard | Fertig |
| Responsive Dashboard-Oberfläche | Fertig, Kennzahlen klar als Demo markiert |
| Connector-Status-API | Fertig und authentifiziert |
| Meta OAuth und Compliance-Callbacks | Serverseitig implementiert, Aktivierung und Pilot ausstehend |
| Google-/TikTok-/Pinterest-OAuth | Vorbereitet, noch nicht aktiviert |
| Reale Kampagnendaten und Kampagnenstarts | Noch nicht implementiert |
| KI-Creatives und Optimierungsagent | Noch nicht implementiert |

> Kampagnenstarts und Budgetänderungen werden später nur mit expliziten Freigaben und technischen Leitplanken freigeschaltet.

## Architektur

| Komponente | Technologie |
|---|---|
| Web-App | Next.js 16 mit App Router und TypeScript |
| Styling | Tailwind CSS 4 |
| Authentifizierung | Supabase Auth mit SSR-Cookies |
| Datenbank | Supabase PostgreSQL mit Row Level Security |
| Hosting | Vercel |
| Plattform-Connectoren | Modulare, serverseitige Adapter |

Portal-Login und Werbeplattform-Autorisierung sind bewusst getrennt. Ein Nutzer meldet sich über **Supabase Auth** im Portal an. Meta, Google und weitere Werbekonten werden später über jeweils eigene OAuth-Connectoren verknüpft.

## Umgebungsvariablen

Für den Meta-Connector werden in Vercel die folgenden Variablen benötigt:

| Variable | Sichtbarkeit | Zweck |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | öffentlich | Supabase-Projekt-URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` oder `NEXT_PUBLIC_SUPABASE_ANON_KEY` | öffentlich | Browser- und SSR-Authentifizierung |
| `SUPABASE_SERVICE_ROLE_KEY` | nur Server | Connector-Daten trotz RLS schreiben und Compliance-Löschungen ausführen |
| `META_APP_ID` | nur Server | Meta-App-ID |
| `META_APP_SECRET` | nur Server | Codeaustausch und Prüfung von Meta-`signed_request` |
| `META_LOGIN_CONFIG_ID` | nur Server | ID der Facebook-Login-for-Business-Konfiguration |
| `META_STATE_SECRET` | nur Server | HMAC-Signatur des zehn Minuten gültigen OAuth-State |
| `META_TOKEN_ENCRYPTION_KEY` | nur Server | AES-256-GCM-Verschlüsselung der Zugriffstokens |

`META_STATE_SECRET` muss mindestens 32 Zeichen lang sein. `META_TOKEN_ENCRYPTION_KEY` muss ein Base64-kodierter 32-Byte-Schlüssel sein; er kann lokal mit `openssl rand -base64 32` erzeugt und anschließend ausschließlich in Vercel gespeichert werden. Die Datei `.env.example` enthält nur Namen und sichere Platzhalter. Geheime Werte dürfen niemals mit `NEXT_PUBLIC_` beginnen oder in GitHub gespeichert werden.

## Supabase-Migration

Nach dem ursprünglichen Basisschema müssen die Migrationen in dieser Reihenfolge im Supabase SQL Editor ausgeführt werden:

```text
supabase/migrations/20260722_auth_and_connector_security.sql
supabase/migrations/20260725_meta_connector_oauth.sql
```

Die erste Migration synchronisiert Auth-Nutzer und sichert die bestehende Connector-Tabelle mit RLS ab. Die zweite ergänzt AES-GCM-Tokenfelder, Meta-Business- und Asset-Metadaten, einen eindeutigen Connector pro Nutzer und Plattform sowie minimale, nicht rückrechenbare Statusnachweise für Datenlöschungsanfragen. Browserrollen können keine Tokenfelder lesen oder schreiben.

## Lokale Prüfung

```bash
npm ci
npm run lint
npm run test:meta-security
npm run build
npm run dev
```

Die App stellt außerdem folgende Diagnose- und Connector-Endpunkte bereit:

| Route | Zugriff | Zweck |
|---|---|---|
| `/api/health` | öffentlich | Deployment- und Konfigurationsstatus ohne Geheimnisse |
| `/api/connectors` | nur angemeldet | Status der eigenen Plattformverbindungen ohne Tokens |
| `/api/connectors/meta/start` | nur angemeldet | Startet Facebook Login for Business mit signiertem State |
| `/api/connectors/meta/callback` | nur angemeldet | Prüft State, tauscht den Code aus und speichert den Token verschlüsselt |
| `/api/connectors/meta/deauthorize` | Meta-Webhook | Validiert `signed_request` und entfernt die Verbindung |
| `/api/connectors/meta/data-deletion` | Meta-Webhook beziehungsweise Status-Link | Löscht Verbindungsdaten und liefert Bestätigungscode plus Statusseite |

## Sicherheitsgrenzen des aktuellen Stands

Meta-Zugriffstokens werden ausschließlich im serverseitigen Callback verarbeitet und mit **AES-256-GCM**, zufälligem Initialisierungsvektor und Authentifizierungstag gespeichert. Der Browser erhält weder Token noch Service-Role-Schlüssel. OAuth-State ist HMAC-signiert, an den angemeldeten Supabase-Nutzer gebunden und zehn Minuten gültig. Deautorisierungs- und Datenlöschungsaufrufe werden mit dem Meta App Secret kryptografisch validiert. Plattform-Credentials bleiben ausschließlich in Vercel-Umgebungsvariablen.

## Nächster Produktbaustein

Als nächstes folgen die kontrollierte Aktivierung dieses Meta-Fundaments: Supabase-Migration anwenden, serverseitige Vercel-Variablen hinterlegen, den Dashboard-Button anbinden und den OAuth-Ablauf mit dem internen Business-Portfolio testen. Danach werden freigegebene Werbekonten, Seiten und Instagram-Konten synchronisiert und zunächst ausschließlich read-only Kampagnendaten geladen. Schreibende Aktionen bleiben bis zur separaten Freigabe deaktiviert.
