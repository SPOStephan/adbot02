import Link from "next/link";
import { redirect } from "next/navigation";

import { DashboardPageHeader } from "@/components/DashboardPageHeader";
import { APP_SITE_URL } from "@/lib/site-urls";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Kunden-Anleitung „Erweiterte Messung einrichten“.
 * Ausführliche Fassung: docs/customer/CONVERSIONS_API_ERWEITERT.md
 */

const ENDPOINT = `${APP_SITE_URL}/api/v1/conversions/events`;
const OPENAPI = `${APP_SITE_URL}/api-docs/conversions-v1.openapi.json`;

const BROWSER_SNIPPET = `const eventId = crypto.randomUUID();
fbq("track", "Lead", { content_name: "KI-Check" }, { eventID: eventId });
// eventId zusammen mit dem Formular an deinen Server schicken`;

const NODE_SNIPPET = `// Nur serverseitig ausführen.
if (consentMarketing) {
  const response = await fetch("${ENDPOINT}", {
    method: "POST",
    headers: {
      Authorization: \`Bearer \${process.env.ADBOT_EVENTS_KEY}\`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      events: [{
        event_name: "Lead",
        event_id: eventId,            // gleich wie eventID im Browser-Pixel
        event_time: Math.floor(Date.now() / 1000),
        action_source: "website",
        event_source_url: req.headers.referer,
        consent: { marketing: true },
        user_data: {
          email: lead.email,          // Adbot hasht, speichert nichts
          phone: lead.phone,
          client_ip_address: req.headers["x-forwarded-for"]?.split(",")[0]?.trim(),
          client_user_agent: req.headers["user-agent"],
          fbp: req.cookies?._fbp,
          fbc: req.cookies?._fbc,
        },
      }],
    }),
  });
  const result = await response.json(); // result.events[0].status
}`;

const PHP_SNIPPET = `<?php
if ($consentMarketing) {
    $payload = ['events' => [[
        'event_name' => 'Lead',
        'event_id' => $eventId,
        'event_time' => time(),
        'action_source' => 'website',
        'event_source_url' => $_SERVER['HTTP_REFERER'] ?? null,
        'consent' => ['marketing' => true],
        'user_data' => [
            'email' => $lead['email'] ?? null,
            'client_ip_address' => $_SERVER['REMOTE_ADDR'] ?? null,
            'client_user_agent' => $_SERVER['HTTP_USER_AGENT'] ?? null,
            'fbp' => $_COOKIE['_fbp'] ?? null,
            'fbc' => $_COOKIE['_fbc'] ?? null,
        ],
    ]]];
    $ch = curl_init('${ENDPOINT}');
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
    $result = json_decode(curl_exec($ch), true);
    curl_close($ch);
}`;

const FEEDBACK_SNIPPET = `{
  "events": [{
    "event_name": "DisqualifiedLead",
    "event_id": "dq-6b7c1d2e",
    "action_source": "system_generated",
    "consent": { "marketing": true },
    "user_data": { "email": "max@example.com" },
    "original_event_data": { "event_name": "Lead", "event_id": "<event_id des Leads>" }
  }]
}`;

const STATUSES: [string, string][] = [
  ["sent", "An Meta übermittelt."],
  ["skipped_no_consent", "Keine Marketing-Einwilligung, nichts gesendet."],
  ["duplicate", "Gleiches Ereignis (Name + event_id) wurde schon gesendet."],
  ["invalid", "Formfehler, Grund in „reason“ (z. B. Domain nicht erlaubt, Ereignis älter als 7 Tage)."],
  ["meta_error", "Meta hat abgelehnt oder war nicht erreichbar. Erneut senden ist möglich."],
];

function Code({ children }: { children: string }) {
  return (
    <pre className="mt-3 overflow-x-auto rounded-xl bg-slate-950 p-4 text-xs leading-5 text-slate-100">
      <code>{children}</code>
    </pre>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <h2 className="text-lg font-extrabold tracking-tight text-slate-950">{title}</h2>
      <div className="mt-3 space-y-3 text-sm leading-6 text-slate-600">{children}</div>
    </section>
  );
}

