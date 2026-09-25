export const PAGE_TYPES = ["start", "choice-grid", "choice-list", "contact"] as const;
export const FUNNEL_STATUSES = ["draft", "published", "paused", "archived"] as const;
export const START_PAGE_LAYOUTS = ["classic", "benefits"] as const;
export const PROGRESS_LAYOUTS = [
  "percent",
  "minimal",
  "icons",
  "bar",
  "chevrons",
  "bold",
  "reduced",
  "illustrated",
  "checks",
  "chips",
  "brand",
] as const;
export const LUCIDE_FUNNEL_ICONS = [
  "badge-check",
  "banknote",
  "bell",
  "book-open",
  "brain",
  "briefcase",
  "building",
  "calendar",
  "car",
  "chart-line",
  "check",
  "circle-help",
  "clock",
  "coffee",
  "construction",
  "crown",
  "dumbbell",
  "factory",
  "file-text",
  "flag",
  "gem",
  "globe",
  "graduation-cap",
  "handshake",
  "heart",
  "home",
  "laptop",
  "leaf",
  "lightbulb",
  "mail",
  "map-pin",
  "message-circle",
  "megaphone",
  "phone",
  "plane",
  "rocket",
  "search",
  "shield-check",
  "shopping-cart",
  "smile",
  "sparkles",
  "star",
  "target",
  "trophy",
  "truck",
  "user-check",
  "users",
  "wrench",
  "zap",
] as const;

/** Eigene Adbot-Icons (Lucide-Strichstil). Neue Symbole hier + Label + SVG ablegen. */
export const ADBOT_FUNNEL_ICONS = [
  "adbot-annual-hours",
  "adbot-company-car",
  "adbot-corporate-perks",
  "adbot-flex-hours",
  "adbot-health-care",
  "adbot-home-office",
  "adbot-insurance-cover",
  "adbot-mobile-work",
  "adbot-modern-workplace",
  "adbot-profit-share",
  "adbot-team-together",
  "adbot-training-path",
  "adbot-travel-equals-work",
  "adbot-vacation-days",
] as const;

export const FUNNEL_OPTION_ICONS = [...LUCIDE_FUNNEL_ICONS, ...ADBOT_FUNNEL_ICONS] as const;

export type FunnelPageType = (typeof PAGE_TYPES)[number];
export type FunnelStatus = (typeof FUNNEL_STATUSES)[number];
export type StartPageLayout = (typeof START_PAGE_LAYOUTS)[number];
export type ProgressLayout = (typeof PROGRESS_LAYOUTS)[number];

export type FunnelOptionIcon = (typeof FUNNEL_OPTION_ICONS)[number];
export type LucideFunnelIcon = (typeof LUCIDE_FUNNEL_ICONS)[number];
export type AdbotFunnelIcon = (typeof ADBOT_FUNNEL_ICONS)[number];

export const FUNNEL_OPTION_ICON_LABELS: Record<FunnelOptionIcon, string> = {
  "badge-check": "Auszeichnung",
  banknote: "Geldschein",
  bell: "Glocke",
  "book-open": "Buch",
  brain: "Denken",
  briefcase: "Aktentasche",
  building: "Gebäude",
  calendar: "Kalender",
  car: "Auto",
  "chart-line": "Wachstum",
  check: "Häkchen",
  "circle-help": "Frage",
  clock: "Uhr",
  coffee: "Kaffee",
  construction: "Baustelle",
  crown: "Krone",
  dumbbell: "Fitness",
  factory: "Produktion",
  "file-text": "Dokument",
  flag: "Zielflagge",
  gem: "Diamant",
  globe: "International",
  "graduation-cap": "Abschluss",
  handshake: "Handschlag",
  heart: "Herz",
  home: "Zuhause",
  laptop: "Laptop",
  leaf: "Nachhaltigkeit",
  lightbulb: "Idee",
  mail: "E-Mail",
  "map-pin": "Standort",
  "message-circle": "Nachricht",
  megaphone: "Marketing",
  phone: "Telefon",
  plane: "Reise",
  rocket: "Rakete",
  search: "Suche",
  "shield-check": "Sicherheit",
  "shopping-cart": "Einkauf",
  smile: "Lächeln",
  sparkles: "Funkeln",
  star: "Stern",
  target: "Ziel",
  trophy: "Pokal",
  truck: "Logistik",
  "user-check": "Person bestätigt",
  users: "Team",
  wrench: "Werkzeug",
  zap: "Energie",
  "adbot-annual-hours": "Jahresarbeitszeit",
  "adbot-company-car": "Firmenwagen",
  "adbot-corporate-perks": "Corporate Benefits",
  "adbot-flex-hours": "Gleitzeit",
  "adbot-health-care": "Gesundheit",
  "adbot-home-office": "Homeoffice",
  "adbot-insurance-cover": "Versicherung",
  "adbot-mobile-work": "Mobiles Arbeiten",
  "adbot-modern-workplace": "Moderner Arbeitsplatz",
  "adbot-profit-share": "Ergebnisbeteiligung",
  "adbot-team-together": "Gemeinschaft",
  "adbot-training-path": "Weiterbildung",
  "adbot-travel-equals-work": "Reisezeit",
  "adbot-vacation-days": "Urlaubstage",
};

