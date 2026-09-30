// Klockan i supabase-läget: testtid i testmiljön (epokerna i app_settings), riktig tid i produktion.
import { describe, expect, it } from "vitest";
import { DEMO_START } from "@/data/seed";
import { clockNow, clockSettings, parseDemoEpoch, parseEpochMs, REAL_CLOCK } from "./clock";
import { settingsFromRows } from "./settings";

const SEEDED = Date.parse("2026-09-30T08:00:00Z"); // när seeden lästes in (riktig tid)

describe("testklockan", () => {
  it("startar på DEMO_START när seeden läses in och går sedan i vanlig takt", () => {
    const s = clockSettings("auto", "2026-09-30 10:00:00.123456+02", DEMO_START);
    expect(s).toEqual({ mode: "test", realEpochMs: SEEDED + 123, demoEpoch: "2027-02-01T09:12" });
    expect(clockNow(s, SEEDED)).toBe("2027-02-01T09:12");
    expect(clockNow(s, SEEDED + 59_999)).toBe("2027-02-01T09:12");
    expect(clockNow(s, SEEDED + 28 * 60_000 + 200)).toBe("2027-02-01T09:40");
    expect(clockNow(s, SEEDED + 3 * 24 * 3_600_000 + 200)).toBe("2027-02-04T09:12");
    // Före seeden (klockor som skiljer lite): aldrig före starttiden.
    expect(clockNow(s, SEEDED - 3_600_000)).toBe("2027-02-01T09:12");
  });

  it("MM_CLOCK=real och saknade epoker ger riktig tid i Stockholm", () => {
    expect(clockSettings("real", "2026-09-30T08:00:00Z", DEMO_START)).toEqual(REAL_CLOCK);
    expect(clockSettings("auto", null, DEMO_START)).toEqual(REAL_CLOCK);
    expect(clockSettings("test", "2026-09-30T08:00:00Z", null)).toEqual(REAL_CLOCK);
    expect(clockNow(REAL_CLOCK, SEEDED)).toBe("2026-09-30T10:00");
    expect(clockNow(REAL_CLOCK, Date.parse("2027-01-15T08:00:00Z"))).toBe("2027-01-15T09:00");
  });

  it("tolkar epokerna i olika format", () => {
    expect(parseEpochMs("2026-09-30T08:00:00Z")).toBe(SEEDED);
    expect(parseEpochMs("2026-09-30T10:00:00+02:00")).toBe(SEEDED);
    expect(parseEpochMs(String(SEEDED))).toBe(SEEDED);
    expect(parseEpochMs("igår")).toBeNull();
    expect(parseDemoEpoch("2027-02-01T09:12")).toBe("2027-02-01T09:12");
    expect(parseDemoEpoch("2027-02-01 09:12:00")).toBe("2027-02-01T09:12");
    expect(parseDemoEpoch("2027-02-01T08:12:00Z")).toBe("2027-02-01T09:12");
    expect(parseDemoEpoch("x")).toBeNull();
  });
});

describe("app_settings", () => {
  it("testmiljön med epoker", () => {
    const s = settingsFromRows(
      [
        { key: "environment", value: "staging" },
        { key: "clock_real_epoch", value: "2026-09-30T08:00:00+00:00" },
        { key: "clock_demo_epoch", value: "2027-02-01T09:12" },
      ],
      "auto",
    );
    expect(s.environment).toBe("staging");
    expect(clockNow(s.clock, SEEDED + 5 * 60_000)).toBe("2027-02-01T09:17");
  });

  it("produktion: ingen rad = produktion och riktig tid", () => {
    const s = settingsFromRows([], "auto");
    expect(s).toEqual({ environment: "production", clock: REAL_CLOCK });
  });
});
