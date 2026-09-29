# klickwerk-Kundenportal auf Basis von Adbot – Spezifikation

**Stand:** 29.09.2026 · **Status:** Entwurf zur Abstimmung, noch nicht umgesetzt
**Bezug:** README (Architektur), `docs/audits/ARCHITECTURE_RISKS_2026-09-29.md` (Befund 7: Funnel-SSO)

## 1. Ziel

klickwerk.io ist ein eigenes Produkt für Social Recruiting. Es hat eine eigene App, eine eigene Website und eine eigene Marke. Ein klickwerk-Kunde loggt sich in sein Konto ein und sieht dort unter klickwerk-Marke:

- seine **Funnel** (live),
- die **Bewerbungen** aus diesen Funnels,
- die **Anzeigen**, die auf diese Funnel geschaltet sind. Die Vorschau entspricht der realistischen Meta-Vorschau aus dem Kampagnenstart (`MetaAdPreviewGallery`),
- die **Kennzahlen** Impressionen, Klicks, Bewerbungen, Kosten pro Bewerbung und Ausgaben, soweit für ihn freigegeben.

klickwerk bedient sich dabei so weit wie möglich bei Adbot (Kampagnen, Meta, Creatives, Kennzahlen) und beim Funnel-Tool (Funnel, Bewerbungen). Adbot bleibt headless für den Kunden: Er sieht nie eine Adbot-Oberfläche.

## 2. Leitentscheidungen

| # | Entscheidung | Begründung |
|---|---|---|
| E1 | **Der Auftrag ist das zentrale Objekt.** Aufträge für einen klickwerk-Kunden legt der Admin im klickwerk-Admin an. Kampagnen und Funnel entstehen aus dem Auftrag heraus. | Kunde und Auftrag stehen fest, bevor etwas gestartet wird. Adbot muss nichts erraten, nichts muss nachgetragen werden. |
| E2 | **Sichtbar ist nur, was ausdrücklich zugeordnet ist.** Ein Kunde sieht nur Kampagnen, deren Meta-Kampagnen-ID gespeichert ihm zugeordnet ist. Eine Zuordnung über Ziel-URL oder Werbekonto allein genügt nicht. | Im Normalfall laufen Kampagnen mehrerer Kunden über das Werbekonto des Owners. Fehlt die Zuordnung, sieht niemand die Kampagne (fail-closed). |
| E3 | **Ausgeschaltete Daten werden nicht ausgeliefert.** Sichtbarkeitsschalter pro Kunde wirken serverseitig in Adbot. Ausgeschaltete Bereiche oder Kennzahlen fehlen in der API-Antwort vollständig. | Der Kunde soll keine leeren Spalten, keine Nullwerte und keine Hinweise sehen. Es soll wirken, als gäbe es die Angabe nicht. |
| E4 | **Der Weg zu Meta bleibt ausschließlich der Adbot-Write-Pfad.** klickwerk spricht nie direkt mit Meta. | Die Freigaben, Kill-Switch, Leases und Guardrails der Write-Control-Plane bleiben die einzige Stelle für Meta-Writes (`META_WRITE_COLLATERAL_GUARDRAILS.md`). |
| E5 | **klickwerk hat eigene Zugangsdaten**, sowohl für die Adbot-API als auch für das Funnel-Tool. Das gemeinsame `FUNNEL_SSO_SECRET` wird dafür nicht genutzt. | So wird Befund 7 (gemeinsames Secret, Replay-Schutz nur im Speicher) für diesen Weg vermieden. Externe Kundenlogins machen dieses Risiko praktisch relevant. |
| E6 | **Kampagnen werden anfangs im bestehenden Adbot-Start-Dialog gestartet**, aufgerufen aus dem Auftrag heraus, mit fest gebundenem Kunden und Auftrag. Einen Start rein per API gibt es erst später. | Der Start-Dialog (Motive je Format, Texte, Vorschau, Budget, Freigabe) soll nicht doppelt gebaut und gepflegt werden. |

## 3. Ausgangslage im Code (verifiziert)

