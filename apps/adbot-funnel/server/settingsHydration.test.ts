import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  SETTINGS_QUERY_OPTIONS,
  shouldHydrateSettingsFromQuery,
} from "../client/src/lib/settingsHydration";

describe("settings query hydration", () => {
  it("startet beim Zurückwechseln aus der Zwischenablage keinen Fokus-Refetch", () => {
    expect(SETTINGS_QUERY_OPTIONS.refetchOnWindowFocus).toBe(false);
  });

  it("zeigt beim Wiederöffnen keinen alten Cachewert vor der frischen Serverantwort", () => {
    expect(shouldHydrateSettingsFromQuery({
      fetchedAfterMount: false,
      hasLocalChanges: false,
    })).toBe(false);
  });

  it("übernimmt die frische Serverantwort nach dem Öffnen", () => {
    expect(shouldHydrateSettingsFromQuery({
      fetchedAfterMount: true,
      hasLocalChanges: false,
    })).toBe(true);
  });

  it("überschreibt keine laufende Benutzereingabe durch einen Refetch", () => {
    expect(shouldHydrateSettingsFromQuery({
      fetchedAfterMount: true,
      hasLocalChanges: true,
    })).toBe(false);
  });
});

describe("editor query hydration", () => {
  const editorSource = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "../client/src/pages/admin/FunnelEditor.tsx"),
    "utf8",
  );

  it("lädt den Editor nur aus einer frischen Serverantwort, nicht aus einem alten Cache", () => {
    expect(editorSource).toContain("...SETTINGS_QUERY_OPTIONS");
    expect(editorSource).toContain("!query.isFetchedAfterMount");
  });

  it("schreibt gespeicherte Werte (z. B. weitere Empfänger-E-Mails) in den Cache zurück", () => {
    expect(editorSource).toMatch(/adminConfig\.setData\(\{ id: saved\.id \}/);
  });
});
