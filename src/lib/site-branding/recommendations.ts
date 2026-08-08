/** Shown in the admin logo editor — keep in sync with upload limits. */
export const SITE_LOGO_RECOMMENDATIONS = {
  formatsLabel: "PNG, JPEG oder WebP (transparentes PNG bevorzugt)",
  allowedMimeTypes: ["image/png", "image/jpeg", "image/webp"] as const,
  maxBytes: 2 * 1024 * 1024,
  maxBytesLabel: "max. 2 MB",
  /** Display height in nav is ~40px; upload @2x. */
  recommendedWidthPx: { min: 360, max: 480 },
  recommendedHeightPx: { min: 80, max: 120 },
  widthLabel: "360–480 px Breite",
  heightLabel: "80–120 px Höhe",
  displayHeightPx: 40,
  onLight: {
    title: "Heller Modus",
    subtitle: "Für helle Hintergründe (Dashboard, Rechtstexte)",
    tip: "Dunkle oder farbige Schrift / Marke — gut lesbar auf Weiß und Hellgrau.",
  },
  onDark: {
    title: "Dark Mode",
    subtitle: "Für dunkle Hintergründe (Landingpage, Login)",
    tip: "Negativ-Logo mit weißer oder sehr heller Schrift — gut lesbar auf Dunkelgrau/Schwarz.",
  },
} as const;
