import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import { getSiteBranding } from "@/lib/site-branding/branding";

import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const branding = await getSiteBranding();
  // Same-origin /icon (and rewrite /favicon.ico → /icon) so the uploaded
  // branding favicon wins over any leftover static Vercel favicon.ico.
  const version = branding.updatedAt
    ? encodeURIComponent(branding.updatedAt)
    : "default";
  const iconUrl = `/icon?v=${version}`;
  return {
    title: {
      default: "Adbot.one",
      template: "%s | Adbot.one",
    },
    description:
      "Kanalübergreifendes Dashboard für Werbekampagnen, Creatives und kontrollierte Optimierung.",
    icons: {
      icon: [{ url: iconUrl }],
      shortcut: iconUrl,
      apple: iconUrl,
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="de">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        {children}
      </body>
    </html>
  );
}
