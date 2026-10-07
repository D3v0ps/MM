import { describe, expect, it } from "vitest";
import { parseContractConfig } from "./config";
import {
  ackTextFor, aiAllowed, awaitingAnswer, caseCounterId, coaches, duplicateActive, findCaseNumber, formatCaseNumber, nextCaseNumber, orderValueOre, phaseSince, previewNextCaseNumber,
  priceFor, stuck,
} from "./cases";
import { NOW, cfgWith, mkCase, mkCheckIn, mkPerson, mkPlacement, mkPriceItem, mkProfile, testDb, testEnv } from "./test-data";

const env = testEnv();

describe("ärendenummer {prefix}-{ÅÅ}-{NNNN}", () => {
  it("första numret för ett nytt år", () => {
    expect(nextCaseNumber(null, env.cfg, 2027)).toEqual({ caseNumber: "BOT-27-0001", lastValue: 1 });
  });
  it("fortsätter löpnumret per avtal och år", () => {
    expect(nextCaseNumber({ lastValue: 48 }, env.cfg, 2027)).toEqual({ caseNumber: "BOT-27-0049", lastValue: 49 });
    expect(nextCaseNumber(181, env.cfg, "2026")).toEqual({ caseNumber: "BOT-26-0182", lastValue: 182 });
  });
  it("prefixet kommer från avtalets konfiguration", () => {
    // Ett annat kommunavtal med eget prefix (påhittat).
    expect(nextCaseNumber(0, parseContractConfig({ casePrefix: "NYK", dataRole: "processor" }), 2027).caseNumber).toBe("NYK-27-0001");
  });
  it("fyller ut till fyra siffror men klipper aldrig", () => {
    expect(formatCaseNumber("BOT", 2027, 7)).toBe("BOT-27-0007");
    expect(formatCaseNumber("BOT", 2027, 12345)).toBe("BOT-27-12345");
  });
  it("förhandsvisning läser case_counters för avtal och år", () => {
    const db = testDb({ case_counters: [{ id: caseCounterId("c-bot", 2027), contractId: "c-bot", year: 2027, lastValue: 50 }, { id: "c-bot:2026", contractId: "c-bot", year: 2026, lastValue: 181 }] });
    expect(previewNextCaseNumber(db, env)).toBe("BOT-27-0051");
    expect(previewNextCaseNumber(testDb(), env)).toBe("BOT-27-0001");
  });
  it("hittar ärendenumret i en ämnesrad", () => {
    expect(findCaseNumber("SV: Komplettering BOT-27-0049 beställarreferens")).toBe("BOT-27-0049");
    expect(findCaseNumber("Ny beställning")).toBeNull();
  });
});

describe("pris och ordervärde", () => {
  const items = [mkPriceItem({ areaCode: "G", priceOre: 139800 }), mkPriceItem({ id: "pi-G2", areaCode: "G", priceOre: 145000, validFrom: "2027-09-10", validTo: null })];
  it("priset som gäller datumet", () => {
    expect(priceFor(items, "G", "2027-01-04")).toBe(139800);
    expect(priceFor(items, "G", "2027-09-10")).toBe(145000);
    expect(priceFor(items, "X", "2027-01-04")).toBe(0);
  });
  it("ordervärde = beställda veckor × veckopris vid start", () => {
    expect(orderValueOre(mkCase({ id: "c1", startDate: "2027-01-11", orderValueWeeks: 6 }), items, env)).toBe(6 * 139800);
    expect(orderValueOre(mkCase({ id: "c2", startDate: null, orderValueWeeks: null, plannedWeeks: 4 }), items, env)).toBe(4 * 139800);
  });
});

describe("ordererkännande", () => {
  it("besked senast en arbetsdag efter avropet – över helgen", () => {
    const c = mkCase({ id: "c1", caseNumber: "BOT-27-0049", referredAt: "2027-01-29T15:20" });
    expect(ackTextFor(c, env.cfg)).toBe(
      "Tack! Vi har tagit emot er beställning och gett den ärendenummer BOT-27-0049. Ni får besked om startdatum och ansvarig coach senast måndag 1 februari 2027 klockan 15.20. Använd gärna ärendenumret i stället för personnummer när ni kontaktar oss om deltagaren.",
    );
  });
  it("utan fastställd svarstid utelämnas beskedsmeningen", () => {
    const cfg = cfgWith((c) => { c.sla = c.sla.map((r) => (r.key === "avrop_svar" ? { ...r, within: "ATT_FASTSTÄLLA" } : r)); });
    expect(ackTextFor(mkCase({ id: "c1", caseNumber: "BOT-27-0049" }), cfg)).toBe(
      "Tack! Vi har tagit emot er beställning och gett den ärendenummer BOT-27-0049. Använd gärna ärendenumret i stället för personnummer när ni kontaktar oss om deltagaren.",
    );
  });
});

