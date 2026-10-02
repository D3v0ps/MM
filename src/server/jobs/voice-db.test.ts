// Röstjobben mot riktiga migrationer (PGlite, supabase/migrations inkl. 0015) och testdatat (supabase/seed.sql) – som
// service role, precis som jobbkörningen i drift. Raderna skrivs som PostgREST gör (json_populate_record) med samma namn-
// och tidsomvandling som SupabaseRepo. Kontrollerar kolumnerna: ai_runs (jsonb output, input_deleted_at), audio_uploads,
// jobs (claim_jobs), participant_voice_notes, check_ins.ai och monthly_assessments.areas – och dubblettfelet (23505) som
// gallringens jobb per timme bygger på.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { SYSTEM_ACTOR } from "@/api/roles";
import type { LocalDateTime } from "@/core/time";
import { jsonAt, pickFields, pickRow, type Repo, type Row, type Table, type Where, type ListOpts } from "@/data/repo";
import type { AppRepo, Job } from "@/data/schema";
import { asUser, createMigratedDatabase, loadSeed, type Tx } from "@/data/supabase/pglite";
import { fromDbRow, toColumn, toDbRow, toDbValue } from "@/data/supabase/columns";
import { DataError, toRepoError } from "@/data/supabase/repo";
import { createSimulatedAi } from "@/features/_shared/ai-sim";
import { enqueueVoiceJob, type CheckInAiOutput } from "@/features/_shared/voice-jobs";
import { createStorageAudio, type AudioStorage } from "../audio/storage";
import { liveCtx } from "../ctx";
import { JOB_HANDLERS, type JobDeps } from "./registry";
import { runJobs, type JobPatch, type JobStore } from "./runner";
import { ensureRetentionJobs } from "./voice";

const NOW: LocalDateTime = "2027-02-01T09:12";
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Repo som SQL mot PGlite: get, list, first, count, insert, update med samma Where-semantik som SupabaseRepo. */
function sqlTable<T extends Row>(tx: Tx, name: string): Table<T> {
  const whereSql = (where: Where<T> | undefined, params: unknown[]): string => {
    const parts: string[] = [];
    for (const [field, cond] of Object.entries(where ?? {})) {
      if (cond === undefined) continue;
      const col = `"${toColumn(field)}"`;
      const p = (v: unknown) => {
        params.push(toDbValue(v));
        return `$${params.length}`;
      };
      if (!isObj(cond)) parts.push(`${col} = ${p(cond)}`);
      else if ("in" in cond) parts.push(`${col} = any(${p(cond.in)})`);
      else if ("neq" in cond) parts.push(`${col} is distinct from ${p(cond.neq)}`);
      else if ("isNull" in cond) parts.push(cond.isNull ? `${col} is null` : `${col} is not null`);
      else {
        const c = cond as { gte?: unknown; lte?: unknown; gt?: unknown; lt?: unknown };
        if (c.gte !== undefined) parts.push(`${col} >= ${p(c.gte)}`);
        if (c.lte !== undefined) parts.push(`${col} <= ${p(c.lte)}`);
        if (c.gt !== undefined) parts.push(`${col} > ${p(c.gt)}`);
        if (c.lt !== undefined) parts.push(`${col} < ${p(c.lt)}`);
      }
    }
    return parts.length ? `where ${parts.join(" and ")}` : "";
  };
  const run = async <R,>(sql: string, params: unknown[]): Promise<R[]> => {
    try {
      return (await tx.query<R>(sql, params)).rows;
    } catch (e) {
      throw toRepoError(name, { code: (e as { code?: string }).code });
    }
  };
  const list = async (where?: Where<T>, opts?: ListOpts<T>): Promise<T[]> => {
    const params: unknown[] = [];
    const order = opts?.orderBy ? `order by "${toColumn(opts.orderBy)}" ${opts.desc ? "desc" : "asc"} nulls last` : "order by id";
    const limit = opts?.limit != null ? `limit ${Number(opts.limit)}` : "";
    const rows = await run<{ j: Record<string, unknown> }>(`select to_json(t) as j from public.${name} t ${whereSql(where, params)} ${order} ${limit}`, params);
    return rows.map((r) => fromDbRow<T>(r.j));
  };
  const get = async (id: string) => (await list({ id } as Where<T>))[0] ?? null;
  return {
    get,
    list,
    pick: async (fields, where, opts) => {
      const cols = pickFields(fields, opts);
      return (await list(where, opts)).map((r) => pickRow(r, cols) as never);
    },
    pickJson: async (fields, json, where, opts) => {
      const cols = pickFields(fields, opts);
      return (await list(where, opts)).map((r) => ({ ...pickRow(r, cols), ...Object.fromEntries(Object.entries(json).map(([a, path]) => [a, jsonAt(r, path)])) }) as never);
    },
    first: async (where, opts) => (await list(where, { ...opts, limit: 1 }))[0] ?? null,
    async count(where) {
      const params: unknown[] = [];
      return Number((await run<{ n: number }>(`select count(*)::int as n from public.${name} t ${whereSql(where, params)}`, params))[0].n);
    },
    async insert(row: T) {
      await run(`insert into public.${name} select * from json_populate_record(null::public.${name}, $1::json)`, [JSON.stringify(toDbRow(row as Record<string, unknown>))]);
      return (await get(row.id))!;
    },
    async update(id: string, patch: Partial<T>) {
      const values = toDbRow(patch as Record<string, unknown>);
      const cols = Object.keys(values);
      await run(
        `update public.${name} set (${cols.map((c) => `"${c}"`).join(", ")}) = (select ${cols.map((c) => `p."${c}"`).join(", ")} from json_populate_record(null::public.${name}, $1::json) p) where id = $2`,
        [JSON.stringify(values), id],
      );
      return (await get(id))!;
    },
    async remove() {
      throw new Error("används inte");
    },
  };
}
const sqlRepo = (tx: Tx): AppRepo => ({ table: (n: string) => sqlTable(tx, n) }) as unknown as AppRepo;

