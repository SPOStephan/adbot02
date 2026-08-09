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
  get freebieSsoSecret() {
    return readEnv("FREEBIE_SSO_SECRET").trim();
  },
  get bunnyStorageZone() {
    return readEnv("BUNNY_STORAGE_ZONE").trim();
  },
  get bunnyStorageApiKey() {
    return readEnv("BUNNY_STORAGE_API_KEY").trim();
  },
  get bunnyStorageRegion() {
    return readEnv("BUNNY_STORAGE_REGION").trim() || "de";
  },
  get bunnyCdnHostname() {
    return readEnv("BUNNY_CDN_HOSTNAME").trim();
  },
  get resendApiKey() {
    return readEnv("RESEND_API_KEY").trim();
  },
  get mailFrom() {
    return readEnv("MAIL_FROM").trim() || "Adbot Freebie <freebie@adbot.one>";
  },
  get publicAppUrl() {
    return (readEnv("PUBLIC_APP_URL").trim() || "https://freebie.adbot.one").replace(
      /\/+$/,
      "",
    );
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
      "ADMIN_EMAIL und ADMIN_PASSWORD müssen für den Freebie-Admin gesetzt sein.",
    );
  }
}
