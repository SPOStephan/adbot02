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
  title: "Funnel mit Meta bewerben",
  intro:
    "Diese Schritte reichen, damit Adbot eine Meta-Kampagne startet, Funnel-Abschlüsse zuverlässig als Leads meldet und spätere Qualitätsbewertungen an Meta zurückgibt.",
} as const;

export const LIVE_SETUP_STEPS: LiveSetupStep[] = [
  {
    id: "pixel",
    title: "Meta Pixel in Adbot verbinden",
    summary:
      "Beim Kampagnenstart die Pixel aus dem verbundenen Werbekonto laden, Conversions API prüfen und bestätigen. Funnel und Freebie übernehmen sie automatisch, wenn dort noch keine andere steht.",
    href: "/dashboard/traffic-launch",
    actionLabel: "Kampagne einrichten",
    details: [
      "Meta muss bereits verbunden sein. Adbot listet Pixel am verbundenen Werbekonto — nicht aus dem Events Manager kopieren.",
      "Pixel wählen und „CAPI prüfen und Pixel bestätigen“ klicken. Adbot sendet eine Probe mit dem Connection-Token.",
      "Nur wenn die Probe ankommt, ist die serverseitige Lead-Meldung freigegeben. Conversion-Event bleibt im Regelfall LEAD.",
      "Wenn Liste oder Probe scheitert: Pixel/Dataset in der Login-for-Business-Konfiguration zuweisen, dann Meta neu verbinden. Ein Events-Manager-Token ist nicht der Kundenweg.",
    ],
  },
  {
    id: "funnel-tracking",
    title: "Meta-Tracking im Funnel einschalten",
    summary:
      "Adbot prüft beim Kampagnenstart, ob Pixel und Lead-Event im gewählten Funnel aktiv sind, und synchronisiert sie bei Bedarf.",
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
    title: "Bestehende Domain anbinden und bestätigen",
    summary:
      "Die Lead-Kampagne braucht eine HTTPS-Zielseite auf einer Domain, die du schon besitzt und in Adbot anbindest.",
    href: "/dashboard/domains",
    actionLabel: "Zu Domains",
    details: [
      "Unter Domains oder im Funnel eine bestehende Subdomain anbinden — kein Domainkauf. Adbot setzt SSL und Hosting; du trägst nur den CNAME beim Domain-Anbieter ein.",
      "Account-Domain: alle Funnel unter /f/slug, Root ist die Liste. Funnel-Domain: Root ist genau ein Funnel.",
      "DNS prüfen, bis der Status READY ist. Dieselbe Domain nicht gleichzeitig an Funnel und Freebie binden.",
    ],
  },
  {
    id: "canary",
    title: "Meta-Kampagne einrichten",
    summary:
      "Funnel, Zielgebiet, Pixel, Werbemittel, Texte und Tagesbudget direkt im Kampagnenstart festlegen.",
    href: "/dashboard/traffic-launch",
    actionLabel: "Kampagne einrichten",
    details: [
      "Meta muss verbunden sein, Policy und Freigeben aktiv, Pixel bestätigt und eine READY-Domain gewählt.",
      "Adbot nutzt Lead-Generierung und optimiert zunächst auf Funnel-Abschlüsse; mit genügend Qualitätsdaten kann eine neue Kampagne auf qualifizierte Leads optimieren.",
      "Vor dem Start zeigt Adbot Werbemittel, Texte, Funnel, Pixel und Tagesbudget in einer Vorschau.",
    ],
  },
  {
    id: "test-lead",
    title: "Eingehende Conversions kontrollieren",
    summary:
      "Nach dem Kampagnenstart im Meta Events Manager kontrollieren, dass Funnel-Abschlüsse als Lead ankommen.",
    href: "/dashboard/tracking",
    actionLabel: "Zu Tracking",
    details: [
      "Im Events Manager sollte Lead erscheinen — Browser-Pixel plus Serversignal über die Meta-Verbindung zur selben Event-ID.",
      "Adbot speichert den Funnel-Abschluss parallel in der Eingangsübersicht.",
      "Bei einer Fehlermeldung Pixel und Conversions API direkt im Kampagnenstart erneut prüfen.",
    ],
  },
  {
    id: "quality",
    title: "Gute und schlechte Leads bewerten",
    summary:
      "Einzelne Bewerbungen mit Gut oder Schlecht bewerten. Zusätzlich können zentrale Antworten automatisch einen höheren oder niedrigeren Wert bekommen.",
    href: "/api/funnel/sso?next=/admin/applications",
    external: true,
    actionLabel: "Bewerbungen öffnen",
    details: [
      "Im Funnel unter Eingänge eine Einsendung öffnen und Gut oder Schlecht wählen. Gut sendet an Meta QualifiedLead mit Wert, Schlecht DisqualifiedLead mit niedrigem Wert.",
      "Im Funnel-Editor kannst du pro Antwortoption einen Euro-Wert setzen (zum Beispiel mehr Berufserfahrung = höherer Wert). Die Summe geht schon beim Absenden mit dem Lead an Meta.",
      "Meta kann dadurch auf qualifizierte Leads lernen. Laufende Kampagnen werden nicht still verändert; das Performance-Ziel wird bei einer neuen Kampagne ausdrücklich gewählt.",
    ],
  },
];