export function isAdbotFunnelIcon(icon: string): icon is AdbotFunnelIcon {
  return (ADBOT_FUNNEL_ICONS as readonly string[]).includes(icon);
}

export type FunnelOption = {
  id: string;
  label: string;
  value: string;
  icon: FunnelOptionIcon;
  description?: string;
  /** Optional EUR value sent to Meta with the Lead event when this answer is selected. */
  leadValue?: number;
};

export type ContactFieldKey = "name" | "company" | "email" | "phone" | "message";

export type ContactFieldConfig = {
  key: ContactFieldKey;
  label: string;
  placeholder: string;
  enabled: boolean;
  required: boolean;
  inputType: "text" | "email" | "tel" | "textarea";
};

type FunnelPageBase = {
  id: string;
  type: FunnelPageType;
  name: string;
  eyebrow: string;
  title: string;
  description: string;
  buttonLabel: string;
  /** Short public label in the progress indicator. Empty falls back to the page name. */
  progressTitle: string;
  /** Optional second line under the progress title. */
  progressHint: string;
  progressIcon: FunnelOptionIcon;
  /** Hidden idea pages stay in the editor but are skipped in the public funnel. */
  hidden?: boolean;
};

export function isFunnelPageHidden(page: Pick<FunnelPageBase, "hidden">): boolean {
  return page.hidden === true;
}

export function canHideFunnelPage(page: Pick<FunnelPageBase, "type">): boolean {
  return page.type !== "start" && page.type !== "contact";
}

export function visibleFunnelPages<T extends Pick<FunnelPageBase, "hidden">>(pages: T[]): T[] {
  return pages.filter(page => !isFunnelPageHidden(page));
}

export type StartBenefit = {
  id: string;
  icon: FunnelOptionIcon;
  title: string;
  text: string;
  /** Optional hex override. Empty/undefined uses the branding accent. */
  color?: string;
};

export type StartPage = FunnelPageBase & {
  type: "start";
  layout: StartPageLayout;
  heroImageUrl: string;
  bullets: string[];
  trustNote: string;
  benefitsBandTitle: string;
  secondaryButtonLabel: string;
  benefits: StartBenefit[];
  heroBackgroundAssetId: string;
  heroBackgroundDesktopUrl: string;
  heroBackgroundMobileUrl: string;
  heroBackgroundOpacity: number;
};

export type FunnelMediaAsset = {
  id: string;
  ownerUserId: string | null;
  funnelId: string;
  kind: "hero-background";
  filename: string;
  desktopUrl: string;
  mobileUrl: string;
  createdAt: string;
};

export type ChoicePage = FunnelPageBase & {
  type: "choice-grid" | "choice-list";
  questionKey: string;
  allowMultiple: boolean;
  options: FunnelOption[];
};

export type ContactPage = FunnelPageBase & {
  type: "contact";
  fields: ContactFieldConfig[];
  consentLabel: string;
  consentRequired: boolean;
  resumeEnabled: boolean;
  resumeRequired: boolean;
  resumeLabel: string;
  successTitle: string;
  successText: string;
};

export type FunnelPage = StartPage | ChoicePage | ContactPage;

