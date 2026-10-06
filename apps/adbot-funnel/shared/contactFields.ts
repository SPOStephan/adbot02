import type {
  ApplicationContact,
  ApplicationContactLabels,
  BuiltinContactFieldKey,
  ContactFieldCharset,
  ContactFieldConfig,
  ContactPage,
  FunnelConfig,
} from "./funnel";

export const BUILTIN_CONTACT_FIELD_KEYS = ["name", "company", "email", "phone", "message"] as const satisfies readonly BuiltinContactFieldKey[];

export const MAX_CONTACT_FIELDS = 20;
export const CONTACT_FIELD_KEY_PATTERN = /^[a-zA-Z][a-zA-Z0-9_-]{0,47}$/;
export const CONTACT_FIELD_MAX_LENGTH = 240;
export const CONTACT_MESSAGE_MAX_LENGTH = 4000;

export const DEFAULT_BIRTH_YEAR_MIN = 1950;
export const DEFAULT_BIRTH_YEAR_MAX = 2006;
export const DEFAULT_BIRTH_YEAR_START = 1980;

/** Fixed column/row labels for the original five fields (Übersicht, CSV, Mail). */
export const BUILTIN_CONTACT_FIELD_LABELS: Record<BuiltinContactFieldKey, string> = {
  name: "Name",
  company: "Firma",
  email: "E-Mail",
  phone: "Telefon",
  message: "Nachricht",
};

export const CONTACT_FIELD_CHARSET_LABELS: Record<ContactFieldCharset, string> = {
  any: "Zahlen und Buchstaben",
  digits: "Nur Zahlen",
  letters: "Nur Buchstaben",
};

export type ContactFieldPresetKey = "birthYear" | "postalCode" | "city";

/** Ready-made extra fields admins can add to a contact page with one click. */
export const CONTACT_FIELD_PRESETS: Record<ContactFieldPresetKey, ContactFieldConfig> = {
  birthYear: {
    key: "birthYear",
    label: "Geburtsjahr",
    placeholder: "Bitte wählen",
    enabled: true,
    required: false,
    inputType: "year",
    yearMin: DEFAULT_BIRTH_YEAR_MIN,
    yearMax: DEFAULT_BIRTH_YEAR_MAX,
    yearStart: DEFAULT_BIRTH_YEAR_START,
  },
  postalCode: {
    key: "postalCode",
    label: "PLZ",
    placeholder: "12345",
    enabled: true,
    required: false,
    inputType: "text",
    charset: "digits",
    maxLength: 5,
  },
  city: {
    key: "city",
    label: "Wohnort",
    placeholder: "Musterstadt",
    enabled: true,
    required: false,
    inputType: "text",
    charset: "letters",
  },
};

export function isBuiltinContactFieldKey(key: string): key is BuiltinContactFieldKey {
  return (BUILTIN_CONTACT_FIELD_KEYS as readonly string[]).includes(key);
}

export function createCustomContactField(existingKeys: readonly string[]): ContactFieldConfig {
  let index = 1;
  while (existingKeys.includes(`custom${index}`)) index += 1;
  return {
    key: `custom${index}`,
    label: "Eigenes Feld",
    placeholder: "",
    enabled: true,
    required: false,
    inputType: "text",
    charset: "any",
  };
}

export function contactFieldCharset(field: ContactFieldConfig): ContactFieldCharset {
  if (field.inputType !== "text") return "any";
  return field.charset === "digits" || field.charset === "letters" ? field.charset : "any";
}

export function contactFieldMaxLength(field: ContactFieldConfig): number {
  if (field.inputType === "textarea") return CONTACT_MESSAGE_MAX_LENGTH;
  const max = Number(field.maxLength);
  return Number.isInteger(max) && max > 0 ? Math.min(max, CONTACT_FIELD_MAX_LENGTH) : CONTACT_FIELD_MAX_LENGTH;
}

const DISALLOWED_DIGITS = /[^0-9]/g;
// Letters of any language plus the separators that occur in names of places
// ("Bad Homburg v. d. Höhe", "Sankt-Peter-Ording", "L'Aquila").
const DISALLOWED_LETTERS_SOURCE = "[^\\p{L}\\p{M} .'’-]";
const DISALLOWED_LETTERS = new RegExp(DISALLOWED_LETTERS_SOURCE, "gu");

/** Strips characters the field does not accept while the person is typing. */
export function sanitizeContactFieldInput(field: ContactFieldConfig, value: string): string {
  const charset = contactFieldCharset(field);
  const cleaned = charset === "digits"
    ? value.replace(DISALLOWED_DIGITS, "")
    : charset === "letters"
      ? value.replace(DISALLOWED_LETTERS, "")
      : value;
  return cleaned.slice(0, contactFieldMaxLength(field));
}

