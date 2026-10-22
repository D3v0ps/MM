// Återkommande nivåaktiviteter (Karims beslut 2026-10-22): vilka tillfällen som skapas – veckodagar, helgdagar, sista dag, aldrig
// ett inställt tillfälle igen, 14 dagar framåt – och valideringen och texten.
import { describe, expect, it } from "vitest";
import {
  isoWeekday, normalizeWeekdays, seriesOccurrenceStarts, seriesScheduleError, seriesScheduleText, seriesWeekdaysError, SERIES_HORIZON_DAYS, type SeriesPlan,
} from "./group-series";

// Måndag 1 februari 2027 kl. 09.12 (testklockan).
const NOW = "2027-02-01T09:12";
const plan = (o: Partial<SeriesPlan> = {}): SeriesPlan => ({ weekdays: [2, 4], startTime: "10:00", startsOn: "2027-02-01", endsOn: null, endedAt: null, ...o });
const none = new Set<string>();
const starts = (o: Partial<SeriesPlan> = {}, opts: { now?: string; holidays?: Set<string>; existing?: Set<string>; horizonDays?: number } = {}) =>
  seriesOccurrenceStarts(plan(o), { now: opts.now ?? NOW, holidays: opts.holidays ?? none, existing: opts.existing ?? none, horizonDays: opts.horizonDays });

describe("seriesOccurrenceStarts – tillfällena från i dag och 14 dagar framåt", () => {
  it("tisdag och torsdag 10.00: fyra tillfällen de närmaste 14 dagarna (till och med måndag 15 februari)", () => {
    expect(SERIES_HORIZON_DAYS).toBe(14);
    expect(starts()).toEqual(["2027-02-02T10:00", "2027-02-04T10:00", "2027-02-09T10:00", "2027-02-11T10:00"]);
    // Måndag 10.00 har inte börjat än (klockan är 09.12) – i dag kommer med.
    expect(starts({ weekdays: [1] })).toEqual(["2027-02-01T10:00", "2027-02-08T10:00", "2027-02-15T10:00"]);
  });
  it("ett tillfälle som redan har börjat i dag skapas inte – ett senare i dag skapas", () => {
    expect(starts({ weekdays: [1], startTime: "09:00" })).toEqual(["2027-02-08T09:00", "2027-02-15T09:00"]);
    expect(starts({ weekdays: [1], startTime: "13:30" })).toEqual(["2027-02-01T13:30", "2027-02-08T13:30", "2027-02-15T13:30"]);
  });
  it("helgdagar hoppas över (tabellen holidays)", () => {
    expect(starts({}, { holidays: new Set(["2027-02-04", "2027-02-11"]) })).toEqual(["2027-02-02T10:00", "2027-02-09T10:00"]);
    // Långfredagen och annandag påsk 2027.
    const easter = seriesOccurrenceStarts(plan({ weekdays: [1, 5], startsOn: "2027-03-22" }), { now: "2027-03-22T08:00", holidays: new Set(["2027-03-26", "2027-03-29"]), existing: none });
    expect(easter).toEqual(["2027-03-22T10:00", "2027-04-02T10:00", "2027-04-05T10:00"]);
  });
  it("första och sista dagen: inget före startsOn och inget efter endsOn", () => {
    expect(starts({ startsOn: "2027-02-08" })).toEqual(["2027-02-09T10:00", "2027-02-11T10:00"]);
    expect(starts({ endsOn: "2027-02-09" })).toEqual(["2027-02-02T10:00", "2027-02-04T10:00", "2027-02-09T10:00"]);
    expect(starts({ startsOn: "2027-03-01" })).toEqual([]);
  });
  it("ett tillfälle som redan finns – också ett inställt – skapas aldrig igen (idempotent)", () => {
    const existing = new Set(["2027-02-02T10:00", "2027-02-09T10:00"]);
    expect(starts({}, { existing })).toEqual(["2027-02-04T10:00", "2027-02-11T10:00"]);
    const all = new Set(starts());
    expect(starts({}, { existing: all })).toEqual([]);
  });
  it("horisonten: nya tillfällen tillkommer när dagarna går, aldrig mer än 14 dagar fram", () => {
    const later = starts({}, { now: "2027-02-08T12:00" });
    expect(later).toEqual(["2027-02-09T10:00", "2027-02-11T10:00", "2027-02-16T10:00", "2027-02-18T10:00"]);
    expect(later.every((x) => x <= "2027-02-22T23:59")).toBe(true);
    expect(starts({}, { horizonDays: 3 })).toEqual(["2027-02-02T10:00", "2027-02-04T10:00"]);
  });
  it("en avslutad serie får inga nya tillfällen", () => {
    expect(starts({ endedAt: "2027-02-01T09:00" })).toEqual([]);
  });
});

describe("veckodagar, tid och texten", () => {
  it("ISO-veckodag: måndag 1 … söndag 7", () => {
    expect(["2027-02-01", "2027-02-02", "2027-02-05", "2027-02-07"].map(isoWeekday)).toEqual([1, 2, 5, 7]);
  });
  it("minst en dag, bara måndag–fredag, varje dag en gång", () => {
    expect(seriesWeekdaysError([2, 4])).toBeNull();
    expect(seriesWeekdaysError([1, 2, 3, 4, 5])).toBeNull();
    expect(seriesWeekdaysError([])).toBe("Välj minst en veckodag.");
    expect(seriesWeekdaysError([6])).toMatch(/måndag till fredag/);
    expect(seriesWeekdaysError([0])).toMatch(/måndag till fredag/);
    expect(seriesWeekdaysError([2, 2])).toMatch(/en gång/);
    expect(normalizeWeekdays([4, 2, 4])).toEqual([2, 4]);
  });
  it("tiden HH:MM, första dagen inte före i dag, sista dagen inte före första", () => {
    const ok = { weekdays: [2], startTime: "10:00", startsOn: "2027-02-01", endsOn: null };
    expect(seriesScheduleError(ok, "2027-02-01")).toBeNull();
    expect(seriesScheduleError({ ...ok, startTime: "24:00" }, "2027-02-01")).toMatch(/tid/);
    expect(seriesScheduleError({ ...ok, startsOn: "2027-01-31" }, "2027-02-01")).toMatch(/före i dag/);
    expect(seriesScheduleError({ ...ok, endsOn: "2027-01-31" }, "2027-01-01")).toMatch(/Sista dagen/);
    expect(seriesScheduleError({ ...ok, weekdays: [] }, "2027-02-01")).toBe("Välj minst en veckodag.");
  });
  it("texten: \"tisdag och torsdag 10.00\", \"måndag, onsdag och fredag 13.30\"", () => {
    expect(seriesScheduleText([4, 2], "10:00")).toBe("tisdag och torsdag 10.00");
    expect(seriesScheduleText([1, 3, 5], "13:30")).toBe("måndag, onsdag och fredag 13.30");
    expect(seriesScheduleText([5], "09:00")).toBe("fredag 09.00");
  });
});