export default async function ErweiterteMessungPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/dashboard/tracking/erweiterte-messung");

  return (
    <>
      <DashboardPageHeader
        description="Für Entwickler und Agenturen: Conversion-Ereignisse vom eigenen Server über Adbot an Meta senden, ohne eigenen Meta-Zugriffsschlüssel."
        eyebrow="Tracking"
        title="Erweiterte Messung einrichten"
      />
      <div className="mt-8 space-y-6">
        <Card title="1. Zuschalten und Schlüssel erzeugen">
          <ol className="list-decimal space-y-2 pl-5">
            <li>
              Unter{" "}
              <Link className="font-semibold underline underline-offset-2" href="/dashboard/tracking#conversions-api-erweitert">
                Tracking
              </Link>{" "}
              beim bestätigten Pixel „Conversions API (erweitert)“ einschalten.
            </li>
            <li>
              Schlüssel erzeugen: Bezeichnung, erlaubte Domains (Subdomains sind automatisch erlaubt) und Art.
              Test-Schlüssel (<code>adb_ev_test_…</code>) senden nur mit Meta-Testcode, Live-Schlüssel (<code>adb_ev_live_…</code>) für den Betrieb.
            </li>
            <li>
              Schlüssel sofort kopieren. Er wird nur einmal angezeigt. Als Server-Variable speichern
              (z. B. <code>ADBOT_EVENTS_KEY</code>), nie im Browser-Code.
            </li>
          </ol>
        </Card>

        <Card title="2. Endpunkt">
          <Code>{`POST ${ENDPOINT}\nAuthorization: Bearer <Ereignis-Schlüssel>\nContent-Type: application/json`}</Code>
          <p>
            Nur Server-zu-Server, bis 100 Ereignisse je Anfrage, höchstens 1000 Ereignisse pro Minute und Schlüssel.
            Vollständige Beschreibung:{" "}
            <a className="font-semibold underline underline-offset-2" href={OPENAPI} rel="noreferrer" target="_blank">
              OpenAPI
            </a>
            .
          </p>
        </Card>

        <Card title="3. Einwilligung und Datenschutz">
          <p>
            Sende Ereignisse nur mit Marketing-Einwilligung und setze <code>consent.marketing</code> wahrheitsgemäß.
            Ohne <code>true</code> sendet Adbot nichts an Meta (<code>skipped_no_consent</code>).
          </p>
          <p>
            E-Mail, Telefon, Namen und weitere Kundendaten hasht Adbot (SHA-256) vor dem Versand. Gespeichert werden
            sie nicht, auch keine IP-Adresse oder User-Agent. Das Protokoll enthält nur Ereignisname, event_id und Status
            und wird nach 90 Tagen gelöscht.
          </p>
        </Card>

        <Card title="4. Doppelte Zählung mit dem Browser-Pixel vermeiden">
          <p>
            Dieselbe <code>event_id</code> im Browser-Pixel (<code>eventID</code>) und im Server-Ereignis verwenden.
            Meta erkennt beide dann als ein Ereignis.
          </p>
          <Code>{BROWSER_SNIPPET}</Code>
        </Card>

        <Card title="5. Beispiel Node.js">
          <Code>{NODE_SNIPPET}</Code>
        </Card>

        <Card title="6. Beispiel PHP">
          <Code>{PHP_SNIPPET}</Code>
        </Card>

        <Card title="7. Lead-Qualität zurückmelden">
          <p>
            Schlechte Leads als <code>DisqualifiedLead</code>, gute als <code>Subscribe</code> oder <code>Purchase</code>
            (mit <code>value</code> und <code>currency</code>) senden, jeweils mit <code>original_event_data</code> des
            ursprünglichen Leads. Damit kann Adbot auf qualifizierte Leads optimieren.
          </p>
          <Code>{FEEDBACK_SNIPPET}</Code>
        </Card>

        <Card title="8. Antwort je Ereignis">
          <ul className="space-y-1">
            {STATUSES.map(([status, text]) => (
              <li key={status}>
                <code className="font-semibold text-slate-900">{status}</code> – {text}
              </li>
            ))}
          </ul>
          <p>
            HTTP-Fehler: 401 Schlüssel ungültig, 403 Option aus, 400 Anfrage ungültig, 413 zu groß, 429 zu viele
            Ereignisse, 503 später erneut senden.
          </p>
        </Card>

        <Card title="9. Testen">
          <p>
            Im Meta Events Manager unter „Testereignisse“ den Testcode kopieren. Dann mit Test-Schlüssel und{" "}
            <code>test_event_code</code> senden oder im Tracking-Bereich „Testereignis senden“ nutzen. Das Ereignis
            erscheint als Server-Ereignis im Events Manager.
          </p>
          <p>
            React/Vite-Websites: <code>consent-kit</code> ab v0.3.0 liefert <code>trackMetaEvent</code> (Browser, gibt die
            event_id zurück) sowie <code>hasServerConsent</code> und <code>readMetaBrowserIds</code> für den Server.
          </p>
        </Card>
      </div>
    </>
  );
}
