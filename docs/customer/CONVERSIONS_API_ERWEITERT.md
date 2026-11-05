# Erweiterte Messung (Conversions API) einrichten

Für Entwickler und Agenturen. Standardmäßig misst der **Browser-Pixel** auf deiner Website – daran ändert sich nichts. Mit der erweiterten Messung schickt zusätzlich **dein Server** Conversion-Ereignisse an Adbot. Adbot leitet sie über deine bestehende Meta-Verbindung per Conversions API an deinen bestätigten Pixel weiter. Ein eigener Meta-Zugriffsschlüssel ist **nicht** nötig.

Vorteile: bessere Zuordnung trotz Werbeblockern, Ereignisse ohne Browser (z. B. Zahlungs-Webhooks) und Rückmeldungen zur Lead-Qualität für die Optimierung „Qualifizierte Leads“.

## 1. Zuschalten

1. Im Adbot-Dashboard unter **Tracking** muss dein Pixel bestätigt sein.
2. Im Abschnitt **Erweiterte Messung (Conversions API)** den Schalter beim Pixel einschalten.
3. **Schlüssel erzeugen**: Bezeichnung (z. B. „kiready.co Produktion“), erlaubte Domains (z. B. `kiready.co`; Subdomains wie `www.kiready.co` sind automatisch erlaubt) und Art wählen:
   - **Test** (`adb_ev_test_…`): sendet nur zusammen mit einem Meta-Testcode, ideal zum Einrichten.
   - **Live** (`adb_ev_live_…`): für den Produktivbetrieb.
4. Den Schlüssel **sofort kopieren**. Er wird nur einmal angezeigt. Speichere ihn als Server-Variable (z. B. `ADBOT_EVENTS_KEY`), **nie** im Browser-Code oder im Git-Repository.

Schlüssel lassen sich jederzeit widerrufen. Ausschalten des Schalters stoppt sofort alle Anfragen für diesen Pixel.

## 2. Endpunkt

```
POST https://app.adbot.one/api/v1/conversions/events
Authorization: Bearer <Ereignis-Schlüssel>
Content-Type: application/json
```

- Nur Server-zu-Server. Browser-Aufrufe (CORS) werden nicht unterstützt.
- Bis zu **100 Ereignisse** je Anfrage, höchstens 1 MB, höchstens 1000 Ereignisse pro Minute und Schlüssel.
- Vollständige Beschreibung als OpenAPI: `https://app.adbot.one/api-docs/conversions-v1.openapi.json`

## 3. Ereignisformat

```json
{
  "test_event_code": "TEST12345",
  "events": [{
    "event_name": "Lead",
    "event_id": "6b7c1d2e-0f4a-4d9b-9a51-2f3c4d5e6f70",
    "event_time": 1793772425,
    "action_source": "website",
    "event_source_url": "https://kiready.co/ki-readiness",
    "consent": { "marketing": true },
    "user_data": {
      "email": "max@example.com",
      "phone": "+49 171 1234567",
      "first_name": "Max",
      "last_name": "Muster",
      "external_id": "crm-42",
      "client_ip_address": "203.0.113.7",
      "client_user_agent": "Mozilla/5.0 …",
      "fbp": "fb.1.1700000000000.123456789",
      "fbc": "fb.1.1700000000000.AbCdEf"
    },
    "custom_data": { "value": 22.61, "currency": "EUR", "content_name": "KI-Check" }
  }]
}
```

