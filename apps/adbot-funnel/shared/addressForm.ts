import type { AddressForm, FunnelConfig, FunnelPage } from "./funnel";
import { DEFAULT_FUNNEL_GATE } from "./funnelGate";

export const DEFAULT_ADDRESS_FORM: AddressForm = "du";

export function resolveAddressForm(value?: string | null): AddressForm {
  return value === "sie" ? "sie" : DEFAULT_ADDRESS_FORM;
}

const DU_TO_SIE_PHRASES: Array<[RegExp, string]> = [
  [/\bBeantworte\b/g, "Beantworten Sie"],
  [/\bWähle\b/g, "Wählen Sie"],
  [/\bFinde heraus\b/g, "Finden Sie heraus"],
  [/\bFinde\b/g, "Finden Sie"],
  [/\bHinterlasse\b/g, "Hinterlassen Sie"],
  [/\bLade deinen\b/g, "Laden Sie Ihren"],
  [/\bLade deinen\b/gi, "Laden Sie Ihren"],
  [/\bBitte lade deinen\b/g, "Bitte laden Sie Ihren"],
  [/\bBitte lade\b/g, "Bitte laden Sie"],
  [/\bBitte fülle\b/g, "Bitte füllen Sie"],
  [/\bBitte bestätige\b/g, "Bitte bestätigen Sie"],
  [/\bBitte wähle\b/g, "Bitte wählen Sie"],
  [/\bbringst du\b/g, "bringen Sie"],
  [/\bmöchtest du\b/gi, "möchten Sie"],
  [/\bstehst du\b/g, "stehen Sie"],
  [/\bpasst am besten zu dir\b/g, "passt am besten zu Ihnen"],
  [/\bpasst der Job zu dir\b/gi, "passt der Job zu Ihnen"],
  [/\bzu dir\b/g, "zu Ihnen"],
  [/\bbei dir\b/g, "bei Ihnen"],
  [/\berreichen wir dich\b/g, "erreichen wir Sie"],
  [/\bWir melden uns\b/g, "Wir melden uns"],
];

const SIE_TO_DU_PHRASES: Array<[RegExp, string]> = [
  [/\bBeantworten Sie\b/g, "Beantworte"],
  [/\bWählen Sie\b/g, "Wähle"],
  [/\bFinden Sie heraus\b/g, "Finde heraus"],
  [/\bFinden Sie\b/g, "Finde"],
  [/\bHinterlassen Sie\b/g, "Hinterlasse"],
  [/\bLaden Sie Ihren\b/g, "Lade deinen"],
  [/\bBitte laden Sie Ihren\b/g, "Bitte lade deinen"],
  [/\bBitte laden Sie\b/g, "Bitte lade"],
  [/\bBitte füllen Sie\b/g, "Bitte fülle"],
  [/\bBitte bestätigen Sie\b/g, "Bitte bestätige"],
  [/\bBitte wählen Sie\b/g, "Bitte wähle"],
  [/\bbringen Sie\b/g, "bringst du"],
  [/\bmöchten Sie\b/gi, "möchtest du"],
  [/\bstehen Sie\b/g, "stehst du"],
  [/\bpasst am besten zu Ihnen\b/g, "passt am besten zu dir"],
  [/\bpasst der Job zu Ihnen\b/gi, "passt der Job zu dir"],
  [/\bzu Ihnen\b/g, "zu dir"],
  [/\bbei Ihnen\b/g, "bei dir"],
  [/\berreichen wir Sie\b/g, "erreichen wir dich"],
];

export function rewriteAddressText(text: string, from: AddressForm, to: AddressForm): string {
  if (!text || from === to) return text;
  let next = text;
  const phrases = to === "sie" ? DU_TO_SIE_PHRASES : SIE_TO_DU_PHRASES;
  for (const [pattern, replacement] of phrases) next = next.replace(pattern, replacement);
  if (to === "sie") {
    next = next
      .replace(/\b[Dd]eines\b/g, match => match[0] === "D" ? "Ihres" : "Ihres")
      .replace(/\b[Dd]einer\b/g, match => match[0] === "D" ? "Ihrer" : "Ihrer")
      .replace(/\b[Dd]einem\b/g, match => match[0] === "D" ? "Ihrem" : "Ihrem")
      .replace(/\b[Dd]einen\b/g, match => match[0] === "D" ? "Ihren" : "Ihren")
      .replace(/\b[Dd]eine\b/g, match => match[0] === "D" ? "Ihre" : "Ihre")
      .replace(/\b[Dd]ein\b/g, match => match[0] === "D" ? "Ihr" : "Ihr")
      .replace(/\b[Dd]ich\b/g, "Sie")
      .replace(/\b[Dd]ir\b/g, "Ihnen")
      .replace(/\b[Dd]u\b/g, "Sie");
  } else {
    next = next
      .replace(/\bIhres\b/g, "Deines")
      .replace(/\bIhrer\b/g, "Deiner")
      .replace(/\bIhrem\b/g, "Deinem")
      .replace(/\bIhren\b/g, "Deinen")
      .replace(/\bIhre\b/g, "Deine")
      .replace(/\bIhr\b/g, "Dein")
      .replace(/\bihres\b/g, "deines")
      .replace(/\bihrer\b/g, "deiner")
      .replace(/\bihrem\b/g, "deinem")
      .replace(/\bihren\b/g, "deinen")
      .replace(/\bihre\b/g, "deine")
      .replace(/\bihr\b/g, "dein")
      .replace(/\bIhnen\b/g, "dir");
  }
  return next;
}

