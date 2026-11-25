// Den interna månadsrapporten (Karims beslut 2026-11-18) – genom samma execute() som appen och prototypen, mot testdatat i minnet
// (demoklockan 1 februari 2027 kl. 09.12). Bara påhittade uppgifter.
// Behörighet: samordnare, avtalsansvarig, coach och chef – aldrig ekonomen, kommunen, systemadministratören eller deltagaren.
import { beforeEach, describe, expect, it } from "vitest";
import "@/api/handlers";
import type { Actor, Role } from "@/api/roles";
import { BOTKYRKA_CONFIG } from "@/core/config";
import { kpiValue, type KpiDb } from "@/core/kpi";
import { listPersonas } from "@/data/actors";
import type { MemoryData } from "@/data/memory";
import { createMemoryRuntime, demoClock, type MemoryRuntime } from "@/data/memory-runtime";
import { createSeed, DEMO_START } from "@/data/seed";
import type { Tables } from "@/data/schema";
import { groupActivityCreate, groupGoalResultSet } from "@/features/aktiviteter/api";
import { attendanceSet } from "@/features/coach/api";
import { monthlyOverview, monthlyOverviewPdf, monthlyOverviewViewed, type MonthlyOverviewView } from "./api";

const SEED: MemoryData<Tables> = createSeed();
let rt: MemoryRuntime;
const fresh = (data: MemoryData<Tables> = structuredClone(SEED)) => {
  rt = createMemoryRuntime({ data, clock: demoClock(DEMO_START) });
};
beforeEach(() => fresh());
const as = (userId: string, role: Role): Actor => {
  const p = listPersonas(rt.raw()).find((x) => x.actor.userId === userId && x.actor.role === role);
  if (!p) throw new Error(`Ingen testperson ${userId}`);
  return p.actor;
};
const PARTICIPANT: Actor = { userId: "deltagare", role: "deltagare", contractIds: [], customerUnit: null };
type View = Extract<MonthlyOverviewView, { allowed: true }>;
const view = async (actor: Actor, input: Record<string, unknown> = { month: "2027-01" }) => {
  const v = (await rt.run("query", monthlyOverview.key, input, actor)) as MonthlyOverviewView;
  if (!v.allowed) throw new Error("inte tillåten");
  return v as View;
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const cmd = (key: string, input: unknown, actor: Actor): Promise<any> => rt.run("command", key, input, actor);
const audit = (action: string) => rt.store.rows("audit_log").filter((l) => l.action === action);

describe("vem får läsa rapporten", () => {
  it("samordnare, avtalsansvarig, coach och chef ser samma rapport för avtalet – coachen utan resultatgraden", async () => {
    const actors = [as("u-sara", "samordnare"), as("u-johan", "avtalsansvarig"), as("u-karin", "chef"), as("u-amira", "coach")];
    const views = await Promise.all(actors.map((a) => view(a)));
    for (const v of views) {
      expect(v.month).toBe("2027-01");
      expect(v.contractId).toBe("c-bot");
      expect(v.participants.length).toBeGreaterThan(50);
    }
    // Alla på Miljonbemanning ser alla ärenden i avtalet (beslut 2026-10-09) – samordnaren, avtalsansvarig och chefen ser samma.
    const strip = (v: View) => JSON.stringify({ ...v, generatedAt: null });
    expect(new Set(views.slice(0, 3).map(strip)).size).toBe(1);
    const [sara, , , coach] = views;
    expect(sara.results.month).toMatchObject({ contractTarget: 0.32, internalTarget: 0.35 });
    expect(sara.results.rolling).not.toBeNull();
    // Coachen får inte resultatgraden (månaden och rullande) eller målen för den – servern skickar dem inte (Karims beslut 2026-11-24).
    expect(coach.results.month).toBeNull();
    expect(coach.results.rolling).toBeNull();
    expect(JSON.stringify(coach)).not.toMatch(/contractTarget|internalTarget|Resultatgrad/);
    // Allt annat är detsamma.
    const noRate = (v: View) => strip({ ...v, results: { ...v.results, month: null, rolling: null } });
    expect(noRate(coach)).toBe(noRate(sara));
  });

  it("ekonomen, kommunen, systemadministratören och deltagaren nekas – också loggningen och PDF:en", async () => {
    const denied = [as("u-lars", "ekonom"), as("k-maria", "kommun_handlaggare"), as("u-robin", "admin"), PARTICIPANT];
    for (const a of denied) {
      await expect(rt.run("query", monthlyOverview.key, { month: "2027-01" }, a), a.role).rejects.toThrow();
      await expect(cmd(monthlyOverviewViewed.key, { contractId: "c-bot", month: "2027-01", area: null }, a), a.role).rejects.toThrow();
      await expect(cmd(monthlyOverviewPdf.key, { contractId: "c-bot", month: "2027-01", area: null }, a), a.role).rejects.toThrow();
    }
    expect(audit("monthly_overview.viewed")).toHaveLength(0);
    expect(audit("monthly_overview.downloaded")).toHaveLength(0);
  });

  it("standard är förra månaden; en månad utanför avtalet eller ett okänt yrkesområde ger standardvalet", async () => {
    const sara = as("u-sara", "samordnare");
    expect((await view(sara, {})).month).toBe("2027-01");
    expect((await view(sara, { month: "2030-01" })).month).toBe("2027-01");
    expect((await view(sara, { month: "2026-08" })).month).toBe("2027-01");
    const v = await view(sara, { month: "2027-01", area: "Q" });
    expect(v.area).toBeNull();
    expect(v.months[0]).toEqual({ value: "2027-02", label: "februari 2027" });
    expect(v.months.at(-1)).toEqual({ value: "2026-09", label: "september 2026" });
    expect(v.areas.map((a) => a.value)).toEqual(["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L"]);
    // Ett avtal som läsaren inte har ger standardvalet.
    expect((await view(sara, { contractId: "c-annat", month: "2027-01" })).contractId).toBe("c-bot");
  });

  it("ett avtal som inte har startat är aldrig förvalt; valt ger det ett tomt läge", async () => {
    const data = structuredClone(SEED);
    const bot = data.contracts.find((c) => c.id === "c-bot")!;
    data.contracts.push({ ...structuredClone(bot), id: "c-ny", contractNumber: "999", startsOn: "2027-03-01", casePrefix: "NY" });
    const m = data.memberships.find((x) => x.userId === "u-sara" && x.contractId === "c-bot")!;
    // Först i medlemskapens ordning – men inte förvalt.
    data.memberships.unshift({ ...m, id: "u-sara:c-ny", contractId: "c-ny" });
    fresh(data);
    const sara = as("u-sara", "samordnare");
    expect(sara.contractIds[0]).toBe("c-ny");
    const def = await view(sara, {});
    expect(def.contractId).toBe("c-bot");
    expect(def.contracts.map((c) => c.value)).toContain("c-ny");
    const ny = (await rt.run("query", monthlyOverview.key, { contractId: "c-ny" }, sara)) as MonthlyOverviewView;
    expect(ny).toEqual({ allowed: false, contracts: def.contracts, notStarted: { contractId: "c-ny", startsOn: "2027-03-01" } });
    expect(await cmd(monthlyOverviewViewed.key, { contractId: "c-ny", month: "2027-02", area: null }, sara)).toMatchObject({ ok: false, error: "not_found" });
  });
});

describe("siffrorna", () => {
  it("närvarograden är samma som nyckeltalet för månaden (ledningsvyn)", async () => {
    const v = await view(as("u-karin", "chef"));
    const rows = <N extends keyof Tables>(n: N) => rt.store.rows(n);
    const db: KpiDb = {
      cases: rows("cases"), reports: rows("reports"), activities: rows("activities"), attendance: rows("attendance"), pulse_responses: rows("pulse_responses"),
      first_meeting_no_shows: rows("first_meeting_no_shows"),
    };
    const kpi = kpiValue(db, "narvarograd", { month: "2027-01" }, { cfg: BOTKYRKA_CONFIG, now: DEMO_START, contractStart: "2026-09-10" })!;
    expect(v.attendance.total.rate).toBe(kpi.value);
    expect(v.attendance.total.present + v.attendance.total.late).toBe(kpi.num);
    expect(v.attendance.total.registered).toBe(kpi.den);
  });

  it("närvarograden är samma som nyckeltalet också när ett ärende avslutats med ett slutdatum före månaden", async () => {
    const data = structuredClone(SEED);
    const jan = data.activities.filter((a) => a.startsAt.startsWith("2027-01") && data.attendance.some((x) => x.activityId === a.id));
    const c = data.cases.find((x) => x.status === "active" && jan.filter((a) => a.caseId === x.id).length >= 3)!;
    Object.assign(c, { status: "closed", endDate: "2026-12-15", closedAt: "2027-01-28T10:00", endReason: "arbete", resultClass: "no_result" });
    fresh(data);
    const v = await view(as("u-karin", "chef"));
    const rows = <N extends keyof Tables>(n: N) => rt.store.rows(n);
    const db: KpiDb = {
      cases: rows("cases"), reports: rows("reports"), activities: rows("activities"), attendance: rows("attendance"), pulse_responses: rows("pulse_responses"),
      first_meeting_no_shows: rows("first_meeting_no_shows"),
    };
    const kpi = kpiValue(db, "narvarograd", { month: "2027-01" }, { cfg: BOTKYRKA_CONFIG, now: DEMO_START, contractStart: "2026-09-10" })!;
    expect(v.attendance.total.rate).toBe(kpi.value);
    expect(v.attendance.total.registered).toBe(kpi.den);
    expect(v.attendance.byArea.reduce((s, r) => s + r.registered, 0)).toBe(kpi.den);
    expect(v.activities.byKindTotal.rate).toBe(kpi.value);
    // Ärendet är inte inskrivet i januari: ingen rad – eller, med en händelse i månaden, en rad märkt med avslutet och utan tillfällen.
    const row = v.participants.find((p) => p.caseId === c.id);
    if (row) expect(row).toMatchObject({ outside: "Avslutad 15 dec 2026", activities: { held: 0 }, attendance: { rate: null } });
    expect(v.totals.participants).toBe(v.flow.total.atStart + v.flow.total.started);
  });

  it("avsluten som räknas går ihop med resultatgradens nämnare – förra och innevarande månad", async () => {
    for (const month of ["2027-01", "2027-02", "2026-12"]) {
      const v = await view(as("u-sara", "samordnare"), { month });
      expect(v.results.closuresCounted, month).toBe(v.results.month?.den);
      expect(v.results.verifiedResults, month).toBe(v.results.month?.num);
      expect(v.results.closedTotal, month).toBe(v.results.closures.reduce((s, x) => s + x.count, 0));
    }
  });

  it("ett resultat efter avslutet har en rad per deltagare – och loggraden har ärendet", async () => {
    const data = structuredClone(SEED);
    const c = data.cases.find((x) => x.status === "closed" && !!x.endDate && x.endDate < "2026-12-01")!;
    data.outcome_events.push({ ...structuredClone(data.outcome_events[0]), id: "ev-efter", caseId: c.id, kind: "arbete_paborjat", occurredOn: "2027-01-12" });
    fresh(data);
    const karin = as("u-karin", "chef");
    const v = await view(karin);
    const row = v.participants.find((p) => p.caseId === c.id)!;
    expect(row.outside).toMatch(/^Avslutad /);
    expect(row.results).toContain("Arbete påbörjat 12 jan");
    expect(row.name).not.toBe("");
    expect(v.totals.participants).toBeLessThan(v.participants.length);
    expect(await cmd(monthlyOverviewViewed.key, { contractId: "c-bot", month: "2027-01", area: null }, karin)).toMatchObject({ ok: true });
    expect(audit("monthly_overview.viewed")[0].details).toMatchObject({ rows: v.participants.length });
    expect((audit("monthly_overview.viewed")[0].details as { caseIds: string[] }).caseIds).toContain(c.id);
  });

  it("skyddade personuppgifter (den vilande spärren): namnet döljs efter läsarens åtkomst – bara ärendenumret", async () => {
    const data = structuredClone(SEED);
    const c = data.cases.find((x) => x.id === "case-260143")!;
    const person = data.persons.find((p) => p.id === c.personId)!;
    person.protectedIdentity = true;
    fresh(data);
    const full = `${person.firstName} ${person.lastName}`;
    const sara = await view(as("u-sara", "samordnare"));
    const masked = sara.participants.find((p) => p.caseId === c.id)!;
    expect(masked).toMatchObject({ name: "Skyddade personuppgifter", restricted: true, caseNumber: c.caseNumber, periodLines: [], results: [] });
    expect(masked.attendance.rate).toBeNull();
    expect(JSON.stringify(sara)).not.toContain(full);
    // Avtalsansvarig har full åtkomst i skyddade ärenden och ser namnet.
    const johan = await view(as("u-johan", "avtalsansvarig"));
    expect(johan.participants.find((p) => p.caseId === c.id)).toMatchObject({ name: full, restricted: false });
  });

  it("en registrering att deltagaren inte kom till första mötet ändrar ingenting i rapporten", async () => {
    const before = await view(as("u-sara", "samordnare"), { month: "2027-02" });
    const data = structuredClone(SEED);
    const c = data.cases.find((x) => x.id === "case-270043")!;
    expect(c.startDate).toBeNull();
    data.first_meeting_no_shows.push({ id: "fmns-test", caseId: c.id, contractId: c.contractId, meetingAt: c.firstMeetingAt!, kind: "uteblev", reason: null, registeredBy: "u-amira", registeredAt: "2027-01-29T10:00" });
    fresh(data);
    const after = await view(as("u-sara", "samordnare"), { month: "2027-02" });
    expect({ ...after, generatedAt: null }).toEqual({ ...before, generatedAt: null });
    expect(after.participants.some((p) => p.caseId === "case-270043")).toBe(false);
  });

  it("yrkesområdet som filter: bara deltagarna i området, och flödet går ihop", async () => {
    const all = await view(as("u-sara", "samordnare"));
    const g = await view(as("u-sara", "samordnare"), { month: "2027-01", area: "G" });
    expect(g.area).toEqual({ code: "G", label: "G Lager och logistik" });
    expect(g.participants.length).toBe(all.flow.rows.find((r) => r.code === "G")!.atStart + all.flow.rows.find((r) => r.code === "G")!.started);
    expect(g.participants.every((p) => p.areaCode === "G")).toBe(true);
    expect(g.flow.rows.map((r) => r.code)).toEqual(["G"]);
    const t = g.flow.total;
    expect(t.atStart + t.started - t.ended).toBe(t.atEnd);
  });

  it("gruppmålet syns aldrig och påverkar ingenting – svaret är byte för byte detsamma efter att ett mål markerats", async () => {
    const amira = as("u-amira", "coach");
    const nadia = "case-260143";
    const res = await cmd(groupActivityCreate.key, { name: "CV-verkstad", kind: "yrkesmoment", startsAt: "2027-02-01T08:00", durationMin: 60, location: "Alby", caseIds: [nadia], goal: "HEMLIGT GRUPPMÅL 4711" }, amira);
    expect(res).toMatchObject({ ok: true });
    const act = rt.store.rows("activities").find((a) => a.groupActivityId === res.groupActivityId && a.caseId === nadia)!;
    expect(await cmd(attendanceSet.key, { activityId: act.id, status: "present" }, amira)).toMatchObject({ ok: true });
    const before = await view(amira, { month: "2027-02" });
    expect(before.activities.groupActivities).toBe(1);
    expect(await cmd(groupGoalResultSet.key, { id: res.groupActivityId, caseId: nadia, achieved: false }, amira)).toMatchObject({ ok: true });
    expect(rt.store.rows("group_goal_results")).toHaveLength(1);
    const after = await view(amira, { month: "2027-02" });
    expect(JSON.stringify({ ...after, generatedAt: null })).toBe(JSON.stringify({ ...before, generatedAt: null }));
    expect(JSON.stringify(after)).not.toContain("HEMLIGT");
    // Gruppaktivitetens namn är internt och står inte heller i rapporten.
    expect(JSON.stringify(after)).not.toContain("CV-verkstad");
  });

  it("inga personnummer, inga belopp och inga nivåer, taggar eller AI-utkast i svaret", async () => {
    const v = await view(as("u-sara", "samordnare"));
    const json = JSON.stringify(v);
    expect(json).not.toMatch(/\b\d{6,8}[-+]?\d{4}\b/);
    expect(json).not.toMatch(/amountOre|priceOre|personnummer|aiSummaryDraft|groupingId|"tag"/);
  });

  it("aldrig delmålens namn eller id och aldrig nivåernas, taggarnas eller gruppernas namn – förra och innevarande månad", async () => {
    // Namnen byts mot kännetecken, så att en träff inte kan vara en vanlig etikett.
    const data = structuredClone(SEED);
    data.progress_goals.forEach((g, i) => (g.label = `DELMALSNAMN${i}X`));
    data.groupings.forEach((g, i) => {
      g.name = `GRUPPERINGSNAMN${i}X`;
      if (g.category) g.category = `TAGGKATEGORI${i}X`;
    });
    fresh(data);
    let achieved = 0;
    let tagged = 0;
    for (const month of ["2027-01", "2027-02"]) {
      for (const a of [as("u-sara", "samordnare"), as("u-amira", "coach")]) {
        const v = await view(a, { month });
        const json = JSON.stringify(v);
        expect(json).not.toMatch(/DELMALSNAMN|GRUPPERINGSNAMN|TAGGKATEGORI/);
        for (const g of data.progress_goals) expect(json).not.toContain(g.id);
        for (const g of data.groupings) expect(json).not.toContain(g.id);
        achieved += v.progression.achievedCount;
        tagged += v.activities.withGoals;
      }
    }
    // Testdatat har uppnådda delmål och tillfällen med delmål – kontrollen prövar något.
    expect(achieved).toBeGreaterThan(0);
    expect(tagged).toBeGreaterThan(0);
  });

  it("en begränsad testare ser varken stegen i Progression och resultat eller det interna målet", async () => {
    const tester: Actor = { ...as("u-sara", "samordnare"), testerId: "tester-annan" };
    const v = await view(tester);
    expect(v.results.steps).toBeNull();
    expect(v.results.month?.internalTarget).toBeNull();
    expect(v.results.rolling?.statusText).not.toMatch(/interna/);
    const full = await view(as("u-sara", "samordnare"));
    expect(full.results.steps).not.toBeNull();
    expect(full.results.month?.internalTarget).toBe(0.35);
  });
});

describe("revisionsloggen", () => {
  it("visningen och PDF:en loggas med avtalet, månaden, yrkesområdet och ärendenas id:n – aldrig namn", async () => {
    const karin = as("u-karin", "chef");
    const v = await view(karin, { month: "2027-01", area: "F" });
    expect(await cmd(monthlyOverviewViewed.key, { contractId: "c-bot", month: "2027-01", area: "F" }, karin)).toMatchObject({ ok: true });
    const pdf = await cmd(monthlyOverviewPdf.key, { contractId: "c-bot", month: "2027-01", area: "F" }, karin);
    expect(pdf).toEqual({ ok: true, filename: "rapport_bot_manadsrapport_2027-01.pdf" });
    const [seen] = audit("monthly_overview.viewed");
    const [down] = audit("monthly_overview.downloaded");
    for (const row of [seen, down]) {
      expect(row).toMatchObject({ entity: "contract", entityId: "c-bot", contractId: "c-bot", actorId: "u-karin" });
      expect(row.details).toMatchObject({ month: "2027-01", area: "F", rows: v.participants.length, caseIds: v.participants.map((p) => p.caseId).sort() });
      const text = JSON.stringify(row);
      for (const p of v.participants) expect(text).not.toContain(p.name);
      expect(text).not.toMatch(/BOT-\d{2}-\d{4}/);
    }
    expect(down.details).toMatchObject({ format: "pdf" });
  });

  it("ett val som inte finns loggas inte", async () => {
    const sara = as("u-sara", "samordnare");
    expect(await cmd(monthlyOverviewViewed.key, { contractId: "c-bot", month: "2030-01", area: null }, sara)).toMatchObject({ ok: false, error: "not_found" });
    expect(await cmd(monthlyOverviewPdf.key, { contractId: "c-bot", month: "2027-01", area: "Q" }, sara)).toMatchObject({ ok: false, error: "not_found" });
    expect(await cmd(monthlyOverviewPdf.key, { contractId: "c-annat", month: "2027-01", area: null }, sara)).toMatchObject({ ok: false, error: "not_found" });
    expect(audit("monthly_overview.viewed")).toHaveLength(0);
    expect(audit("monthly_overview.downloaded")).toHaveLength(0);
  });
});
