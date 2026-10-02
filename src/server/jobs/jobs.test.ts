// Bakgrundsjobben: körningens regler (runner.ts), nyckeln för /api/jobs/run (auth.ts) och JobStore mot Supabase (store.ts).
import { describe, expect, it } from "vitest";
import type { PgClient, PgResult } from "@/data/supabase/repo";
import { memoryJobStore, memoryNotifyRepo } from "../notify/test-helpers";
import type { JobRow } from "../notify/types";
import { bearerMatches, jobsSecret, MIN_SECRET_LENGTH } from "./auth";
import { JobError, safeErrorText } from "./errors";
import { INTERRUPTED_REASON, MAX_ATTEMPTS, retryDelayMinutes, runJobs, STALE_MINUTES, type JobHandler } from "./runner";
import { supabaseJobStore } from "./store";

const NOW = "2027-02-01T09:12";

const job = (id: string, extra: Partial<JobRow> = {}): JobRow => ({
  id, kind: "test", payload: {}, status: "queued", attempts: 0, runAfter: NOW, lastError: null, createdAt: NOW, createdBy: null, finishedAt: null, ...extra,
});

function setup(n: number, handler: JobHandler<null>) {
  const { store } = memoryNotifyRepo();
  for (let i = 1; i <= n; i++) store.insertRow("jobs", job(`job-${String(i).padStart(2, "0")}`));
  return { store, jobs: memoryJobStore(store), handlers: { test: handler } };
}

