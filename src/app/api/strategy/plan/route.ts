import { NextRequest } from "next/server";

import { loadStrategyPlannerData } from "@/lib/cross-platform-strategy/data";
import { parseStrategyPlannerRequest } from "@/lib/cross-platform-strategy/input";
import { createCrossPlatformStrategyPlan } from "@/lib/cross-platform-strategy/planner";
import {
  controlErrorResponse,
  controlJson,
  readControlJson,
} from "@/lib/meta/customer-control-route";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(request: NextRequest) {
  try {
    const body = await readControlJson(request);
    const command = parseStrategyPlannerRequest(body);
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return controlJson(
        {
          ok: false,
          error: "unauthorized",
          message: "Bitte melde dich erneut an.",
        },
        401,
      );
    }

    const data = await loadStrategyPlannerData(user.id, {
      selectedPlatforms: command.selectedPlatforms,
    });
    const plan = createCrossPlatformStrategyPlan(command, data.context);

    return controlJson({ ok: true, plan });
  } catch (error) {
    return controlErrorResponse(error);
  }
}