export type FunnelBrand = {
  logoUrl: string;
  logoAlt: string;
  faviconUrl: string;
  accentColor: "#0165c3";
  backgroundColor: string;
  surfaceColor: string;
  textColor: string;
  choiceBackgroundColor: string;
  choiceTextColor: string;
  choiceSelectedBackgroundColor: string;
  choiceSelectedTextColor: string;
  choiceSelectedBorderColor: string;
};

export type FunnelProgressColors = {
  /** Empty string uses the branding accent. */
  active: string;
  completed: string;
  upcoming: string;
  text: string;
  muted: string;
  track: string;
};

export type FunnelProgress = {
  layout: ProgressLayout;
  colors: FunnelProgressColors;
};

export type FunnelSocialProof = {
  enabled: boolean;
  eyebrow: string;
  text: string;
};

export type FunnelLegal = {
  imprintTitle: string;
  imprintContent: string;
};

export type FunnelPostSubmit = {
  mode: "message" | "redirect";
  redirectUrl: string;
};

export const META_CONVERSION_TRIGGERS = ["submit", "doi"] as const;
export type MetaConversionTrigger = (typeof META_CONVERSION_TRIGGERS)[number];

export type FunnelMetaTracking = {
  enabled: boolean;
  pixelId: string;
  eventName: string;
  /** Wann die Meta-Conversion gemeldet wird. Standard: beim Absenden. Optional erst nach DOI. */
  conversionTrigger: MetaConversionTrigger;
  /** Optionaler EUR-Wert für manuell als gut bewertete Leads. */
  qualityGoodValue?: number;
  /** Optionaler EUR-Wert für manuell als schlecht bewertete Leads. */
  qualityBadValue?: number;
};

export type FunnelConfig = {
  schemaVersion: 1;
  id: string;
  slug: string;
  title: string;
  status: FunnelStatus;
  isPublished: boolean;
  notificationEmail: string;
  allowedEmbedOrigins: string[];
  brand: FunnelBrand;
  progress: FunnelProgress;
  socialProof: FunnelSocialProof;
  privacyUrl: string;
  privacyLabel: string;
  legal: FunnelLegal;
  postSubmit: FunnelPostSubmit;
  metaTracking: FunnelMetaTracking;
  pages: FunnelPage[];
};

export function toPublicFunnelConfig(config: FunnelConfig): FunnelConfig {
  return {
    ...config,
    notificationEmail: "",
    allowedEmbedOrigins: [],
    pages: visibleFunnelPages(config.pages),
  };
}

export type FunnelSummary = {
  id: string;
  slug: string;
  title: string;
  status: FunnelStatus;
  applicationCount: number;
  newApplicationCount: number;
  ownerUserId: string | null;
  ownerEmail: string | null;
  createdAt: string;
  updatedAt: string;
};

export type FunnelOwner = {
  userId: string | null;
  email: string | null;
};

export type FunnelAnswers = Record<string, string[]>;

export type ApplicationContact = Partial<Record<ContactFieldKey, string>>;

export type ResumeMetadata = {
  key: string;
  url: string;
  fileName: string;
  mimeType: string;
  size: number;
};

export type ApplicationSubmission = {
  funnelSlug: string;
  answers: FunnelAnswers;
  contact: ApplicationContact;
  consent: boolean;
  metaEventId?: string;
  metaFbp?: string;
  metaFbc?: string;
  resume?: ResumeMetadata;
  sourceUrl?: string;
  utm?: Record<string, string>;
};

export type ApplicationStatus = "new" | "reviewing" | "contacted" | "rejected" | "hired";

export type LeadQuality = "good" | "bad";

export type ApplicationRecord = {
  id: string;
  funnelId: string;
  funnelSlug: string;
  status: ApplicationStatus;
  answers: FunnelAnswers;
  contact: ApplicationContact;
  consentAt: string;
  trackingConsentAt?: string;
  metaEventId?: string;
  leadValue?: number;
  leadQuality?: LeadQuality;
  leadQualityAt?: string;
  leadQualityEventId?: string;
  leadQualityMetaStatus?: string;
  resume?: ResumeMetadata;
  sourceUrl?: string;
  utm: Record<string, string>;
  createdAt: string;
};