- **Funnel** gehören einem Adbot-Nutzer (`funnels.owner_user_id` im Supabase-Projekt des Funnel-Tools, `vmrsuyyylybucuomiqpd`). Eine Kundenebene fehlt dort.
- **Bewerbungen** liegen im Funnel-Tool (`applications`), getrennt von der Adbot-Datenbank.
- **Kampagnen** entstehen als Plan `LAUNCH_CHAIN` (`mutation_plans`, `planned_payload` mit `objective`, `destination_url`, `campaign`, `ad_set`, `creative`, `ad`, `brand_asset_ids`). Die Meta-IDs stehen nach dem Anlegen in `remote_object_bindings` (`object_type`, `remote_object_id`, `local_campaign_id`, `local_ad_id`, `local_creative_id`).
- **Live-Stand bei Meta** kommt aus dem stündlichen Marketing-Sync:
  - `campaigns` (Status, Budget, `insights_spend`, `insights_impressions`)
  - `ads` (Status, Review, Ziel-URL)
  - `creatives` (Titel, Text, CTA, Vorschaubild; großes Bild bisher nur bei einem Teil)
  - `performance_data` (Tageswerte: Impressionen, Klicks, Link-Klicks, Leads, Ausgaben)
- **Heutige Statusabfrage für den Funnel-Admin:** `/api/internal/funnel-campaign-status` ordnet Kampagnen nur über die Ziel-URL zu. Für Kundensichtbarkeit reicht das nicht (siehe E2), für die bisherige interne Anzeige schon.

## 4. Datenmodell in Adbot (Vorschlag, neue Migration)

> Das Migrations-SQL wird vor dem Anwenden vollständig gezeigt und nur nach ausdrücklicher Freigabe angewendet. Es enthält nur neue Tabellen und Spalten und ändert nichts an bestehenden Write-Pfaden.

### 4.1 `clients` – klickwerk-Kunden

| Spalte | Bedeutung |
|---|---|
| `id` uuid | Kunden-ID, führend für alle Aufrufe |
| `owner_user_id` uuid | Adbot-Nutzer, der den Kunden verwaltet (Owner/Agentur) |
| `external_ref` text | ID des Kunden in klickwerk (eindeutig je Owner) |
| `display_name` text | Anzeigename |
| `status` | `ACTIVE`, `PAUSED`, `ARCHIVED` (bei `ARCHIVED` liefert die API nichts mehr aus) |
| `created_at`, `updated_at` | |

### 4.2 `client_visibility_settings` – Sichtbarkeit je Kunde

Es gibt eine Zeile je Kunde. Alle Schalter stehen standardmäßig auf **an**.

| Schalter | Wirkung wenn aus |
|---|---|
| `show_ads` | Der gesamte Anzeigenbereich fehlt: keine Kampagnen, Anzeigen oder Vorschauen in der Antwort. Mit ihm entfallen alle Kennzahlen, die aus Meta stammen. |
| `show_impressions` | Das Feld `impressions` fehlt überall |
| `show_clicks` | Das Feld `clicks` fehlt überall |
| `show_applications` | Das Feld `applications` fehlt überall |
| `show_cost_per_application` | Das Feld `costPerApplication` fehlt überall |
| `show_spend` | Das Feld `spend` fehlt überall. **Standard: an.** Der Admin kann es pro Kunde ausblenden. |

Wenn `show_spend` aus ist, bleibt `show_cost_per_application` eigenständig schaltbar. Die Oberfläche weist darauf hin, dass sich die Ausgaben aus Kosten pro Bewerbung × Bewerbungen zurückrechnen lassen.

Änderungen werden versioniert (`updated_by`, `updated_at`). Sie wirken sofort, weil die API bei jedem Aufruf frisch filtert und nichts vorberechnet oder cacht.

### 4.3 `client_orders` – Aufträge

| Spalte | Bedeutung |
|---|---|
| `id` uuid | Auftrags-ID |
| `client_id` | Kunde |
| `external_ref` text | Auftrags-ID in klickwerk |
| `title` text | z. B. „Vertriebler Immobilienfinanzierung“ |
| `status` | `DRAFT`, `ACTIVE`, `PAUSED`, `DONE`, `ARCHIVED` |
| `funnel_refs` jsonb | Funnel-IDs und Ziel-URLs aus dem Funnel-Tool, die zu diesem Auftrag gehören |

