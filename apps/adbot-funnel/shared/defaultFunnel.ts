import type { ContactPage, FunnelConfig } from "./funnel";
import type { FunnelPurpose } from "./funnelPurpose";
import { DEFAULT_PROGRESS_CONTENT_GAP_PX } from "./progressLayout";

export const DEFAULT_FUNNEL_ID = "10000000-0000-4000-8000-000000000001";

export const defaultFunnel: FunnelConfig = {
  schemaVersion: 1,
  id: DEFAULT_FUNNEL_ID,
  slug: "karriere",
  title: "Deine Karriere bei uns",
  purpose: "recruiting",
  status: "published",
  isPublished: true,
  notificationEmail: "",
  allowedEmbedOrigins: [],
  brand: {
    logoUrl: "",
    logoAlt: "Unternehmenslogo",
    faviconUrl: "",
    accentColor: "#0165c3",
    backgroundColor: "#f4f8fc",
    surfaceColor: "#ffffff",
    textColor: "#10253f",
    choiceBackgroundColor: "#ffffff",
    choiceTextColor: "#10253f",
    choiceSelectedBackgroundColor: "#eef7ff",
    choiceSelectedTextColor: "#10253f",
    choiceSelectedBorderColor: "#0165c3",
  },
  progress: {
    layout: "percent",
    colors: {
      active: "",
      completed: "",
      upcoming: "",
      text: "",
      muted: "",
      track: "",
    },
    stages: [],
    contentGapPx: DEFAULT_PROGRESS_CONTENT_GAP_PX,
  },
  socialProof: {
    enabled: true,
    eyebrow: "Einfach & vertraulich",
    text: "In rund 2 Minuten bewerben – ohne Anschreiben.",
  },
  privacyUrl: "https://example.org/datenschutz",
  privacyLabel: "Datenschutzerklärung",
  legal: {
    imprintMode: "internal",
    imprintTitle: "Impressum",
    imprintContent: "Die vollständigen Anbieterangaben für diesen Funnel werden derzeit ergänzt.",
    imprintUrl: "",
    privacyMode: "external",
    privacyTitle: "Datenschutzerklärung",
    privacyContent: "",
  },
  postSubmit: {
    mode: "message",
    redirectUrl: "",
  },
  metaTracking: {
    enabled: false,
    pixelId: "",
    eventName: "Lead",
    conversionTrigger: "submit",
  },
  pages: [
    {
      id: "page-start",
      type: "start",
      name: "Startseite",
      eyebrow: "Dein nächster Karriereschritt",
      title: "Finde heraus, ob wir zueinander passen.",
      subtitle: "",
      description:
        "Beantworte wenige kurze Fragen und lerne uns unverbindlich kennen. Deine Angaben behandeln wir selbstverständlich vertraulich.",
      buttonLabel: "Jetzt starten",
      progressTitle: "Job-Check",
      progressHint: "Passt der Job zu dir?",
      progressIcon: "search",
      layout: "classic",
      heroImageUrl: "",
      heroImageLayout: "circle",
      heroImageRadius: 28,
      bullets: ["Kein Anschreiben nötig", "Mobil in wenigen Minuten", "Schnelle persönliche Rückmeldung"],
      trustNote: "Kostenlos · Unverbindlich · Datenschutzkonform",
      benefitsBandTitle: "Deine Vorteile",
      secondaryButtonLabel: "",
      benefits: [],
      benefitsTileLayout: "two-column",
      benefitsTileGap: "medium",
      benefitsSectionBackground: "",
      benefitsCardBackground: "",
      heroSectionBackground: "",
      badges: [],
      heroBackgroundAssetId: "",
      heroBackgroundDesktopUrl: "",
      heroBackgroundMobileUrl: "",
      heroBackgroundOpacity: 15,
      heroBackgroundFocusX: 50,
    },
    {
      id: "page-role",
      type: "choice-grid",
      name: "Arbeitsbereich",
      eyebrow: "Kurze Frage",
      title: "Welcher Bereich passt am besten zu dir?",
      subtitle: "",
      description: "Wähle die Antwort aus, die deiner Wunschposition am nächsten kommt.",
      buttonLabel: "Weiter",
      progressTitle: "Kurzprofil",
      progressHint: "Ein paar Angaben",
      progressIcon: "user-check",
      questionKey: "arbeitsbereich",
      allowMultiple: false,
      options: [
        { id: "role-sales", label: "Vertrieb", value: "vertrieb", icon: "target", leadValue: 70 },
        { id: "role-office", label: "Office", value: "office", icon: "building", leadValue: 40 },
        { id: "role-tech", label: "Technik", value: "technik", icon: "rocket", leadValue: 55 },
        { id: "role-other", label: "Andere Rolle", value: "andere", icon: "sparkles", leadValue: 25 },
      ],
    },
    {
      id: "page-experience",
      type: "choice-list",
      name: "Berufserfahrung",
      eyebrow: "Kurze Frage",
      title: "Wie viel Berufserfahrung bringst du mit?",
      subtitle: "",
      description: "Eine ehrliche Einschätzung genügt – es gibt keine falsche Antwort.",
      buttonLabel: "Weiter",
      progressTitle: "Erfahrung",
      progressHint: "Wo stehst du gerade?",
      progressIcon: "file-text",
      questionKey: "berufserfahrung",
      allowMultiple: false,
      options: [
        { id: "exp-entry", label: "Ich starte gerade erst", value: "einstieg", icon: "graduation-cap", leadValue: 15 },
        { id: "exp-junior", label: "1–3 Jahre", value: "1-3", icon: "calendar", leadValue: 40 },
        { id: "exp-senior", label: "Mehr als 3 Jahre", value: "3-plus", icon: "star", leadValue: 80 },
        { id: "exp-change", label: "Ich bin Quereinsteiger:in", value: "quereinstieg", icon: "sparkles", leadValue: 35 },
      ],
    },
    {
      id: "page-contact",
      type: "contact",
      name: "Kontaktdaten",
      eyebrow: "Fast geschafft",
      title: "Fast geschafft – wie erreichen wir dich?",
      subtitle: "",
      description: "Hinterlasse deine Kontaktdaten. Wir melden uns persönlich und vertraulich bei dir.",
      buttonLabel: "Bewerbung absenden",
      progressTitle: "Kennenlernen",
      progressHint: "Wir melden uns bei dir",
      progressIcon: "handshake",
      fields: [
        { key: "name", label: "Vor- und Nachname", placeholder: "Max Mustermann", enabled: true, required: true, inputType: "text" },
        { key: "company", label: "Aktuelles Unternehmen", placeholder: "Optional", enabled: true, required: false, inputType: "text" },
        { key: "email", label: "E-Mail-Adresse", placeholder: "max@beispiel.de", enabled: true, required: true, inputType: "email" },
        { key: "phone", label: "Telefonnummer", placeholder: "+49 ...", enabled: true, required: true, inputType: "tel" },
        { key: "message", label: "Was möchtest du uns noch sagen?", placeholder: "Optionaler Hinweis", enabled: true, required: false, inputType: "textarea" },
      ],
      consentLabel:
        "Ich stimme der Verarbeitung meiner Angaben zum Zweck der Kontaktaufnahme und des Bewerbungsverfahrens zu.",
      consentRequired: true,
      resumeEnabled: true,
      resumeRequired: false,
      resumeLabel: "Lebenslauf hochladen (optional)",
      successTitle: "Vielen Dank für deine Bewerbung!",
      successText: "Deine Angaben sind sicher eingegangen. Wir melden uns zeitnah persönlich bei dir.",
    },
  ],
};

