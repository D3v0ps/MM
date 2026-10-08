import { describe, expect, it } from "vitest";
import { holidaysOf } from "./holidays";
import * as t from "./time";

// Facit: listan som prototypen använde (kontrollerad mot almanackan).
const FACIT_2026_2027: Record<string, string> = {
  "2026-01-01": "Nyårsdagen", "2026-01-06": "Trettondedag jul", "2026-04-03": "Långfredagen", "2026-04-05": "Påskdagen",
  "2026-04-06": "Annandag påsk", "2026-05-01": "Första maj", "2026-05-14": "Kristi himmelsfärdsdag", "2026-05-24": "Pingstdagen",
  "2026-06-06": "Sveriges nationaldag", "2026-06-19": "Midsommarafton", "2026-06-20": "Midsommardagen", "2026-10-31": "Alla helgons dag",
  "2026-12-24": "Julafton", "2026-12-25": "Juldagen", "2026-12-26": "Annandag jul", "2026-12-31": "Nyårsafton",
  "2027-01-01": "Nyårsdagen", "2027-01-06": "Trettondedag jul", "2027-03-26": "Långfredagen", "2027-03-28": "Påskdagen",
  "2027-03-29": "Annandag påsk", "2027-05-01": "Första maj", "2027-05-06": "Kristi himmelsfärdsdag", "2027-05-16": "Pingstdagen",
  "2027-06-06": "Sveriges nationaldag", "2027-06-25": "Midsommarafton", "2027-06-26": "Midsommardagen", "2027-11-06": "Alla helgons dag",
  "2027-12-24": "Julafton", "2027-12-25": "Juldagen", "2027-12-26": "Annandag jul", "2027-12-31": "Nyårsafton",
};

describe("helgdagar", () => {
  it("räknar fram samma helgdagar som almanackan 2026–2027", () => {
    expect({ ...holidaysOf(2026), ...holidaysOf(2027) }).toEqual(FACIT_2026_2027);
  });
  it("påsk 2030 och midsommar 2030", () => {
    expect(holidaysOf(2030)["2030-04-21"]).toBe("Påskdagen");
    expect(holidaysOf(2030)["2030-06-21"]).toBe("Midsommarafton");
  });
});

describe("ISO-veckor och torsdagsregeln", () => {
  it("ISO-vecka vid årsskiftet", () => {
    expect(t.isoWeek("2026-12-31").key).toBe("2026-W53");
    expect(t.isoWeek("2027-01-03").key).toBe("2026-W53");
    expect(t.isoWeek("2027-01-04").key).toBe("2027-W01");
    expect(t.weekMonday("2027-W05")).toBe("2027-02-01");
  });
  it("veckan hör till månaden där torsdagen infaller", () => {
    expect(t.weekMonthKey("2027-02-01")).toBe("2027-02"); // torsdag 4 feb
    expect(t.weekMonthKey("2026-11-30")).toBe("2026-12"); // torsdag 3 dec
    expect(t.weeksOfMonth("2027-01").map((w) => w.key)).toEqual(["2027-W01", "2027-W02", "2027-W03", "2027-W04"]);
  });
});

describe("arbetsdagar", () => {
  it("en arbetsdag efter fredag före trettondagen", () => {
    expect(t.addWorkingDays("2027-01-05T10:00", 1)).toBe("2027-01-07T10:00");
    expect(t.addWorkingDays("2026-12-23T15:00", 1)).toBe("2026-12-28T15:00");
  });
  it("femte arbetsdagen i januari 2027", () => {
    expect(t.nthWorkingDay("2027-01", 5)).toBe("2027-01-11"); // 1 och 6 jan är helgdagar
  });
});

describe("tidszon", () => {
  it("timestamptz till Stockholms lokala tid, vinter och sommar", () => {
    expect(t.toStockholmLocal("2027-02-01T08:12:00Z")).toBe("2027-02-01T09:12");
    expect(t.toStockholmLocal("2027-07-01T08:12:00Z")).toBe("2027-07-01T10:12");
  });
});

describe("omfattningen i månader (beslut 2026-10-07, synpunkt #5)", () => {
  it("planerat slut: dagen före samma datum n månader senare – månadens sista dag klipps", () => {
    expect(t.orderPeriodEnd("2027-02-15", 6)).toBe("2027-08-14");
    expect(t.orderPeriodEnd("2027-02-03", 6)).toBe("2027-08-02");
    expect(t.orderPeriodEnd("2027-02-03", 12)).toBe("2028-02-02");
    expect(t.orderPeriodEnd("2027-08-31", 6)).toBe("2028-02-28"); // 29 februari 2028 minus en dag
    expect(t.orderPeriodEnd("2027-01-01", 12)).toBe("2027-12-31");
    expect(t.orderPeriodEnd("2027-02-15T09:12", 6)).toBe("2027-08-14");
  });
  it("debiterbara veckor: alla ISO-veckor med minst en dag i perioden – samma regel som faktureringen", () => {
    expect(t.billableWeekCount("2027-02-03", "2027-08-02")).toBe(27);
    expect(t.billableWeekCount("2027-02-01", "2027-02-07")).toBe(1);
    expect(t.billableWeekCount("2027-02-07", "2027-02-08")).toBe(2); // söndag till måndag
    expect(t.billableWeekCount("2026-12-28", "2027-01-03")).toBe(1); // vecka 53 över årsskiftet
    expect(t.billableWeekCount("2027-02-08", "2027-02-07")).toBe(0);
  });
});