function sqlJobStore(tx: Tx): JobStore {
  return {
    async claim(n, now, maxAttempts) {
      const r = await tx.query<{ j: Record<string, unknown> }>(`select to_json(j) as j from public.claim_jobs($1, $2::timestamptz, $3) j`, [n, toDbValue(now), maxAttempts]);
      return r.rows.map((x) => fromDbRow<Job>(x.j));
    },
    async finish(id: string, patch: JobPatch) {
      await sqlTable<Job>(tx, "jobs").update(id, patch);
    },
  };
}

/** Bucketen "ljud" som en karta (filen "laddas upp" i testet). */
function fakeStorage() {
  const files = new Map<string, Uint8Array>();
  const storage: AudioStorage = {
    createSignedUploadUrl: async (path) => ({ signedUrl: `https://ref.supabase.co/storage/v1/object/upload/sign/ljud/${path}?token=x`, token: "x" }),
    size: async (path) => files.get(path)?.byteLength ?? null,
    download: async (path) => files.get(path) ?? null,
    remove: async (path) => void files.delete(path),
  };
  return { storage, files };
}

let db: PGlite;
beforeAll(async () => {
  db = await createMigratedDatabase();
  await loadSeed(db);
}, 120_000);
afterAll(async () => {
  await db?.close();
});

const asService = <T,>(fn: (tx: Tx) => Promise<T>) => asUser(db, null, fn, { role: "service_role" });

function setup(tx: Tx) {
  const repo = sqlRepo(tx);
  const f = fakeStorage();
  let n = 0;
  const newId = (p: string) => `${p}-db${++n}`;
  let scheduled = 0;
  const ctx = liveCtx({
    actor: SYSTEM_ACTOR, now: NOW, repo, system: repo, newId, enqueue: async () => undefined, ai: createSimulatedAi(),
    audio: (d) => createStorageAudio({ ...d, storage: f.storage }), scheduleJobs: () => void scheduled++,
  });
  const deps = { voice: () => ctx } as unknown as JobDeps;
  const run = () => runJobs({ store: sqlJobStore(tx), handlers: JOB_HANDLERS, ctx: deps, now: NOW, sleep: async () => undefined });
  return { repo, ctx, files: f.files, run, scheduled: () => scheduled };
}

