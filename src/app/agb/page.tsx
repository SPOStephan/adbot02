import type { Metadata } from "next";

import { LegalDocument } from "@/components/LegalDocument";
import { getLegalPage } from "@/lib/legal/pages";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "AGB",
  description: "Allgemeine Geschäftsbedingungen von Adbot / AdPilot",
  robots: { index: true, follow: true },
};

export default async function AgbPage() {
  const page = await getLegalPage("agb");
  return <LegalDocument page={page} />;
}
