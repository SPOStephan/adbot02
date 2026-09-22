import { DashboardPageHeader } from "@/components/DashboardPageHeader";
import { LiveSetupGuide } from "@/components/LiveSetupGuide";
import { DASHBOARD_PAGE_COPY } from "@/lib/dashboard/page-copy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function HilfePage() {
  const copy = DASHBOARD_PAGE_COPY.hilfe;
  return (
    <>
      <DashboardPageHeader
        description={copy.description}
        eyebrow={copy.eyebrow}
        title={copy.title}
      />
      <LiveSetupGuide />
    </>
  );
}