describe("röstjobben mot migrationerna (PGlite)", () => {
  it("coachens inspelning: uppladdning, jobbet i kön (claim_jobs), förslag i ai_runs (jsonb), ljudet raderat, utkastet ifyllt", async () => {
    await asService(async (tx) => {
      const t = setup(tx);
      const ticket = await t.ctx.audio!.createUpload({ caseId: "case-260143", ownerId: "u-amira", purpose: "checkin", mimeType: "audio/webm;codecs=opus", durationSec: 1200 });
      t.files.set(ticket.storagePath, new Uint8Array(48_000));
      expect(await t.ctx.audio!.confirm(ticket.uploadId)).toMatchObject({ uploadId: ticket.uploadId, durationSec: 1200 });
      // Ett utkast till avstämningen (testdatats ci-11916 är Mehmets – här ett nytt för Nadia)
      const base = (await t.repo.table("check_ins").first({ caseId: "case-260143" }))!;
      await t.repo.table("check_ins").insert({ ...base, id: "ci-db", status: "draft", approvedBy: null, approvedAt: null, aiRunId: null, ai: null, overallStatus: null });
      const r = await enqueueVoiceJob(t.ctx, { kind: "transcribe_recording", uploadId: ticket.uploadId, source: "recording", checkInId: "ci-db" });
      expect(r.status).toBe("running");
      expect(t.scheduled()).toBe(1);
      const sum = await t.run();
      expect(sum).toMatchObject({ claimed: 1, done: 1, outcomes: { "transcribe_recording:succeeded": 1 } });
      const run = (await t.repo.table("ai_runs").get(r.aiRunId))!;
      expect(run).toMatchObject({ status: "succeeded", kind: "transcribe_extract", caseId: "case-260143", inputRef: ticket.uploadId, provider: "simulated", audioSeconds: 1200, inputDeletedAt: NOW, createdAt: NOW });
      const out = run.output as CheckInAiOutput;
      expect(out.suggestions.phase).toEqual({ value: null, quote: "Framgår inte av samtalet. Fasen ändras inte.", t: null, noEvidence: true });
      expect(out.transcript.length).toBeGreaterThan(5);
      expect(await t.repo.table("audio_uploads").get(ticket.uploadId)).toMatchObject({ status: "deleted", deletedAt: NOW, bytes: 48_000 });
      expect(t.files.size).toBe(0);
      const ci = (await t.repo.table("check_ins").get("ci-db"))!;
      expect(ci).toMatchObject({ aiRunId: r.aiRunId, inputMethod: "ai_recording", overallStatus: null });
      expect(ci.ai).toMatchObject({ audioDeletedAt: NOW, rawTranscriptDeleteBy: "2027-03-03T09:12", transcript: out.transcript });
      expect(await t.repo.table("jobs").get(r.jobId)).toMatchObject({ status: "done", attempts: 1, finishedAt: NOW, kind: "transcribe_recording" });
      expect(await t.repo.table("audit_log").count({ action: "audio.deleted", entityId: ticket.uploadId })).toBe(1);
    });
  });

  it("deltagarens röstmeddelande sparas i participant_voice_notes; månadens utkast i monthly_assessments.areas", async () => {
    await asService(async (tx) => {
      const t = setup(tx);
      const ticket = await t.ctx.audio!.createUpload({ caseId: "case-270012", ownerId: "deltagare", purpose: "participant", mimeType: "audio/mp4", durationSec: 40 });
      t.files.set(ticket.storagePath, new Uint8Array(160_000));
      await t.ctx.audio!.confirm(ticket.uploadId);
      const p = await enqueueVoiceJob(t.ctx, { kind: "transcribe_participant", uploadId: ticket.uploadId, linkId: "vl-demo", language: "ar", consentTextVersion: "röst-v1.0 (2026-09-30)", consentGivenAt: "2027-02-01T09:11" });
      const d = await enqueueVoiceJob(t.ctx, { kind: "draft_monthly", caseId: "case-260130", month: "2027-01" });
      expect(await t.run()).toMatchObject({ done: 2, failed: 0 });
      const note = (await t.repo.table("participant_voice_notes").first({ aiRunId: p.aiRunId }))!;
      expect(note).toMatchObject({ caseId: "case-270012", linkId: "vl-demo", language: "ar", status: "new", consentGivenAt: "2027-02-01T09:11", createdAt: NOW });
      expect(note.textOriginal).toMatch(/[؀-ۿ]/);
      expect(note.textSv).not.toMatch(/[؀-ۿ]/);
      const ma = (await t.repo.table("monthly_assessments").first({ caseId: "case-260130", month: "2027-01" }))!;
      expect(ma.areas.narvaro_rutiner.aiObservationDraft).toEqual({ text: "Närvarande vid 10 av 11 registrerade tillfällen. 1 ogiltig frånvaro.", sources: ["Närvaroregistrering", "Avstämning 22 jan"], noEvidence: false });
      expect(ma.areas.narvaro_rutiner.level).toBeNull();
      expect((await t.repo.table("ai_runs").get(d.aiRunId))!.status).toBe("succeeded");
    });
  });

  it("gallringens jobb läggs en gång per timme – en dubblett ger felkoden 23505 (DataError)", async () => {
    await asService(async (tx) => {
      const t = setup(tx);
      const jobs = t.repo as unknown as Repo<{ jobs: Job }>;
      expect(await ensureRetentionJobs(jobs, NOW)).toBe(2);
      expect(await ensureRetentionJobs(jobs, "2027-02-01T09:40")).toBe(0);
      expect(await t.repo.table("jobs").count({ kind: { in: ["retention_audio", "retention_transcripts"] } })).toBe(2);
      expect(await t.run()).toMatchObject({ done: 2, outcomes: { "retention_audio:removed:0": 1, "retention_transcripts:cleared:0": 1 } });
      const e = await t.repo.table("jobs").insert({ id: "job-retention_audio-2027-02-01T09", kind: "retention_audio", payload: {}, status: "queued", attempts: 0, runAfter: NOW, lastError: null, createdAt: NOW, createdBy: null, finishedAt: null }).catch((x: unknown) => x);
      expect(e).toBeInstanceOf(DataError);
      expect((e as DataError).code).toBe("23505");
    });
  });
});
