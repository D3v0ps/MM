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
  it("samordnare, avtalsansvarig, coach och chef ser samma rapport för avtalet", async () => {
    const actors = [as("u-sara", "samordnare"), as("u-johan", "avtalsansvarig"), as("u-amira", "coach"), as("u-karin", "chef")];
    const views = await Promise.all(actors.map((a) => view(a)));
    for (const v of views) {
      expect(v.month).toBe("2027-01");
      expect(v.contractId).toBe("c-bot");
      expect(v.participants.length).toBeGreaterThan(50);
    }
    // Alla på Miljonbemanning ser alla ärenden i avtalet (beslut 2026-10-09) – coachen ser samma siffror som samordnaren.
    const strip = (v: View) => JSON.stringify({ ...v, generatedAt: null });
    expect(new Set(views.map(strip)).size).toBe(1);
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

  it("en begränsad testare ser varken stegen i Progression och resultat eller det interna målet", async () => {
    const tester: Actor = { ...as("u-sara", "samordnare"), testerId: "tester-annan" };
    const v = await view(tester);
    expect(v.results.steps).toBeNull();
    expect(v.results.month.internalTarget).toBeNull();
    expect(v.results.rolling.statusText).not.toMatch(/interna/);
    const full = await view(as("u-sara", "samordnare"));
    expect(full.results.steps).not.toBeNull();
    expect(full.results.month.internalTarget).toBe(0.35);
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
