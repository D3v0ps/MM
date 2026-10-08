// Rapportutkast som skapas automatiskt (ensure.ts) mot testdatat i minnet: inget skapas på nyinläst testdata vid DEMO_START
// (inte heller medan testdatat läses in), skillnaden mot testdatats regler (redovisad), nya veckor och månader när klockan
// passerar gränsen, högvattenmärket (avbruten körning, längre uppehåll), spärrade konton, revisionsloggen, idempotensen och
// krockar mellan två körningar.
import { beforeEach, describe, expect, it } from "vitest";
import { SYSTEM_ACTOR } from "@/api/roles";
import { BOTKYRKA_CONFIG } from "@/core/config";
import { plannedReports, reportKey } from "@/core/report-schedule";
import { diffDays, monthEnd, type LocalDateTime } from "@/core/time";
import { listPersonas } from "@/data/actors";
import { createMemoryRuntime, demoClock, type MemoryRuntime } from "@/data/memory-runtime";
import type { MemoryData } from "@/data/memory";
import { createSeed, DEMO_START } from "@/data/seed";
import type { Report, Tables } from "@/data/schema";
import type { Ctx } from "@/api/server";
import { reportList } from "./api";
import { ensureReports, FULL_HISTORY, type ReportScheduleState } from "./ensure";

const SEED: MemoryData<Tables> = createSeed();
const AUTO = ["weekly_attendance", "monthly", "customer_summary"];
let rt: MemoryRuntime;
beforeEach(() => {
  rt = createMemoryRuntime({ data: structuredClone(SEED), clock: demoClock(DEMO_START) });
});

const sara = () => listPersonas(rt.raw()).find((p) => p.actor.userId === "u-sara")!.actor;
/** En fråga som samordnaren – körningen kontrollerar rapportutkasten först (som vid varje anrop). */
const touch = () => rt.run("query", reportList.key, {}, sara());
const reports = () => rt.store.rows("reports");
const created = () => rt.store.rows("audit_log").filter((l) => l.action === "report.created");
const at = async (t: LocalDateTime) => {
  rt.clock.set(t);
  await touch();
};

