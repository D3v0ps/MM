import { describe, expect, it } from "vitest";
import type { CaseAreaChange } from "@/data/schema";
import { areaChangeProblem, areaChangesByCase, areaForMonth, effectiveMonthOf, inOrder, nextAreaChangeSeq } from "./area-changes";

const c = { id: "case-1", primaryAreaCode: "C" };
const change = (id: string, fromArea: string, toArea: string, changedAt: string, caseId = "case-1", seq = Number(id.replace(/\D/g, "")) || 1): CaseAreaChange => ({
  id, contractId: "c-bot", caseId, fromArea, toArea, effectiveMonth: effectiveMonthOf(changedAt), changedBy: "u-amira", changedAt, noteId: `note-${id}`, seq,
});

describe("effectiveMonthOf: månaden efter bytet", () => {
  it("ett byte i oktober gäller fakturan från november – också sista dagen i månaden och vid årsskiftet", () => {
    expect(effectiveMonthOf("2026-10-22T10:15")).toBe("2026-11");
    expect(effectiveMonthOf("2026-10-31T23:59")).toBe("2026-11");
    expect(effectiveMonthOf("2026-12-01T00:00")).toBe("2027-01");
  });
});

describe("areaForMonth: yrkesområdet som fakturan räknas på", () => {
  it("inga byten: ärendets yrkesområde", () => {
    expect(areaForMonth(c, [], "2026-10")).toBe("C");
    expect(areaForMonth({ id: "x", primaryAreaCode: null }, [], "2026-10")).toBeNull();
  });

  it("byte i oktober: oktober på det gamla yrkesområdet, november och senare på det nya", () => {
    const xs = [change("ch1", "A", "C", "2026-10-22T10:00")];
    expect(areaForMonth(c, xs, "2026-09")).toBe("A");
    expect(areaForMonth(c, xs, "2026-10")).toBe("A");
    expect(areaForMonth(c, xs, "2026-11")).toBe("C");
    expect(areaForMonth(c, xs, "2027-03")).toBe("C");
  });

  it("två byten i olika månader: varje månad får det yrkesområde som gällde", () => {
    const xs = [change("ch2", "C", "G", "2026-12-03T09:00"), change("ch1", "A", "C", "2026-10-22T10:00")];
    expect(areaForMonth(c, xs, "2026-10")).toBe("A");
    expect(areaForMonth(c, xs, "2026-11")).toBe("C");
    expect(areaForMonth(c, xs, "2026-12")).toBe("C");
    expect(areaForMonth(c, xs, "2027-01")).toBe("G");
  });

  it("två byten samma månad: bytesmånaden på det första gamla yrkesområdet, månaden efter på det sista nya", () => {
    const xs = [change("ch1", "A", "C", "2026-10-05T09:00"), change("ch2", "C", "G", "2026-10-20T09:00")];
    expect(areaForMonth(c, xs, "2026-10")).toBe("A");
    expect(areaForMonth(c, xs, "2026-11")).toBe("G");
  });

  it("två byten samma minut (G → D, sedan rättat D → H): ordningen är bytets nummer, aldrig id:t – fakturan på H", () => {
    // I produktionen är id:t slumpat (cac-<uuid>): det rättade bytet kan ha ett id som sorteras före det första.
    const at = "2026-10-22T10:15";
    const xs = [change("cac-ffff", "G", "D", at, "case-1", 1), change("cac-0000", "D", "H", at, "case-1", 2)];
    expect(inOrder(xs).map((x) => x.toArea)).toEqual(["D", "H"]);
    expect(areaForMonth({ id: "case-1", primaryAreaCode: "H" }, xs, "2026-11")).toBe("H");
    expect(areaForMonth({ id: "case-1", primaryAreaCode: "H" }, [...xs].reverse(), "2026-11")).toBe("H");
    expect(areaForMonth({ id: "case-1", primaryAreaCode: "H" }, xs, "2026-10")).toBe("G");
    expect(nextAreaChangeSeq(xs)).toBe(3);
    expect(nextAreaChangeSeq([])).toBe(1);
  });

  it("bara ärendets egna byten räknas", () => {
    const xs = [change("ch9", "C", "K", "2026-09-10T09:00", "case-2")];
    expect(areaForMonth(c, xs, "2026-12")).toBe("C");
    expect(areaChangesByCase(xs).get("case-2")?.map((x) => x.id)).toEqual(["ch9"]);
  });
});

describe("areaChangeProblem: kontrollen av ett byte", () => {
  const areas = [{ code: "A", active: true }, { code: "C", active: true }, { code: "K", active: false }];
  const active = { status: "active" as const, primaryAreaCode: "A" };
  const ok = "Kartläggningen visade att lager passar bättre.";

  it("ett giltigt byte", () => {
    expect(areaChangeProblem(active, areas, "C", ok)).toBeNull();
    expect(areaChangeProblem({ ...active, status: "paused" }, areas, "C", ok)).toBeNull();
    expect(areaChangeProblem({ ...active, status: "confirmed" }, areas, "C", ok)).toBeNull();
  });

  it("avslutat, nekat eller obesvarat ärende nekas", () => {
    for (const status of ["closed", "declined", "received", "acknowledged"] as const) {
      expect(areaChangeProblem({ ...active, status }, areas, "C", ok)?.code, status).toBe("closed");
    }
  });

  it("okänt eller inaktivt yrkesområde, samma yrkesområde och ärende utan yrkesområde nekas", () => {
    expect(areaChangeProblem(active, areas, "Z", ok)?.code).toBe("area");
    expect(areaChangeProblem(active, areas, "K", ok)?.code).toBe("area");
    expect(areaChangeProblem(active, areas, "A", ok)?.code).toBe("same");
    expect(areaChangeProblem({ ...active, primaryAreaCode: null }, areas, "C", ok)?.code).toBe("no_area");
  });

  it("motiveringen: 10–300 tecken efter trim, aldrig personnummer", () => {
    expect(areaChangeProblem(active, areas, "C", "  för kort ")?.code).toBe("motivation");
    expect(areaChangeProblem(active, areas, "C", `  ${"x".repeat(10)}  `)).toBeNull();
    expect(areaChangeProblem(active, areas, "C", "x".repeat(300))).toBeNull();
    expect(areaChangeProblem(active, areas, "C", "x".repeat(301))?.code).toBe("motivation");
    expect(areaChangeProblem(active, areas, "C", "Gäller 19730216-9545 enligt kommunen.")?.code).toBe("pnr");
  });
});