describe("runJobs", () => {
  it("kör förfallna jobb i ordning, högst limit, i omgångar om batchSize", async () => {
    const ran: string[] = [];
    const { store, jobs, handlers } = setup(7, { run: async (j) => void ran.push(j.id) });
    const sum = await runJobs({ store: jobs, handlers, ctx: null, now: NOW, limit: 5, batchSize: 2 });
    expect(sum).toMatchObject({ claimed: 5, done: 5, retried: 0, failed: 0, errors: 0, outcomes: { "test:done": 5 } });
    expect(ran).toEqual(["job-01", "job-02", "job-03", "job-04", "job-05"]);
    expect(store.rows("jobs").map((j) => j.status)).toEqual(["done", "done", "done", "done", "done", "queued", "queued"]);
    expect(store.getRow("jobs", "job-01")).toMatchObject({ attempts: 1, finishedAt: NOW, lastError: null });
  });

  it("slutar hämta nya jobb när tiden är slut", async () => {
    let t = 0;
    const { jobs, handlers } = setup(6, { run: async () => void (t += 8_000) });
    const sum = await runJobs({ store: jobs, handlers, ctx: null, now: NOW, limit: 10, batchSize: 2, budgetMs: 20_000, elapsedMs: () => t });
    // Omgång 1 (2 jobb, 16 s), omgång 2 (2 jobb, 32 s) – sedan hämtas inga fler.
    expect(sum.claimed).toBe(4);
  });

  it("pausar mellan jobben (Resends gräns per sekund), inte före det första", async () => {
    const sleeps: number[] = [];
    const { jobs, handlers } = setup(3, { run: async () => undefined });
    await runJobs({ store: jobs, handlers, ctx: null, now: NOW, pauseMs: 500, sleep: async (ms) => void sleeps.push(ms) });
    expect(sleeps).toEqual([500, 500]);
  });

  it("väntetider 1, 5, 15 och 60 minuter, sedan failed och onGiveUp", async () => {
    expect([1, 2, 3, 4, 5, 9].map(retryDelayMinutes)).toEqual([1, 5, 15, 60, 60, 60]);
    const gaveUp: string[] = [];
    const { store, jobs, handlers } = setup(1, {
      run: async () => {
        throw new Error(`hemlig text med adress x@y.se`);
      },
      onGiveUp: async (j, reason) => void gaveUp.push(`${j.id}:${reason}`),
    });
    let now = NOW;
    for (let i = 1; i <= MAX_ATTEMPTS; i++) {
      await runJobs({ store: jobs, handlers, ctx: null, now });
      const j = store.getRow("jobs", "job-01")!;
      expect(j.attempts).toBe(i);
      expect(j.lastError).toBe("Oväntat fel (Error)");
      if (i < MAX_ATTEMPTS) now = j.runAfter;
    }
    expect(store.getRow("jobs", "job-01")).toMatchObject({ status: "failed", finishedAt: now });
    expect(gaveUp).toEqual(["job-01:Oväntat fel (Error)"]);
  });

  it("JobError som inte är värt att försöka igen: failed direkt", async () => {
    const { store, jobs, handlers } = setup(1, {
      run: async () => {
        throw new JobError("Resend svarade 422 (validation_error)", { retryable: false });
      },
    });
    expect(await runJobs({ store: jobs, handlers, ctx: null, now: NOW })).toMatchObject({ failed: 1 });
    expect(store.getRow("jobs", "job-01")).toMatchObject({ status: "failed", attempts: 1, lastError: "Resend svarade 422 (validation_error)" });
  });

  it("ett jobb som fastnat i running hämtas igen efter fem minuter (avbruten körning) och tar upp arbetet igen", async () => {
    expect(STALE_MINUTES).toBe(5);
    const ran: string[] = [];
    const { store, jobs, handlers } = setup(0, { run: async (j) => void ran.push(j.id) });
    store.insertRow("jobs", job("job-a", { status: "running", attempts: 1, startedAt: "2027-02-01T09:08" }));
    store.insertRow("jobs", job("job-b", { status: "running", attempts: 1, startedAt: "2027-02-01T09:06" }));
    await runJobs({ store: jobs, handlers, ctx: null, now: NOW });
    expect(ran).toEqual(["job-b"]);
    expect(store.getRow("jobs", "job-b")).toMatchObject({ status: "done", attempts: 2 });
    expect(store.getRow("jobs", "job-a")!.status).toBe("running");
  });

  it("även sista försöket avbröts: jobbet ges upp (failed, onGiveUp) i stället för att bli hängande i running för evigt", async () => {
    const ran: string[] = [];
    const gaveUp: string[] = [];
    const { store, jobs, handlers } = setup(0, { run: async (j) => void ran.push(j.id), onGiveUp: async (j, reason) => void gaveUp.push(`${j.id}:${reason}`) });
    store.insertRow("jobs", job("job-sist", { status: "running", attempts: MAX_ATTEMPTS, startedAt: "2027-02-01T09:00" }));
    store.insertRow("jobs", job("job-nyss", { status: "running", attempts: MAX_ATTEMPTS, startedAt: "2027-02-01T09:10" }));
    expect(await runJobs({ store: jobs, handlers, ctx: null, now: NOW })).toMatchObject({ claimed: 1, failed: 1, done: 0 });
    expect(ran).toEqual([]);
    expect(gaveUp).toEqual([`job-sist:${INTERRUPTED_REASON}`]);
    expect(store.getRow("jobs", "job-sist")).toMatchObject({ status: "failed", lastError: INTERRUPTED_REASON, finishedAt: NOW });
    // Det som nyss startade får köra klart; därefter hämtas inget igen
    expect(store.getRow("jobs", "job-nyss")!.status).toBe("running");
    expect(await runJobs({ store: jobs, handlers, ctx: null, now: "2027-02-01T09:20" })).toMatchObject({ claimed: 1, failed: 1 });
    expect(await runJobs({ store: jobs, handlers, ctx: null, now: "2027-02-01T10:00" })).toMatchObject({ claimed: 0 });
    expect(store.rows("jobs").filter((j) => j.status === "running")).toEqual([]);
  });

  it("när statusen inte kan sparas räknas det som fel och körningen fortsätter", async () => {
    const { jobs, handlers } = setup(2, { run: async () => undefined });
    let first = true;
    const flaky = {
      claim: jobs.claim,
      finish: async (id: string, p: Parameters<typeof jobs.finish>[1]) => {
        if (first) {
          first = false;
          throw new Error("databasen svarar inte");
        }
        return jobs.finish(id, p);
      },
    };
    expect(await runJobs({ store: flaky, handlers, ctx: null, now: NOW })).toMatchObject({ claimed: 2, done: 1, errors: 1 });
  });

  it("felorsaker innehåller aldrig okända feltexter", () => {
    expect(safeErrorText(new Error("maria.ekdahl@botkyrka.se 19750818-8340"))).toBe("Oväntat fel (Error)");
    expect(safeErrorText(new TypeError("x"))).toBe("Oväntat fel (TypeError)");
    expect(safeErrorText("sträng")).toBe("Oväntat fel (string)");
    expect(safeErrorText(new JobError("Resend svarade 503 (service_unavailable)", { retryable: true }))).toBe("Resend svarade 503 (service_unavailable)");
  });
});

