# Visuelle Qualitätsprüfung

Stand: 27. Juli 2026

Geprüfte Desktop-Routen bei 1440 × 1000 Pixeln: `/f/karriere`, `/admin`, `/admin/editor` und `/admin/settings`.

Der öffentliche Funnel zeigt eine klare, vertrauenswürdige blau-weiße Gestaltung, eine starke Überschriftenhierarchie, einen gut sichtbaren CTA, konsistente Fortschrittsanzeige sowie einen unaufdringlichen Social-Proof-Footer. Die Admin-Oberflächen sind gut lesbar, funktional und visuell konsistent. Bewerbungsübersicht, Editor mit 390-Pixel-Livevorschau und Einstellungsseite wurden ohne sichtbare Überlappungen oder abgeschnittene Kerninhalte gerendert.

Die unabhängige Stilprüfung empfiehlt für eine spätere Branding-Runde vor allem eine eigenständigere Wort-/Bildmarke, ein wiederkehrendes Recruiting-Motiv und eine etwas markantere Produktstimme. Diese Empfehlungen sind keine funktionalen Blocker. Die aktuelle neutrale Standardmarke „Dein Unternehmen“ bleibt absichtlich vollständig über den Editor austauschbar.

In der internen Screenshot-Umgebung zeigt die Einstellungsseite als `window.location.origin` die lokale Preview-Adresse `http://127.0.0.1:3000`. In einer veröffentlichten Bereitstellung wird daraus automatisch die reale Domain. Vor WordPress-Einbindung ist der angezeigte Direktlink in der veröffentlichten Umgebung nochmals zu kontrollieren.

Zusätzlich wurden dieselben vier Routen bei **390 × 844 Pixeln** geprüft. Der Funnel ordnet Inhalt, CTA, Illustration und Footer untereinander an, ohne horizontales Abschneiden. Bewerbungsübersicht, Editor und Einstellungen wechseln in eine einspaltige Darstellung; Such-/Filterelemente, Formulare und Aktionsbuttons bleiben erreichbar. Die Editor-Livevorschau wird unterhalb der Eingabefelder dargestellt. Es wurden keine mobilen Layoutblocker festgestellt.
