# Adbot – Architektur-Risiken und offene Befunde

**Prüfdatum:** 29. September 2026
**Basis:** `main` nach PR #365 (`5822b45`)
**Art der Prüfung:** Nur lesend. Code und SQL-Migrationen wurden geprüft, dazu Lese-Abfragen auf die Produktionsdatenbank (Supabase „Adbot01“). **Es wurde nichts geändert**, weder Code noch Daten noch laufende Meta-Kampagnen.

Jeder Befund wurde im Code verifiziert und bewertet: **BESTÄTIGT**, **TEILWEISE** (Kern richtig, Ausmaß anders als vermutet) oder **WIDERLEGT**. Die Fix-Vorschläge sind Empfehlungen und noch nicht umgesetzt. Änderungen an Meta-Write-Pfaden erfolgen nur nach `docs/meta-automation/META_WRITE_COLLATERAL_GUARDRAILS.md` und mit Smoke-SQL.

## Übersicht nach Priorität

| # | Befund | Bewertung | Priorität |
|---|---|---|---|
| 1 | KI-Ready-Login: Session per E-Mail, Vorab-Übernahme über unbestätigte Registrierung möglich | BESTÄTIGT | **Hoch (Sicherheit)** |
| 2 | Kampagnenstart und Beitrag-Push verbrauchen keine Credits | BESTÄTIGT | **Hoch (Umsatz)** |
| 3 | Hängende Meta-Schritte nach Vercel-Abbruch bleiben unsichtbar – **live 9 Fälle** | BESTÄTIGT | **Hoch (Betrieb)** |
| 4 | Dashboard-Gate: fail-open, per Suspense nicht blockierend, API-Routen ohne Gate | BESTÄTIGT | Mittel |
| 5 | Globale Queue-Claims und bedingungsloses Lease-Force-Release | TEILWEISE | Mittel |
| 6 | Synchrone Bildgenerierung ohne Host-Allowlist; keine Moderation | BESTÄTIGT | Mittel |
| 7 | Funnel-SSO: Replay nur im Speicher, gemeinsames Secret | TEILWEISE | Mittel |
| 8 | Kundendomain fällt bei DNS-Störung von READY auf PENDING_DNS | TEILWEISE | Niedrig |
| 9 | Funnel-Creative-Übergabe: doppelte Generierung möglich | TEILWEISE | Niedrig |
| 10 | Kein CI für Tests/Lint; Architektur-Doku teils veraltet | BESTÄTIGT | Mittel |

---

## 1. KI-Ready-Login: Session per E-Mail statt über die verknüpfte User-ID — BESTÄTIGT

**Befund**
- `src/lib/kiready/complete-login.ts`: Die Verknüpfung wird für `input.userId` gespeichert. Die Session wird danach aber über `establishAdbotSession(input.email)` erzeugt.
- `src/lib/kiready/session.ts`: `admin.auth.admin.generateLink({ type: "magiclink", email })` → `verifyOtp`. Die Session gehört dem Konto, das **diese E-Mail** hat, nicht zwingend dem verknüpften Konto.
- `src/app/auth/kiready/callback/route.ts`: Bei bekannter Identität ist `userId` die verknüpfte ID, aber `email` die **aktuelle** KI-Ready-E-Mail. Die beiden werden nicht miteinander verglichen.
- `findUsersByVerifiedEmail` (`src/lib/kiready/identities.ts`) sucht in `public.users` mit `.ilike("email", email)`.
  - `public.users` wird per Trigger für **jede** Registrierung befüllt, auch für unbestätigte (`supabase/migrations/20260722_auth_and_connector_security.sql`). Das „Verified“ im Namen stimmt also nicht.
  - `ilike` ohne Escaping: `_` und `%` in der E-Mail wirken als Platzhalter.

**Szenarien**
- **Vorab-Übernahme:**
  1. Ein Angreifer registriert sich im Portal mit der E-Mail des Opfers und einem eigenen Passwort und lässt die Registrierung unbestätigt.
  2. Das Opfer meldet sich über KI-Ready an, wird mit diesem Konto verknüpft und bestätigt „verbinden“. Dabei wird kein lokales Passwort abgefragt.
  3. `verifyOtp` bestätigt die E-Mail. Das Opfer arbeitet nun in einem Konto, dessen Passwort der Angreifer kennt.
- **E-Mail-Drift:** Ändert sich die E-Mail bei KI-Ready auf die Adresse eines anderen Adbot-Kontos, öffnet der Login dessen Session.

