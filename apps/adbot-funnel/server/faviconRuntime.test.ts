import { describe, expect, it } from "vitest";
import { applyFunnelDocumentBranding } from "../client/src/lib/favicon";

interface FakeLink {
  rel: string;
  href: string;
  dataset: Record<string, string>;
  removed: boolean;
  remove: () => void;
}

function createFakeDocument() {
  const links: FakeLink[] = [];
  const createLink = (): FakeLink => {
    const link: FakeLink = {
      rel: "",
      href: "",
      dataset: {},
      removed: false,
      remove: () => { link.removed = true; },
    };
    return link;
  };
  const documentRef = {
    title: "Recruiting Funnel",
    querySelector: () => links.find(link => !link.removed && link.dataset.funnelFavicon === "true") ?? null,
    createElement: () => createLink(),
    head: { append: (link: FakeLink) => links.push(link) },
  } as unknown as Document;
  return { documentRef, links };
}

describe("öffentliches Funnel-Favicon", () => {
  it("setzt Titel und Favicon und stellt den vorherigen Dokumentzustand beim Verlassen wieder her", () => {
    const { documentRef, links } = createFakeDocument();
    const restore = applyFunnelDocumentBranding({
      title: "Vertrieb Nord",
      faviconUrl: "https://storage.example.org/favicon.png",
    }, documentRef);

    expect(documentRef.title).toBe("Vertrieb Nord");
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({
      rel: "icon",
      href: "https://storage.example.org/favicon.png",
      dataset: { funnelFavicon: "true" },
      removed: false,
    });

    restore();
    expect(documentRef.title).toBe("Recruiting Funnel");
    expect(links[0]?.removed).toBe(true);
  });

  it("entfernt ein vorhandenes Funnel-Favicon, wenn der nächste Funnel keines konfiguriert", () => {
    const { documentRef, links } = createFakeDocument();
    const firstRestore = applyFunnelDocumentBranding({ title: "Erster Funnel", faviconUrl: "https://storage.example.org/a.png" }, documentRef);
    firstRestore();
    links[0]!.removed = false;

    const restore = applyFunnelDocumentBranding({ title: "Zweiter Funnel" }, documentRef);
    expect(links[0]?.removed).toBe(true);
    restore();
    expect(documentRef.title).toBe("Recruiting Funnel");
  });
});