### 4.4 `client_campaign_assignments` – die Sicherheitsgrenze

| Spalte | Bedeutung |
|---|---|
| `client_id`, `order_id` | Kunde und Auftrag (Auftrag optional bei Altbestand) |
| `platform_account_id` | Werbekonto in Adbot |
| `platform_campaign_id` text | **Meta-Kampagnen-ID** |
| `source` | `ORDER_LAUNCH` (automatisch beim Start) oder `ADMIN_MANUAL` (Altbestand, händisch) |
| `plan_id` | Adbot-Plan, falls über Adbot gestartet |
| `assigned_by`, `assigned_at`, `revoked_at` | Nachvollziehbarkeit; entzogene Zuordnungen bleiben erhalten |

Regeln:
- Eindeutig je `(platform_account_id, platform_campaign_id)` unter den aktiven Zuordnungen. Eine Kampagne gehört also höchstens einem Kunden.
- Für jede Zuordnung gilt: Das Werbekonto gehört `clients.owner_user_id` (Mandantenprüfung per Trigger).
- Anzeigen, Anzeigengruppen und Creatives werden **über die Kampagne** mitgezählt und nicht einzeln zugeordnet.

### 4.5 Auftrag am Plan

- `mutation_plans` bekommt die optionalen Spalten `client_id` und `client_order_id`. Sie werden beim Vorbereiten des Launches gesetzt und sind danach unveränderlich.
- Sobald `remote_object_bindings` die Meta-Kampagnen-ID enthält, legt ein Trigger die Zeile in `client_campaign_assignments` mit `source = ORDER_LAUNCH` an.
- Der Trigger schreibt **nur** in die neue Tabelle. Status, Freeze oder Claim der Pläne ändert er nicht. Trotzdem gilt für diese Änderung das Vorgehen aus `META_WRITE_COLLATERAL_GUARDRAILS.md`, inklusive Smoke-SQL.

## 5. Abläufe

### 5.1 Auftrag anlegen und Kampagne starten

```text
klickwerk-Admin                 Funnel-Tool                  Adbot
───────────────                 ───────────                  ─────
Kunde anlegen ──────────────────────────────────────────────▶ POST /api/klickwerk/v1/clients
Auftrag anlegen ────────────────────────────────────────────▶ POST …/clients/{id}/orders
Funnel anlegen ────────────────▶ Funnel mit client/order-Ref
                                 ◀── funnel_id, URL
Funnel dem Auftrag zuordnen ────────────────────────────────▶ PATCH …/orders/{id} (funnel_refs)
„Kampagne starten“ ─────────────────────────────────────────▶ Start-Token (Auftrag, 60 s, einmalig)
   └─ Weiterleitung per SSO ───────────────────────────────▶ /dashboard/traffic-launch?order=…
                                                              Start-Dialog mit fest gebundenem
                                                              Kunden, Auftrag und Funnel-URL
                                                              → Plan mit client_id/order_id
                                                              → Freigabe → Executor → Meta
                                                              → Binding → Kundenzuordnung
```

- Die Funnel-URL im Start-Dialog ist auf die Funnel des Auftrags beschränkt.
- Der Start-Token wird serverseitig als verbraucht gespeichert (einmalig, DB statt Speicher).
- Alle bestehenden Schutzmechanismen (Freigabe, Kill-Switch, Duplikatschutz, Budget-Exposure) gelten unverändert.

### 5.2 Altbestand zuordnen

Das betrifft Kampagnen, die ohne Auftrag entstanden sind, etwa die laufende Vertriebs-Kampagne auf dem Kundenkonto. Adbot bekommt dafür die Admin-Seite **„Kunden“**. Dort wählt der Admin pro Kunde Kampagnen aus der Liste des Werbekontos (Name, Meta-ID, Status, Ziel-URL als Hinweis) und weist sie zu (`ADMIN_MANUAL`). Die Ziel-URL dient nur als Vorschlag und wird nie automatisch übernommen.

### 5.3 Kunde loggt sich in klickwerk ein

