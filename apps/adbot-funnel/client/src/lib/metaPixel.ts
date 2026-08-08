type MetaPixelFunction = ((...args: unknown[]) => void) & {
  callMethod?: (...args: unknown[]) => void;
  queue?: unknown[][];
  loaded?: boolean;
  version?: string;
};

declare global {
  interface Window {
    fbq?: MetaPixelFunction;
    _fbq?: MetaPixelFunction;
  }
}

const SCRIPT_ID = "meta-pixel-script";
const initializedPixels = new Set<string>();
const trackedPageViews = new Set<string>();

function ensureMetaQueue() {
  if (window.fbq) return window.fbq;
  const fbq = function (...args: unknown[]) {
    if (fbq.callMethod) fbq.callMethod(...args);
    else fbq.queue?.push(args);
  } as MetaPixelFunction;
  fbq.queue = [];
  fbq.loaded = true;
  fbq.version = "2.0";
  window.fbq = fbq;
  window._fbq = fbq;
  return fbq;
}

export function loadMetaPixel(pixelId: string) {
  if (typeof window === "undefined" || typeof document === "undefined" || !/^\d{5,25}$/.test(pixelId)) return false;
  const fbq = ensureMetaQueue();
  if (!document.getElementById(SCRIPT_ID)) {
    const script = document.createElement("script");
    script.id = SCRIPT_ID;
    script.async = true;
    script.src = "https://connect.facebook.net/en_US/fbevents.js";
    document.head.appendChild(script);
  }
  if (!initializedPixels.has(pixelId)) {
    fbq("init", pixelId);
    initializedPixels.add(pixelId);
  }
  const pageViewKey = `${pixelId}:${window.location.href}`;
  if (!trackedPageViews.has(pageViewKey)) {
    fbq("track", "PageView");
    trackedPageViews.add(pageViewKey);
  }
  return true;
}

export function trackMetaConversion(pixelId: string, eventName: string, eventId: string) {
  if (!loadMetaPixel(pixelId) || !window.fbq) return false;
  window.fbq(
    "track",
    eventName,
    { content_category: "Recruiting", content_name: "Completed application" },
    { eventID: eventId },
  );
  return true;
}

export function createMetaEventId() {
  return crypto.randomUUID();
}

export function readMetaBrowserIdentifiers(cookie = document.cookie) {
  const values = Object.fromEntries(cookie.split(";").map(entry => {
    const [key, ...rest] = entry.trim().split("=");
    return [key, decodeURIComponent(rest.join("="))];
  }));
  return {
    metaFbp: values._fbp || undefined,
    metaFbc: values._fbc || undefined,
  };
}

export function resetMetaPixelRuntimeForTests() {
  initializedPixels.clear();
  trackedPageViews.clear();
}
