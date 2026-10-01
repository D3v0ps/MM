// Pulslänken i supabase-läget: deltagaren är databasrollen anon och har inga rättigheter alls. Hanteraren ska ändå kunna
// spara svaret – via systemsteg (ctx.system) efter att token kontrollerats – och anon ska fortsatt sakna rättigheter.
//   1. Minnesläget med ett repo som nekar allt (som anon): svaret sparas, länken förbrukas, uppgiften till samordnaren och
//      lågt betyg till chefen blir som vanligt, och deltagarens eget repo används inte till något.
//   2. Migrationerna i PGlite: anon har inga rättigheter på pulstabellerna (eller någon annan tabell) och kan inte skriva ett svar.
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { SYSTEM_ACTOR, type Actor } from "@/api/roles";
import { execute, type Ctx } from "@/api/server";
import { alerts } from "@/core/alerts";
import { domainEnv } from "@/core/env";
import { addMinutes, type LocalDateTime } from "@/core/time";
import { PARTICIPANT_USER_ID } from "@/data/actors";
import { MemoryRepo, MemoryStore } from "@/data/memory";
import { POLICIES } from "@/data/policy";
import { PolicyError } from "@/data/repo";
import { TABLE_NAMES, type AppRepo, type Db, type TableName, type Tables } from "@/data/schema";
import { createSeed, DEMO_START, TEST_PNR_CRYPTO } from "@/data/seed";
import { asUser, attempt, createMigratedDatabase } from "@/data/supabase/pglite";
import "./handlers";

// ---------------------------------------------------------------- 1. Minnesläget, deltagaren som anon
/** Repo som nekar varje läsning och skrivning – som anon i supabase-läget. Räknar försöken. */
function denyAllRepo(): { repo: AppRepo; attempts: string[] } {
  const attempts: string[] = [];
  const deny = (table: string, op: string) => async () => {
    attempts.push(`${table}.${op}`);
    throw new PolicyError(table);
  };
  const repo = {
    table: (name: string) => Object.fromEntries(["get", "list", "first", "count", "insert", "update", "remove"].map((op) => [op, deny(name, op)])),
  } as unknown as AppRepo;
  return { repo, attempts };
}

const PARTICIPANT: Actor = { userId: PARTICIPANT_USER_ID, role: "deltagare", contractIds: [], customerUnit: null };
const answers = { q1: 4, q2: 3, q3: 2, q4: "praktik", q5: "ja" };

let store: MemoryStore<Tables>;
let now: LocalDateTime;
let denied: string[];
let seq = 0;
beforeEach(() => {
  store = new MemoryStore<Tables>(createSeed());
  now = DEMO_START;
  denied = [];
});
const rows = <N extends TableName>(n: N): Tables[N][] => store.rows(n);

/** Kör som deltagaren med ett repo som nekar allt; systemstegen går mot minnet utan filter (service role). */
async function asAnon(kind: "query" | "command", key: string, input: unknown): Promise<unknown> {
  if (kind === "command") now = addMinutes(now, 1);
  const { repo, attempts } = denyAllRepo();
  const system = new MemoryRepo<Tables>(store, SYSTEM_ACTOR, POLICIES, { bypass: true }) as unknown as AppRepo;
  const newId = (prefix: string) => `${prefix}-n${String(++seq).padStart(5, "0")}`;
  const ctx: Ctx = {
    actor: PARTICIPANT,
    now: () => now,
    repo,
    system,
    newId,
    audit: async (e) => {
      await system.table("audit_log").insert({ id: newId("log"), occurredAt: now, actorId: PARTICIPANT.userId, action: e.action, entity: e.entity, entityId: e.entityId, contractId: e.contractId ?? null, details: e.details ?? {} });
    },
    notify: async () => {
      throw new Error("Pulssvaret ska inte skicka något");
    },
    crypto: TEST_PNR_CRYPTO,
  };
  try {
    return JSON.parse(JSON.stringify(await execute(kind, key, input, ctx)));
  } finally {
    denied.push(...attempts);
  }
}

