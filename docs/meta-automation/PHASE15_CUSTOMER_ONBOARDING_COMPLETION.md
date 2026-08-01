# Phase 15 — Customer Onboarding und kontrollierter Active Launch

**Stand:** 1. August 2026

**Autor:** Manus AI

**Status:** Implementiert und vollständig lokal validiert; **nicht deployed**, keine Staging-Migration angewendet und kein Meta-Remote-Write ausgeführt.

## Ergebnis

Phase 15 ergänzt die vorhandene Meta-Control-Plane um einen kundenbedienten, weiterhin fail-closed Onboarding- und Launch-Pfad. Die erfolgreiche Verbindung mit minimalem `ads_management`-Scope ist dabei nur eine notwendige Voraussetzung. Sie aktiviert weder Autonomie noch `ALLOW` und erzeugt keinen Launch-Plan.

| Bereich | Implementierter Vertrag |
|---|---|
| Domain | Registrierung und Bestätigung sind getrennte, tenantgebundene Kommandos. Ein Customer Launch akzeptiert ausschließlich den **exakt bestätigten Ziel-Host**; die registrierbare Domain erweitert diesen Scope nicht. |
| Objective-Blueprint | Draft und Aktivierung sind getrennt. Payload, Required Inputs und Meta-Felder werden per Allowlist, Größenlimit und Sensitive-Key-Sperre validiert. Aktivierung verlangt EUR und `ads_management`. |
| Vorhandenes Meta-Creative | Der Browser übergibt nur eine synchronisierte Creative-ID. URL, Hash und Bytes werden serverseitig aus dem aktuellen tenantgebundenen Sync aufgelöst. Der Download erlaubt nur HTTPS-Meta-CDN-Hosts, keine Redirects und höchstens 10 MiB; MIME, Dateistruktur, Dimensionen und SHA-256 werden geprüft. |
| Privater Storage | Bucket und Objektpfad werden serverseitig gehärtet und nach der Konfiguration erneut auf `public = false` verifiziert. Tenant-, Account- und Hash-Pfadbestandteile werden vor jedem Storage-Zugriff validiert. |
| Active Launch | Der Browser erhält weder Read-Lease noch Policy-, Snapshot- oder interne Account-IDs. Der Server erwirbt die Lease und der DB-Wrapper erzwingt aktuellen Sync, EUR, `ads_management`, Policy, Kill-Switch, Exposure-Snapshot, Domain, Blueprint, Asset und explizite Kundenbestätigung. |
| Dashboard | Domain, Blueprint, Creative-Import und Launch sind als getrennte Schritte sichtbar. Die Creative-Auswahl nutzt einen engen JWT-/Tenant-geprüften Read-RPC und gibt keine private Bild-URL oder `content`-Projektion an den Browser aus. |

## Defense in Depth

Die neue Datenbankmigration `20260729250000_meta_customer_onboarding.sql` hält alle mutierenden Onboarding- und Launch-RPCs auf `service_role`. Nur der minimale Listing-RPC für aktuelle importierbare Creative-IDs ist für `authenticated` freigegeben; `anon` und `service_role` besitzen dafür bewusst kein Execute-Grant. Der Listing-RPC verwendet `auth.uid()`, Account-Ownership, aktuellen erfolgreichen EUR-Sync, `ads_management`, `source = 'meta'`, `is_current` und die identische Sync-ID.

