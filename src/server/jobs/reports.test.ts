// Rapportutkasten i jobbkörningen (reports.ts + runner.ts) mot testdatat i minnet: jobbet läggs en gång per
// tiominutersperiod, körs med appens klocka och ctx.system, skapar veckans rapporter när veckan är slut och inget när allt
// redan finns. Läget i app_settings (golvet från testklockan, högvattenmärkena). Plus de unika indexen i databasen (PGlite
// med alla migrationer och seed.sql).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { SYSTEM_ACTOR } from "@/api/roles";
import type { Ctx } from "@/api/server";
import type { LocalDateTime } from "@/core/time";
import { MemoryRepo, MemoryStore } from "@/data/memory";
import { POLICIES } from "@/data/policy";
import { createSeed, DEMO_START } from "@/data/seed";
import { TEST_PNR_CRYPTO } from "@/data/seed/pnr";
import type { AppRepo, Tables } from "@/data/schema";
import { asUser, attempt, createMigratedDatabase, loadSeed } from "@/data/supabase/pglite";
import { JOB_HANDLERS, type JobDeps } from "./registry";
import { REAL_CLOCK } from "../clock";
import { ensureReportScheduleJob, REPORT_SCHEDULE_JOB, reportMarkKey, reportScheduleJobId, reportScheduleState, type AppSettingsClient } from "./reports";
import { runJobs, type JobStore } from "./runner";

function setup() {
  const store = new MemoryStore<Tables>(createSeed());
  let seq = 0;
  const newId = (p: string) => `${p}-j${String(++seq).padStart(4, "0")}`;
  let clock: LocalDateTime = DEMO_START;
  const now = () => clock;
  const system = new MemoryRepo<Tables>(store, SYSTEM_ACTOR, POLICIES, { bypass: true }) as unknown as AppRepo;
  const ctx: Ctx = {
    actor: SYSTEM_ACTOR, now, repo: system, system, newId, crypto: TEST_PNR_CRYPTO,
    audit: async (e) => {
      await system.table("audit_log").insert({ id: newId("log"), occurredAt: now(), actorId: SYSTEM_ACTOR.userId, action: e.action, entity: e.entity, entityId: e.entityId, contractId: e.contractId ?? null, details: e.details ?? {} });
    },
    notify: async (m) => {
      await system.table("outbound_messages").insert({ id: newId("out"), createdAt: now(), channel: m.channel, to: m.to, template: m.template, subject: null, body: m.body, caseId: m.caseId ?? null, status: "queued", sentAt: null } as never);
    },
  };
  const jobStore: JobStore = {
    async claim(n, at, max) {
      const due = store.rows("jobs").filter((j) => j.status === "queued" && j.runAfter <= at && j.attempts < max).sort((a, b) => (a.runAfter + a.id < b.runAfter + b.id ? -1 : 1)).slice(0, n);
      return due.map((j) => store.updateRow("jobs", j.id, { status: "running", attempts: j.attempts + 1, startedAt: at }));
    },
    async finish(id, patch) {
      store.updateRow("jobs", id, patch);
    },
  };
  // app_settings i minnet (som i testmiljön: testklockan startade på DEMO_START).
  const settings = new Map<string, string>([["clock_demo_epoch", DEMO_START], ["clock_real_epoch", "2026-10-01T08:00:00.000Z"]]);
  const settingsClient: AppSettingsClient = {
    from: () => ({
      upsert: async (v) => {
        settings.set(v.key, v.value);
        return { error: null };
      },
    }),
  };
  const testClock = { mode: "test" as const, realEpochMs: Date.parse("2026-10-01T08:00:00.000Z"), demoEpoch: DEMO_START };
  const deps = {
    reportSchedule: async () => ({ ctx, state: reportScheduleState(settingsClient, [...settings].map(([key, value]) => ({ key, value })), testClock) }),
  } as unknown as JobDeps;
  /** Som runDueJobs: lägg periodens jobb och kör det som är köat. */
  const run = async (at: LocalDateTime, d: JobDeps = deps) => {
    clock = at;
    await ensureReportScheduleJob(system, at);
    return runJobs({ store: jobStore, handlers: JOB_HANDLERS, ctx: d, now: at, sleep: async () => undefined });
  };
  return { store, system, run, settings };
}

