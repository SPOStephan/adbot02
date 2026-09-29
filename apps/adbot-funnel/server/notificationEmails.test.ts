import { describe, expect, it } from "vitest";
import { formatNotificationEmails, notificationEmailsAreValid, parseNotificationEmails } from "@shared/notificationEmails";
import { funnelConfigSchema } from "@shared/funnelSchemas";
import { defaultFunnel } from "@shared/defaultFunnel";

describe("notification emails", () => {
  it("parses comma, semicolon and whitespace separated lists", () => {
    expect(parseNotificationEmails("a@example.org, b@example.org;c@example.org  d@example.org")).toEqual([
      "a@example.org",
      "b@example.org",
      "c@example.org",
      "d@example.org",
    ]);
    expect(parseNotificationEmails("")).toEqual([]);
  });

  it("formats a list as a comma-separated string and drops empty rows", () => {
    expect(formatNotificationEmails(["a@example.org", " ", "b@example.org "])).toBe("a@example.org, b@example.org");
  });

  it("validates every address", () => {
    expect(notificationEmailsAreValid("")).toBe(true);
    expect(notificationEmailsAreValid("a@example.org, b@example.org")).toBe(true);
    expect(notificationEmailsAreValid("a@example.org, kein-mail")).toBe(false);
  });

  it("accepts several recipients in the funnel config schema", () => {
    const base = { ...defaultFunnel, notificationEmail: "a@example.org, b@example.org" };
    expect(funnelConfigSchema.safeParse(base).success).toBe(true);
    expect(funnelConfigSchema.safeParse({ ...base, notificationEmail: "a@example.org, falsch" }).success).toBe(false);
  });
});