| Feld | Pflicht | Hinweis |
| --- | --- | --- |
| `event_name` | ja | `Lead`, `CompleteRegistration`, `Contact`, `SubmitApplication`, `Schedule`, `Purchase`, `Subscribe`, `StartTrial`, `InitiateCheckout`, `AddPaymentInfo`, `AddToCart`, `Search`, `ViewContent`, `DisqualifiedLead`. `PageView` bitte nur über den Browser-Pixel. |
| `event_id` | ja | Eindeutig je Ereignis. **Gleicher Wert wie `eventID` im Browser-Pixel**, damit Meta doppelte Zählung vermeidet. |
| `event_time` | nein | Unix-Sekunden, höchstens 7 Tage alt. Standard: jetzt. |
| `action_source` | nein | Standard `website`. Für Folgeereignisse ohne Browser `system_generated`. |
| `event_source_url` | bei `website` | Muss zu den erlaubten Domains des Schlüssels passen. |
| `consent.marketing` | ja | Nur bei `true` wird an Meta gesendet. Sonst Antwort `skipped_no_consent`. |
| `user_data` | ja | Mindestens eine Angabe (E-Mail, Telefon, `external_id`, `fbp`/`fbc` oder IP + User-Agent). Bei `website` ist `client_user_agent` Pflicht. |
| `custom_data` | nein | `value` braucht `currency` (z. B. `EUR`). Max. 8 KB. |
| `original_event_data` | nein | Für Qualitäts-Rückmeldungen, siehe unten. |

**Datenschutz:** E-Mail, Telefon, Namen, Ort, PLZ, Land, Geschlecht, Geburtsdatum und `external_id` normalisiert und hasht Adbot (SHA-256), bevor sie an Meta gehen. Du kannst auch bereits gehashte Werte (64 Hex-Zeichen) senden. Adbot speichert keine dieser Angaben und auch keine IP-Adresse oder User-Agent. Im Protokoll stehen nur Ereignisname, `event_id`, Status und Fehlercode, und es wird nach 90 Tagen gelöscht.

**Einwilligung:** Sende Ereignisse nur, wenn die Person der Marketing-Messung zugestimmt hat, und setze `consent.marketing` wahrheitsgemäß.

## 4. Deduplizierung mit dem Browser-Pixel

Erzeuge die `event_id` im Browser, schicke sie mit dem Pixel-Ereignis **und** an deinen Server:

```js
const eventId = crypto.randomUUID();
fbq("track", "Lead", { content_name: "KI-Check" }, { eventID: eventId });
await fetch("/api/lead", { method: "POST", body: JSON.stringify({ ...formData, eventId }) });
```

Meta erkennt beide als dasselbe Ereignis (gleicher Name + gleiche `event_id`).

## 5. Beispiele

### Node.js (fetch)

```js
// Nur serverseitig ausführen.
export async function sendLeadToAdbot({ req, lead, eventId, consentMarketing }) {
  if (!consentMarketing) return; // ohne Einwilligung nichts senden
  const response = await fetch("https://app.adbot.one/api/v1/conversions/events", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.ADBOT_EVENTS_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      events: [{
        event_name: "Lead",
        event_id: eventId,
        event_time: Math.floor(Date.now() / 1000),
        action_source: "website",
        event_source_url: req.headers.referer,
        consent: { marketing: true },
        user_data: {
          email: lead.email,
          phone: lead.phone,
          client_ip_address: req.headers["x-forwarded-for"]?.split(",")[0]?.trim(),
          client_user_agent: req.headers["user-agent"],
          fbp: req.cookies?._fbp,
          fbc: req.cookies?._fbc,
        },
      }],
    }),
  });
  const result = await response.json();
  // result.events[0].status: sent | skipped_no_consent | duplicate | invalid | meta_error
  return result;
}
```

### PHP (cURL)

