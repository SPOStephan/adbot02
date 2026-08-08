import { describe, expect, it } from "vitest";
import { defaultFunnel } from "@shared/defaultFunnel";
import { resolveApplicationAnswers } from "@shared/applicationAnswers";

describe("lesbare Bewerbungsantworten", () => {
  it("verwendet den nutzerdefinierten internen Seitennamen statt des technischen Question-Keys", () => {
    const config = structuredClone(defaultFunnel);
    const choicePage = config.pages.find(page => page.type === "choice-grid");
    if (!choicePage || choicePage.type !== "choice-grid") throw new Error("Auswahlseite fehlt");
    choicePage.name = "Sachkunde";
    choicePage.questionKey = "question-32395331-216c-4e1c-99cc-73256a3bdcb3";

    expect(resolveApplicationAnswers(config, {
      [choicePage.questionKey]: ["vorhanden"],
    })).toEqual([{ label: "Sachkunde", values: ["vorhanden"] }]);
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