describe("pulslänken när deltagaren saknar alla rättigheter (anon i supabase-läget)", () => {
  it("länkens läge läses utan deltagarens repo", async () => {
    expect(await asAnon("query", "puls.link", {})).toEqual({ state: "open", language: "sv", days: 7, location: "Alby" });
    expect(await asAnon("query", "puls.link", { token: "abcdefgh12345678" })).toMatchObject({ state: "missing" });
    expect(denied).toEqual([]);
  });

  it("svaret sparas, länken förbrukas, samordnaren får uppgiften och chefen flaggan – utan deltagarens repo", async () => {
    const before = { responses: rows("pulse_responses").length, tasks: rows("tasks").length, audit: rows("audit_log").length, out: rows("outbound_messages").length };
    expect(await asAnon("command", "puls.submit", { language: "so", answers, text: "  Jag vill prata om min praktik.  " })).toEqual({ ok: true });
    expect(denied).toEqual([]);

    const resp = rows("pulse_responses").at(-1)!;
    expect(rows("pulse_responses")).toHaveLength(before.responses + 1);
    expect(resp).toEqual({
      id: resp.id, inviteId: "pi-demo", caseId: "case-260143", coachId: "u-amira", occasion: "periodic", language: "so",
      answers: { q1: 4, q2: 3, q3: 2, q4: "praktik", q5: "ja" }, text: "Jag vill prata om min praktik.", contactRequested: true, submittedAt: "2027-02-01T09:13",
    });
    expect(rows("pulse_invites").find((x) => x.id === "pi-demo")).toMatchObject({ usedAt: "2027-02-01T09:13", language: "so" });

    expect(rows("tasks")).toHaveLength(before.tasks + 1);
    expect(rows("tasks").at(-1)).toMatchObject({
      toRole: "samordnare", toId: null, fromId: "system", kind: "pulse_contact", caseIds: ["case-260143"], responseId: resp.id, status: "open", createdAt: "2027-02-01T09:13",
      text: "En deltagare vill bli kontaktad (pulsmätning 1 feb 2027, ärende BOT-26-0143). Avgör vem som tar kontakten.",
    });
    expect(rows("audit_log")).toHaveLength(before.audit + 1);
    expect(rows("audit_log").at(-1)).toMatchObject({ action: "pulse.submitted", actorId: PARTICIPANT_USER_ID, entity: "pulse_response", entityId: resp.id, contractId: "c-bot", details: { caseId: "case-260143", language: "so", contactRequested: true } });
    expect(rows("outbound_messages")).toHaveLength(before.out);

    // Lågt betyg på stödet (fråga 3 = 2) går till chefen, kontaktönskan till samordnaren – ingenting till coachen.
    const db = Object.fromEntries(TABLE_NAMES.map((n) => [n, rows(n)])) as unknown as Db;
    const env = domainEnv(rows("contracts")[0], rows("org_settings")[0].settings, now);
    const kinds = (role: "samordnare" | "coach" | "chef", personaId: string) => alerts(db, { role, personaId }, env).filter((a) => a.key.includes(resp.id)).map((a) => a.kind);
    expect(kinds("samordnare", "u-sara")).toEqual(["pulse_contact"]);
    expect(kinds("chef", "u-karin")).toEqual(["pulse_low"]);
    expect(kinds("coach", "u-amira")).toEqual([]);

    // Länken går bara att använda en gång – också när svaret skrivs som systemsteg.
    expect(await asAnon("query", "puls.link", {})).toMatchObject({ state: "used" });
    expect(await asAnon("command", "puls.submit", { language: "sv", answers: { q1: 5, q2: 5, q3: 5, q4: "jobb", q5: "nej" }, text: "" })).toMatchObject({ ok: false, error: "used" });
    expect(rows("pulse_responses")).toHaveLength(before.responses + 1);
    expect(denied).toEqual([]);
  });

  it("kontrollerna före systemstegen: okänd länk, utgången länk, skyddat ärende och ofullständigt svar sparar ingenting", async () => {
    const n = rows("pulse_responses").length;
    expect(await asAnon("command", "puls.submit", { token: "abcdefgh12345678", language: "sv", answers, text: "" })).toMatchObject({ ok: false, error: "not_found" });
    expect(await asAnon("command", "puls.submit", { language: "sv", answers: { ...answers, q5: null }, text: "" })).toMatchObject({ ok: false, error: "incomplete" });

    // Skyddat ärende: länken räknas som saknad (ska aldrig finnas, CLAUDE.md punkt 8).
    const inv = rows("pulse_invites").find((x) => x.id === "pi-demo")!;
    const c = rows("cases").find((x) => x.id === inv.caseId)!;
    const person = rows("persons").find((p) => p.id === c.personId)!;
    person.protectedIdentity = true;
    expect(await asAnon("command", "puls.submit", { language: "sv", answers, text: "" })).toMatchObject({ ok: false, error: "not_found" });
    person.protectedIdentity = false;

    // Utgången länk
    now = inv.expiresAt;
    expect(await asAnon("command", "puls.submit", { language: "sv", answers, text: "" })).toMatchObject({ ok: false, error: "expired" });

    expect(rows("pulse_responses")).toHaveLength(n);
    expect(rows("pulse_invites").find((x) => x.id === "pi-demo")!.usedAt).toBeNull();
    expect(rows("tasks").filter((t) => t.kind === "pulse_contact" && t.caseIds.includes(inv.caseId) && t.createdAt >= DEMO_START)).toEqual([]);
    expect(denied).toEqual([]);
  });
});