describe("/api/jobs/run – nyckeln", () => {
  const SECRET = "c2VrcmV0LW55Y2tlbC1mb3ItdGVzdA==";
  it("Bearer med rätt nyckel godkänns, allt annat nekas", () => {
    expect(bearerMatches(`Bearer ${SECRET}`, SECRET)).toBe(true);
    expect(bearerMatches(`bearer   ${SECRET} `, SECRET)).toBe(true);
    expect(bearerMatches(`Bearer ${SECRET}x`, SECRET)).toBe(false);
    expect(bearerMatches(SECRET, SECRET)).toBe(false);
    expect(bearerMatches(`Basic ${SECRET}`, SECRET)).toBe(false);
    expect(bearerMatches("Bearer ", SECRET)).toBe(false);
    expect(bearerMatches(null, SECRET)).toBe(false);
  });
  it("saknad eller för kort nyckel räknas som saknad (rutten svarar 503)", () => {
    expect(jobsSecret({})).toBeNull();
    expect(jobsSecret({ MM_JOBS_SECRET: "kort" })).toBeNull();
    expect(jobsSecret({ MM_JOBS_SECRET: "x".repeat(MIN_SECRET_LENGTH) })).toBe("x".repeat(MIN_SECRET_LENGTH));
    expect(jobsSecret({ MM_JOBS_SECRET: `  ${SECRET}  ` })).toBe(SECRET);
  });
});

describe("supabaseJobStore", () => {
  it("claim anropar claim_jobs med tid i Stockholm och gör om raderna; finish uppdaterar jobbet", async () => {
    const rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];
    const updates: { table: string; values: Record<string, unknown>; eq: [string, unknown][] }[] = [];
    const row = { id: "job-1", kind: "send_message", payload: { messageId: "out-1" }, status: "running", attempts: 1, run_after: "2027-02-01T09:12:00+01:00",
      last_error: null, created_at: "2027-02-01T09:12:00+01:00", created_by: null, finished_at: null, started_at: "2027-02-01T09:13:00+01:00" };
    const client = {
      rpc: async (fn: string, args: Record<string, unknown>): Promise<PgResult<unknown>> => {
        rpcCalls.push({ fn, args });
        return { data: [row], error: null };
      },
      from: (table: string) => ({
        update: (values: Record<string, unknown>) => {
          const u = { table, values, eq: [] as [string, unknown][] };
          updates.push(u);
          const q = {
            eq: (c: string, v: unknown) => (u.eq.push([c, v]), q),
            select: () => Promise.resolve({ data: [{ id: "job-1", status: values.status }], error: null }),
          };
          return q;
        },
      }),
    } as unknown as PgClient & { rpc: (fn: string, args: Record<string, unknown>) => Promise<PgResult<unknown>> };
    const s = supabaseJobStore(client);
    const got = await s.claim(5, "2027-02-01T09:13", 5);
    expect(rpcCalls).toEqual([{ fn: "claim_jobs", args: { n: 5, p_now: "2027-02-01T09:13:00+01:00", p_max_attempts: 5, p_stale_after: "5 minutes" } }]);
    expect(got).toEqual([{ id: "job-1", kind: "send_message", payload: { messageId: "out-1" }, status: "running", attempts: 1, runAfter: "2027-02-01T09:12",
      lastError: null, createdAt: "2027-02-01T09:12", createdBy: null, finishedAt: null, startedAt: "2027-02-01T09:13" }]);
    await s.finish("job-1", { status: "queued", lastError: "Resend svarade 503 (service_unavailable)", runAfter: "2027-06-01T10:00" });
    expect(updates).toEqual([
      { table: "jobs", values: { status: "queued", last_error: "Resend svarade 503 (service_unavailable)", run_after: "2027-06-01T10:00:00+02:00" }, eq: [["id", "job-1"]] },
    ]);
  });
});
