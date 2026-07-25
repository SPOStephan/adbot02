import "server-only";

function normalized(value: string | undefined): string | null {
  const candidate = value?.trim();
  return candidate ? candidate : null;
}

export function hasSupabaseAdminKey(): boolean {
  return Boolean(
    normalized(process.env.SUPABASE_SECRET_KEY) ??
      normalized(process.env.SUPABASE_SERVICE_ROLE_KEY),
  );
}

export function getSupabaseAdminKey(): string {
  const modernSecretKey = normalized(process.env.SUPABASE_SECRET_KEY);

  if (modernSecretKey) {
    return modernSecretKey;
  }

  const legacyServiceRoleKey = normalized(
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  );

  if (legacyServiceRoleKey) {
    return legacyServiceRoleKey;
  }

  throw new Error(
    "Die serverseitige Supabase-Admin-Konfiguration fehlt. Bevorzugt SUPABASE_SECRET_KEY in Vercel hinterlegen; SUPABASE_SERVICE_ROLE_KEY wird nur als Legacy-Fallback unterstützt.",
  );
}
