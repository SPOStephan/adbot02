import type { FunnelPostSubmit } from "@shared/funnel";

export type PostSubmitResult = "message" | "redirect";

export function isSafeRedirectUrl(value: string) {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

export function applyPostSubmitAction(
  config: FunnelPostSubmit,
  showMessage: () => void,
  navigate: (url: string) => void = url => window.location.assign(url),
): PostSubmitResult {
  if (config.mode === "redirect" && isSafeRedirectUrl(config.redirectUrl)) {
    navigate(config.redirectUrl);
    return "redirect";
  }
  showMessage();
  return "message";
}
