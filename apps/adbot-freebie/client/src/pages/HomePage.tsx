export function HomePage() {
  return (
    <div className="funnel-canvas">
      <header className="funnel-header">
        <div className="funnel-wordmark">
          <span className="funnel-wordmark-mark" aria-hidden="true">
            AF
          </span>
          Adbot Freebie
        </div>
      </header>
      <main className="funnel-main">
        <section className="funnel-step funnel-start-step">
          <div className="funnel-copy">
            <p className="funnel-eyebrow">Adbot Freebie</p>
            <h1>Lead-Magnete mit DOI oder OTP.</h1>
            <p className="funnel-description">
              Lade dein Freebie hoch, wähle Bestätigung per Link oder Code und liefere
              nach E-Mail-Bestätigung über Bunny CDN aus.
            </p>
            <div className="mt-8">
              <a className="funnel-primary-button" href="/admin">
                Admin öffnen
              </a>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
