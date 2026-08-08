import { describe, expect, it, vi } from "vitest";
import { applyPostSubmitAction, isSafeRedirectUrl } from "../client/src/lib/postSubmit";

describe("Aktion nach erfolgreicher Bewerbung", () => {
  it("erlaubt ausschließlich absolute HTTPS-Ziele", () => {
    expect(isSafeRedirectUrl("https://example.org/danke")).toBe(true);
    expect(isSafeRedirectUrl("http://example.org/danke")).toBe(false);
    expect(isSafeRedirectUrl("/danke")).toBe(false);
    expect(isSafeRedirectUrl("javascript:alert(1)")).toBe(false);
  });

  it("leitet nur im gültigen Weiterleitungsmodus um und fällt sonst auf die Erfolgsnachricht zurück", () => {
    const showMessage = vi.fn();
    const navigate = vi.fn();
    expect(applyPostSubmitAction({ mode: "redirect", redirectUrl: "https://example.org/danke" }, showMessage, navigate)).toBe("redirect");
    expect(navigate).toHaveBeenCalledWith("https://example.org/danke");
    expect(showMessage).not.toHaveBeenCalled();

    navigate.mockClear();
    expect(applyPostSubmitAction({ mode: "redirect", redirectUrl: "http://example.org" }, showMessage, navigate)).toBe("message");
    expect(navigate).not.toHaveBeenCalled();
    expect(showMessage).toHaveBeenCalledTimes(1);
  });
});
