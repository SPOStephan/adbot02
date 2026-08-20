import {
  DashboardContentSkeleton,
  DashboardPageHeader,
} from "@/components/DashboardPageHeader";
import { DASHBOARD_PAGE_COPY } from "@/lib/dashboard/page-copy";

export default function AssistentLoading() {
  const copy = DASHBOARD_PAGE_COPY.assistent;
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