describe("på nyinläst testdata vid DEMO_START", () => {
  it("skapas inga rader – testdatat har redan veckorapporterna till och med vecka 4 och rapporterna för januari", async () => {
    const before = reports().length;
    await touch();
    await touch();
    expect(reports().length).toBe(before);
    expect(created()).toEqual([]);
  });

  it("samma regler över hela avtalstiden: vecko- och månadsrapporterna stämmer exakt, skillnaden mot testdatat redovisas", () => {
    // Reglerna körda från avtalets start (since = null) jämförda med testdatats rader. Månadsrapporterna: minst 11 inskrivna
    // dagar (reportSchedule.monthly.minEnrolledDays, samma regel som testdatat). Testdatat har ingen beställarrapport för
    // september 2026 (avtalet startade den 10:e) – den enda skillnaden. Testdatat ändras inte; golvet (testklockans start)
    // gör att raderna bara skapas för perioder efter den.
    const db = SEED;
    const contract = db.contracts.find((c) => c.id === "c-bot")!;
    const members = db.memberships.filter((m) => m.contractId === "c-bot");
    const planned = plannedReports({
      contract: { id: contract.id, startsOn: contract.startsOn, endsOn: contract.endsOn, config: contract.config },
      cases: db.cases.filter((c) => c.contractId === "c-bot"),
      caseworkerIds: members.filter((m) => m.role === "kommun_handlaggare").map((m) => m.userId),
      existing: [],
      since: null,
      now: DEMO_START,
    });
    const seeded = db.reports.filter((r) => AUTO.includes(r.kind));
    const byKey = new Map(planned.map((p) => [reportKey(p), p]));
    // Varje rad i testdatat har en motsvarighet med exakt samma fält (period, sista dag, preliminär, mottagare).
    const FIELDS = ["contractId", "kind", "caseId", "recipientUserId", "week", "month", "periodStart", "periodEnd", "version", "dueAt", "provisionalDue"] as const;
    for (const r of seeded) {
      const p = byKey.get(reportKey(r));
      expect(p, `${r.id} ${r.kind} ${r.week ?? r.month}`).toBeDefined();
      // En decemberrapport i testdatat levererades sent (för KPI:n) – dueAt är ändå samma.
      for (const f of FIELDS) expect(p![f], `${r.id}.${f}`).toEqual(r[f]);
      if (r.kind === "weekly_attendance") expect(r.approvedBy).toBe(p!.approvedBy);
    }
    const seededKeys = new Set(seeded.map(reportKey));
    const extra = planned.filter((p) => !seededKeys.has(reportKey(p)));
    expect(extra.filter((p) => p.kind === "weekly_attendance")).toEqual([]);
    expect(extra.filter((p) => p.kind === "customer_summary").map((p) => p.month)).toEqual(["2026-09"]);
    expect(extra.filter((p) => p.kind === "monthly")).toEqual([]);
    expect(planned.filter((p) => p.kind === "monthly").length).toBe(seeded.filter((r) => r.kind === "monthly").length);
    // Testdatats månadsrapporter har alla minst 11 inskrivna dagar – och reglerna hoppar över de månader som har färre.
    const casesById = new Map(db.cases.map((c) => [c.id, c]));
    const days = (caseId: string, mk: string) => {
      const c = casesById.get(caseId)!;
      const from = c.startDate! > `${mk}-01` ? c.startDate! : `${mk}-01`;
      const to = c.endDate && c.endDate < monthEnd(mk) ? c.endDate : monthEnd(mk);
      return diffDays(from, to) + 1;
    };
    expect(Math.min(...seeded.filter((r) => r.kind === "monthly").map((r) => days(r.caseId!, r.month!)))).toBe(11);
    const short = db.cases.filter((c) => c.contractId === "c-bot" && c.startDate && c.startDate >= "2026-09-01" && c.startDate <= "2027-01-31" && days(c.id, c.startDate.slice(0, 7)) < 11);
    expect(short.length).toBeGreaterThan(50);
    for (const c of short) expect(planned.some((p) => p.kind === "monthly" && p.caseId === c.id && p.month === c.startDate!.slice(0, 7))).toBe(false);
  });

  it("utan golvet (hela avtalstiden) skulle bara beställarrapporten för september 2026 skapas", async () => {
    const ctx = await systemCtx();
    const res = await ensureReports(ctx, FULL_HISTORY);
    expect(res.created.map((x) => `${x.kind}:${x.period}`)).toEqual(["customer_summary:2026-09"]);
  });

  it("medan testdatat läses in (ärenden finns men inga rapporter än) skapas inget – golvet är testklockans start", async () => {
    // Som i testmiljön: mm.reset_test_data() har satt klockan till DEMO_START och tömt rapporterna; ärendena är inlästa.
    const data = structuredClone(SEED);
    data.reports = [];
    const loading = createMemoryRuntime({ data, clock: demoClock(DEMO_START) });
    loading.clock.set("2027-02-01T09:13");
    await loading.run("query", reportList.key, {}, listPersonas(loading.raw()).find((p) => p.actor.userId === "u-sara")!.actor);
    expect(loading.store.rows("reports")).toEqual([]);
    expect(loading.store.rows("audit_log").filter((l) => l.action === "report.created")).toEqual([]);
  });
});

