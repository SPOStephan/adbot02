import { describe, expect, it } from "vitest";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const resendApiKey = process.env.RESEND_API_KEY;
const mailFrom = process.env.MAIL_FROM;

describe.skipIf(!supabaseUrl || !supabaseServiceKey)("Supabase-Produktionszugang", () => {
  it("authentifiziert den Service-Schlüssel am REST-Endpunkt", async () => {
    const response = await fetch(`${supabaseUrl}/rest/v1/`, {
      headers: {
        apikey: supabaseServiceKey!,
        Authorization: `Bearer ${supabaseServiceKey}`,
      },
    });

    expect(response.status).toBe(200);
  });

  it.each(["funnels", "applications"])("kann die Tabelle %s über die Service-Rolle lesen", async table => {
    const response = await fetch(`${supabaseUrl}/rest/v1/${table}?select=id&limit=1`, {
      headers: {
        apikey: supabaseServiceKey!,
        Authorization: `Bearer ${supabaseServiceKey}`,
      },
    });

    expect(response.status, await response.text()).toBe(200);
  });
});

describe.skipIf(!resendApiKey || !mailFrom)("Resend-Produktionszugang", () => {
  it("akzeptiert den API-Schlüssel und den bestätigten Absender", async () => {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    });

    expect([400, 422]).toContain(response.status);
    expect(mailFrom).toMatch(/<[^<>\s]+@boncred\.info>|^[^<>\s]+@boncred\.info$/i);
  });
});
