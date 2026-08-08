export const PAGE_TYPES = ["start", "choice-grid", "choice-list", "contact"] as const;
export const FUNNEL_STATUSES = ["draft", "published", "paused", "archived"] as const;
export const FUNNEL_OPTION_ICONS = [
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

export type FunnelPageType = (typeof PAGE_TYPES)[number];
export type FunnelStatus = (typeof FUNNEL_STATUSES)[number];

export type FunnelOptionIcon = (typeof FUNNEL_OPTION_ICONS)[number];

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
};

export type FunnelOption = {
  id: string;
  label: string;
  value: string;
  icon: FunnelOptionIcon;
  description?: string;
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
};

export type StartPage = FunnelPageBase & {
  type: "start";
  heroImageUrl: string;
  bullets: string[];
  trustNote: string;
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

export type FunnelMetaTracking = {
  enabled: boolean;
  pixelId: string;
  eventName: string;
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
  socialProof: FunnelSocialProof;
  privacyUrl: string;
  privacyLabel: string;
  legal: FunnelLegal;
  postSubmit: FunnelPostSubmit;
  metaTracking: FunnelMetaTracking;
  pages: FunnelPage[];
};

export type FunnelSummary = {
  id: string;
  slug: string;
  title: string;
  status: FunnelStatus;
  applicationCount: number;
  newApplicationCount: number;
  createdAt: string;
  updatedAt: string;
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
  resume?: ResumeMetadata;
  sourceUrl?: string;
  utm: Record<string, string>;
  createdAt: string;
};
