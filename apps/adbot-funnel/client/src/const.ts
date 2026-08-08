export { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";

/** @deprecated Use the admin email/password form; kept as no-op redirect helper. */
export const startLogin = () => {
  if (typeof window === "undefined") return;
  if (!window.location.pathname.startsWith("/admin")) {
    window.location.href = "/admin";
  }
};
