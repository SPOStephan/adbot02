import { describe, expect, it } from "vitest";
import { getNextIconGridIndex, isIconActivationKey } from "../client/src/lib/iconKeyboard";

describe("Icon-Galerie Tastaturbedienung", () => {
  it("navigiert horizontal, vertikal sowie zum Anfang und Ende", () => {
    const next = (currentIndex: number, key: string) => getNextIconGridIndex({ currentIndex, key, itemCount: 10, columnCount: 3 });

    expect(next(4, "ArrowLeft")).toBe(3);
    expect(next(4, "ArrowRight")).toBe(5);
    expect(next(4, "ArrowUp")).toBe(1);
    expect(next(4, "ArrowDown")).toBe(7);
    expect(next(4, "Home")).toBe(0);
    expect(next(4, "End")).toBe(9);
  });

  it("hält den Fokus an den Galeriegrenzen und ignoriert fremde Tasten", () => {
    expect(getNextIconGridIndex({ currentIndex: 0, key: "ArrowLeft", itemCount: 4, columnCount: 3 })).toBe(0);
    expect(getNextIconGridIndex({ currentIndex: 3, key: "ArrowDown", itemCount: 4, columnCount: 3 })).toBe(3);
    expect(getNextIconGridIndex({ currentIndex: 2, key: "Tab", itemCount: 4, columnCount: 3 })).toBeNull();
    expect(getNextIconGridIndex({ currentIndex: 0, key: "Home", itemCount: 0, columnCount: 3 })).toBeNull();
  });

  it("erkennt Enter und Leertaste als Auswahl, nicht jedoch Navigationstasten", () => {
    expect(isIconActivationKey("Enter")).toBe(true);
    expect(isIconActivationKey(" ")).toBe(true);
    expect(isIconActivationKey("ArrowRight")).toBe(false);
  });
});
