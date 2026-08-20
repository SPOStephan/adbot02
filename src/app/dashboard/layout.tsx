import type { ReactNode } from "react";

import { DashboardShell } from "@/components/DashboardShell";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Layout must stay sync (no top-level awaits). Otherwise Next.js blocks
 * client navigations and page `loading.tsx` never shows.
 */
export default function DashboardLayout({
  children,
}: {
  children: ReactNode;
}) {
  return <DashboardShell>{children}</DashboardShell>;
}
