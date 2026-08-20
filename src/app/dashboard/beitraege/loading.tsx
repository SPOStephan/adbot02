import {
  DashboardContentSkeleton,
  DashboardPageHeader,
} from "@/components/DashboardPageHeader";
import { DASHBOARD_PAGE_COPY } from "@/lib/dashboard/page-copy";

export default function BeitraegeLoading() {
  const copy = DASHBOARD_PAGE_COPY.beitraege;
  return (
    <>
      <DashboardPageHeader
        description={copy.description}
        eyebrow={copy.eyebrow}
        title={copy.title}
      />
      <DashboardContentSkeleton />
    </>
  );
}
