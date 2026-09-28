import { describe, expect, it } from "vitest";
import { defaultFunnel } from "@shared/defaultFunnel";
import {
  resolveApplicationAnswers,
  snapshotApplicationAnswerLabels,
} from "@shared/applicationAnswers";

describe("lesbare Bewerbungsantworten", () => {
  it("zeigt das sichtbare Optionslabel mit Umlauten statt des technischen Werts", () => {
    const config = structuredClone(defaultFunnel);
    const choicePage = config.pages.find(page => page.type === "choice-grid");
    if (!choicePage || choicePage.type !== "choice-grid") throw new Error("Auswahlseite fehlt");
    choicePage.name = "Vertriebserfahrung";
    choicePage.questionKey = "question-32395331-216c-4e1c-99cc-73256a3bdcb3";
    choicePage.options[0] = {
      ...choicePage.options[0]!,
      value: "anderer-vertrieb-telefonvertrieb-au-endienst",
      label: "Anderer Vertrieb / Telefonvertrieb / Außendienst",
    };

    expect(resolveApplicationAnswers(config, {
      [choicePage.questionKey]: ["anderer-vertrieb-telefonvertrieb-au-endienst"],
    })).toEqual([{
      label: "Vertriebserfahrung",
      values: ["Anderer Vertrieb / Telefonvertrieb / Außendienst"],
    }]);
  });

  it("bewahrt für neue Bewerbungen den Wortlaut vom Zeitpunkt der Auswahl", () => {
    const config = structuredClone(defaultFunnel);
    const choicePage = config.pages.find(page => page.type === "choice-grid");
    if (!choicePage || choicePage.type !== "choice-grid") throw new Error("Auswahlseite fehlt");
    const value = choicePage.options[0]!.value;
    choicePage.options[0]!.label = "Immobilienkaufmann/-frau";
    const answers = { [choicePage.questionKey]: [value] };
    const snapshots = snapshotApplicationAnswerLabels(config, answers);

    choicePage.options[0]!.label = "Später geändertes Label";

    expect(resolveApplicationAnswers(config, answers, snapshots)[0]?.values).toEqual([
      "Immobilienkaufmann/-frau",
    ]);
  });

  it("erhält lesbare Legacy-Schlüssel und verbirgt veraltete technische Referenzen", () => {
    expect(resolveApplicationAnswers(undefined, {
      Arbeitsbereich: ["Vertrieb"],
      "question-aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee": ["Ja"],
    })).toEqual([
      { label: "Arbeitsbereich", values: ["Vertrieb"] },
      { label: "Frage 2", values: ["Ja"] },
    ]);
  });
});
