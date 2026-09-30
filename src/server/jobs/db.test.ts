// Utskick och jobb mot riktiga migrationer (PGlite, supabase/migrations): kolumnerna i outbound_messages och jobs,
// statusarna och mm.claim_jobs (FOR UPDATE SKIP LOCKED, attempts, run_after, max antal försök) – som service role.
// Raderna skrivs som PostgREST gör (json_populate_record) med samma namn- och tidsomvandling som SupabaseRepo.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import type { LocalDateTime } from "@/core/time";
import type { Row, Table } from "@/data/repo";
import { asUser, createMigratedDatabase, type Tx } from "@/data/supabase/pglite";
import { fromDbRow, toDbRow, toDbValue } from "@/data/supabase/columns";
import { recipientGate } from "../notify/decision";
import { queueMessage } from "../notify/queue";
import { fakeResend } from "../notify/test-helpers";
import type { JobRow, NotifyRepo, NotifyTables, OutboundRow } from "../notify/types";
import { JOB_HANDLERS, type JobDeps } from "./registry";
import { runJobs, type JobPatch, type JobStore } from "./runner";

const NOW = "2027-02-01T09:12";
const KARIM = "karim.khalil@miljonbemanning.se";

/** Den del av Repo som utskicken använder (get, insert, update), som SQL mot PGlite. */
function sqlTable<T extends Row>(tx: Tx, name: string): Table<T> {
  const get = async (id: string) => {
    const r = await tx.query<{ j: Record<string, unknown> }>(`select to_json(t) as j from public.${name} t where id = $1`, [id]);
    return r.rows[0] ? fromDbRow<T>(r.rows[0].j) : null;
  };
  const unsupported = async (): Promise<never> => {
    throw new Error("används inte av utskicken");
  };
  return {
    get,
    list: unsupported,
    first: unsupported,
    count: unsupported,
    async insert(row: T) {
      await tx.query(`insert into public.${name} select * from json_populate_record(null::public.${name}, $1::json)`, [JSON.stringify(toDbRow(row as Record<string, unknown>))]);
      return row;
    },
    async update(id: string, patch: Partial<T>) {
      const values = toDbRow(patch as Record<string, unknown>);
      const cols = Object.keys(values);
      const r = await tx.query(
        `update public.${name} set (${cols.map((c) => `"${c}"`).join(", ")}) = (select ${cols.map((c) => `p."${c}"`).join(", ")} from json_populate_record(null::public.${name}, $1::json) p) where id = $2`,
        [JSON.stringify(values), id],
      );
      if (!r.affectedRows) throw new Error(`ingen rad i ${name}`);
      return (await get(id))!;
    },
    remove: unsupported,
  };
}

const sqlRepo = (tx: Tx): NotifyRepo => ({ table: <N extends keyof NotifyTables & string>(n: N) => sqlTable<NotifyTables[N]>(tx, n) });

function sqlJobStore(tx: Tx): JobStore {
  return {
    async claim(n: number, now: LocalDateTime, maxAttempts: number) {
      const r = await tx.query<{ j: Record<string, unknown> }>(`select to_json(j) as j from public.claim_jobs($1, $2::timestamptz, $3) j`, [n, toDbValue(now), maxAttempts]);
      return r.rows.map((x) => fromDbRow<JobRow>(x.j));
    },
    async finish(id: string, patch: JobPatch) {
      await sqlTable<JobRow>(tx, "jobs").update(id, patch);
    },
  };
}

let db: PGlite;
beforeAll(async () => {
  db = await createMigratedDatabase();
}, 60_000);
afterAll(async () => {
  await db?.close();
});

const asService = <T>(fn: (tx: Tx) => Promise<T>) => asUser(db, null, fn, { role: "service_role" });

