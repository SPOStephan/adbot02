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
| Meta-/Google-/TikTok-/Pinterest-OAuth | Vorbereitet, noch nicht aktiviert |
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

Für den aktuellen Stand werden in Vercel benötigt:

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
```

Alternativ unterstützt der Code den neueren Variablennamen `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. Die geplanten, serverseitigen Plattformvariablen sind in `.env.example` dokumentiert. Geheime Werte dürfen niemals mit `NEXT_PUBLIC_` beginnen oder in GitHub gespeichert werden.

## Supabase-Migration

Nach dem ursprünglichen Basisschema muss einmal die folgende Migration im Supabase SQL Editor ausgeführt werden:

```text
supabase/migrations/20260722_auth_and_connector_security.sql
```

Sie synchronisiert neue Auth-Nutzer mit `public.users` und schränkt Connector-Zugriffe so ein, dass OAuth-Tokens nicht aus dem Browser geschrieben oder verändert werden können.

## Lokale Prüfung

```bash
npm install
npm run lint
npm run build
npm run dev
```

Die App stellt außerdem zwei Diagnose-Endpunkte bereit:

| Route | Zugriff | Zweck |
|---|---|---|
| `/api/health` | öffentlich | Deployment- und Konfigurationsstatus ohne Geheimnisse |
| `/api/connectors` | nur angemeldet | Status der eigenen Plattformverbindungen ohne Tokens |

## Sicherheitsgrenzen des aktuellen Stands

Die bestehenden Connector-Tabellen sind vorbereitet, aber **echte OAuth-Tokens werden noch nicht geschrieben**. Vor der ersten realen Plattformanbindung wird eine serverseitige Tokenverschlüsselung oder ein geeigneter Secret Store ergänzt. Die Plattform-Credentials bleiben ausschließlich in Vercel-Umgebungsvariablen.

## Nächster Produktbaustein

Als nächstes sollte genau **ein** Connector vollständig umgesetzt werden, idealerweise Meta Ads: Developer-App, OAuth mit signiertem `state`, serverseitiger Tokenaustausch, verschlüsselte Speicherung, Kontenauswahl und read-only Kampagnensynchronisation. Erst wenn dieser Ablauf stabil getestet ist, folgt eine schreibende Kampagnenfunktion.
