export function HomePage() {
  return (
    <main className="relative mx-auto flex min-h-screen max-w-5xl flex-col justify-center px-6 py-16">
      <div className="max-w-2xl">
        <p className="brand text-5xl tracking-tight text-[var(--ink)] sm:text-6xl">
          Adbot Freebie
        </p>
        <h1 className="mt-5 text-2xl font-semibold tracking-tight text-[var(--ink)] sm:text-3xl">
          Lead-Magnete mit DOI oder OTP.
        </h1>
        <p className="mt-4 max-w-xl text-base leading-7 text-[var(--muted)]">
          Lade dein Freebie hoch, wähle Bestätigung per Link oder Code, und liefere nach
          E-Mail-Bestätigung über Bunny CDN aus.
        </p>
        <a
          className="mt-8 inline-flex rounded-xl bg-[var(--accent)] px-5 py-3 text-sm font-semibold text-white transition hover:brightness-110"
          href="/admin"
        >
          Admin öffnen
        </a>
      </div>
    </main>
  );
}
