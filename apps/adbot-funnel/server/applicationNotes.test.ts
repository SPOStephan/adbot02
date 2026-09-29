import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { TrpcContext } from "./_core/context";
import { buildMemberUser } from "./_core/session";
import { resetMemoryStoreForTests } from "./funnelStore";
import { appRouter } from "./routers";

const request = { protocol: "https", headers: {} } as TrpcContext["req"];
const response = {} as TrpcContext["res"];

const publicContext: TrpcContext = { user: null, req: request, res: response };

const platformAdmin: TrpcContext = {
  user: {
    id: 1,
    openId: "admin:ops@example.org",
    email: "ops@example.org",
    name: "Ops",
    loginMethod: "password",
    role: "admin",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  },
  req: request,
  res: response,
};

const foreignMember: TrpcContext = {
  user: buildMemberUser({ ownerUserId: "ffffffff-1111-4222-8333-444444444444", email: "hr@fremd.example", name: "Fremd" }),
  req: request,
  res: response,
};

async function submitApplication() {
  return appRouter.createCaller(publicContext).funnel.submit({
    funnelSlug: "karriere",
    answers: { arbeitsbereich: ["vertrieb"], berufserfahrung: ["3-plus"] },
    contact: { name: "Erika Muster", email: "erika@example.org", phone: "+49 123" },
    consent: true,
  });
}

describe("Aktennotizen zu Bewerbungen", () => {
  beforeAll(() => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  });

  beforeEach(() => {
    resetMemoryStoreForTests();
  });

  it("speichert Autor und Zeitpunkt aus der Sitzung und zeigt den Verlauf in Reihenfolge", async () => {
    const { id } = await submitApplication();
    const ops = appRouter.createCaller(platformAdmin);

    expect(await ops.funnel.applicationNotes({ id })).toEqual([]);

    const first = await ops.funnel.addApplicationNote({ id, body: "  Telefonat geführt.  " });
    const second = await ops.funnel.addApplicationNote({ id, body: "Rückruf am Freitag." });

    expect(first).toMatchObject({
      applicationId: id,
      authorEmail: "ops@example.org",
      authorName: "Ops",
      authorLoginMethod: "password",
      body: "Telefonat geführt.",
    });
    expect(Number.isNaN(Date.parse(first.createdAt))).toBe(false);

    const notes = await ops.funnel.applicationNotes({ id });
    expect(notes.map(note => note.id)).toEqual([first.id, second.id]);
  });

  it("lehnt leere Notizen ab", async () => {
    const { id } = await submitApplication();
    const ops = appRouter.createCaller(platformAdmin);
    await expect(ops.funnel.addApplicationNote({ id, body: "   " })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("gibt fremden Zugängen weder Lese- noch Schreibzugriff", async () => {
    const { id } = await submitApplication();
    const ops = appRouter.createCaller(platformAdmin);
    await ops.funnel.addApplicationNote({ id, body: "Intern." });

    const member = appRouter.createCaller(foreignMember);
    await expect(member.funnel.applicationNotes({ id })).rejects.toBeDefined();
    await expect(member.funnel.addApplicationNote({ id, body: "Hallo" })).rejects.toBeDefined();
    expect(await ops.funnel.applicationNotes({ id })).toHaveLength(1);
  });
});
