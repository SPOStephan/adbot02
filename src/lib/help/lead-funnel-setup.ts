export type LiveSetupStep = {
  id: string;
  title: string;
  summary: string;
  href: string;
  external?: boolean;
  actionLabel: string;
  details: string[];
};

export const LIVE_SETUP_GUIDE = {
  title: "Erster Live-Test: Funnel, Pixel und Leads",
  intro:
    "Diese Schritte reichen, damit eine echte Bewerbung als Conversion bei Meta ankommt — und du später gute von schlechten Leads unterscheiden kannst.",
} as const;

export const LIVE_SETUP_STEPS: LiveSetupStep[] = [
  {
    id: "pixel",
    title: "Meta Pixel in Adbot verbinden",
    summary:
      "Einmal unter Tracking die Pixel-ID bestätigen. Funnel und Freebie übernehmen sie automatisch, wenn dort noch keine andere steht.",
    href: "/dashboard/tracking",
    actionLabel: "Zu Tracking",
    details: [
      "Meta Business Suite → Events Manager → Datenquellen → Pixel öffnen und die numerische Pixel-ID kopieren.",
      "In Adbot unter Tracking einfügen, Bezeichnung wählen und auf „Pixel bestätigen“ klicken.",
      "Conversion-Event bleibt im Regelfall LEAD. Das ist dasselbe Ereignis, das der Funnel als Lead sendet.",
    ],
  },
  {
    id: "funnel-tracking",
    title: "Meta-Tracking im Funnel einschalten",
    summary:
      "Im Funnel unter Einstellungen den Schalter „Meta-Tracking aktiv“ setzen. Für Lead-Qualität und zuverlässige Events zusätzlich das Conversions-API-Token hinterlegen.",
    href: "/api/funnel/sso",
    external: true,
    actionLabel: "Funnel öffnen",
    details: [
      "Funnel öffnen → gewünschter Funnel → Einstellungen → Meta Conversion Tracking.",
      "„Meta-Tracking aktiv“ einschalten. Die Pixel-ID kommt meist schon aus dem Portal.",
      "Eventname auf Lead lassen. Conversion-Zeitpunkt: Beim Absenden.",
      "Optional, aber empfohlen: Conversions-API-Zugangstoken aus dem Events Manager. Ohne Token sieht Meta nur den Browser-Pixel — Adblocker können Events schlucken, und Gut/Schlecht kann nicht serverseitig zurückgemeldet werden.",
    ],
  },
  {
    id: "domain",
    title: "Domain anlegen und bestätigen",
    summary:
      "Die Lead-Kampagne braucht eine HTTPS-Zielseite, deren Domain in Adbot bestätigt ist.",
    href: "/dashboard/domains",
    actionLabel: "Zu Domains",
    details: [
      "Unter Domains eine eigene Domain anlegen oder im Funnel hinterlegen. Adbot setzt SSL und Hosting; du trägst nur den CNAME beim Domain-Anbieter ein.",
      "DNS prüfen, bis der Status READY ist. Root-URL zeigt dann den gebundenen Funnel.",
      "Dieselbe Domain nicht gleichzeitig an Funnel und Freebie binden.",
    ],
  },
  {
    id: "canary",
    title: "Lead-Canary vorbereiten",
    summary:
      "Unter Traffic-Launch den Lead-Canary mit Funnel-URL, Pixel und kleinem Tagesbudget starten.",
    href: "/dashboard/traffic-launch",
    actionLabel: "Zum Traffic-Launch",
    details: [
      "Meta muss verbunden sein, Policy und Freigeben aktiv, Pixel bestätigt und eine READY-Domain gewählt.",
      "Lead-Canary nutzt Lead-Generierung und optimiert auf Offsite-Conversions (Lead) — getrennt vom Traffic-Canary und vom Beitrag-Push.",
      "Zuerst ein kleines Tagesbudget. Nach dem Start eine eindeutig als Test markierte Bewerbung über die Anzeige oder die Funnel-URL absenden.",
    ],
  },
  {
    id: "test-lead",
    title: "Testbewerbung und Events Manager",
    summary:
      "Eine Testbewerbung absenden und im Meta Events Manager prüfen, dass Lead ankommt.",
    href: "/dashboard/tracking",
    actionLabel: "Zu Tracking",
    details: [
      "Optional: Im Funnel einen Test-Event-Code aus dem Events Manager eintragen, Testbewerbung senden, Code danach wieder leeren.",
      "Im Events Manager unter Test Events sollte Lead erscheinen. Mit Token siehst du Browser- und Serversignal zur selben Event-ID.",
      "Testdatensatz in der Funnel-Bewerbungsübersicht nach der Kontrolle löschen oder als Test markieren.",
    ],
  },
  {
    id: "quality",
    title: "Gute und schlechte Leads bewerten",
    summary:
      "Einzelne Bewerbungen mit Gut oder Schlecht bewerten. Zusätzlich können zentrale Antworten automatisch einen höheren oder niedrigeren Wert bekommen.",
    href: "/api/funnel/sso",
    external: true,
    actionLabel: "Bewerbungen öffnen",
    details: [
      "Im Funnel unter Bewerbungen eine Einsendung öffnen und Gut oder Schlecht wählen. Gut sendet an Meta das Ereignis Subscribe mit Wert, Schlecht sendet DisqualifiedLead mit niedrigem Wert.",
      "Im Funnel-Editor kannst du pro Antwortoption einen Euro-Wert setzen (zum Beispiel mehr Berufserfahrung = höherer Wert). Die Summe geht schon beim Absenden mit dem Lead an Meta.",
      "Meta kann dadurch auf Wert und auf qualifizierte Leads optimieren. Die laufende Lead-Kampagne ändert sich nicht von selbst — wenn genug Gut-Bewertungen da sind, stellst du in Meta die Optimierung auf Subscribe oder Wert um.",
    ],
  },
];
