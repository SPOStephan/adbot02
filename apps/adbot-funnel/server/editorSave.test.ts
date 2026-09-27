import { describe, expect, it } from "vitest";
import { createEditorSaveController } from "../client/src/lib/editorSave";

describe("Editor-Speichern mit Revision", () => {
  it("wartet überlappende Saves ab und schreibt danach die letzte Farbe, nicht den ersten Stand", () => {
    let latest = { heroSectionBackground: "", badgeBackground: "", badgeText: "" };
    const save = createEditorSaveController({ getLatest: () => latest });

    latest = { heroSectionBackground: "#FFF4E5", badgeBackground: "", badgeText: "" };
    save.bumpRevision();
    const first = save.requestPersist(true);
    expect(first.action).toBe("start");
    expect(first.payload).toEqual({ heroSectionBackground: "#FFF4E5", badgeBackground: "", badgeText: "" });

    latest = { heroSectionBackground: "#FFF4E5", badgeBackground: "#0165C3", badgeText: "#FFFFFF" };
    save.bumpRevision();
    expect(save.requestPersist(false)).toEqual({ action: "queue", revision: 2 });

    const afterFirst = save.finishPersist(true);
    expect(afterFirst.clearDirty).toBe(false);
    expect(afterFirst.replay).toEqual({ silent: false });

    const second = save.requestPersist(afterFirst.replay!.silent);
    expect(second.action).toBe("start");
    expect(second.payload).toEqual({ heroSectionBackground: "#FFF4E5", badgeBackground: "#0165C3", badgeText: "#FFFFFF" });

    expect(save.finishPersist(true).clearDirty).toBe(true);
  });

  it("hält dirty, wenn während des Speicherns noch einmal geändert wurde", () => {
    let latest = { color: "#AAAAAA" };
    const save = createEditorSaveController({ getLatest: () => latest });
    save.bumpRevision();
    expect(save.requestPersist(true).action).toBe("start");
    latest = { color: "#BBBBBB" };
    save.bumpRevision();

    const finished = save.finishPersist(true);
    expect(finished.clearDirty).toBe(false);
    expect(finished.replay).toEqual({ silent: true });
    expect(save.requestPersist(true).payload).toEqual({ color: "#BBBBBB" });
  });

  it("überspringt leere Stände und setzt den Zähler beim Laden zurück", () => {
    const save = createEditorSaveController<{ color: string }>({ getLatest: () => undefined });
    save.bumpRevision();
    expect(save.requestPersist(true)).toEqual({ action: "skip", revision: 1 });
    save.reset();
    expect(save.revision).toBe(0);
    expect(save.inFlight).toBe(false);
  });
});