**Fix-Vorschlag**
- Session für `userId` erzeugen: Die E-Mail aus `auth.users` per ID laden und bei Abweichung abbrechen oder neu verknüpfen lassen.
- Zuordnung per E-Mail nur über exakten Vergleich und nur gegen bestätigte Konten (`email_confirmed_at is not null`).
- Beim Verknüpfen eines bestehenden Kontos einen Nachweis verlangen (Passwort oder OTP).

## 2. Kampagnenstart und Beitrag-Push verbrauchen keine Credits — BESTÄTIGT

**Befund**
- Die Preise stehen in `src/lib/billing/credit-contract.ts` und in `credit_action_costs`. Die Migration `20260808190000_billing_credits_foundation.sql` markiert sie selbst als „Placeholder costs – tune before enforcing gates in product paths“.
- Keine TS- oder SQL-Stelle reserviert die folgenden Keys:

| Aktion | Credits | Abgerechnet? |
|---|---|---|
| `creative.generate_copy_set` | 5 | Ja (`ad-copy/suggest.ts`) |
| `creative.generate_image_master` | 20 | Ja (`creative-assets/enqueue.ts`, `library-generate.ts`) |
| `campaign.launch_chain` | 40 | **Nein** |
| `organic_boost.plan_candidate` | 2 | **Nein** |
| `organic_boost.execute_plan` | 10 | **Nein** |
| `creative.render_placement` | 3 | **Nein** (Funktion nicht genutzt) |
| `creative.inspire_from_upload` | 8 | **Nein** |

- Das Guthaben wird nur angezeigt (`DashboardHeaderChrome`, `DashboardAsideChrome`) und nirgends als Sperre geprüft.

**Fix-Vorschlag**
- Beim Anlegen eines Plans reservieren, mit der Plan-ID als Idempotenzschlüssel.
- Nach erfolgreichem Meta-Write abrechnen (Commit). Bei Fehlschlag oder Kill-Switch freigeben (Release).
- **Wichtig (Guardrails):** Die Reservierung darf AUTO-Pläne nicht dauerhaft festhalten. Bei fehlendem Guthaben muss der Plan einen klaren Endzustand bekommen. Außerdem ist Smoke-SQL Pflicht.
- Vorher mit dem Owner klären, ob Beitrag-Push und Launches bewusst noch gratis sein sollen.

## 3. Unterbrochener Meta-Aufruf: hängende Schritte ohne Erkennung — BESTÄTIGT (live 9 Fälle)

**Wie es sein soll**
- Ein Timeout **innerhalb** der Funktion (Write-Client-Timeout 15 s) führt zu `fail_meta_mutation_execution(..., 'UNKNOWN')`, also `REMOTE_UNKNOWN`. Bei Launches wird das `COMPENSATION_REQUIRED`, sonst `RECONCILING`, mit CRITICAL-Audit-Eintrag. Einen automatischen Retry gibt es bewusst nicht, denn der Write kann angekommen sein.

**Lücke**
- Wenn Vercel die Funktion hart beendet, nachdem `begin_meta_mutation_step_dispatch` gelaufen ist, bleiben die Zustände stehen:
  - Schritt: `RUNNING` / `PRE_DISPATCH`
  - Plan: `EXECUTING`
- Nach Ablauf des Leases (12 min) sieht niemand mehr hin:
  - Der Claim wählt nur `PENDING`- und `RETRYABLE`-Schritte.
  - `recover_interrupted_meta_customer_launches` schließt genau diese Schritte aus.
  - `resume_failed_meta_customer_launch` verlangt Plan-Status `FAILED` und schließt `PRE_DISPATCH` aus.
  - `yield_meta_mutation_execution` wirkt nur an sauberen Schrittgrenzen.
- Es gibt keinen Sweeper, kein CRITICAL-Audit und keinen Alarm.

**Live-Befund (Lese-Abfrage 29.09.2026)**
- 9 Pläne vom Typ `LAUNCH_CHAIN` stehen seit dem 24.08. bis 20.09.2026 in `EXECUTING`. Ihre Schritte stehen auf `RUNNING/PRE_DISPATCH`. Alle gehören zu **einem** Werbekonto (`platform_account_id 7466c3d7-…`).
- Letzter Lease-Ablauf: 20.09.2026 08:15 UTC.
- Hängende Schritte:
  - 3× `create-ad-paused`
  - 2× `validate-creative`
  - 1× `validate-ad-set`
  - 1× `create-creative`
  - 1× `activate-ad`
  - 1× `activate-campaign`
