import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

export type MetaLaunchMaintenanceResult = {
  cancelledPlans: number;
  releasedExposures: number;
};

export async function runMetaLaunchMaintenance(): Promise<MetaLaunchMaintenanceResult> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("cleanup_stale_meta_customer_launches", {
    p_user_id: null,
    p_min_age_seconds: 7200,
  });

  if (error) {
    throw new Error("meta_launch_maintenance_failed");
  }

  const row = Array.isArray(data) ? data[0] : null;
  return {
    cancelledPlans:
      typeof row?.cancelled_plans === "number" ? row.cancelled_plans : 0,
    releasedExposures:
      typeof row?.released_exposures === "number" ? row.released_exposures : 0,
  };
}