| Fail-closed-Grenze | Abgelehnter Zustand |
|---|---|
| Identität | Fehlende User-/Account-/Objekt-ID, Cross-Tenant-Zugriff oder widerrufenes Konto |
| Meta-Bereitschaft | Fehlender `ads_management`-Scope, Nicht-EUR-Konto, fehlgeschlagener oder älter als zwei Stunden gewordener Marketing-Sync |
| Creative-Import | Browser-URL, fremdes/stales Creative, Nicht-Meta-Quelle, abweichende Quell-Sync-ID, nicht erlaubter CDN-Host, Redirect, übergroße oder strukturell ungültige Bilddatei |
| Domain | Ziel-URL ohne HTTPS, ungültiger Host oder Geschwister-Subdomain unter derselben registrierbaren Domain |
| Policy und Budget | Keine aktive kundenbestätigte Policy, ungültige EUR-Caps, Budgetlimit, Exposure- oder Cooldown-Verletzung |
| Launch | Fehlender aktueller COMPLETE-Snapshot, abweichende Policy-/Sync-Identität, fehlende Readiness, Kill-Switch ungleich `ALLOW` oder fehlende ausdrückliche Launch-Bestätigung |
| Idempotenz | Wiederholte Domain-, Blueprint-, Asset- oder Launch-Kommandos erzeugen keine duplizierte fachliche Wirkung; Audit- und Exposure-Verträge bleiben kanonisch. |

Der Abschlussreview hat mehrere Randbedingungen zusätzlich gehärtet: unbekannte Top-Level-Felder werden abgelehnt, der Customer Launch ist auf Exact Host begrenzt, vorhandene öffentliche Storage-Buckets werden vor Upload aktiv privatisiert und verifiziert, Creative-Importe sind an den exakt vom Server gelesenen Marketing-Sync gebunden, und das Dashboard liest keine privilegierte Creative-`content`-Spalte mehr. Meta dokumentiert `image_hash`, `image_url` und `thumbnail_url` als lesbare AdCreative-Felder; ein vorhandener accountlokaler Hash kann wiederverwendet werden, andernfalls bleibt der validierte Uploadpfad über AdImage maßgeblich.[1] [2]

## Verifikation

Alle Prüfungen wurden nach den letzten Security-Korrekturen erneut in einer gemeinsamen Abschlussmatrix ausgeführt. Der Produktions-Build verwendete ausschließlich nicht geheime lokale Platzhalter für die öffentlichen Supabase-Variablen und kontaktierte kein Staging-System.

| Prüfung | Ergebnis |
|---|---|
| `git diff --check` | Bestanden |
| `npm run lint` | Bestanden |
| `npm run test:meta-all` | Bestanden |
| `npm run test:meta-budget-planner` | Bestanden |
| `npm run test:meta-creative-assets` | Bestanden |
| Fresh-PostgreSQL-Migrations- und Rollenprüfung | Bestanden, einschließlich Owner-/Cross-Tenant-, Exact-Host-, Current-Sync-, TOCTOU-, Grant-, Audit- und Idempotenzfällen |
| `npm run build` | Bestanden; alle bestehenden und vier neuen Automation-Routen erfolgreich kompiliert und typisiert |

## Betriebsstatus und nächstes Gate

> **Es wurde kein Deployment, keine Migration auf einer verbundenen Supabase-Instanz, kein Kill-Switch-Wechsel, keine Policy-Aktivierung, kein Launch-Plan und kein Meta-Write ausgeführt.** Der sichere Betriebszustand bleibt `FREEZE_WRITES` beziehungsweise ohne ausdrückliches `ALLOW` nicht claimbar.

Als nächster kontrollierter Schritt kann der Checkpoint zunächst in einer isolierten Staging-Umgebung deployed und die Migration angewendet werden. Danach müssen Account-Tagescap, Kampagnen-Tagescap, Landingpage samt exakt zu bestätigendem Host, Objective, Region, Zielgruppe und Brand-Quelle konkret bestätigt werden. Domain, Blueprint und Asset werden weiterhin bei `FREEZE_WRITES` vorbereitet. Policy-Aktivierung, Wechsel auf `ALLOW` und Materialisierung genau eines Launch-Plans bleiben ein separates, ausdrücklich zu bestätigendes Gate.

## Referenzen

[1]: https://developers.facebook.com/documentation/ads-commerce/marketing-api/reference/ad-creative "Meta for Developers — AdCreative Reference"
[2]: https://developers.facebook.com/documentation/ads-commerce/marketing-api/reference/ad-image "Meta for Developers — AdImage Reference"