- Das Konto ist dadurch **nicht blockiert**: Seit dem 20.09. liefen dort 19 Launches erfolgreich.
- Offen bleibt, ob bei Meta pausierte Restobjekte (Anzeigen, Creatives) aus diesen Läufen existieren. `activate-*` könnte außerdem tatsächlich aktiviert haben.
- **Bewusst nicht angefasst.** Eine Bereinigung braucht einen Abgleich mit Meta und die ausdrückliche Freigabe des Owners.

Abfrage zum Nachvollziehen (nur lesend):

```sql
select p.id as plan_id, p.action_type, p.status as plan_status, p.lease_expires_at,
       s.step_key, s.operation, s.object_type, s.dispatch_started_at, p.platform_account_id
from public.mutation_plan_steps s
join public.mutation_plans p on p.id = s.plan_id
where s.status = 'RUNNING'
  and s.dispatch_state = 'PRE_DISPATCH'
order by s.dispatch_started_at;
```

**Fix-Vorschlag**
- Im Cron `meta-launch-maintenance` einen Sweeper ergänzen. Er erfasst Schritte mit `RUNNING/PRE_DISPATCH`, deren Lease abgelaufen ist und die keinen Heartbeat mehr haben. Diese überführt er in dieselben Zustände wie `fail_meta_mutation_execution(..., 'UNKNOWN')` und schreibt einen CRITICAL-Audit-Eintrag.
- Die Abfrage oben als Diagnose-SQL ablegen.
- Dem Executor eine Deadline mitgeben: Kurz vor `maxDuration` startet er keinen neuen Dispatch mehr. Das verhindert die meisten Fälle.
- Das betrifft Recovery-Pfade, also gelten die Guardrails und Smoke-SQL ist Pflicht.

## 4. Dashboard-Gate — BESTÄTIGT (Auswirkung anders als vermutet)

**Befund**
- `src/components/RequireDashboardAuth.tsx`: `getKireadyAccessForUser(user.id).catch(() => null)`. Bei einem Fehler ist `access` null, und der Zugang wird gewährt.
  - Das betrifft nur mit KI-Ready verknüpfte Nutzer ohne Berechtigung (gekündigt, abgelaufen) und nur bei einem DB-Fehler.
  - Nicht verknüpfte Nutzer dürfen ohnehin rein.
  - Dasselbe Muster steht in `DashboardHeaderChrome.tsx`.
- **Größer:** Das Gate wird in `DashboardShell` innerhalb von `<Suspense>` **neben** `{children}` gerendert. Die Seite streamt parallel, der Redirect ist also keine harte Sperre.
- **Noch größer:** Keine API-Route prüft `allowDashboard`. Ein gesperrter, aber verknüpfter Nutzer kann die Dashboard-APIs jederzeit direkt aufrufen.
- **Abmildernd:** Kostenpflichtige Aktionen prüfen `assertAdbotPaidActionAllowed`, und das schlägt bei Fehlern sicher fehl (fail-closed).

**Fix-Vorschlag**
- Bei einem Fehler auf eine Fehlerseite umleiten (fail-closed).
- Das Gate im Layout vor `children` abwarten.
- Ein gemeinsames `assertDashboardAccess(userId)` in die Dashboard-APIs einbauen.

## 5. Globale Queue-Claims im Organic-Drain und Hard-Cap-Drain — TEILWEISE

**Befund**
- `organic-boost-execute.ts` und `hard-cap-status-execute.ts` rufen `processNextMetaMutation` auf.
- Der Claim (`claim_meta_mutation_execution`, zuletzt `20260928190000_…`) hat außer der Plan-ID keinen Filter. Er nimmt den global nächsten Plan.
- Die Umleitung auf ein fremdes Konto wird erst **nach** der Ausführung erkannt.

**Kein Mandantenrisiko:** Zugangsdaten, Policy und Kill-Switch kommen jeweils vom geclaimten Plan. Es läuft normale Executor-Arbeit, nur im falschen Kontext.

**Echte Risiken**
- **Zeitbudget:** Ein fremder `LAUNCH_CHAIN` mit bis zu 64 Schritten kann in einer Nutzeranfrage laufen, etwa in der Sync-Route (`maxDuration` 120) oder in Dashboard-`after()`. Wird die Anfrage abgebrochen, entsteht genau der Fall aus Befund 3.
- **Plantyp:** Auf demselben Konto wird ein anderer Plantyp, etwa ein Launch statt eines Boosts, als Boost-Erfolg gezählt.
- **Fairness:** Eigene Boost-Pläne können hinter älteren Plänen verhungern.
- **Lease-Force-Release:** `prepare_meta_organic_boost_write_now` (zuletzt `20260811200000_…`) und `prepare_meta_status_activate_write_now` (zuletzt `20260809170000_…`) rufen `force_release_meta_account_operation_lease` **ohne Bedingung** auf. Eine gerade laufende Ausführung auf demselben Konto verliert dadurch ihr Konto-Lease.