describe("fas och fastnat", () => {
  it("fasen räknas från första godkända avstämningen i fasen", () => {
    const c = mkCase({ id: "c1", startDate: "2027-01-04", phase: 2 });
    const db = testDb({
      check_ins: [
        mkCheckIn({ id: "ci1", caseId: "c1", heldAt: "2027-01-08T10:00", phase: 1 }),
        mkCheckIn({ id: "ci2", caseId: "c1", heldAt: "2027-01-15T10:00", phase: 2 }),
        mkCheckIn({ id: "ci3", caseId: "c1", heldAt: "2027-01-22T10:00", phase: 2 }),
        mkCheckIn({ id: "ci4", caseId: "c1", heldAt: "2027-01-29T10:00", phase: 3, status: "draft" }),
      ],
    });
    expect(phaseSince(c, db)).toBe("2027-01-15");
  });
  it("utan avstämningar gäller phaseSince och annars startdatum", () => {
    expect(phaseSince(mkCase({ id: "c1", startDate: "2027-01-04", phase: 3, phaseSince: "2027-01-18" }), testDb())).toBe("2027-01-18");
    expect(phaseSince(mkCase({ id: "c1", startDate: "2027-01-04" }), testDb())).toBe("2027-01-04");
  });
  it("fastnat i fas 1 efter mer än 10 dagar", () => {
    const c = mkCase({ id: "c1", startDate: "2027-01-18", phase: 1 });
    expect(stuck(c, testDb(), env)).toEqual({ days: 14, maxDays: 10, phase: 1 });
    expect(stuck(mkCase({ id: "c2", startDate: "2027-01-22", phase: 1 }), testDb(), env)).toBeNull();
    expect(stuck({ ...c, status: "closed" }, testDb(), env)).toBeNull();
    expect(stuck({ ...c, phase: 2 }, testDb(), env)).toBeNull();
  });
  it("fas 3 räknas inte som fastnat om praktik är planerad", () => {
    const c = mkCase({ id: "c1", startDate: "2026-12-01", phase: 3, phaseSince: "2026-12-14" });
    expect(stuck(c, testDb(), env)).toEqual({ days: 49, maxDays: 35, phase: 3 });
    expect(stuck(c, testDb({ placements: [mkPlacement({ id: "pl1", caseId: "c1" })] }), env)).toBeNull();
  });
});

describe("listor", () => {
  it("ärenden som väntar på svar", () => {
    const db = testDb({ cases: [mkCase({ id: "a", status: "acknowledged" }), mkCase({ id: "b", status: "received" }), mkCase({ id: "c", status: "confirmed" })] });
    expect(awaitingAnswer(db).map((c) => c.id)).toEqual(["a", "b"]);
  });
  it("huvudcoacher ur medlemskapen, i användarlistans ordning", () => {
    const db = testDb({
      profiles: [mkProfile({ id: "u-sara", fullName: "Sara" }), mkProfile({ id: "u-erik", fullName: "Erik" }), mkProfile({ id: "u-amira", fullName: "Amira" })],
      memberships: [
        { id: "m1", userId: "u-amira", contractId: "c-bot", role: "coach", customerUnit: null },
        { id: "m2", userId: "u-erik", contractId: "c-bot", role: "coach", customerUnit: null },
        { id: "m3", userId: "u-sara", contractId: "c-bot", role: "samordnare", customerUnit: null },
      ],
    });
    expect(coaches(db, "c-bot").map((p) => p.id)).toEqual(["u-erik", "u-amira"]);
  });
  it("dubblettkontroll på personnummerhash – bara pågående ärenden", () => {
    const db = testDb({
      persons: [mkPerson({ id: "p1", personnummerHash: "h1" }), mkPerson({ id: "p2", personnummerHash: "h2" })],
      cases: [mkCase({ id: "a", personId: "p1", status: "active" }), mkCase({ id: "b", personId: "p1", status: "closed" }), mkCase({ id: "c", personId: "p2", status: "paused" })],
    });
    expect(duplicateActive(db, "h1").map((c) => c.id)).toEqual(["a"]);
    expect(duplicateActive(db, "h2").map((c) => c.id)).toEqual(["c"]);
    expect(duplicateActive(db, "")).toEqual([]);
  });
});

it("klockan i testerna är demoklockan", () => {
  expect(NOW).toBe("2027-02-01T09:12");
});

describe("AI-spärr", () => {
  it("bara med samtycke och aldrig för skyddade personuppgifter", () => {
    const c = mkCase({ id: "c1", aiConsentStatus: "given" });
    expect(aiAllowed(c, mkPerson({ id: "p" }))).toBe(true);
    expect(aiAllowed(c, mkPerson({ id: "p", protectedIdentity: true }))).toBe(false);
    expect(aiAllowed({ ...c, aiConsentStatus: "revoked" }, mkPerson({ id: "p" }))).toBe(false);
    expect(aiAllowed({ ...c, aiConsentStatus: "not_asked" }, mkPerson({ id: "p" }))).toBe(false);
    expect(aiAllowed(c, null)).toBe(false);
  });
});