1. klickwerk authentifiziert den Kunden selbst (eigene Nutzerverwaltung).
2. Der klickwerk-Server ruft Adbot mit seinem App-Schlüssel und der `client_id` des eingeloggten Kunden auf.
3. Adbot liefert nur Daten dieses Kunden, gefiltert nach seinen Sichtbarkeitsschaltern.
4. Die Bewerbungen holt klickwerk beim Funnel-Tool, gefiltert auf die Funnel der Aufträge des Kunden.

## 6. Schnittstelle Adbot → klickwerk (nur lesend für Kundendaten)

**Authentifizierung:**
- **Server-zu-Server mit eigenem Schlüssel** `KLICKWERK_API_SECRET`. Der Schlüssel wird nie im Browser verwendet.
- Jede Anfrage wird per HMAC über Methode, Pfad, Zeitstempel und Body-Hash signiert.
- Das Zeitfenster beträgt ±60 s. Die Nonce wird in der DB gespeichert, damit dieselbe Anfrage nicht zweimal akzeptiert wird.
- Der Schlüssel ist genau einem Owner (`owner_user_id`) zugeordnet. Anfragen für Kunden anderer Owner werden abgelehnt.

**Endpunkte (Entwurf):**

| Methode | Pfad | Zweck |
|---|---|---|
| POST | `/api/klickwerk/v1/clients` | Kunden anlegen/aktualisieren (Admin-Vorgang aus klickwerk) |
| POST/PATCH | `/api/klickwerk/v1/clients/{id}/orders` | Aufträge anlegen, Funnel zuordnen |
| POST | `/api/klickwerk/v1/orders/{id}/launch-token` | Kurzlebiger Token für den Absprung in den Adbot-Start-Dialog |
| GET | `/api/klickwerk/v1/clients/{id}/overview` | Aufträge, Funnel, Kampagnen, Anzeigen mit Vorschau, Kennzahlen (gefiltert) |
| GET | `/api/klickwerk/v1/clients/{id}/ads/{adId}` | Einzelanzeige mit allen Vorschau-Kombinationen |

**Antwort `overview` (Beispiel mit allen Schaltern an):**

```json
{
  "client": { "id": "…", "displayName": "Boncred" },
  "period": { "from": "2026-09-01", "to": "2026-09-29" },
  "orders": [{
    "id": "…", "title": "Vertriebler Immobilienfinanzierung", "status": "ACTIVE",
    "funnels": [{ "funnelId": "…", "url": "https://jobs.boncred.info/…" }],
    "metrics": { "impressions": 48210, "clicks": 1312, "applications": 37,
                 "costPerApplication": { "amountMinor": 2410, "currency": "EUR" },
                 "spend": { "amountMinor": 89170, "currency": "EUR" } },
    "campaigns": [{
      "metaCampaignId": "…", "kind": "LEAD", "status": "ACTIVE",
      "metrics": { "…": "…" },
      "ads": [{
        "metaAdId": "…", "status": "ACTIVE",
        "preview": { "advertiserName": "Boncred", "instagramHandle": "@boncred.official",
                     "primaryText": "…", "headline": "…", "callToAction": "APPLY_NOW",
                     "destinationHost": "jobs.boncred.info",
                     "imageUrl": "https://…signed…", "format": "FEED_4_5" }
      }]
    }]
  }]
}
```

**Mit `show_spend = false`:** Das Feld `spend` fehlt in `orders[].metrics` und `campaigns[].metrics`. Es gibt keinen Nullwert und kein Flag.
**Mit `show_ads = false`:** `campaigns` fehlt vollständig. Übrig bleiben Aufträge, Funnel und die Kennzahl `applications` (sofern freigegeben).

**Datenquellen der Vorschau:**
1. Der Adbot-Plan (`planned_payload`: Texte, Überschrift, CTA, `brand_asset_ids` → Bilder aus dem Storage als kurzlebige Signed URLs) gibt genau die gestartete Anzeige wieder.
2. Der Marketing-Sync (`ads`, `creatives`) liefert den Live-Status und Anzeigen, die außerhalb von Adbot entstanden sind (Altbestand).
3. Später optional: die Meta-Vorschau-Schnittstelle (`/{ad_id}/previews`) als „Originalansicht“. Deren Frame-Links laufen ab und werden bei Bedarf serverseitig frisch geholt.

