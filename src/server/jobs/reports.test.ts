// Rapportutkasten i jobbkörningen (reports.ts + runner.ts) mot testdatat i minnet: jobbet läggs en gång per
// tiominutersperiod, körs med appens klocka och ctx.system, skapar veckans rapporter när veckan är slut och inget när allt
// redan finns. Plus de unika indexen i databasen (PGlite med alla migrationer och seed.sql).
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
import { ensureReportScheduleJob, REPORT_SCHEDULE_JOB, reportScheduleJobId } from "./reports";
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
  const deps = { system: () => ctx } as unknown as JobDeps;
  /** Som runDueJobs: lägg periodens jobb och kör det som är köat. */
  const run = async (at: LocalDateTime, d: JobDeps = deps) => {
    clock = at;
    await ensureReportScheduleJob(system, at);
    return runJobs({ store: jobStore, handlers: JOB_HANDLERS, ctx: d, now: at, sleep: async () => undefined });
  };
  return { store, system, run };
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
    expect(r.rows.map((x) => x.indexname)).toEqual(["audit_log_report_created_idx", "reports_customer_summary_key", "reports_monthly_key", "reports_weekly_key"]);
  });
});
