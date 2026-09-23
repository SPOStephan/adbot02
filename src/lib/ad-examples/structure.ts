/** Structural ad templates — layout slots, not campaign copy. */

export const STRUCTURE_TEMPLATE_KINDS = [
  { value: "none", label: "Keine Strukturvorlage" },
  { value: "job", label: "Job-Anzeige" },
  { value: "product", label: "Produkt / Angebot" },
  { value: "lead", label: "Lead / Funnel" },
] as const;

export type StructureTemplateKind =
  (typeof STRUCTURE_TEMPLATE_KINDS)[number]["value"];

export type StructureSlotRole =
  | "logo"
  | "image"
  | "headline"
  | "body"
  | "cta"
  | "other";

export type AdStructureSlot = {
  key: string;
  role: StructureSlotRole;
  placement: string;
  maxChars: number;
  notes: string;
};

export type AdStructureTemplate = {
  kind: StructureTemplateKind;
  slots: AdStructureSlot[];
};

export const JOB_AD_STRUCTURE: AdStructureTemplate = {
  kind: "job",
  slots: [
    {
      key: "logo",
      role: "logo",
      placement: "oben links",
      maxChars: 0,
      notes: "Firmenlogo, klein, klarer Freiraum",
    },
    {
      key: "illustration",
      role: "image",
      placement: "visuelle Hauptfläche",
      maxChars: 0,
      notes: "Beruf oder Branche visualisieren, kein Werbetext im Bild",
    },
    {
      key: "job_title",
      role: "headline",
      placement: "oben / Mitte",
      maxChars: 48,
      notes: "Konkreter Jobtitel, nicht die Firma",
    },
    {
      key: "job_description",
      role: "body",
      placement: "unter dem Titel",
      maxChars: 180,
      notes: "Zwei bis drei Nutzen oder Aufgaben, keine Stellenanzeigen-Novelle",
    },
    {
      key: "cta",
      role: "cta",
      placement: "unten",
      maxChars: 24,
      notes: "Jetzt bewerben / Stelle ansehen",
    },
  ],
};

const SLOT_ROLES: readonly StructureSlotRole[] = [
  "logo",
  "image",
  "headline",
  "body",
  "cta",
  "other",
];

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export function parseStructureTemplateKind(value: unknown): StructureTemplateKind {
  if (value === "job" || value === "product" || value === "lead") return value;
  return "none";
}

export function parseAdStructureSlots(value: unknown): AdStructureSlot[] {
  if (typeof value === "string") {
    return value
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 12)
      .map((line, index) => {
        const [key, role, placement, maxChars, ...rest] = line
          .split("|")
          .map((part) => part.trim());
        const parsedRole = SLOT_ROLES.includes(role as StructureSlotRole)
          ? (role as StructureSlotRole)
          : "other";
        const max = Number(maxChars);
        return {
          key: (key || `slot_${index + 1}`).slice(0, 40),
          role: parsedRole,
          placement: (placement || "").slice(0, 80),
          maxChars: Number.isFinite(max) && max > 0 ? Math.min(Math.trunc(max), 400) : 0,
          notes: rest.join(" | ").slice(0, 200),
        };
      });
  }
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, 12)
    .map((item, index) => {
      const row =
        item && typeof item === "object" && !Array.isArray(item)
          ? (item as Record<string, unknown>)
          : {};
      const role = SLOT_ROLES.includes(row.role as StructureSlotRole)
        ? (row.role as StructureSlotRole)
        : "other";
      const max = Number(row.maxChars ?? row.max_chars);
      return {
        key: text(row.key, 40) || `slot_${index + 1}`,
        role,
        placement: text(row.placement, 80),
        maxChars: Number.isFinite(max) && max > 0 ? Math.min(Math.trunc(max), 400) : 0,
        notes: text(row.notes, 200),
      };
    })
    .filter((slot) => slot.key.length > 0);
}

export function resolveAdStructureTemplate(input: {
  kind?: unknown;
  slots?: unknown;
  tags?: string[];
}): AdStructureTemplate {
  const kind = parseStructureTemplateKind(input.kind);
  const parsedSlots = parseAdStructureSlots(input.slots);
  if (parsedSlots.length > 0) {
    return { kind: kind === "none" && input.tags?.includes("jobs") ? "job" : kind, slots: parsedSlots };
  }
  if (kind === "job" || (kind === "none" && (input.tags ?? []).includes("jobs"))) {
    return JOB_AD_STRUCTURE;
  }
  return { kind, slots: [] };
}

export function formatStructureForPrompt(template: AdStructureTemplate): string {
  if (template.slots.length < 1) return "";
  const lines = template.slots.map((slot) => {
    const length = slot.maxChars > 0 ? `, max. ${slot.maxChars} Zeichen` : "";
    const notes = slot.notes ? ` — ${slot.notes}` : "";
    return `- ${slot.key} (${slot.role}) bei „${slot.placement || "frei"}“${length}${notes}`;
  });
  return [`Strukturvorlage ${template.kind}:`, ...lines].join("\n");
}

export function serializeStructureSlots(slots: readonly AdStructureSlot[]): string {
  return slots
    .map((slot) =>
      [slot.key, slot.role, slot.placement, String(slot.maxChars), slot.notes]
        .join(" | ")
        .trim(),
    )
    .join("\n");
}

export function normalizeCreativeTags(value: unknown): string[] {
  const source = Array.isArray(value) ? value.join(",") : String(value ?? "");
  return [
    ...new Set(
      source
        .split(",")
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean),
    ),
  ]
    .slice(0, 12)
    .map((item) => item.slice(0, 40));
}