**Kennzahlen:**
- `impressions`, `clicks` (Link-Klicks) und `spend` stammen aus `performance_data`, summiert über die zugeordneten Kampagnen.
- `applications` stammt aus dem Funnel-Tool (echte Bewerbungen je Funnel und Zeitraum), nicht aus Metas Lead-Zählung.
- `costPerApplication` ist `spend / applications`. Das Feld fehlt, wenn keine Bewerbungen vorliegen.

Die **Meta-Werbebibliothek-API wird für das Kundenportal nicht benötigt.** Sie bleibt für das geplante Lernen aus fremden Anzeigen vorgesehen (eigene Meta-App).

## 7. Schnittstelle Funnel-Tool → klickwerk

- Funnel und Bewerbungen bekommen eine Kunden- bzw. Auftragsreferenz (`client_ref`, `order_ref`).
- Eine neue Server-zu-Server-API liefert Bewerbungen je Funnel bzw. Auftrag. Sie nutzt ein **eigenes** klickwerk-Secret, dieselbe Signatur- und Nonce-Methode wie in Abschnitt 6 und signierte Download-Links für Lebensläufe.
- Adbot fragt die Bewerbungszahlen je Funnel und Zeitraum dort ab, für die Kennzahlen.

## 8. Sicherheit und Datenschutz

- **Mandantentrennung:** Jede Abfrage beginnt bei `client_id` → aktive `client_campaign_assignments`. Es gibt keine Abfrage „alle Kampagnen des Werbekontos“ im Kundenpfad. Ein Test prüft, dass nicht zugeordnete Kampagnen desselben Werbekontos nie in der Antwort erscheinen.
- **Keine Schreibrechte für Kunden:** Die Kundenpfade lesen nur. Starts, Pausen und Budgetänderungen bleiben beim Admin im Adbot-Dialog.
- **Bewerberdaten** (DSGVO) bleiben im Funnel-Tool. Adbot speichert nur Zählwerte.
- **Befund 7** wird für klickwerk nicht geerbt: eigene Secrets, Nonces in der DB, kurze Token-Laufzeiten.
- **Bilder** werden nur als kurzlebige Signed URLs ausgeliefert.

## 9. Umsetzungsphasen

| Phase | Inhalt | Meta-Bezug |
|---|---|---|
| **1 – Adbot-Kern** | Migration (Abschnitt 4), Admin-Seite „Kunden“ (Kunden, Aufträge, Altbestand zuordnen, Sichtbarkeitsschalter), Endpunkt `overview` mit Vorschau und Kennzahlen aus Adbot-Daten, Tests zur Mandantentrennung und zu den Schaltern | Nur lesend; Launch-Pfad unverändert |
| **2 – Auftrag im Start** | Start-Token, Absprung in den Start-Dialog mit fest gebundenem Auftrag, `client_id`/`order_id` am Plan, Trigger → Zuordnung | Berührt die Launch-Vorbereitung: Guardrails und Smoke-SQL Pflicht |
| **3 – Funnel-Tool** | Kunden- und Auftragsreferenzen, Bewerbungs-API mit eigenem Secret, Bewerbungszahlen für `applications` | – |
| **4 – klickwerk-App** | Eigene App mit Login, Branding und Website auf Basis der APIs aus 1–3 | – |
| **5 – Ausbau** | Bildlücke schließen (großes Bild für alle Creatives), Meta-Originalvorschau, optional Start per API mit Auftragsvorlagen | 5c berührt den Write-Pfad |

## 10. Offene Punkte

1. Zeitraum der Kennzahlen: Standard „Laufzeit des Auftrags“ oder „letzte 30 Tage“, jeweils umschaltbar?
2. Sollen Kunden pausierte oder beendete Kampagnen sehen, zum Beispiel als „beendet“, oder nur laufende?
3. Soll ein Kunde mehrere Nutzer haben (Team-Zugänge)? Das betrifft nur klickwerk, nicht Adbot.
4. Welcher Werbetreibenden-Name und welches Profilbild erscheinen in der Vorschau, wenn über das Owner-Werbekonto, aber mit der Seite des Kunden geschaltet wird? Das hängt davon ab, wessen Facebook-Seite die Anzeige trägt.