describe("rapportutkasten i jobbkörningen", () => {
  it("jobbet läggs en gång per tiominutersperiod (samma id), en dubblett från en samtidig körning ignoreras", async () => {
    const t = setup();
    expect(reportScheduleJobId("2027-02-01T09:12")).toBe("job-report_schedule-2027-02-01T09:1");
    expect(reportScheduleJobId("2027-02-01T09:19")).toBe(reportScheduleJobId("2027-02-01T09:10"));
    expect(await ensureReportScheduleJob(t.system, "2027-02-01T09:12")).toBe(true);
    expect(await ensureReportScheduleJob(t.system, "2027-02-01T09:18")).toBe(false);
    expect(await ensureReportScheduleJob(t.system, "2027-02-01T09:20")).toBe(true);
    expect(t.store.rows("jobs").filter((j) => j.kind === REPORT_SCHEDULE_JOB).map((j) => j.id)).toEqual(["job-report_schedule-2027-02-01T09:1", "job-report_schedule-2027-02-01T09:2"]);
    const dup = {
      table: () => ({ get: async () => null, insert: async () => Promise.reject(Object.assign(new Error("dubblett"), { code: "23505" })) }),
    } as unknown as Parameters<typeof ensureReportScheduleJob>[0];
    expect(await ensureReportScheduleJob(dup, "2027-02-01T09:30")).toBe(false);
  });

  it("vid DEMO_START skapas inget; när vecka 5 är slut skapas veckorapporterna; nästa period skapar inget nytt", async () => {
    const t = setup();
    const before = t.store.rows("reports").length;
    expect(await t.run(DEMO_START)).toMatchObject({ claimed: 1, done: 1, failed: 0, outcomes: { "report_schedule:none": 1 } });
    expect(t.store.rows("reports").length).toBe(before);

    expect(await t.run("2027-02-08T00:03")).toMatchObject({ claimed: 1, done: 1, outcomes: { "report_schedule:created": 1 } });
    const w5 = t.store.rows("reports").filter((r) => r.week === "2027-W05");
    expect(w5.map((r) => r.recipientUserId).sort()).toEqual(["k-ahmed", "k-linda", "k-maria", "k-omar"]);
    expect(t.store.rows("audit_log").filter((l) => l.action === "report.created").every((l) => l.actorId === "system" && l.occurredAt === "2027-02-08T00:03")).toBe(true);
    const job = t.store.getRow("jobs", "job-report_schedule-2027-02-08T00:0")!;
    expect(job).toMatchObject({ status: "done", lastError: null, finishedAt: "2027-02-08T00:03" });

    expect(await t.run("2027-02-08T00:13")).toMatchObject({ claimed: 1, done: 1, outcomes: { "report_schedule:none": 1 } });
    expect(t.store.rows("reports").filter((r) => r.week === "2027-W05")).toHaveLength(4);
  });

  it("högvattenmärket sparas i app_settings när avtalet gåtts igenom; ett längre uppehåll fylls i från märket", async () => {
    const t = setup();
    await t.run(DEMO_START);
    expect(t.settings.get(reportMarkKey("c-bot"))).toBe(DEMO_START);
    // KK skapar inga rapporter automatiskt – inget märke.
    expect(t.settings.has(reportMarkKey("c-kk"))).toBe(false);
    // Cron har stått still i fyra månader (t.ex. fel hemlighet): allt från februari skapas, inte bara de senaste 62 dagarna.
    expect(await t.run("2027-06-01T08:00")).toMatchObject({ done: 1, outcomes: { "report_schedule:created": 1 } });
    expect(t.settings.get(reportMarkKey("c-bot"))).toBe("2027-06-01T08:00");
    const months = [...new Set(t.store.rows("reports").filter((r) => r.kind === "monthly" && r.month! > "2027-01").map((r) => r.month))].sort();
    expect(months).toEqual(["2027-02", "2027-03", "2027-04", "2027-05"]);
  });

  it("medan testdatat läses in på nytt skapas inget (ärendena är inlästa, rapporterna inte än)", async () => {
    const t = setup();
    // mm.reset_test_data() har tömt tabellerna och satt testklockan till DEMO_START; ett märke från förra testomgången finns kvar.
    for (const r of [...t.store.rows("reports")]) t.store.removeRow("reports", r.id);
    expect(t.store.rows("reports")).toEqual([]);
    t.settings.set(reportMarkKey("c-bot"), "2027-03-15T10:00");
    expect(await t.run("2027-02-01T09:13")).toMatchObject({ done: 1, outcomes: { "report_schedule:none": 1 } });
    expect(t.store.rows("reports")).toEqual([]);
  });

  it("läget: golvet är testklockans start i testmiljön och saknas med riktig tid; märkena läses per avtal", async () => {
    const writes: { key: string; value: string }[] = [];
    const db: AppSettingsClient = { from: () => ({ upsert: async (v) => (writes.push(v), { error: null }) }) };
    const rows = [
      { key: "environment", value: "staging" }, { key: reportMarkKey("c-bot"), value: "2027-02-08T00:05" }, { key: reportMarkKey("c-x"), value: "inte en tid" },
    ];
    const staging = reportScheduleState(db, rows, { mode: "test", realEpochMs: 0, demoEpoch: DEMO_START });
    expect(staging.floor).toBe(DEMO_START);
    expect(await staging.checkedThrough("c-bot")).toBe("2027-02-08T00:05");
    expect(await staging.checkedThrough("c-x")).toBeNull();
    expect(await staging.checkedThrough("c-kk")).toBeNull();
    await staging.markChecked("c-bot", "2027-02-08T00:15");
    expect(writes).toEqual([{ key: "report_schedule_checked:c-bot", value: "2027-02-08T00:15" }]);
    expect(await staging.checkedThrough("c-bot")).toBe("2027-02-08T00:15");
    expect(reportScheduleState(db, [], REAL_CLOCK).floor).toBeNull();
    // Ett skrivfel stoppar körningen med tabell och felkod (aldrig värden) – märket flyttas inte.
    const failing: AppSettingsClient = { from: () => ({ upsert: async () => ({ error: { code: "57014", message: "canceling statement" } }) }) };
    const st = reportScheduleState(failing, [], REAL_CLOCK);
    await expect(st.markChecked("c-bot", "2027-02-08T00:15")).rejects.toThrow("Databasfel i app_settings (57014)");
    expect(await st.checkedThrough("c-bot")).toBeNull();
  });

  it("utan systemets Ctx stoppas jobbet utan nya försök", async () => {
    const t = setup();
    const sum = await t.run(DEMO_START, {} as JobDeps);
    expect(sum).toMatchObject({ claimed: 1, failed: 1 });
    expect(t.store.getRow("jobs", reportScheduleJobId(DEMO_START))).toMatchObject({ status: "failed", lastError: "Rapportutkasten kan inte skapas här" });
  });
});