**Fix-Vorschlag**
- Einen Konto- und Typfilter für den Claim einführen (`claim_meta_mutation_execution_for_account`).
- Den Executor-Läufen aus Nutzeranfragen eine Deadline mitgeben.
- Das Force-Release nur ausführen, wenn keine Ausführung mit frischem Heartbeat existiert.
- Das betrifft Claim- und Lease-Pfade, also gelten die Guardrails und Smoke-SQL ist Pflicht.

## 6. Bildgenerierung: keine Moderation, doppelter Provider ohne Host-Allowlist — BESTÄTIGT

**Befund**
- Keine Moderation:
  - `creative-assets/providers/openrouter.ts` setzt `moderationStatus: "APPROVED"` ohne Bedingung.
  - Die SQL-Registrierungsfunktionen der Bibliothek setzen ebenfalls `APPROVED`.
  - Die einzige Prüfung ist das Anzeigen-Review bei Meta.
- `src/lib/ad-training/image.ts` bringt eine zweite OpenRouter-Anbindung mit:
  - Sie übernimmt jede `https://`-URL aus der Provider-Antwort.
  - Ohne Host-Allowlist.
  - Mit `redirect: "follow"`: Weiterleitungen auf http oder interne Hosts werden also verfolgt.
  - Sie liest die Antwort vollständig, bevor die Größe geprüft wird.
  - Sie prüft das Modell nicht gegen die Allowlist.
- Der Hauptprovider macht es richtig: Host-Allowlist, manuelle Redirects mit erneuter Prüfung, begrenztes Lesen.
- Genutzt wird `image.ts` von:
  - der Kampagnen-Pipeline
  - der Funnel-Creative-Übergabe
  - dem Enqueue-Fallback ohne Werbekonto
  - dem Admin-Training
- **Abmildernd:** Die URL stammt vom Provider, nicht vom Nutzer. Ausnutzbar ist das nur mit einem kompromittierten oder falsch konfigurierten Provider.

**Fix-Vorschlag**
- `generateMasterImageBytes` auf die Provider-Klasse bzw. deren Hilfsfunktionen umstellen (`assertAllowedAssetUrl`, Redirect-Handling, begrenztes Lesen).
- Das Modell gegen die Allowlist prüfen.
- Optional generierte Bilder zunächst als `PENDING` registrieren und später moderieren.

## 7. Funnel-SSO — TEILWEISE

**Befund**
- **„`aud` wird nicht geprüft“ trifft größtenteils nicht zu.**
  - Die Funnel-App prüft `aud` gegen den Host (`apps/adbot-funnel/server/_core/adbotSso.ts`), und Adbot setzt `aud` immer.
  - Restschwäche: `aud` ist im Prüfer optional, und `req.hostname` stammt aus dem Host-Header.
  - Der Prüfer in `src/lib/funnel-sso.ts` hat keine `aud`-Prüfung, wird aber nirgends aufgerufen.
- **Gemeinsames Secret: bestätigt.**
  - `FUNNEL_SSO_SECRET` signiert das Admin-SSO und alle Server-zu-Server-Aufrufe (CAPI-Relay, Kampagnenstatus, Tool-Domains, Creative-Übergabe), und zwar in beide Richtungen.
  - Getrennt werden die Tokens nur über das `purpose`-Feld, und das wird geprüft.
  - Wer die Umgebungsvariablen der Funnel-App erbeutet, kann SSO-Tokens für beliebige Adbot-User-IDs ausstellen.
- **Replay-Schutz nur im Speicher: bestätigt.**
  - Die Nonce-Map gilt nur pro Serverless-Instanz.
  - Der Token läuft in der URL (`?token=`) und kann so in Verlauf und Logs landen.
  - Die Gültigkeit ist auf 5 Minuten begrenzt. Ein erfolgreiches Replay bringt aber eine Funnel-Session für **1 Jahr**.

**Fix-Vorschlag**
- Nonces in DB oder KV speichern (eindeutiger Insert mit TTL).
- Die TTL auf rund 60 s senken und `aud` zur Pflicht machen.
- Getrennte Secrets für SSO und für Server-zu-Server-Aufrufe verwenden.
- Eine kürzere Funnel-Session wählen.

## 8. Kundendomain: fehlgeschlagener Re-Check setzt READY auf PENDING_DNS — TEILWEISE

