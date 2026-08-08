export interface FunnelDocumentBranding {
  title: string;
  faviconUrl?: string;
}

export function applyFunnelDocumentBranding(
  branding: FunnelDocumentBranding,
  documentRef: Document = document,
) {
  const previousTitle = documentRef.title;
  documentRef.title = branding.title;
  const existing = documentRef.querySelector<HTMLLinkElement>('link[data-funnel-favicon="true"]');
  let favicon = existing;

  if (branding.faviconUrl) {
    favicon = existing ?? documentRef.createElement("link");
    favicon.rel = "icon";
    favicon.dataset.funnelFavicon = "true";
    favicon.href = branding.faviconUrl;
    if (!existing) documentRef.head.append(favicon);
  } else {
    existing?.remove();
  }

  return () => {
    documentRef.title = previousTitle;
    favicon?.remove();
  };
}
