function readEnv(name: string) {
  return process.env[name] ?? "";
}

export const ENV = {
  get cookieSecret() {
    return readEnv("JWT_SECRET");
  },
  get adminEmail() {
    return readEnv("ADMIN_EMAIL").trim().toLowerCase();
  },
  get adminPassword() {
    return readEnv("ADMIN_PASSWORD");
  },
  get adminName() {
    return readEnv("ADMIN_NAME").trim() || "Adbot Admin";
  },
  get supabaseUrl() {
    return readEnv("SUPABASE_URL");
  },
  get supabaseServiceRoleKey() {
    return readEnv("SUPABASE_SERVICE_ROLE_KEY");
  },
  get storageBucket() {
    return readEnv("STORAGE_BUCKET").trim() || "application-resumes";
  },
  get funnelSsoSecret() {
    return readEnv("FUNNEL_SSO_SECRET").trim();
  },
  get isProduction() {
    return process.env.NODE_ENV === "production";
  },
};

export function assertAuthConfigured() {
  if (!ENV.cookieSecret || ENV.cookieSecret.length < 32) {
    throw new Error(
      "JWT_SECRET fehlt oder ist zu kurz (mindestens 32 Zeichen).",
    );
  }
  if (!ENV.adminEmail || !ENV.adminPassword) {
    throw new Error(
      "ADMIN_EMAIL und ADMIN_PASSWORD müssen für den Funnel-Admin gesetzt sein.",
    );
  }
}