export function applyAddressFormToConfig(config: FunnelConfig, nextForm: AddressForm): FunnelConfig {
  const current = resolveAddressForm(config.addressForm);
  if (current === nextForm) return { ...config, addressForm: nextForm };
  const rewrite = (value: string) => rewriteAddressText(value, current, nextForm);
  const gate = config.gate ?? DEFAULT_FUNNEL_GATE;
  return {
    ...config,
    addressForm: nextForm,
    title: rewrite(config.title),
    socialProof: {
      ...config.socialProof,
      eyebrow: rewrite(config.socialProof.eyebrow),
      text: rewrite(config.socialProof.text),
    },
    gate: {
      exitTitle: rewrite(gate.exitTitle),
      exitText: rewrite(gate.exitText),
      handoffTitle: rewrite(gate.handoffTitle),
      handoffText: rewrite(gate.handoffText),
    },
    pages: config.pages.map(page => rewritePage(page, rewrite)),
  };
}

function rewritePage(page: FunnelPage, rewrite: (value: string) => string): FunnelPage {
  const base = {
    ...page,
    eyebrow: rewrite(page.eyebrow),
    title: rewrite(page.title),
    description: rewrite(page.description),
    buttonLabel: rewrite(page.buttonLabel),
    progressTitle: rewrite(page.progressTitle),
    progressHint: rewrite(page.progressHint),
  };
  if (base.type === "start") {
    return {
      ...base,
      bullets: base.bullets.map(rewrite),
      trustNote: rewrite(base.trustNote),
      benefitsBandTitle: rewrite(base.benefitsBandTitle),
      secondaryButtonLabel: rewrite(base.secondaryButtonLabel),
      benefits: base.benefits.map(benefit => ({
        ...benefit,
        title: rewrite(benefit.title),
        text: rewrite(benefit.text),
      })),
    };
  }
  if (base.type === "choice-grid" || base.type === "choice-list") {
    return {
      ...base,
      options: base.options.map(option => ({
        ...option,
        label: rewrite(option.label),
        description: option.description ? rewrite(option.description) : option.description,
      })),
    };
  }
  return {
    ...base,
    fields: base.fields.map(field => ({
      ...field,
      label: rewrite(field.label),
      placeholder: rewrite(field.placeholder),
    })),
    consentLabel: rewrite(base.consentLabel),
    resumeLabel: rewrite(base.resumeLabel),
    successTitle: rewrite(base.successTitle),
    successText: rewrite(base.successText),
  };
}

export function funnelUiCopy(form: AddressForm) {
  const sie = form === "sie";
  return {
    back: "Zurück",
    loading: "Funnel wird geladen …",
    unavailableTitle: "Dieser Funnel ist gerade nicht erreichbar.",
    unavailableText: "Bitte versuche es später erneut.",
    fillField: (label: string) => sie
      ? `Bitte füllen Sie das Feld „${label}“ aus.`
      : `Bitte fülle das Feld „${label}“ aus.`,
    consentRequired: sie
      ? "Bitte bestätigen Sie die Datenschutz-Einwilligung."
      : "Bitte bestätige die Datenschutz-Einwilligung.",
    resumeRequired: sie
      ? "Bitte laden Sie Ihren Lebenslauf hoch."
      : "Bitte lade deinen Lebenslauf hoch.",
    resumeType: sie
      ? "Bitte laden Sie Ihren Lebenslauf als PDF-, DOC- oder DOCX-Datei hoch."
      : "Bitte lade deinen Lebenslauf als PDF-, DOC- oder DOCX-Datei hoch.",
    fileTooLarge: sie
      ? "Die Datei ist größer als 8 MB. Bitte wählen Sie eine kleinere Datei."
      : "Die Datei ist größer als 8 MB. Bitte wähle eine kleinere Datei.",
    fileUnreadable: sie
      ? "Die Datei konnte nicht gelesen werden. Bitte wählen Sie sie erneut aus."
      : "Die Datei konnte nicht gelesen werden. Bitte wähle sie erneut aus.",
    successEyebrow: "Erfolgreich übermittelt",
    sending: "Wird gesendet …",
    chooseFile: "Datei auswählen",
    wordmark: sie ? "Ihr Unternehmen" : "Dein Unternehmen",
    skip: "Zum Hauptinhalt springen",
    answerRequired: (title: string) => sie
      ? `Bitte beantworten Sie: ${title}`
      : `Bitte beantworte: ${title}`,
    continueHandoff: "Jetzt Bewerbung für diese Stelle fortsetzen",
  };
}