```php
<?php
function sendLeadToAdbot(array $lead, string $eventId, bool $consentMarketing): ?array {
    if (!$consentMarketing) return null; // ohne Einwilligung nichts senden
    $payload = [
        'events' => [[
            'event_name' => 'Lead',
            'event_id' => $eventId,
            'event_time' => time(),
            'action_source' => 'website',
            'event_source_url' => $_SERVER['HTTP_REFERER'] ?? null,
            'consent' => ['marketing' => true],
            'user_data' => [
                'email' => $lead['email'] ?? null,
                'phone' => $lead['phone'] ?? null,
                'client_ip_address' => $_SERVER['REMOTE_ADDR'] ?? null,
                'client_user_agent' => $_SERVER['HTTP_USER_AGENT'] ?? null,
                'fbp' => $_COOKIE['_fbp'] ?? null,
                'fbc' => $_COOKIE['_fbc'] ?? null,
            ],
        ]],
    ];
    $ch = curl_init('https://app.adbot.one/api/v1/conversions/events');
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 10,
        CURLOPT_HTTPHEADER => [
            'Authorization: Bearer ' . getenv('ADBOT_EVENTS_KEY'),
            'Content-Type: application/json',
        ],
        CURLOPT_POSTFIELDS => json_encode($payload),
    ]);
    $body = curl_exec($ch);
    curl_close($ch);
    return $body ? json_decode($body, true) : null;
}
```

### Qualitäts-Rückmeldung (z. B. aus dem Vertrieb)

```json
{
  "events": [{
    "event_name": "DisqualifiedLead",
    "event_id": "dq-6b7c1d2e",
    "action_source": "system_generated",
    "consent": { "marketing": true },
    "user_data": { "email": "max@example.com" },
    "original_event_data": { "event_name": "Lead", "event_id": "6b7c1d2e-0f4a-4d9b-9a51-2f3c4d5e6f70" }
  }]
}
```

Für gute Leads entsprechend `Subscribe` oder `Purchase` (mit `value` und `currency`) und dem `original_event_data` des ursprünglichen Leads senden. Sobald Ereignisse über diesen Weg ankommen, kann Adbot Lead-Kampagnen auf **qualifizierte Leads** optimieren.

## 6. Antwort

```json
{
  "ok": true,
  "test": false,
  "counts": { "sent": 1 },
  "events": [{ "index": 0, "status": "sent", "event_name": "Lead", "event_id": "6b7c…", "fbtrace_id": "A1b2C3…" }]
}
```

| Status | Bedeutung |
| --- | --- |
| `sent` | An Meta übermittelt. |
| `skipped_no_consent` | Keine Marketing-Einwilligung, nichts gesendet. |
| `duplicate` | Ereignis mit gleichem Namen und `event_id` wurde schon gesendet. Nicht erneut gezählt. |
| `invalid` | Formfehler, Grund steht in `reason` (z. B. `event_source_url_domain_not_allowed`, `event_time_too_old`, `user_data_missing`). |
| `meta_error` | Meta hat abgelehnt oder war nicht erreichbar, Code in `code`. Das Ereignis kann erneut gesendet werden. |

HTTP-Fehler: `401` Schlüssel ungültig/widerrufen, `403` Option für den Pixel aus, `400` Anfrage ungültig (z. B. Test-Schlüssel ohne `test_event_code`), `413` zu groß, `429` zu viele Ereignisse, `503` vorübergehend nicht verfügbar (später erneut senden).

## 7. Testen

1. Im Meta Events Manager unter **Testereignisse** den Testcode kopieren.
2. Mit Test-Schlüssel und `"test_event_code": "<Code>"` ein `Lead` senden, oder im Adbot-Dashboard **Testereignis senden** nutzen.
3. Das Ereignis erscheint im Events Manager als Server-Ereignis. In Adbot zeigt der Tracking-Bereich Anzahl, letzten Eingang und Fehler.

## Hinweis für React/Vite-Websites

[`consent-kit`](https://github.com/SPOStephan/consent-kit) ab v0.3.0 (`github:SPOStephan/consent-kit#v0.3.0`) liefert `trackMetaEvent` (Browser, gibt die `event_id` zurück) und serverseitig `hasServerConsent` / `readMetaBrowserIds`. Das passt direkt zu diesem Endpunkt (siehe `docs/CONVERSIONS-API.md` im consent-kit-Repository).