// ---------------------------------------------------------------- 2. Databasen: anon har fortfarande inga rättigheter
describe("migrationerna: anon har inga rättigheter på pulstabellerna (PGlite)", () => {
  let db: PGlite;
  beforeAll(async () => {
    db = await createMigratedDatabase();
  }, 120_000);
  afterAll(async () => {
    await db?.close();
  });

  it("ingen select, insert, update eller delete för anon – på pulstabellerna eller någon annan tabell", async () => {
    const priv = await db.query<{ t: string; s: boolean; i: boolean; u: boolean; d: boolean }>(
      `select t, has_table_privilege('anon', ('public.' || t)::regclass, 'select') as s, has_table_privilege('anon', ('public.' || t)::regclass, 'insert') as i,
              has_table_privilege('anon', ('public.' || t)::regclass, 'update') as u, has_table_privilege('anon', ('public.' || t)::regclass, 'delete') as d
       from unnest($1::text[]) as t`,
      [["pulse_responses", "pulse_invites", "tasks", "audit_log", "cases", "persons"]],
    );
    expect(priv.rows).toEqual(["pulse_responses", "pulse_invites", "tasks", "audit_log", "cases", "persons"].map((t) => ({ t, s: false, i: false, u: false, d: false })));

    const any = await db.query<{ t: string }>(
      `select c.relname as t from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind in ('r', 'v', 'm')
         and (has_table_privilege('anon', c.oid, 'select') or has_table_privilege('anon', c.oid, 'insert')
           or has_table_privilege('anon', c.oid, 'update') or has_table_privilege('anon', c.oid, 'delete'))`,
    );
    expect(any.rows).toEqual([]);
    // Pulslänkens hjälpfunktion (RLS för inloggade) ligger i schemat mm, som anon inte når.
    const mm = await db.query<{ ok: boolean }>(`select has_schema_privilege('anon', 'mm', 'usage') as ok`);
    expect(mm.rows[0].ok).toBe(false);
  });

  it("anon kan varken läsa pulslänkar eller skriva ett svar, en uppgift eller en loggpost", async () => {
    const res = await asUser(db, null, async (tx) => ({
      readInvites: await attempt(tx, "select count(*) from public.pulse_invites"),
      readResponses: await attempt(tx, "select count(*) from public.pulse_responses"),
      insertResponse: await attempt(tx, "insert into public.pulse_responses (id) values ('pr-anon')"),
      useInvite: await attempt(tx, "update public.pulse_invites set used_at = now()"),
      insertTask: await attempt(tx, "insert into public.tasks (id) values ('task-anon')"),
      insertAudit: await attempt(tx, "insert into public.audit_log (id) values ('log-anon')"),
      inviteOpen: await attempt(tx, "select mm.pulse_invite_open('pi-demo', 'case-260143')"),
    }));
    for (const [what, a] of Object.entries(res)) expect({ what, code: a.ok ? "ok" : a.code }).toEqual({ what, code: "42501" });
  });
});
