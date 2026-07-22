function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `Die Umgebungsvariable ${name} fehlt. Bitte in Vercel unter Settings > Environment Variables hinterlegen.`,
    );
  }

  return value;
}

export function getSupabaseEnv() {
  const url = required(
    "NEXT_PUBLIC_SUPABASE_URL",
    process.env.NEXT_PUBLIC_SUPABASE_URL,
  );

  const publishableKey = required(
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY oder NEXT_PUBLIC_SUPABASE_ANON_KEY",
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );

  return { url, publishableKey };
}
