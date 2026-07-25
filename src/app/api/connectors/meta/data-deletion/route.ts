import { createHash, randomBytes } from "node:crypto";

import { NextResponse } from "next/server";

import { parseMetaSignedRequest } from "@/lib/meta/crypto";
import { getMetaWebhookEnv } from "@/lib/meta/env";
import { createPortalUrl } from "@/lib/site-urls";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const CONFIRMATION_CODE_PATTERN = /^[a-f0-9]{36}$/;

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

function hashConfirmationCode(code: string) {
  return createHash("sha256").update(code).digest("hex");
}

function statusPage(input: {
  title: string;
  message: string;
  status: number;
}) {
  const body = `<!doctype html>
<html lang="de">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${input.title} | AdBot</title>
  <style>
    :root { color-scheme: light; font-family: ui-sans-serif, system-ui, sans-serif; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f8fafc; color: #0f172a; }
    main { width: min(42rem, calc(100% - 2rem)); padding: 2rem; border: 1px solid #e2e8f0; border-radius: 1rem; background: white; box-shadow: 0 1rem 3rem rgba(15, 23, 42, .08); }
    h1 { margin: 0 0 1rem; font-size: clamp(1.5rem, 4vw, 2.25rem); }
    p { margin: 0; color: #475569; line-height: 1.65; }
  </style>
</head>
<body>
  <main>
    <h1>${input.title}</h1>
    <p>${input.message}</p>
  </main>
</body>
</html>`;

  return new Response(body, {
    status: input.status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
      "Content-Type": "text/html; charset=utf-8",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function GET(request: Request) {
  const code = new URL(request.url).searchParams.get("code");

  if (!code || !CONFIRMATION_CODE_PATTERN.test(code)) {
    return statusPage({
      title: "Ungültiger Löschstatus-Link",
      message:
        "Der Bestätigungscode fehlt oder ist ungültig. Bitte verwende den vollständigen Link aus deiner Meta-Datenlöschungsanfrage.",
      status: 400,
    });
  }

  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("meta_data_deletion_requests")
      .select("status, requested_at, completed_at")
      .eq("confirmation_hash", hashConfirmationCode(code))
      .maybeSingle();

    if (error || !data) {
      return statusPage({
        title: "Löschanfrage nicht gefunden",
        message:
          "Zu diesem Bestätigungscode liegt keine Löschanfrage vor. Es wurden keine personenbezogenen Daten offengelegt.",
        status: 404,
      });
    }

    const completed = data.status === "completed";
    return statusPage({
      title: completed
        ? "Meta-Verbindungsdaten wurden gelöscht"
        : "Meta-Datenlöschung wird bearbeitet",
      message: completed
        ? "Die bei AdBot gespeicherte Meta-Verbindung einschließlich Zugriffstoken und Asset-Zuordnungen wurde entfernt. Der Bestätigungscode bleibt nur als nicht rückrechenbarer Hash für den Statusnachweis gespeichert."
        : "Die Löschanfrage wurde angenommen und wird bearbeitet.",
      status: 200,
    });
  } catch {
    return statusPage({
      title: "Status derzeit nicht verfügbar",
      message:
        "Der Löschstatus konnte vorübergehend nicht geladen werden. Bitte versuche es später erneut.",
      status: 503,
    });
  }
}

export async function POST(request: Request) {
  let signedRequest: FormDataEntryValue | null = null;

  try {
    const formData = await request.formData();
    signedRequest = formData.get("signed_request");
  } catch {
    return json({ error: "invalid_request" }, 400);
  }

  if (typeof signedRequest !== "string") {
    return json({ error: "missing_signed_request" }, 400);
  }

  try {
    const { appSecret } = getMetaWebhookEnv();
    const payload = parseMetaSignedRequest(signedRequest, appSecret);

    if (!payload) {
      return json({ error: "invalid_signature" }, 400);
    }

    const admin = createAdminClient();
    const { error: deletionError } = await admin
      .from("platform_accounts")
      .delete()
      .eq("platform", "meta")
      .eq("meta_user_id", payload.user_id);

    if (deletionError) {
      console.error("[meta-oauth] Datenlöschung konnte nicht ausgeführt werden");
      return json({ error: "deletion_failed" }, 500);
    }

    const confirmationCode = randomBytes(18).toString("hex");
    const now = new Date().toISOString();
    const { error: statusError } = await admin
      .from("meta_data_deletion_requests")
      .insert({
        confirmation_hash: hashConfirmationCode(confirmationCode),
        status: "completed",
        requested_at: now,
        completed_at: now,
      });

    if (statusError) {
      console.error("[meta-oauth] Löschbestätigung konnte nicht gespeichert werden");
      return json({ error: "deletion_failed" }, 500);
    }

    const statusUrl = createPortalUrl(
      "/api/connectors/meta/data-deletion",
    );
    statusUrl.searchParams.set("code", confirmationCode);

    return json({
      url: statusUrl.toString(),
      confirmation_code: confirmationCode,
    });
  } catch {
    console.error("[meta-oauth] Datenlöschung konnte nicht verarbeitet werden");
    return json({ error: "deletion_failed" }, 500);
  }
}
