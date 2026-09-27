import { describe, expect, it } from "vitest";

import { shouldHydrateSettingsFromQuery } from "../client/src/lib/settingsHydration";

describe("settings query hydration", () => {
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
