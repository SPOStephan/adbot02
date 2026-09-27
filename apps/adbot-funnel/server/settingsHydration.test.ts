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
