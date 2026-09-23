import type { FunnelPage } from "./funnel";

export function pageShowsEyebrow(page: Pick<FunnelPage, "eyebrow" | "showEyebrow">): boolean {
  return page.showEyebrow !== false && Boolean(page.eyebrow.trim());
}

export function pageShowsTitle(page: Pick<FunnelPage, "showTitle">): boolean {
  return page.showTitle !== false;
}

export function pageShowsDescription(page: Pick<FunnelPage, "description" | "showDescription">): boolean {
  return page.showDescription !== false && Boolean(page.description.trim());
}
