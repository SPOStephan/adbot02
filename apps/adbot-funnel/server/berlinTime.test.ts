import { describe, expect, it } from "vitest";
import { berlinDateStamp, formatBerlinDate, formatBerlinDateTime, formatBerlinTime } from "@shared/berlinTime";

describe("berlinTime", () => {
  it("shows summer timestamps in MESZ (UTC+2)", () => {
    expect(formatBerlinDateTime("2026-09-29T09:48:36.000Z")).toBe("29.9.2026, 11:48:36");
    expect(formatBerlinTime("2026-09-29T09:48:36.000Z")).toBe("11:48");
  });

  it("shows winter timestamps in MEZ (UTC+1)", () => {
    expect(formatBerlinDateTime("2026-01-15T09:00:00.000Z")).toBe("15.1.2026, 10:00:00");
  });

  it("uses the Berlin calendar day around midnight", () => {
    expect(formatBerlinDate("2026-09-29T22:30:00.000Z")).toBe("30.9.2026");
    expect(berlinDateStamp("2026-09-29T22:30:00.000Z")).toBe("2026-09-30");
  });
});
