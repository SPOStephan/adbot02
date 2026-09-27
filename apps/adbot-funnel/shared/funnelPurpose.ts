export const FUNNEL_PURPOSES = [
  "recruiting",
  "lead_qualification",
  "appointment",
  "quote_request",
  "event_registration",
  "lead_magnet",
  "product_sales",
  "survey_other",
] as const;

export type FunnelPurpose = (typeof FUNNEL_PURPOSES)[number];

export type FunnelPurposeOption = {
  value: FunnelPurpose;
  label: string;
  description: string;
};

export const FUNNEL_PURPOSE_OPTIONS: readonly FunnelPurposeOption[] = [
  {
    value: "recruiting",
    label: "Social Recruiting / Jobanzeige",
    description: "Bewerber gewinnen und vorqualifizieren. Wird für Werbeplattformen als Job-Kampagne markiert.",
  },
  {
    value: "lead_qualification",
    label: "Kundenanfrage & Vorqualifizierung",
    description: "Interessenten nach Bedarf, Eignung oder Kaufabsicht einordnen.",
  },
  {
    value: "appointment",
    label: "Termin / Beratung / Demo",
    description: "Anfragen für Gespräche, Beratungen, Demos oder Dienstleistungen erfassen.",
  },
  {
    value: "quote_request",
    label: "Angebot / Kostenvoranschlag",
    description: "Anforderungen abfragen und passende Angebote vorbereiten.",
  },
  {
    value: "event_registration",
    label: "Event / Webinar / Anmeldung",
    description: "Teilnehmer für Veranstaltungen, Webinare oder Kurse registrieren.",
  },
  {
    value: "lead_magnet",
    label: "Lead-Magnet / Download / Newsletter",
    description: "Kontaktdaten für Inhalte, Downloads, Newsletter oder kostenlose Tests gewinnen.",
  },
  {
    value: "product_sales",
    label: "Verkauf / Produktberatung",
    description: "Produkte oder Leistungen empfehlen und Interessenten zum Kauf führen.",
  },
  {
    value: "survey_other",
    label: "Umfrage / Feedback / Sonstiges",
    description: "Antworten, Feedback oder einen individuellen Funnel-Zweck erfassen.",
  },
];

export function normalizeFunnelPurpose(value: unknown): FunnelPurpose {
  return FUNNEL_PURPOSES.includes(value as FunnelPurpose)
    ? (value as FunnelPurpose)
    : "recruiting";
}

export function funnelPurposeOption(value: unknown): FunnelPurposeOption {
  const purpose = normalizeFunnelPurpose(value);
  return FUNNEL_PURPOSE_OPTIONS.find(option => option.value === purpose) ?? FUNNEL_PURPOSE_OPTIONS[0];
}

export function funnelPurposeTags(value: unknown): string[] {
  const purpose = normalizeFunnelPurpose(value);
  return purpose === "recruiting"
    ? ["funnel", "funnel-purpose:recruiting", "jobs", "employment"]
    : ["funnel", `funnel-purpose:${purpose}`];
}

export function isEmploymentFunnelPurpose(value: unknown): boolean {
  return normalizeFunnelPurpose(value) === "recruiting";
}

export function funnelSubmissionLabel(value: unknown): string {
  const purpose = normalizeFunnelPurpose(value);
  if (purpose === "recruiting") return "Bewerbung";
  if (purpose === "event_registration") return "Anmeldung";
  if (purpose === "survey_other") return "Antwort";
  return "Anfrage";
}

export function funnelSubmissionPlural(value: unknown): string {
  const purpose = normalizeFunnelPurpose(value);
  if (purpose === "recruiting") return "Bewerbungen";
  if (purpose === "event_registration") return "Anmeldungen";
  if (purpose === "survey_other") return "Antworten";
  return "Anfragen";
}
