import type { Metadata } from "next";

import { LegalDocument } from "@/components/LegalDocument";
import { getLegalPage } from "@/lib/legal/pages";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Impressum",
  description: "Impressum von Adbot / AdPilot",
  robots: { index: true, follow: true },
};

export default async function ImpressumPage() {
  const page = await getLegalPage("impressum");
  return <LegalDocument page={page} />;
}
