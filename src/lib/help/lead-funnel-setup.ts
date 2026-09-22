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
      "Unter Tracking die Pixel aus dem verbundenen Werbekonto laden, CAPI prüfen und bestätigen. Funnel und Freebie übernehmen sie automatisch, wenn dort noch keine andere steht.",
    href: "/dashboard/tracking",
    actionLabel: "Zu Tracking",
    details: [
      "Meta muss bereits verbunden sein. Adbot listet Pixel am verbundenen Werbekonto — nicht aus dem Events Manager kopieren.",
      "Pixel wählen und „CAPI prüfen und Pixel bestätigen“ klicken. Adbot sendet eine Probe mit dem Connection-Token.",
      "Nur wenn die Probe ankommt, ist das der Kundenweg. Conversion-Event bleibt im Regelfall LEAD.",
      "Wenn Liste oder Probe scheitert: Pixel/Dataset in der Login-for-Business-Konfiguration zuweisen, dann Meta neu verbinden. Ein Events-Manager-Token ist nicht der Kundenweg.",
    ],
  },
  {
    id: "funnel-tracking",
    title: "Meta-Tracking im Funnel einschalten",
    summary:
      "Im Funnel unter Einstellungen den Schalter „Meta-Tracking aktiv“ setzen. Serverseitige CAPI kommt aus der Meta-Verbindung im Portal — kein Events-Manager-Token.",
    href: "/api/funnel/sso",
    external: true,
    actionLabel: "Funnel öffnen",
    details: [
      "Funnel öffnen → gewünschter Funnel → Einstellungen → Meta Conversion Tracking.",
      "„Meta-Tracking aktiv“ einschalten. Die Pixel-ID kommt meist schon aus dem Portal.",
      "Eventname auf Lead lassen. Conversion-Zeitpunkt: Beim Absenden.",
      "Lead und Gut/Schlecht gehen serverseitig über die geprüfte Meta-Verbindung. Ein Events-Manager-Token ist nicht der Kundenweg.",
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
      "Im Events Manager unter Test Events sollte Lead erscheinen — Browser-Pixel plus Serversignal über die Meta-Verbindung zur selben Event-ID.",
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