describe("när klockan passerar en vecko- eller månadsgräns", () => {
  it("vecka 5: en veckorapport per handläggare med inskrivna ärenden, loggad som systemet, väntar på närvaron", async () => {
    await at("2027-02-08T00:05");
    const w5 = reports().filter((r) => r.kind === "weekly_attendance" && r.week === "2027-W05");
    expect(w5.map((r) => r.recipientUserId).sort()).toEqual(["k-ahmed", "k-linda", "k-maria", "k-omar"]);
    for (const r of w5) {
      expect(r).toMatchObject({ contractId: "c-bot", caseId: null, periodStart: "2027-02-01", periodEnd: "2027-02-07", dueAt: "2027-02-08T16:00", version: 1, approvedBy: "system", provisionalDue: false });
      expect(["waiting", "delivered"]).toContain(r.status);
    }
    const logs = created();
    expect(logs).toHaveLength(4);
    for (const l of logs) {
      expect(l).toMatchObject({ actorId: "system", entity: "report", contractId: "c-bot", details: { kind: "weekly_attendance", week: "2027-W05", automatic: true } });
      expect(JSON.stringify(l)).not.toMatch(/Ekdahl|Maria|\d{6}-?\d{4}/);
    }
    // Idempotent: samma kontroll igen (och efter nästa kommando samma vecka) skapar inget nytt.
    const n = reports().length;
    await at("2027-02-08T09:00");
    await touch();
    expect(reports().length).toBe(n);
    expect(created()).toHaveLength(4);
  });

  it("månadsskiftet: månadsrapport per inskrivet ärende och en beställarrapport för avtalet (ingen mottagare), inga för avslutade ärenden", async () => {
    await at("2027-03-01T00:01");
    const feb = reports().filter((r) => r.kind === "monthly" && r.month === "2027-02");
    const cases = rt.store.rows("cases").filter((c) => c.contractId === "c-bot" && c.startDate && c.startDate <= "2027-02-28" && (!c.endDate || c.endDate >= "2027-02-01"));
    expect(feb.map((r) => r.caseId).sort()).toEqual(cases.map((c) => c.id).sort());
    expect(feb.length).toBeGreaterThan(50);
    for (const r of feb) expect(r).toMatchObject({ status: "draft", periodStart: "2027-02-01", periodEnd: "2027-02-28", dueAt: "2027-03-05T23:59", provisionalDue: true, recipientUserId: null });
    // Avslutade före februari: ingen rapport.
    const closedBefore = rt.store.rows("cases").filter((c) => c.endDate && c.endDate < "2027-02-01").map((c) => c.id);
    expect(feb.filter((r) => closedBefore.includes(r.caseId!))).toEqual([]);
    const cs = reports().filter((r) => r.kind === "customer_summary" && r.month === "2027-02");
    expect(cs).toHaveLength(1);
    // Beställarrapporten lämnas till kommunen utanför portalen (beslut 2026-10-07): ingen mottagare.
    expect(cs[0]).toMatchObject({ recipientUserId: null, status: "draft", dueAt: `2027-03-10T16:00`, periodStart: "2027-02-01", periodEnd: "2027-02-28" });
    // Veckorna 5–8 skapades också (klockan passerade fyra måndagar).
    expect(new Set(reports().filter((r) => r.kind === "weekly_attendance" && r.week! > "2027-W04").map((r) => r.week))).toEqual(new Set(["2027-W05", "2027-W06", "2027-W07", "2027-W08"]));
    // Rapportlistan visar de nya raderna som vanliga rapporter.
    const list = (await rt.run("query", reportList.key, {}, sara())) as { rows: { id: string }[] };
    expect(list.rows.some((x) => x.id === cs[0].id)).toBe(true);
  });

  it("längre uppehåll än fönstret (62 dagar): allt från högvattenmärket fylls i – inget hoppas över", async () => {
    await touch(); // märket sätts vid DEMO_START
    await at("2027-06-01T08:00");
    const months = [...new Set(reports().filter((r) => r.kind === "monthly" && r.month! > "2027-01").map((r) => r.month))].sort();
    // Fönstret skulle börja 31 mars – februari fylls ändå i, eftersom märket står kvar på 1 februari.
    expect(months).toEqual(["2027-02", "2027-03", "2027-04", "2027-05"]);
    const weeks = [...new Set(reports().filter((r) => r.kind === "weekly_attendance" && r.week! > "2027-W04").map((r) => r.week!))].sort();
    expect(weeks[0]).toBe("2027-W05");
    expect(weeks[weeks.length - 1]).toBe("2027-W21");
    expect(weeks.length).toBe(17);
    expect([...new Set(reports().filter((r) => r.kind === "customer_summary" && r.month! > "2027-01").map((r) => r.month))].sort()).toEqual(["2027-02", "2027-03", "2027-04", "2027-05"]);
  });

  it("två körningar samtidigt skapar inte samma rad två gånger", async () => {
    rt.clock.set("2027-02-08T00:05");
    await Promise.all([touch(), touch(), touch()]);
    expect(reports().filter((r) => r.kind === "weekly_attendance" && r.week === "2027-W05")).toHaveLength(4);
  });

  it("en veckorapport där all närvaro redan är registrerad publiceras direkt", async () => {
    // Registrera all närvaro för Maria Ekdahls ärenden vecka 5 innan veckan är slut (direkt i datat – samma sak som coacherna gör).
    const maria = new Set(rt.store.rows("cases").filter((c) => c.referrerId === "k-maria").map((c) => c.id));
    for (const a of rt.store.rows("activities").filter((x) => maria.has(x.caseId) && x.startsAt >= "2027-02-01" && x.startsAt <= "2027-02-07T23:59")) {
      if (!rt.store.rows("attendance").some((x) => x.activityId === a.id)) {
        rt.store.insertRow("attendance", { id: `att-test-${a.id}`, activityId: a.id, caseId: a.caseId, status: "present", reason: "", registeredBy: "u-amira", registeredAt: "2027-02-05T16:00" } as never);
      }
    }
    await at("2027-02-08T00:05");
    const r = reports().find((x) => x.kind === "weekly_attendance" && x.week === "2027-W05" && x.recipientUserId === "k-maria")!;
    expect(r).toMatchObject({ status: "delivered", deliveredAt: "2027-02-08T00:05", deliveredTo: ["k-maria"] });
    expect(r.snapshot?.reportId).toBe(r.id);
    const mail = rt.store.rows("outbound_messages").filter((m) => m.createdAt === "2027-02-08T00:05" && m.template === "ny_rapport");
    expect(mail.map((m) => m.body)).toContain("Veckorapporten för v. 5 2027 finns i portalen – logga in för att läsa.");
  });
});