export function birthYearRange(field: ContactFieldConfig) {
  const toYear = (value: unknown, fallback: number) => {
    const year = Number(value);
    return Number.isInteger(year) && year >= 1900 && year <= 2100 ? year : fallback;
  };
  const min = toYear(field.yearMin, DEFAULT_BIRTH_YEAR_MIN);
  const max = Math.max(min, toYear(field.yearMax, DEFAULT_BIRTH_YEAR_MAX));
  const start = Math.min(max, Math.max(min, toYear(field.yearStart, DEFAULT_BIRTH_YEAR_START)));
  return { min, max, start };
}

/** Years from newest to oldest, the order a birth-year list is read in. */
export function birthYearOptions(field: ContactFieldConfig): string[] {
  const { min, max } = birthYearRange(field);
  const years: string[] = [];
  for (let year = max; year >= min; year -= 1) years.push(String(year));
  return years;
}

/**
 * Returns a German error message when a filled-in value does not match the
 * field's rules, or undefined when it is fine. Empty values are left to the
 * required check.
 */
export function contactFieldValueError(field: ContactFieldConfig, value: string | undefined): string | undefined {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return undefined;
  if (field.inputType === "year") {
    return birthYearOptions(field).includes(trimmed) ? undefined : `Bitte wähle bei „${field.label}“ ein Jahr aus der Liste.`;
  }
  if (trimmed.length > contactFieldMaxLength(field)) return `„${field.label}“ ist zu lang.`;
  const charset = contactFieldCharset(field);
  if (charset === "digits" && /[^0-9]/.test(trimmed)) return `Bei „${field.label}“ sind nur Zahlen erlaubt.`;
  if (charset === "letters" && new RegExp(DISALLOWED_LETTERS_SOURCE, "u").test(trimmed)) return `Bei „${field.label}“ sind nur Buchstaben erlaubt.`;
  return undefined;
}

function contactPageOf(config: FunnelConfig | undefined): ContactPage | undefined {
  return config?.pages.find((page): page is ContactPage => page.type === "contact");
}

/** Keeps only the values of fields that are switched on for this contact page. */
export function pickEnabledContactValues(page: ContactPage, contact: Record<string, string | undefined>): ApplicationContact {
  const result: ApplicationContact = {};
  for (const field of page.fields) {
    if (!field.enabled) continue;
    const value = contact[field.key];
    if (typeof value === "string") result[field.key] = value;
  }
  return result;
}

/**
 * Captures the wording of the extra fields as the person saw it, so renaming a
 * field later does not change what an existing entry shows.
 */
export function snapshotApplicationContactLabels(config: FunnelConfig, contact: ApplicationContact): ApplicationContactLabels {
  const labels: ApplicationContactLabels = {};
  for (const field of contactPageOf(config)?.fields ?? []) {
    if (isBuiltinContactFieldKey(field.key)) continue;
    if (!contact[field.key]?.trim()) continue;
    const label = field.label.trim();
    if (label) labels[field.key] = label;
  }
  return labels;
}

export type DisplayContactField = {
  key: string;
  label: string;
  value: string;
};

/**
 * All filled-in contact values in the order of the contact page, labelled for
 * people: the five original fields keep their fixed labels, every other field
 * uses the label from submission time, then the current funnel, then its key.
 * Values for fields that no longer exist are kept at the end.
 */
export function resolveApplicationContactFields(
  config: FunnelConfig | undefined,
  contact: ApplicationContact,
  contactLabels?: ApplicationContactLabels,
): DisplayContactField[] {
  const fields = contactPageOf(config)?.fields ?? [];
  const order = [
    ...fields.map(field => field.key),
    ...BUILTIN_CONTACT_FIELD_KEYS,
    ...Object.keys(contact),
  ].filter((key, index, keys) => keys.indexOf(key) === index);
  const currentLabels = new Map(fields.map(field => [field.key, field.label.trim()] as const));
  const result: DisplayContactField[] = [];
  for (const key of order) {
    const value = contact[key];
    if (typeof value !== "string" || !value.trim()) continue;
    const label = isBuiltinContactFieldKey(key)
      ? BUILTIN_CONTACT_FIELD_LABELS[key]
      : contactLabels?.[key]?.trim()
        || currentLabels.get(key)
        || (Object.hasOwn(CONTACT_FIELD_PRESETS, key) ? CONTACT_FIELD_PRESETS[key as ContactFieldPresetKey].label : "")
        || key;
    result.push({ key, label, value });
  }
  return result;
}

/** Extra fields only (everything except name, company, email, phone, message). */
export function resolveExtraContactFields(
  config: FunnelConfig | undefined,
  contact: ApplicationContact,
  contactLabels?: ApplicationContactLabels,
): DisplayContactField[] {
  return resolveApplicationContactFields(config, contact, contactLabels).filter(field => !isBuiltinContactFieldKey(field.key));
}