// ================================================================ De unika indexen (0018_rapportutkast.sql)
describe("unika index för rapportraderna i databasen", () => {
  let db: PGlite;
  beforeAll(async () => {
    db = await createMigratedDatabase();
    await loadSeed(db);
  }, 120_000);
  afterAll(async () => {
    await db?.close();
  });

  const COLS = "id, contract_id, case_id, recipient_user_id, kind, week, month, period_start, period_end, status, version, due_at, provisional_due, summary_ai_used, superseded, previous_id";
  const insert = (id: string, kind: string, o: { caseId?: string | null; recipient?: string | null; week?: string | null; month?: string | null; previousId?: string | null }) => [
    `insert into public.reports (${COLS}) values ($1, 'c-bot', $2, $3, $4, $5, $6, '2027-01-25', '2027-01-31', 'draft', 1, '2027-02-01T16:00+01', false, false, false, $7)`,
    [id, o.caseId ?? null, o.recipient ?? null, kind, o.week ?? null, o.month ?? null, o.previousId ?? null],
  ] as const;

  it("en andra rad med samma nyckel stoppas (23505), en rättelse och en annan period går igenom", async () => {
    await asUser(db, null, async (tx) => {
      // Testdatat har redan Maria Ekdahls veckorapport för vecka 4, Nadias månadsrapport för januari och beställarrapporten för januari.
      expect(await attempt(tx, ...insert("rep-x1", "weekly_attendance", { recipient: "k-maria", week: "2027-W04" }))).toMatchObject({ ok: false, code: "23505" });
      expect(await attempt(tx, ...insert("rep-x2", "monthly", { caseId: "case-260143", month: "2027-01" }))).toMatchObject({ ok: false, code: "23505" });
      expect(await attempt(tx, ...insert("rep-x3", "customer_summary", { recipient: "k-eva", month: "2027-01" }))).toMatchObject({ ok: false, code: "23505" });
      // Rättelse: samma nyckel men previous_id satt.
      expect(await attempt(tx, ...insert("rep-x4", "monthly", { caseId: "case-260143", month: "2027-01", previousId: "rep-16011" }))).toMatchObject({ ok: true, rows: 1 });
      // Nästa vecka och nästa månad går bra – men bara en gång.
      expect(await attempt(tx, ...insert("rep-x5", "weekly_attendance", { recipient: "k-maria", week: "2027-W05" }), { keep: true })).toMatchObject({ ok: true, rows: 1 });
      expect(await attempt(tx, ...insert("rep-x6", "weekly_attendance", { recipient: "k-maria", week: "2027-W05" }))).toMatchObject({ ok: false, code: "23505" });
      expect(await attempt(tx, ...insert("rep-x7", "monthly", { caseId: "case-260143", month: "2027-02" }))).toMatchObject({ ok: true, rows: 1 });
      // Andra rapporttyper berörs inte (t.ex. flera slutrapporter i testdatat för samma ärende vid rättelse).
      expect(await attempt(tx, ...insert("rep-x8", "final", { caseId: "case-260143" }))).toMatchObject({ ok: true, rows: 1 });
    }, { role: "service_role" });
  });

  it("indexen finns och testdatat bryter inte mot dem", async () => {
    const r = await db.query<{ indexname: string }>("select indexname from pg_indexes where schemaname = 'public' and tablename in ('reports', 'audit_log') and indexname in ('reports_weekly_key', 'reports_monthly_key', 'reports_customer_summary_key', 'audit_log_report_created_idx') order by 1");
    expect(r.rows.map((x) => x.indexname)).toEqual(["reports_customer_summary_key", "reports_monthly_key", "reports_weekly_key"]);
  });
});
