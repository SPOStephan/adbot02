import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

export type MetaLaunchMaintenanceResult = {
  cancelledPlans: number;
  releasedExposures: number;
  recoveredPlans: number;
};

export async function runMetaLaunchMaintenance(): Promise<MetaLaunchMaintenanceResult> {
  const admin = createAdminClient();
  const { data: recoveryData, error: recoveryError } = await admin.rpc(
    "recover_interrupted_meta_customer_launches",
    { p_user_id: null },
  );
  if (recoveryError) {
    throw new Error("meta_launch_recovery_failed");
  }

  const { data, error } = await admin.rpc("cleanup_stale_meta_customer_launches", {
    p_user_id: null,
    p_min_age_seconds: 7200,
  });

  if (error) {
    throw new Error("meta_launch_maintenance_failed");
  }

  const row = Array.isArray(data) ? data[0] : null;
  const recoveryRow = Array.isArray(recoveryData) ? recoveryData[0] : null;
  return {
    cancelledPlans:
      typeof row?.cancelled_plans === "number" ? row.cancelled_plans : 0,
    releasedExposures:
      typeof row?.released_exposures === "number" ? row.released_exposures : 0,
    recoveredPlans:
      typeof recoveryRow?.recovered_plans === "number"
        ? recoveryRow.recovered_plans
        : 0,
  };
}