**Befund**
- `src/lib/custom-domains/service.ts`: Jedes Prüfergebnis mit `ok: false` schreibt `PENDING_DNS`, auch bei einer bisher READY-Domain.
- `dns.ts` wertet jeden Resolver-Fehler als `ok: false`, auch vorübergehende wie SERVFAIL oder ETIMEOUT.
- Geprüft wird nur ein CNAME. Apex-, ALIAS- und geflattete Domains schlagen deshalb immer fehl.

**Teilweise widerlegt**
- Es gibt keinen Vercel-API-Aufruf.
- Der Re-Check wird nur durch den Nutzer ausgelöst („DNS erneut prüfen“).
- Adbot selbst liefert keine Seiten über die Domain aus. Das Host-Routing liegt in den Funnel- und Freebie-Apps; ob diese Apps bei `PENDING_DNS` die Auslieferung stoppen, ließ sich in diesem Repo nicht prüfen.

**Folgen in Adbot**
- Das Funnel-Admin-SSO weicht auf den gemeinsamen Host aus.
- Die Domain verschwindet aus der Auswahl beim Kampagnenstart.

**Fix-Vorschlag**
- Eine READY-Domain nur bei eindeutigem Ergebnis herabstufen, also bei NXDOMAIN oder falschem CNAME, idealerweise erst nach mehreren Fehlversuchen.
- Bei Resolver-Fehlern nur `last_dns_message` aktualisieren.

## 9. Funnel-Creative-Übergabe — TEILWEISE (doppelte Einträge widerlegt)

**Befund**
- `src/lib/funnel-creative-handoff-service.ts` macht erst einen Select und dann einen Insert.
- Doppelte Zeilen verhindert aber der Unique-Constraint `funnel_creative_handoffs_funnel_url_key (funnel_id, destination_url)`. Der zweite Insert scheitert mit 23505 und liefert `SKIPPED`, samt roher Postgres-Fehlermeldung.

**Echte Lücke**
- Einträge mit Status `PENDING` oder `FAILED` laufen erneut in `generateLibraryCreativeNow`.
- Eine Wiederholung, während der erste Lauf noch `PENDING` ist, erzeugt daher eine zweite, kostenpflichtige Generierung. Die `job_id` gewinnt, wer zuletzt schreibt.

**Fix-Vorschlag**
- Den Eintrag atomar übernehmen: per Upsert oder RPC mit Statusbedingung und Altersgrenze für `PENDING`.
- 23505 als `already_processed` melden.

## 10. Prozess und Dokumentation — BESTÄTIGT

- **Kein CI:** `.github/workflows` enthält nur den Scraper und die Spiegel-Workflows für Funnel und Freebie. Tests und Lint laufen nur manuell.
- **Vorbestehend rote Tests:**
  - `test-campaign-geo`
  - `test-funnel-url-split`
  - `test-meta-customer-controls`
  - `test-structural-multi-ad`
  - `test-meta-write-control-plane.sql` Zeile 621
- **Nie aufgerufene SQL-Tests:** `test-meta-campaign-recommendations.sql` und `test-meta-marketing-migration.sql` ruft kein Skript auf.
- **Veraltete Doku:** `docs/meta-automation/WRITE_CONTROL_PLANE_ARCHITECTURE.md` nennt `claim_meta_mutation_plan` und `assert_meta_mutation_guard`. Beide Funktionen gibt es in keiner Migration.
- **README:** Bis zu diesem Stand war sie veraltet und beschrieb Kampagnenstarts als „noch nicht implementiert“. Mit diesem Dokument wurde sie aktualisiert.

**Vorschlag**
- Einen minimalen GitHub-Workflow einrichten: `npm ci`, `lint`, `build` und die statischen `test:*`-Skripte.
- Die bekannten roten Tests reparieren oder dokumentiert ausnehmen.

## Empfohlene Reihenfolge

1. Befund 1 (KI-Ready-Login): kleiner, lokaler Fix mit hohem Sicherheitsgewinn. Kein Meta-Bezug.
2. Befund 3: den Sweeper und das Diagnose-SQL entwerfen; die 9 Altfälle gemeinsam mit dem Owner gegen Meta abgleichen.
3. Befund 2: die Produktentscheidung zur Bepreisung treffen, danach die Reservierung guardrail-konform anbinden.
4. Befunde 4, 6, 7: Härtungen ohne Meta-Write-Bezug.
5. Befund 5: gemeinsam mit Befund 3, weil beide dieselben Claim- und Lease-Pfade betreffen.
6. Befunde 8, 9, 10: danach.