export function defaultFunnelForPurpose(purpose: FunnelPurpose): FunnelConfig {
  const template = structuredClone(defaultFunnel);
  template.purpose = purpose;
  if (purpose === "recruiting") return template;

  template.socialProof = {
    enabled: true,
    eyebrow: "Schnell & unkompliziert",
    text: "In rund 2 Minuten ausfüllen – unverbindlich und datenschutzkonform.",
  };
  template.pages = template.pages.map(page => {
    if (page.type === "start") {
      return {
        ...page,
        eyebrow: "Nur wenige Schritte",
        title: "Finde heraus, ob unser Angebot zu dir passt.",
        description: "Beantworte wenige kurze Fragen. Anschließend können wir dein Anliegen gezielt bearbeiten.",
        progressTitle: "Schnell-Check",
        progressHint: "Worum geht es dir?",
        bullets: ["In wenigen Minuten", "Unverbindlich", "Persönliche Rückmeldung"],
      };
    }
    if (page.type === "choice-grid") {
      return {
        ...page,
        name: "Anliegen",
        title: "Worum geht es dir?",
        description: "Wähle die Antwort, die am besten zu deinem Anliegen passt.",
        questionKey: "anliegen",
        options: [
          { id: "need-advice", label: "Beratung", value: "beratung", icon: "message-circle", leadValue: 60 },
          { id: "need-offer", label: "Angebot", value: "angebot", icon: "file-text", leadValue: 70 },
          { id: "need-info", label: "Informationen", value: "informationen", icon: "info", leadValue: 30 },
          { id: "need-other", label: "Sonstiges", value: "sonstiges", icon: "sparkles", leadValue: 20 },
        ],
      };
    }
    if (page.type === "choice-list") {
      return {
        ...page,
        name: "Priorität",
        title: "Was ist dir besonders wichtig?",
        description: "Eine kurze Einschätzung hilft uns bei der passenden Rückmeldung.",
        questionKey: "prioritaet",
        options: [
          { id: "priority-quality", label: "Qualität", value: "qualitaet", icon: "star", leadValue: 60 },
          { id: "priority-speed", label: "Schnelle Umsetzung", value: "geschwindigkeit", icon: "rocket", leadValue: 50 },
          { id: "priority-price", label: "Preis", value: "preis", icon: "coins", leadValue: 40 },
          { id: "priority-unsure", label: "Ich bin noch unsicher", value: "unsicher", icon: "help-circle", leadValue: 20 },
        ],
      };
    }
    if (page.type !== "contact") return page;
    const contact: ContactPage = {
      ...page,
      title: "Fast geschafft – wie erreichen wir dich?",
      description: "Hinterlasse deine Kontaktdaten. Wir melden uns persönlich bei dir.",
      buttonLabel: "Anfrage absenden",
      progressTitle: "Kontakt",
      progressHint: "Wir melden uns bei dir",
      consentLabel: "Ich stimme der Verarbeitung meiner Angaben zum Zweck der Bearbeitung meiner Anfrage zu.",
      resumeEnabled: false,
      resumeRequired: false,
      successTitle: "Vielen Dank für deine Anfrage!",
      successText: "Deine Angaben sind sicher eingegangen. Wir melden uns zeitnah persönlich bei dir.",
    };
    return contact;
  });
  return template;
}
