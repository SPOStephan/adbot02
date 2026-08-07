import type { Metadata } from "next";

import { LegalDocument } from "@/components/LegalDocument";
import { getLegalPage } from "@/lib/legal/pages";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Datenschutzerklärung",
  description: "Datenschutzerklärung von Adbot / AdPilot",
  robots: { index: true, follow: true },
};

export default async function DatenschutzPage() {
  const page = await getLegalPage("datenschutz");
  return <LegalDocument page={page} />;
}