describe("krockar med en annan körning (unika index i databasen)", () => {
  it("en dubblett (23505) hoppas över utan fel", async () => {
    rt.clock.set("2027-02-08T00:05");
    const ctx = await systemCtx();
    let inserts = 0;
    const reportsTable = ctx.system.table("reports");
    const dupCtx: Ctx = {
      ...ctx,
      system: {
        table: ((name: string) =>
          name === "reports"
            ? {
                ...reportsTable,
                insert: async (row: Report) => {
                  inserts++;
                  if (inserts % 2 === 0) throw Object.assign(new Error("duplicate key value violates unique constraint"), { code: "23505" });
                  return reportsTable.insert(row);
                },
              }
            : ctx.system.table(name as never)) as Ctx["system"]["table"],
      },
    };
    const res = await ensureReports(dupCtx, seedState());
    expect(res.duplicates).toBe(2);
    expect(res.created).toHaveLength(2);
    // Nästa körning ser raderna som finns och skapar bara de som fattas.
    const again = await ensureReports(ctx, seedState());
    expect(again.created).toHaveLength(2);
    expect(await ensureReports(ctx, seedState())).toMatchObject({ created: [], duplicates: 0 });
  });

  it("andra fel stoppar körningen (jobbet försöker igen)", async () => {
    rt.clock.set("2027-02-08T00:05");
    const ctx = await systemCtx();
    const broken: Ctx = { ...ctx, system: { table: ((name: string) => (name === "reports" ? { ...ctx.system.table("reports"), insert: async () => Promise.reject(new Error("nätverksfel")) } : ctx.system.table(name as never))) as Ctx["system"]["table"] } };
    const state = seedState();
    await expect(ensureReports(broken, state)).rejects.toThrow("nätverksfel");
    // Märket flyttas inte – nästa körning prövar samma perioder.
    expect(await state.checkedThrough("c-bot")).toBeNull();
  });
});