describe("utskick mot migrationerna (PGlite)", () => {
  it("kö, spärr, sändning och jobbstatus sparas i rätt kolumner", async () => {
    await asService(async (tx) => {
      let n = 0;
      const newId = (p: string) => `${p}-${++n}`;
      const repo = sqlRepo(tx);
      const ok = await queueMessage(repo, { channel: "email", to: KARIM, template: "ny_rapport", body: "Veckorapporten för vecka 4 finns i portalen – logga in för att läsa.", caseId: null }, NOW, newId);
      const stop = await queueMessage(repo, { channel: "email", to: "maria.ekdahl@botkyrka.se", template: "ny_rapport", body: "Veckorapporten för vecka 4 finns i portalen – logga in för att läsa.", caseId: null }, NOW, newId);
      const sms = await queueMessage(repo, { channel: "sms", to: "deltagare (SMS)", template: "kallelse", body: "Välkommen!", caseId: "case-1" }, NOW, newId);

      const resend = fakeResend();
      const deps: JobDeps = {
        notify: { repo, gate: recipientGate("staging", [KARIM]), render: { appUrl: "https://test.miljonmatch.se", staffDomains: ["miljonbemanning.se"] }, resend: { apiKey: "re_x", from: "Miljonmatch <notis@miljonbemanning.se>" }, fetch: resend.fetch, now: "2027-02-01T09:13" },
      };
      // Före run_after: inget hämtas
      expect(await runJobs({ store: sqlJobStore(tx), handlers: JOB_HANDLERS, ctx: deps, now: "2027-02-01T09:11" })).toMatchObject({ claimed: 0 });
      const sum = await runJobs({ store: sqlJobStore(tx), handlers: JOB_HANDLERS, ctx: deps, now: "2027-02-01T09:13" });
      expect(sum).toMatchObject({ claimed: 2, done: 2, failed: 0, outcomes: { "send_message:sent": 1, "send_message:suppressed": 1 } });
      expect(resend.calls.map((c) => c.body.to)).toEqual([[KARIM]]);

      const out = async (id: string) => (await repo.table("outbound_messages").get(id)) as OutboundRow;
      expect(await out(ok.messageId)).toMatchObject({ status: "sent", sentAt: "2027-02-01T09:13", providerMessageId: "re-1", statusReason: null, subject: "Ny rapport i portalen", createdAt: NOW });
      expect(await out(stop.messageId)).toMatchObject({ status: "suppressed", statusReason: "Testmiljön: mottagaren finns inte i MM_EMAIL_ALLOWLIST", sentAt: null });
      expect(await out(sms.messageId)).toMatchObject({ channel: "sms", status: "suppressed", statusReason: "SMS-leverantör inte vald" });
      const job = (await repo.table("jobs").get(ok.jobId!))!;
      expect(job).toMatchObject({ kind: "send_message", payload: { messageId: ok.messageId }, status: "done", attempts: 1, lastError: null, finishedAt: "2027-02-01T09:13", startedAt: "2027-02-01T09:13" });

      // Samma jobb körs inte igen
      expect(await runJobs({ store: sqlJobStore(tx), handlers: JOB_HANDLERS, ctx: deps, now: "2027-02-01T10:00" })).toMatchObject({ claimed: 0 });
      expect(resend.calls).toHaveLength(1);
    });
  });

  it("fel: nytt försök med väntetid, och efter fem försök hämtar claim_jobs inte jobbet igen", async () => {
    await asService(async (tx) => {
      let n = 0;
      const repo = sqlRepo(tx);
      const q = await queueMessage(repo, { channel: "email", to: KARIM, template: "ny_rapport", body: "Ny rapport – logga in för att läsa.", caseId: null }, NOW, (p) => `${p}-f${++n}`);
      const resend = fakeResend({ fail: Array.from({ length: 5 }, () => ({ status: 503, name: "service_unavailable" })) });
      let now: LocalDateTime = NOW;
      for (let i = 1; i <= 5; i++) {
        const deps: JobDeps = { notify: { repo, gate: recipientGate("staging", [KARIM]), render: { appUrl: null, staffDomains: [] }, resend: { apiKey: "re_x", from: "a@b.se" }, fetch: resend.fetch, now } };
        expect((await runJobs({ store: sqlJobStore(tx), handlers: JOB_HANDLERS, ctx: deps, now })).claimed).toBe(1);
        const j = (await repo.table("jobs").get(q.jobId!))!;
        expect(j.attempts).toBe(i);
        if (i < 5) {
          expect(j).toMatchObject({ status: "queued", lastError: "Resend svarade 503 (service_unavailable)" });
          now = j.runAfter;
        } else {
          expect(j).toMatchObject({ status: "failed", finishedAt: now });
        }
      }
      expect(now).toBe("2027-02-01T10:33"); // 09:12 + 1 + 5 + 15 + 60 minuter
      expect(await repo.table("outbound_messages").get(q.messageId)).toMatchObject({ status: "failed", statusReason: "Resend svarade 503 (service_unavailable)" });
      const again = await tx.query(`select id from public.claim_jobs(10, $1::timestamptz)`, [toDbValue("2027-02-02T12:00")]);
      expect(again.rows).toHaveLength(0);
    });
  });

  it("claim_jobs får bara anropas av service role", async () => {
    await asUser(db, null, async (tx) => {
      await expect(tx.query(`select * from public.claim_jobs(1)`)).rejects.toMatchObject({ code: "42501" });
    }, { role: "authenticated" });
  });
});
