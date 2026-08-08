export const ENV = {
  cookieSecret: process.env.JWT_SECRET ?? "",
  adminEmail: (process.env.ADMIN_EMAIL ?? "").trim().toLowerCase(),
  adminPassword: process.env.ADMIN_PASSWORD ?? "",
  adminName: process.env.ADMIN_NAME?.trim() || "Adbot Admin",
  supabaseUrl: process.env.SUPABASE_URL ?? "",
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
  storageBucket: process.env.STORAGE_BUCKET?.trim() || "application-resumes",
  isProduction: process.env.NODE_ENV === "production",
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