describe("en körning som avbryts halvvägs", () => {
  it("revisionsloggen misslyckas efter rad 20 av februari: nästa körning skapar resten – inga rapporter går förlorade", async () => {
    rt.clock.set("2027-03-01T00:05");
    const ctx = await systemCtx();
    const state = seedState();
    let n = 0;
    const flaky: Ctx = {
      ...ctx,
      audit: async (e) => {
        if (e.action === "report.created" && ++n === 20) throw Object.assign(new Error("tillfälligt fel"), { code: "503" });
        return ctx.audit(e);
      },
    };
    await expect(ensureReports(flaky, state)).rejects.toThrow("tillfälligt fel");
    expect(await state.checkedThrough("c-bot")).toBeNull();
    const partial = reports().filter((r) => r.kind === "monthly" && r.month === "2027-02").length;
    expect(partial).toBeLessThan(20);
    // Nästa körning (tio minuter senare) och en körning dagen efter: alla rader för februari finns.
    rt.clock.set("2027-03-01T00:15");
    await ensureReports(ctx, state);
    expect(await state.checkedThrough("c-bot")).toBe("2027-03-01T00:15");
    rt.clock.set("2027-03-02T08:00");
    expect((await ensureReports(ctx, state)).created).toEqual([]);
    const full = await fullRun();
    expect(reports().filter((r) => r.kind === "monthly" && r.month === "2027-02").length).toBe(full.monthlyFeb);
    expect(reports().filter((r) => r.kind === "customer_summary" && r.month === "2027-02")).toHaveLength(1);
    expect(full.monthlyFeb).toBeGreaterThan(50);
  });
});

describe("mottagarna är konton som är aktiva", () => {
  it("beställarrapporten skapas en gång per avtal och månad – oberoende av kommunens konton", async () => {
    for (const p of rt.store.rows("profiles").filter((x) => x.id.startsWith("k-"))) rt.store.updateRow("profiles", p.id, { active: false });
    await at("2027-03-01T00:05");
    expect(reports().filter((r) => r.kind === "customer_summary" && r.month === "2027-02").map((r) => r.recipientUserId)).toEqual([null]);
  });
  it("en spärrad handläggare får ingen veckorapport", async () => {
    rt.store.updateRow("profiles", "k-omar", { active: false });
    await at("2027-02-08T00:05");
    expect(reports().filter((r) => r.kind === "weekly_attendance" && r.week === "2027-W05").map((r) => r.recipientUserId).sort()).toEqual(["k-ahmed", "k-linda", "k-maria"]);
  });
});

/** Läget som minnesläget använder: golvet vid DEMO_START (testdatat är komplett dit) och märkena i minnet. */
function seedState(): ReportScheduleState {
  const marks = new Map<string, LocalDateTime>();
  return { floor: DEMO_START, checkedThrough: async (id) => marks.get(id) ?? null, markChecked: async (id, at) => void marks.set(id, at) };
}

/** Samma körning i en ny runtime utan fel – facit för hur många månadsrapporter februari ska ha. */
async function fullRun(): Promise<{ monthlyFeb: number }> {
  const other = createMemoryRuntime({ data: structuredClone(SEED), clock: demoClock(DEMO_START) });
  other.clock.set("2027-03-01T00:05");
  await other.ensureScheduledReports();
  return { monthlyFeb: other.store.rows("reports").filter((r) => r.kind === "monthly" && r.month === "2027-02").length };
}

/** Systemets Ctx i minnesläget (samma som körningen använder) – via ett kommando som inte finns behövs inte: bygg den direkt. */
async function systemCtx(): Promise<Ctx> {
  const { MemoryRepo } = await import("@/data/memory");
  const { POLICIES } = await import("@/data/policy");
  const { TEST_PNR_CRYPTO } = await import("@/data/seed/pnr");
  const system = new MemoryRepo<Tables>(rt.store, SYSTEM_ACTOR, POLICIES, { bypass: true }) as unknown as Ctx["system"];
  let seq = 0;
  const newId = (p: string) => `${p}-e${++seq}`;
  return {
    actor: SYSTEM_ACTOR, now: rt.clock.now, repo: system, system, newId, crypto: TEST_PNR_CRYPTO,
    audit: async (e) => {
      await system.table("audit_log").insert({ id: newId("log"), occurredAt: rt.clock.now(), actorId: "system", action: e.action, entity: e.entity, entityId: e.entityId, contractId: e.contractId ?? null, details: e.details ?? {} });
    },
    notify: async () => undefined,
  };
}

void BOTKYRKA_CONFIG;
