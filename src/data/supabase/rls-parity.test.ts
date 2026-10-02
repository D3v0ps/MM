// Bevis: Row Level Security i Postgres ger exakt samma resultat som prototypens policy (src/data/policy.ts).
// Kör alla migrationer och supabase/seed.sql i PGlite (lokal Postgres i processen) och jämför, för varje testperson och
// varje tabell, vad RLS släpper igenom med vad MemoryRepo + POLICIES släpper igenom på samma testdata.
// Kör: npx vitest run src/data/supabase/rls-parity.test.ts
import { readFileSync } from "node:fs";
import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { accessIndex, caseAccessIn } from "@/core/access";
import { requireOperational } from "@/core/config";
import { COLUMNS, EXTRA_COLUMNS, quoteIdent, snakeCase, type SqlType } from "../../../scripts/db/columns";
import { authUserIdFor, seedData, seedSql, sqlLiteral, TESTERS } from "../../../scripts/db/seed-sql";
import { listPersonas, type Persona } from "../actors";
import { MemoryRepo, MemoryStore, type RawAccess } from "../memory";
import { canReadRow, canWriteRow, POLICIES } from "../policy";
import { TABLE_NAMES, type TableName, type Tables } from "../schema";
import { allowed, asUser, attempt, createMigratedDatabase, loadSeed, MIGRATIONS_DIR, SEED_FILE, type Tx } from "./pglite";

// Testarnas konton i auth.users (skapas av servern vid första inloggningen; seeden kopplar dem via e-postadressen).
const TESTER_AUTH: Record<string, string> = {
  "tester-karim": "aaaaaaaa-0000-4000-8000-000000000001",
  "tester-ali": "aaaaaaaa-0000-4000-8000-000000000002",
  "tester-sara": "aaaaaaaa-0000-4000-8000-000000000003",
  "tester-adam": "aaaaaaaa-0000-4000-8000-000000000004",
  "tester-shafik": "aaaaaaaa-0000-4000-8000-000000000005",
  "tester-moda": "aaaaaaaa-0000-4000-8000-000000000006",
};
const KARIM = TESTER_AUTH["tester-karim"];
const ALI = TESTER_AUTH["tester-ali"];
const authOf = (userId: string) => TESTER_AUTH[userId] ?? authUserIdFor(userId);

const data = seedData();
/** Extra testperson: kommunens chef för underenheten Alby (rapporter steg 3). */
const CHEF_ALBY = "k-chef-alby";

/**
 * Extra rader för tabeller som testdatat lämnar tomma eller bara täcker delvis (flaggor, deadlines, bonus, fakturarader,
 * AI-beslut, skyddade ärenden …), så att deras policyer också prövas. Läggs in både i minnet och i databasen.
 */
function extraRows(): { [N in TableName]?: Tables[N][] } {
  const prot = new Set(data.persons.filter((p) => p.protectedIdentity).map((p) => p.id));
  const protectedCase = data.cases.find((c) => prot.has(c.personId))!;
  const mariaCase = data.cases.find((c) => c.referrerId === "k-maria")!;
  const amiraCase = data.cases.find((c) => c.leadCoachId === "u-amira")!;
  const petraCase = data.cases.find((c) => data.case_team.some((t) => t.caseId === c.id && t.userId === "u-petra"))!;
  const runWithCase = data.ai_runs.find((r) => r.caseId)!;
  const at = "2027-02-01T06:00";
  const alert = (id: string, contractId: string, caseId: string | null, recipientRoles: Tables["alerts"]["recipientRoles"]): Tables["alerts"] => ({
    id, key: `${id}-key`, contractId, caseId, kind: "stuck", severity: "warning", title: "Flagga", message: "Text", recipientRoles, createdAt: at,
    acknowledgedBy: null, acknowledgedAt: null, actionPlan: null,
  });
  const deadline = (id: string, contractId: string, caseId: string | null): Tables["deadlines"] => ({ id, contractId, caseId, reportId: null, kind: "forsta_mote", dueAt: at, metAt: null, status: "open" });
  const bonus = (id: string, caseId: string): Tables["bonus_claims"] => ({
    id, caseId, kind: "work", basis: "Anställningsbevis", evidencePaths: [], submittedAt: at, customerDecision: null, decidedBy: null, decidedAt: null, amountOre: null, invoiceDraftId: null,
  });
  const cdev = (id: string, caseId: string | null): Tables["contract_deviations"] => ({
    ...data.contract_deviations[0], id, caseId,
  });
  const draft = data.invoice_drafts[0];
  const decision = (id: string, aiRunId: string | null, decidedBy: string): Tables["ai_field_decisions"] => ({
    id, aiRunId, field: "nextGoal", suggested: "a", final: "a", decision: "accepted", changed: false, decidedBy, decidedAt: at,
  });
  // Röstinspelning (0015): en länk och ett röstmeddelande i det skyddade ärendet (får aldrig skapas – prövar att ingen kan
  // ändra dem), ett granskat röstmeddelande i ett ärende som kommunens handläggare beställt, och ljudfiler för alla syften.
  const link = (id: string, caseId: string, tokenHash: string | null): Tables["voice_links"] => ({
    id, caseId, tokenHash, channel: "sms", language: "sv", sentAt: at, expiresAt: "2027-02-08T06:00", usedAt: null, createdBy: "u-amira",
  });
  const note = (id: string, caseId: string, linkId: string, status: Tables["participant_voice_notes"]["status"]): Tables["participant_voice_notes"] => ({
    id, caseId, linkId, language: "sv", textSv: "Text", textOriginal: null, consentTextVersion: "röst-v1.0 (2026-09-30)", consentGivenAt: at, status,
    createdAt: at, reviewedBy: status === "new" ? null : "u-amira", reviewedAt: status === "new" ? null : at, aiRunId: null,
  });
  const audio = (id: string, caseId: string | null, ownerId: string, purpose: Tables["audio_uploads"]["purpose"]): Tables["audio_uploads"] => ({
    id, caseId, ownerId, purpose, storagePath: `${purpose}/${id}.webm`, mimeType: "audio/webm", bytes: 4000, durationSec: 1, status: "uploaded", createdAt: at, deletedAt: null,
  });
  // Synpunkter (0017): Karims och Alis synpunkter, ett svar och en synpunkt med ändrad status.
  const fb = (id: string, authorId: string, status: Tables["feedback"]["status"]): Tables["feedback"] => ({
    id, type: "fel", priority: "bor", text: "Text", status, role: "coach", path: "/min-vecka", viewTitle: "Min vecka", createdAt: at, authorId,
    statusChangedAt: status === "ny" ? null : at, statusChangedBy: status === "ny" ? null : authorId, submittedAt: null,
  });
  // Kommunens resultatfil (rapporter steg 3): en chef för en underenhet (Alby) prövar enhetsspärren – testdatat har bara en
  // kommunchef, för hela Arbetsmarknadsenheten. Profilen får sitt auth_user_id i beforeAll (insertSql skriver inte extrakolumnerna).
  const eva = data.profiles.find((x) => x.id === "k-eva")!;
  // Rapportbyggaren (0021): en arkiverad mb-rad, en rad i c-kk och en rad delad med kommunen som ägs av samordnaren (delad av
  // avtalsansvarig – samordnaren får sedan inte ändra den).
  const saved = (id: string, contractId: string, ownerId: string, visibility: Tables["saved_reports"]["visibility"], sharedBy: string | null, archivedBy: string | null = null): Tables["saved_reports"] => ({
    id, contractId, ownerId, title: "Testrapport", templateKey: null, definition: { v: 1, dataset: "deltagarmanader" }, visibility, createdAt: at, updatedAt: null, updatedBy: null,
    sharedAt: sharedBy ? at : null, sharedBy, archivedAt: archivedBy ? at : null, archivedBy,
  });
  return {
    saved_reports: [
      saved("sr-x-arkiv", "c-bot", "u-karin", "mb", "u-karin", "u-karin"),
      saved("sr-x-kk", "c-kk", "u-johan", "mb", "u-johan"),
      saved("sr-x-sara-kommun", "c-bot", "u-sara", "customer", "u-johan"),
    ],
    profiles: [{ ...eva, id: CHEF_ALBY, fullName: "Testchef Alby", email: "chef.alby@example.invalid", customerUnit: "Arbetsmarknadsenheten Alby", lastLoginAt: null }],
    memberships: [{ id: "ms-x-chef-alby", userId: CHEF_ALBY, contractId: "c-bot", role: "kommun_chef", customerUnit: "Arbetsmarknadsenheten Alby" }],
    feedback: [fb("fb-x-karim", "tester-karim", "ny"), fb("fb-x-ali", "tester-ali", "klar")],
    feedback_replies: [{ id: "fbr-x-1", feedbackId: "fb-x-karim", text: "Svar", createdAt: at, authorId: "tester-ali", submittedAt: null }],
    alerts: [
      alert("al-1", "c-bot", amiraCase.id, ["coach", "samordnare"]), alert("al-2", "c-bot", null, ["chef"]),
      alert("al-3", "c-bot", protectedCase.id, ["avtalsansvarig", "samordnare"]), alert("al-4", "c-kk", null, ["avtalsansvarig"]),
      alert("al-5", "c-bot", petraCase.id, ["handledare", "ekonom"]),
    ],
    alert_acks: [{ id: "al-1-key", alertKey: "al-1-key", acknowledgedBy: "u-amira", acknowledgedAt: at, actionPlan: "Plan" }],
    deadlines: [deadline("dl-1", "c-bot", amiraCase.id), deadline("dl-2", "c-bot", null), deadline("dl-3", "c-bot", protectedCase.id), deadline("dl-4", "c-kk", null)],
    kpi_snapshots: [
      { id: "kpi-1", contractId: "c-bot", kpiKey: "resultatgrad", window: "rolling_6m", value: 0.34, numerator: 17, denominator: 50, computedAt: at },
      { id: "kpi-2", contractId: "c-kk", kpiKey: "placeringsgrad", window: "month", value: null, numerator: 0, denominator: 0, computedAt: at },
    ],
    bonus_claims: [bonus("bc-1", mariaCase.id), bonus("bc-2", amiraCase.id), bonus("bc-3", protectedCase.id), bonus("bc-4", petraCase.id)],
    contract_deviations: [cdev("cd-x1", mariaCase.id), cdev("cd-x2", protectedCase.id)],
    invoice_lines: [{
      id: "il-1", invoiceDraftId: draft.id, caseId: draft.caseId!, priceItemId: "pi-G", quantity: 4, unitPriceOre: 350000, vatRate: 25, description: "Deltagarvecka",
      isoWeeks: ["2026-W45"], zeroAttendanceWeeks: [],
    }],
    billing_week_approvals: [{ id: `${draft.caseId}:2026-W45`, contractId: "c-bot", month: "2026-11", caseId: draft.caseId!, weekKey: "2026-W45", approvedBy: "u-lars", approvedAt: at, note: "" }],
    invoice_credits: [{ id: "ic-1", contractId: "c-bot", month: "2026-12", caseId: draft.caseId!, creditedAt: at, creditedBy: "u-lars", buyerReference: null }],
    fortnox_runs: [
      { id: "fr-1", contractId: "c-bot", month: "2027-01", kind: "create", ranAt: at, ranBy: "u-lars", created: 1, skipped: 0, notReady: 0, blocked: 0, changed: 0 },
      { id: "fr-2", contractId: "c-kk", month: "2027-01", kind: "sync", ranAt: at, ranBy: "u-lars", created: 0, skipped: 0, notReady: 0, blocked: 0, changed: 0 },
    ],
    jobs: [{ id: "job-seed", kind: "send_message", payload: {}, status: "done", attempts: 1, runAfter: at, lastError: null, createdAt: at, createdBy: null, finishedAt: at }],
    ai_runs: [{ ...runWithCase, id: "ai-run-utan-arende", caseId: null }],
    ai_field_decisions: [
      decision("afd-1", runWithCase.id, "u-amira"), decision("afd-2", "ai-run-utan-arende", "u-sara"), decision("afd-3", null, "u-amira"), decision("afd-4", "saknas", "u-sara"),
    ],
    case_seen: [{ id: `k-maria:${mariaCase.id}`, userId: "k-maria", caseId: mariaCase.id, seenAt: at }],
    template_versions: [{ id: "tv-1", templateKey: "ordererkannande", version: 1, subject: "Ärende", body: "Text", savedAt: at, savedBy: "u-robin", note: "" }],
    log_checks: [{ id: "lc-1", month: "2027-01", items: [{ logId: "log-17284", verdict: "ok" }], note: "", signedBy: "u-karin", signedAt: at }],
    tasks: [
      { ...data.tasks[0], id: "task-x1", toRole: "kommun_handlaggare", toId: "k-maria", fromId: "u-sara", caseIds: [mariaCase.id] },
      { ...data.tasks[0], id: "task-x2", toRole: "coach", toId: null, fromId: "u-sara", caseIds: [amiraCase.id] },
    ],
    inbound_emails: [{ ...data.inbound_emails[0], id: "em-x1", caseId: protectedCase.id, classification: "order" }],
    voice_links: [link("vl-x-skyddad", protectedCase.id, "x-skyddad"), link("vl-x-maria", mariaCase.id, null), link("vl-x-petra", petraCase.id, "x-petra")],
    participant_voice_notes: [note("pvn-x-skyddad", protectedCase.id, "vl-x-skyddad", "new"), note("pvn-x-maria", mariaCase.id, "vl-x-maria", "reviewed"), note("pvn-x-arkiv", petraCase.id, "vl-x-petra", "archived")],
    audio_uploads: [
      audio("aud-x-diktat", null, "k-maria", "dictation"), audio("aud-x-diktat-arende", mariaCase.id, "k-maria", "dictation"),
      audio("aud-x-petra", petraCase.id, "u-petra", "checkin"), audio("aud-x-skyddad", protectedCase.id, protectedCase.leadCoachId!, "checkin"),
      audio("aud-x-deltagare", amiraCase.id, "deltagare", "participant"),
    ],
  };
}
const EXTRA = extraRows();
for (const [t, rows] of Object.entries(EXTRA)) (data[t as TableName] as unknown as object[]).push(...(rows as object[]));
const store = new MemoryStore<Tables>(data);
const raw: RawAccess<Tables> = store.raw();
const personas = listPersonas(raw);
const personaKey = (p: Persona) => `${p.actor.userId}|${p.actor.role}`;
const findPersona = (userId: string) => {
  const p = personas.find((x) => x.actor.userId === userId);
  if (!p) throw new Error(`Testperson saknas: ${userId}`);
  return p;
};

let db: PGlite;

/** Välj testperson åt testaren (i samma transaktion, som postgres). */
const chooseTestPerson = (profileId: string, role: string) => async (tx: Tx) => {
  await tx.query("insert into public.tester_sessions (auth_user_id, profile_id, role) values ($1, $2, $3)", [KARIM, profileId, role]);
};

/**
 * Aktören som policy.ts ska se för testpersonen – samma som databasen: testarna (och deltagaren, som testaren Karim agerar
 * som) har testerId, eftersom den inloggade (auth.uid()) är en testare i testmiljön (mm.auth_is_tester()). Bara
 * synpunkterna (0017) läser testerId.
 */
function actorOf(p: Persona): Persona["actor"] {
  if (p.actor.role === "deltagare") return { ...p.actor, testerId: "tester-karim" };
  return TESTER_AUTH[p.actor.userId] ? { ...p.actor, testerId: p.actor.userId } : p.actor;
}

/** Kör fn som testpersonen: vanliga personer med sitt auth-id, deltagaren (ingen profil) via testarens val. */
function asPersona<T>(p: Persona, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (p.actor.role === "deltagare") return asUser(db, KARIM, fn, { before: chooseTestPerson(p.actor.userId, "deltagare") });
  return asUser(db, authOf(p.actor.userId), fn);
}

/** Tabellen som RLS-läsningen görs mot: avtal och ärenden läses via vyerna contracts_public och cases_public (se supabase/README.md). */
const readSource = (t: TableName) => (t === "contracts" ? "contracts_public" : t === "cases" ? "cases_public" : t);
const COUNT_SQL = TABLE_NAMES.map((t) => `select '${t}' as t, count(*)::int as n from public.${readSource(t)}`).join(" union all ");

async function pgCounts(tx: Tx): Promise<Record<string, number>> {
  const r = await tx.query<{ t: string; n: number }>(COUNT_SQL);
  return Object.fromEntries(r.rows.map((x) => [x.t, x.n]));
}
async function memCounts(p: Persona): Promise<Record<string, number>> {
  const repo = new MemoryRepo<Tables>(store, actorOf(p), POLICIES);
  const out: Record<string, number> = {};
  for (const t of TABLE_NAMES) out[t] = await repo.table(t).count();
  return out;
}
const pgIds = async (tx: Tx, t: TableName) => (await tx.query<{ id: string }>(`select id from public.${readSource(t)} order by id`)).rows.map((r) => r.id);
const memIds = async (p: Persona, t: TableName) =>
  (await new MemoryRepo<Tables>(store, actorOf(p), POLICIES).table(t).list()).map((r) => r.id).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

beforeAll(async () => {
  db = await createMigratedDatabase();
  for (const [id, auth] of Object.entries(TESTER_AUTH)) {
    await db.query("insert into auth.users (id, email) values ($1, $2)", [auth, TESTERS.find((t) => t.id === id)!.email]);
  }
  await loadSeed(db);
  for (const [t, rows] of Object.entries(EXTRA)) {
    for (const row of rows as Record<string, unknown>[]) await db.exec(insertSql(t as TableName, row));
  }
  await db.query("update public.profiles set auth_user_id = $1 where id = $2", [authUserIdFor(CHEF_ALBY), CHEF_ALBY]);
}, 120_000);

// ================================================================ Schema och seed
describe("schema och seed", () => {
  it("supabase/seed.sql är genererad från nuvarande testdata (npx tsx scripts/db/generate-seed.ts)", () => {
    expect(readFileSync(SEED_FILE, "utf8") === seedSql(seedData())).toBe(true);
  });

  it("migrationerna ger exakt kolumnerna i scripts/db/columns.ts (namn, typ, nullbarhet)", async () => {
    const r = await db.query<{ table_name: string; column_name: string; udt_name: string; is_nullable: string }>(
      "select table_name, column_name, udt_name, is_nullable from information_schema.columns where table_schema = 'public' and table_name = any ($1)",
      [TABLE_NAMES as unknown as string[]],
    );
    const udt: Record<string, string> = { text: "text", date: "date", timestamptz: "timestamptz", boolean: "bool", integer: "int4", bigint: "int8", numeric: "numeric", jsonb: "jsonb", "text[]": "_text", "date[]": "_date", "integer[]": "_int4", uuid: "uuid" };
    const actual = r.rows.map((c) => `${c.table_name}.${c.column_name}:${c.udt_name}${c.is_nullable === "YES" ? "?" : ""}`).sort();
    const expected: string[] = [];
    for (const t of TABLE_NAMES) {
      const cols = { ...(COLUMNS[t] as Record<string, SqlType>), ...(EXTRA_COLUMNS[t] ?? {}) };
      for (const [field, type] of Object.entries(cols)) {
        const base = type.replace(" | null", "");
        expected.push(`${t}.${snakeCase(field)}:${udt[base]}${type.endsWith("| null") ? "?" : ""}`);
      }
    }
    expect(actual).toEqual(expected.sort());
  });

  it("varje tabell har RLS, och anon har inga rättigheter alls", async () => {
    const tables = [...TABLE_NAMES, "app_settings", "tester_sessions", "login_attempts"];
    const r = await db.query<{ relname: string; relrowsecurity: boolean }>(
      "select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r'",
    );
    expect(r.rows.map((x) => x.relname).sort()).toEqual([...tables].sort());
    expect(r.rows.filter((x) => !x.relrowsecurity).map((x) => x.relname)).toEqual([]);
    const anon = await db.query<{ t: string }>(
      `select c.relname as t from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind in ('r', 'v')
         and (has_table_privilege('anon', c.oid, 'select') or has_table_privilege('anon', c.oid, 'insert')
           or has_table_privilege('anon', c.oid, 'update') or has_table_privilege('anon', c.oid, 'delete'))`,
    );
    expect(anon.rows).toEqual([]);
    const res = await asUser(db, null, (tx) => attempt(tx, "select count(*) from public.cases"));
    expect(res.ok).toBe(false);
  });

  it("härdning (0011): alla funktioner i mm och public har fast search_path, alla främmande nycklar har ett index", async () => {
    const fns = await db.query<{ fn: string }>(
      `select n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as fn
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname in ('mm', 'public') and p.prokind = 'f'
         and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')`,
    );
    expect(fns.rows.map((x) => x.fn)).toEqual([]);
    const fks = await db.query<{ fk: string }>(
      `select c.conrelid::regclass::text || '.' || a.attname as fk
       from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
       where c.contype = 'f' and c.connamespace = 'public'::regnamespace and array_length(c.conkey, 1) = 1
         and not exists (select 1 from pg_index i where i.indrelid = c.conrelid and i.indkey[0] = c.conkey[1])`,
    );
    expect(fks.rows.map((x) => x.fk)).toEqual([]);
    // Stickprov: funktionerna som rådgivaren pekade ut ger samma svar som förut.
    const r = await db.query<{ a: string; b: boolean; c: string }>(
      "select mm.case_access_level('kommun_chef', 'k-eva', array['c-bot'], 'Arbetsmarknadsenheten', 'c-bot', 'u-amira', 'k-maria', false, false, 'Arbetsmarknadsenheten Norra', 'own') as a, mm.unit_covers('', 'x') as b, mm.customer_scope('{\"customerVisibility\":{\"scope\":\"ATT_FASTSTÄLLA\",\"prototypeScope\":\"own\"}}'::jsonb) as c",
    );
    expect(r.rows[0]).toEqual({ a: "customer", b: true, c: "own" });
  });

  it("tider läses tillbaka som samma Stockholmstid (vintertid och sommartid)", async () => {
    const rows = await db.query<{ id: string; t: string }>("select id, to_char(starts_at at time zone 'Europe/Stockholm', 'YYYY-MM-DD\"T\"HH24:MI') as t from public.activities");
    const byId = new Map(data.activities.map((a) => [a.id, a.startsAt]));
    expect(rows.rows.length).toBe(data.activities.length);
    for (const r of rows.rows) expect(r.t).toBe(byId.get(r.id));
    const offsets = await db.query<{ o: string }>("select distinct to_char(changed_at, 'OF') as o from public.case_status_history order by 1");
    expect(offsets.rows.map((x) => x.o)).toEqual(["+01", "+02"]);
  });
});

// ================================================================ Läsning: RLS = policy.ts för varje testperson
describe("läsning: samma rader som policy.ts", () => {
  it("testpersonerna omfattar alla roller och testarna", () => {
    expect(new Set(personas.map((p) => p.actor.role)).size).toBe(10);
    expect(personas.some((p) => p.actor.userId === "tester-karim")).toBe(true);
  });

  for (const p of personas) {
    it(`${personaKey(p)}: antal rader per tabell, aktören och id:n för ärenden, rapporter, meddelanden och avstämningar`, async () => {
      const expected = await memCounts(p);
      const expectedIds = { cases: await memIds(p, "cases"), reports: await memIds(p, "reports"), messages: await memIds(p, "messages"), check_ins: await memIds(p, "check_ins") };
      const got = await asPersona(p, async (tx) => ({
        counts: await pgCounts(tx),
        actor: (await tx.query<{ a: { userId: string; role: string; contractIds: string[]; customerUnit: string | null } }>("select public.current_actor() as a")).rows[0].a,
        ids: { cases: await pgIds(tx, "cases"), reports: await pgIds(tx, "reports"), messages: await pgIds(tx, "messages"), check_ins: await pgIds(tx, "check_ins") },
      }));
      expect(got.counts).toEqual(expected);
      expect(got.ids).toEqual(expectedIds);
      expect({ userId: got.actor.userId, role: got.actor.role, contractIds: [...got.actor.contractIds].sort(), customerUnit: got.actor.customerUnit ?? null })
        .toEqual({ userId: p.actor.userId, role: p.actor.role, contractIds: [...p.actor.contractIds].sort(), customerUnit: p.actor.customerUnit ?? null });
    });
  }

  it("mm.case_access(case_id) = caseAccess i src/core/access.ts för varje ärende", async () => {
    const src = accessIndex(data);
    const levels = new Set<string>();
    for (const userId of ["u-sara", "u-johan", "u-amira", "u-petra", "u-karin", "u-lars", "u-robin", "k-maria", "k-eva"]) {
      const p = findPersona(userId);
      const expected = Object.fromEntries(data.cases.map((c) => [c.id, caseAccessIn(c, p.actor, src)]));
      const got = await asPersona(p, async (tx) =>
        Object.fromEntries((await tx.query<{ id: string; a: string }>("select c.id, mm.case_access(c.id) as a from (select id from unnest($1::text[]) as id) c", [data.cases.map((c) => c.id)])).rows.map((r) => [r.id, r.a])));
      expect(got).toEqual(expected);
      for (const v of Object.values(expected)) levels.add(v);
    }
    expect([...levels].sort()).toEqual(["billing", "customer", "full", "none", "restricted", "team"]);
  }, 30_000); // nio testpersoner mot databasen – tar längre tid när hela testsviten körs parallellt
});

// ================================================================ Resultatfilen: enhetsspärren (rapporter steg 3)
describe("resultatfilen: kommunens chef för en underenhet", () => {
  it("läser samma ärenden och rapporter i RLS och policy.ts – bara ärenden som beställts i Alby, inga skyddade", async () => {
    const p = findPersona(CHEF_ALBY);
    expect(p.actor).toMatchObject({ role: "kommun_chef", customerUnit: "Arbetsmarknadsenheten Alby" });
    const mem = { cases: await memIds(p, "cases"), reports: await memIds(p, "reports") };
    const pg = await asPersona(p, async (tx) => ({ cases: await pgIds(tx, "cases"), reports: await pgIds(tx, "reports") }));
    expect(pg).toEqual(mem);
    const unit = (caseId: string) => {
      const c = data.cases.find((x) => x.id === caseId)!;
      return (c.referrerId ? data.profiles.find((x) => x.id === c.referrerId)?.customerUnit : null) ?? c.referrerUnit;
    };
    expect(mem.cases.length).toBeGreaterThan(0);
    for (const id of mem.cases) expect(unit(id)).toBe("Arbetsmarknadsenheten Alby");
    const evaCases = await memIds(findPersona("k-eva"), "cases");
    expect(mem.cases.length).toBeLessThan(evaCases.length);
    // Rapporterna: bara levererade individrapporter i Alby-ärenden – aldrig det skyddade ärendets.
    const prot = new Set(data.persons.filter((x) => x.protectedIdentity).map((x) => x.id));
    const reports = data.reports.filter((r) => mem.reports.includes(r.id));
    expect(reports.filter((r) => r.caseId).length).toBeGreaterThan(0);
    for (const r of reports.filter((x) => x.caseId)) {
      expect(unit(r.caseId!)).toBe("Arbetsmarknadsenheten Alby");
      expect(r.deliveredAt).toBeTruthy();
      expect(prot.has(data.cases.find((c) => c.id === r.caseId)!.personId)).toBe(false);
    }
  });
});

// ================================================================ Avtalets interna mål
describe("avtal: kommunen läser aldrig de interna målen", () => {
  it("kommunen får avtalet utan internalTarget och notify via contracts_public – men aldrig tabellen direkt", async () => {
    const got = await asPersona(findPersona("k-maria"), async (tx) => ({
      view: (await tx.query<{ id: string; config: Record<string, unknown> }>("select id, config from public.contracts_public")).rows,
      table: (await tx.query("select id from public.contracts")).rows.length,
    }));
    expect(got.table).toBe(0);
    expect(got.view.map((c) => c.id)).toEqual(["c-bot"]);
    const cfg = got.view[0].config;
    expect(JSON.stringify(cfg)).not.toMatch(/internalTarget|belowInternal/);
    expect(() => requireOperational(cfg as never)).not.toThrow();
    const original = data.contracts.find((c) => c.id === "c-bot")!.config;
    expect((cfg.kpis as { key: string; contractTarget?: number }[]).map((k) => [k.key, k.contractTarget ?? null]))
      .toEqual((original.kpis ?? []).map((k) => [k.key, k.contractTarget ?? null]));
  });

  it("MB läser hela avtalet (samma config som testdatat)", async () => {
    const view = await asPersona(findPersona("u-karin"), async (tx) => (await tx.query<{ id: string; config: unknown }>("select id, config from public.contracts_public order by id")).rows);
    expect(view.map((c) => c.id)).toEqual(["c-bot"]);
    expect(view[0].config).toEqual(JSON.parse(JSON.stringify(data.contracts.find((c) => c.id === "c-bot")!.config)));
  });
});

// ================================================================ Ärenden: detaljerna i skyddade ärenden (0013)
describe("ärenden: cases_public döljer plats, mötestider och bakgrund i skyddade ärenden och för ekonomen", () => {
  const protectedIds = new Set(data.persons.filter((p) => p.protectedIdentity).map((p) => p.id));
  const prot = () => data.cases.find((c) => protectedIds.has(c.personId) && c.location && c.meetingDay != null && c.meetingTime && c.firstMeetingAt && c.backgroundInfo)!;
  const DETAIL_SQL = `select case_number, status, background_info, location, meeting_day, meeting_time, pause_reason,
    to_char(first_meeting_at at time zone 'Europe/Stockholm', 'YYYY-MM-DD"T"HH24:MI') as first_meeting, buyer_reference,
    to_char(start_date, 'YYYY-MM-DD') as start_date from public.cases_public where id = $1`;
  type Detail = { case_number: string; status: string; background_info: string; location: string; meeting_day: number | null; meeting_time: string | null; pause_reason: string | null; first_meeting: string | null; buyer_reference: string | null; start_date: string | null };
  const detail = (userId: string, caseId: string) => asPersona(findPersona(userId), async (tx) => (await tx.query<Detail>(DETAIL_SQL, [caseId])).rows[0]);

  it("samordnare, chef, admin, ekonom och kommunens chef ser nummer och status – inte var eller när personen träffas", async () => {
    const c = prot();
    for (const userId of ["u-sara", "u-karin", "u-robin", "u-lars", "k-eva"]) {
      const row = await detail(userId, c.id);
      expect(row, userId).toEqual({
        case_number: c.caseNumber, status: c.status, background_info: "", location: "", meeting_day: null, meeting_time: null, pause_reason: null,
        // Klockslaget döljs; datumet finns kvar så att "första mötet är bokat" fungerar i flaggor och listor.
        first_meeting: `${c.firstMeetingAt!.slice(0, 10)}T00:00`, buyer_reference: c.buyerReference, start_date: c.startDate,
      });
    }
  });

  it("namngiven huvudcoach och avtalsansvarig ser hela det skyddade ärendet", async () => {
    const c = prot();
    for (const userId of [c.leadCoachId!, "u-johan"]) {
      const row = await detail(userId, c.id);
      expect(row, userId).toMatchObject({ background_info: c.backgroundInfo, location: c.location, meeting_day: c.meetingDay, meeting_time: c.meetingTime, first_meeting: c.firstMeetingAt });
    }
  });

  it("ekonomen ser perioder och referenser men inte bakgrund, plats eller mötestider i vanliga ärenden", async () => {
    const c = data.cases.find((x) => !protectedIds.has(x.personId) && x.backgroundInfo && x.location && x.meetingDay != null && x.buyerReference && x.startDate)!;
    expect(await detail("u-lars", c.id)).toMatchObject({ background_info: "", location: "", meeting_day: null, meeting_time: null, buyer_reference: c.buyerReference, start_date: c.startDate });
    // Samordnaren (full åtkomst) ser allt i samma ärende.
    expect(await detail("u-sara", c.id)).toMatchObject({ background_info: c.backgroundInfo, location: c.location, meeting_day: c.meetingDay });
  });

  it("tabellen: bara id går att läsa direkt, och en ändring kan inte lämna ut kolumnerna", async () => {
    const c = prot();
    const lars = await asPersona(findPersona("u-lars"), async (tx) => ({
      id: (await tx.query("select id from public.cases where id = $1", [c.id])).rows.length,
      location: await attempt(tx, "select location from public.cases where id = $1", [c.id]),
      star: await attempt(tx, "select * from public.cases where id = $1", [c.id]),
      returningAll: await attempt(tx, "update public.cases set buyer_reference = '1234567890' where id = $1 returning *", [c.id]),
      returningId: await attempt(tx, "update public.cases set buyer_reference = '1234567890' where id = $1 returning id", [c.id]),
    }));
    expect(lars.id).toBe(1);
    expect(lars.location.ok).toBe(false);
    expect(lars.star.ok).toBe(false);
    expect(lars.returningAll.ok).toBe(false);
    // Ekonomen får fortfarande ändra beställarreferensen (policyn cases_update), men får bara tillbaka id.
    expect(lars.returningId).toMatchObject({ ok: true, rows: 1 });
    const sara = await asPersona(findPersona("u-sara"), (tx) => attempt(tx, "select background_info, meeting_day from public.cases where id = $1", [c.id]));
    expect(sara.ok).toBe(false);
  });
});

// ================================================================ Kvittenser (0014)
describe("kvittenser ändrar bara sina egna kolumner", () => {
  const maria = () => findPersona("k-maria");
  const unopened = () => data.reports.find((r) => r.deliveredTo.includes("k-maria") && r.deliveredAt && !r.openedAt && r.status === "delivered")!;
  const opened = () => data.reports.find((r) => r.deliveredTo.includes("k-maria") && r.deliveredAt && r.openedAt && r.status === "delivered")!;
  const memWrite = <N extends "reports" | "messages">(t: N, row: Tables[N], userId: string) => canReadRow(t, raw.get(t, row.id)!, findPersona(userId).actor, raw) && canWriteRow(t, row, findPersona(userId).actor, raw);

  it("kommunen kan inte skriva om en levererad rapport – bara kvittera den en gång, i eget namn", async () => {
    const r = unopened();
    const o = opened();
    const at = "2027-02-01T09:30";
    const res = await asPersona(maria(), async (tx) => ({
      forged: await attempt(tx, "update public.reports set status = 'draft', approved_by = 'k-maria' where id = $1", [r.id]),
      snapshot: await attempt(tx, `update public.reports set snapshot = '{"model":{"forfalskad":true}}'::jsonb where id = $1`, [r.id]),
      summary: await attempt(tx, "update public.reports set summary = 'Ändrad av kommunen' where id = $1", [r.id]),
      otherName: await attempt(tx, "update public.reports set opened_at = $2, opened_by = 'k-ahmed' where id = $1", [r.id, at]),
      again: await attempt(tx, "update public.reports set opened_at = $2, opened_by = 'k-maria' where id = $1", [o.id, at]),
      receipt: await attempt(tx, "update public.reports set opened_at = $2, opened_by = 'k-maria' where id = $1", [r.id, at]),
    }));
    expect(res.forged.ok).toBe(false);
    expect(res.snapshot.ok).toBe(false);
    expect(res.summary.ok).toBe(false);
    expect(res.otherName.ok).toBe(false);
    expect(res.again.ok).toBe(false);
    expect(res.receipt).toMatchObject({ ok: true, rows: 1 });
    // Samma svar i minnesläget (policy.ts).
    expect(memWrite("reports", { ...r, status: "draft", approvedBy: "k-maria" }, "k-maria")).toBe(false);
    expect(memWrite("reports", { ...r, summary: "Ändrad av kommunen" }, "k-maria")).toBe(false);
    expect(memWrite("reports", { ...r, openedAt: at, openedBy: "k-ahmed" }, "k-maria")).toBe(false);
    expect(memWrite("reports", { ...o, openedAt: at, openedBy: "k-maria" }, "k-maria")).toBe(false);
    expect(memWrite("reports", { ...r, openedAt: at, openedBy: "k-maria" }, "k-maria")).toBe(true);
  });

  it("meddelanden: bara läskvittot ändras – aldrig text eller avsändare – och kommunens chef ändrar inget", async () => {
    const own = new Set(data.cases.filter((c) => c.referrerId === "k-maria").map((c) => c.id));
    const fromMb = data.messages.find((m) => own.has(m.caseId) && m.senderId.startsWith("u-") && !m.readBy.includes("k-maria"))
      ?? data.messages.find((m) => own.has(m.caseId) && m.senderId.startsWith("u-"))!;
    // Utgångsläge (som postgres): läst av Sara men inte av Maria.
    const before = { ...fromMb, readBy: ["u-sara"], readAt: "2027-01-27T13:40" };
    const res = await asUser(db, authOf("k-maria"), async (tx) => ({
      body: await attempt(tx, "update public.messages set body = 'Ändrad av kommunen', sender_id = 'u-sara' where id = $1", [fromMb.id]),
      other: await attempt(tx, "update public.messages set read_by = array_append(read_by, 'u-johan') where id = $1", [fromMb.id]),
      clear: await attempt(tx, "update public.messages set read_by = '{}' where id = $1", [fromMb.id]),
      readAt: await attempt(tx, "update public.messages set read_at = '2027-02-01T10:00' where id = $1", [fromMb.id]),
      self: await attempt(tx, "update public.messages set read_by = array_append(read_by, 'k-maria') where id = $1", [fromMb.id]),
    }), { before: async (tx) => { await tx.query("update public.messages set read_by = '{u-sara}', read_at = '2027-01-27T13:40' where id = $1", [fromMb.id]); } });
    expect(res.body.ok).toBe(false);
    expect(res.other.ok).toBe(false);
    expect(res.clear.ok).toBe(false);
    expect(res.readAt.ok).toBe(false);
    expect(res.self).toMatchObject({ ok: true, rows: 1 });
    const eva = await asPersona(findPersona("k-eva"), async (tx) => ({
      body: await attempt(tx, "update public.messages set body = 'Chefen ändrade' where id = $1", [fromMb.id]),
      read: await attempt(tx, "update public.messages set read_by = array_append(read_by, 'k-eva') where id = $1", [fromMb.id]),
    }));
    expect(eva.body.ok).toBe(false);
    expect(eva.read.ok).toBe(false);
    const coach = await asPersona(findPersona("u-amira"), (tx) => attempt(tx, "update public.messages set body = 'Ändrad' where id = $1", [fromMb.id]));
    expect(coach.ok).toBe(false);
    // Samma svar i minnesläget (policy.ts).
    expect(memWrite("messages", { ...fromMb, body: "Ändrad av kommunen", senderId: "u-sara" }, "k-maria")).toBe(false);
    expect(memWrite("messages", { ...fromMb, readBy: [...fromMb.readBy, "u-sara"] }, "k-maria")).toBe(false);
    expect(memWrite("messages", { ...fromMb, body: "Chefen ändrade" }, "k-eva")).toBe(false);
    expect(memWrite("messages", { ...fromMb, body: "Ändrad" }, "u-amira")).toBe(false);
    // Minnesläget med samma utgångsläge som i databasen.
    const rawBefore: RawAccess<Tables> = { ...raw, get: ((t: TableName, id: string) => (t === "messages" && id === before.id ? before : raw.get(t as never, id))) as RawAccess<Tables>["get"] };
    const memMaria = (row: Tables["messages"]) => canWriteRow("messages", row, maria().actor, rawBefore);
    expect(memMaria({ ...before, readBy: ["u-sara", "u-johan"] })).toBe(false);
    expect(memMaria({ ...before, readBy: [] })).toBe(false);
    expect(memMaria({ ...before, readAt: "2027-02-01T10:00" })).toBe(false);
    expect(memMaria({ ...before, readBy: ["u-sara", "k-maria"] })).toBe(true);
  });
});

// ================================================================ Skrivning: RLS = policy.ts
/** INSERT av en rad med kolumnerna i schema.ts (utan databasens extra kolumner). */
function insertSql(t: TableName, row: Record<string, unknown>): string {
  const cols = Object.entries(COLUMNS[t] as Record<string, SqlType>);
  return `insert into public.${t} (${cols.map(([f]) => quoteIdent(snakeCase(f))).join(", ")}) values (${cols.map(([f, type]) => sqlLiteral(row[f], type)).join(", ")})`;
}

/** Kopia av en rad med nytt id (och nya värden i unika kolumner) – en ny rad i samma ärende/avtal. */
function copyOf(t: TableName, row: Record<string, unknown>): Record<string, unknown> {
  const c: Record<string, unknown> = { ...row, id: `${row.id}-ny` };
  if (t === "holidays") Object.assign(c, { id: "2099-12-31", date: "2099-12-31" });
  if (t === "profiles") c.email = `ny-${row.id}@example.invalid`;
  if (t === "cases") c.caseNumber = `${row.caseNumber}-NY`;
  if (t === "voice_links" && row.tokenHash) c.tokenHash = `${row.tokenHash}-ny`;
  if (t === "contract_areas") c.code = `${row.code}NY`;
  // Rapportutkastens unika nycklar (0018): samma typ, mottagare/ärende och period får bara finnas en gång.
  if (t === "reports" && row.week) c.week = "2099-W01";
  if (t === "reports" && row.month) c.month = "2099-12";
  if (t === "memberships") {
    const taken = new Set(data.memberships.map((m) => `${m.userId}|${m.contractId}|${m.role}`));
    c.userId = data.profiles.map((p) => p.id).find((u) => !taken.has(`${u}|${row.contractId}|${row.role}`));
  }
  return c;
}

/** Några rader per tabell som testpersonen får läsa och några den inte får läsa enligt policy.ts (deterministiskt). */
function sampleRows(t: TableName, p: Persona, n = 2): Record<string, unknown>[] {
  const rows = data[t] as unknown as Record<string, unknown>[];
  const readable = rows.filter((r) => canReadRow(t, r as never, actorOf(p), raw));
  const hidden = rows.filter((r) => !canReadRow(t, r as never, actorOf(p), raw));
  const pick = (xs: Record<string, unknown>[]) => (xs.length <= n ? xs : Array.from({ length: n }, (_, i) => xs[Math.floor((i * (xs.length - 1)) / Math.max(n - 1, 1))]));
  return [...pick(readable), ...pick(hidden)];
}

describe("skrivning: samma regler som policy.ts", () => {
  for (const p of personas) {
    it(`${personaKey(p)}: ändra och skapa rader i varje tabell`, async () => {
      const expected: string[] = [];
      const plan: { label: string; sql: string; params: unknown[] }[] = [];
      for (const t of TABLE_NAMES) {
        for (const row of sampleRows(t, p, 1)) {
          // Ändring: policy.ts kräver läsrätt på raden och skrivrätt på den nya raden (här oförändrad).
          const upd = canReadRow(t, row as never, actorOf(p), raw) && canWriteRow(t, row as never, actorOf(p), raw);
          expected.push(`update ${t} ${row.id}: ${upd}`);
          plan.push({ label: `update ${t} ${row.id}`, sql: `update public.${t} set id = id where id = $1`, params: [row.id] });
        }
        for (const row of sampleRows(t, p, 1)) {
          const copy = copyOf(t, row);
          const ins = canWriteRow(t, copy as never, actorOf(p), raw);
          expected.push(`insert ${t} ${copy.id}: ${ins}`);
          plan.push({ label: `insert ${t} ${copy.id}`, sql: insertSql(t, copy), params: [] });
        }
      }
      const got = await asPersona(p, async (tx) => {
        const out: string[] = [];
        for (const s of plan) out.push(`${s.label}: ${allowed(await attempt(tx, s.sql, s.params))}`);
        return out;
      });
      expect(got).toEqual(expected);
    });
  }
});

describe("skrivning: särskilda fall", () => {
  const maria = () => findPersona("k-maria");
  const ownCase = () => data.cases.find((c) => c.referrerId === "k-maria")!;
  const otherCase = () => data.cases.find((c) => c.referrerId && c.referrerId !== "k-maria" && c.contractId === "c-bot")!;

  it("kommunen kan inte uppdatera ärenden den inte beställt, och kommunens chef inga ärenden alls", async () => {
    const eva = await asPersona(findPersona("k-eva"), async (tx) => {
      const visible = (await tx.query<{ id: string }>("select id from public.cases limit 1")).rows[0].id;
      return attempt(tx, "update public.cases set status = 'closed' where id = $1", [visible]);
    });
    expect(allowed(eva)).toBe(false);
    const res = await asPersona(maria(), async (tx) => ({
      other: await attempt(tx, "update public.cases set status = 'closed' where id = $1", [otherCase().id]),
      moveAway: await attempt(tx, "update public.cases set referrer_id = 'k-ahmed' where id = $1", [ownCase().id]),
      own: await attempt(tx, "update public.cases set referrer_phone = '08-000 00 00' where id = $1", [ownCase().id]),
    }));
    expect(allowed(res.other)).toBe(false);
    expect(allowed(res.moveAway)).toBe(false);
    // policy.ts: beställande handläggare får ändra sin beställning (t.ex. sina kontaktuppgifter)
    expect(allowed(res.own)).toBe(true);
  });

  it("kommunen kan skapa meddelanden bara i egna ärenden och bara i eget namn", async () => {
    const msg = (caseId: string, senderId: string) =>
      [`insert into public.messages (id, case_id, sender_id, body, created_at, read_by, read_at, kind) values ($1, $2, $3, 'Hej', '2027-02-01T09:12', '{}', null, null)`, [`msg-test-${caseId}-${senderId}`, caseId, senderId]] as const;
    const res = await asPersona(maria(), async (tx) => ({
      own: await attempt(tx, ...msg(ownCase().id, "k-maria")),
      other: await attempt(tx, ...msg(otherCase().id, "k-maria")),
      forged: await attempt(tx, ...msg(ownCase().id, "u-amira")),
    }));
    expect(res).toMatchObject({ own: { ok: true, rows: 1 }, other: { ok: false }, forged: { ok: false } });
    const eva = await asPersona(findPersona("k-eva"), (tx) => attempt(tx, ...msg(ownCase().id, "k-eva")));
    expect(eva.ok).toBe(false);
  });

  it("ingen kan ändra eller ta bort i revisionsloggen – inte ens service role", async () => {
    for (const userId of ["u-robin", "u-karin", "tester-karim"]) {
      const res = await asPersona(findPersona(userId), async (tx) => ({
        upd: await attempt(tx, "update public.audit_log set action = 'x'"),
        del: await attempt(tx, "delete from public.audit_log"),
        ins: await attempt(tx, "insert into public.audit_log (id, occurred_at, actor_id, action, entity, entity_id, contract_id, details) values ('log-x', now(), null, 'x', 'x', null, null, '{}')"),
        visible: (await tx.query("select id from public.audit_log")).rows.length,
      }));
      expect(res.upd.ok || res.del.ok || res.ins.ok).toBe(false);
      expect(res.visible).toBeGreaterThan(0);
    }
    const service = await asUser(db, null, async (tx) => ({
      ins: await attempt(tx, "insert into public.audit_log (id, occurred_at, actor_id, action, entity, entity_id, contract_id, details) values ('log-x', now(), 'system', 'test', 'case', null, null, '{}')", [], { keep: true }),
      upd: await attempt(tx, "update public.audit_log set action = 'x' where id = 'log-x'"),
      del: await attempt(tx, "delete from public.audit_log where id = 'log-x'"),
    }), { role: "service_role" });
    expect(service.ins).toMatchObject({ ok: true, rows: 1 });
    expect(service.upd.ok).toBe(false);
    expect(service.del.ok).toBe(false);
  });

  it("testaren kan agera som en testperson bara i testmiljön", async () => {
    const actorSql = "select public.current_actor() as a";
    type A = { userId: string; role: string; isTester: boolean; impersonating: boolean };
    const staging = await asUser(db, KARIM, async (tx) => ({
      actor: (await tx.query<{ a: A }>(actorSql)).rows[0].a,
      cases: await pgIds(tx, "cases"),
    }), { before: chooseTestPerson("k-maria", "kommun_handlaggare") });
    expect(staging.actor).toMatchObject({ userId: "k-maria", role: "kommun_handlaggare", isTester: true, impersonating: true });
    expect(staging.cases).toEqual(await memIds(maria(), "cases"));

    // Testaren väljer själv (via RLS) en testperson
    const self = await asUser(db, KARIM, async (tx) => {
      const ins = await attempt(tx, "insert into public.tester_sessions (auth_user_id, profile_id, role) values ($1, 'u-amira', 'coach')", [KARIM], { keep: true });
      return { ins, actor: (await tx.query<{ a: A }>(actorSql)).rows[0].a };
    });
    expect(allowed(self.ins)).toBe(true);
    expect(self.actor).toMatchObject({ userId: "u-amira", role: "coach" });

    // En roll som personen inte har ger ingen testperson (testaren agerar som sig själv)
    const wrongRole = await asUser(db, KARIM, async (tx) => (await tx.query<{ a: A }>(actorSql)).rows[0].a, { before: chooseTestPerson("k-maria", "admin") });
    expect(wrongRole).toMatchObject({ userId: "tester-karim", role: "admin", impersonating: false });

    // Produktion: ingen testperson, och testaren kan inte välja någon
    const production = await asUser(db, KARIM, async (tx) => ({
      actor: (await tx.query<{ a: A }>(actorSql)).rows[0].a,
      sessions: (await tx.query("select * from public.tester_sessions")).rows.length,
      ins: await attempt(tx, "insert into public.tester_sessions (auth_user_id, profile_id, role) values ($1, 'u-amira', 'coach') on conflict (auth_user_id) do update set profile_id = excluded.profile_id", [KARIM]),
      cases: (await tx.query("select id from public.cases")).rows.length,
    }), {
      before: async (tx) => {
        await chooseTestPerson("k-maria", "kommun_handlaggare")(tx);
        await tx.query("update public.app_settings set value = 'production' where key = 'environment'");
      },
    });
    expect(production.actor).toMatchObject({ userId: "tester-karim", role: "admin", isTester: false, impersonating: false });
    expect(production.sessions).toBe(0);
    expect(allowed(production.ins)).toBe(false);
    expect(production.cases).toBe(data.cases.length); // admin ser alla ärenden

    // Den som inte är testare kan aldrig välja testperson
    const sara = await asPersona(findPersona("u-sara"), (tx) => attempt(tx, "insert into public.tester_sessions (auth_user_id, profile_id, role) values ($1, 'u-robin', 'admin')", [authOf("u-sara")]));
    expect(allowed(sara)).toBe(false);
  });

  it("synpunkter (0017): bara testare i testmiljön, oavsett testperson – i eget namn, bara status ändras, ingen tar bort", async () => {
    const insertFb = (id: string, authorId: string) =>
      [
        "insert into public.feedback (id, type, priority, text, status, role, path, view_title, created_at, author_id) values ($1, 'fraga', 'kan', 'Hej', 'ny', 'coach', '/min-vecka', 'Min vecka', '2027-02-01T09:30', $2)",
        [id, authorId],
      ] as const;
    // Karim agerar som kommunens handläggare: läser alla synpunkter och skriver i sitt eget namn.
    const karim = await asUser(db, KARIM, async (tx) => ({
      feedback: (await tx.query("select id from public.feedback")).rows.length,
      replies: (await tx.query("select id from public.feedback_replies")).rows.length,
      own: await attempt(tx, ...insertFb("fb-t1", "tester-karim")),
      forged: await attempt(tx, ...insertFb("fb-t2", "tester-ali")),
      persona: await attempt(tx, ...insertFb("fb-t3", "k-maria")),
      status: await attempt(tx, "update public.feedback set status = 'andras', status_changed_at = '2027-02-01T09:40', status_changed_by = 'tester-karim' where id = 'fb-x-ali'"),
      statusOther: await attempt(tx, "update public.feedback set status = 'klar', status_changed_by = 'tester-ali' where id = 'fb-x-karim'"),
      text: await attempt(tx, "update public.feedback set text = 'Ändrad' where id = 'fb-x-ali'"),
      author: await attempt(tx, "update public.feedback set author_id = 'tester-karim' where id = 'fb-x-ali'"),
      reply: await attempt(tx, "insert into public.feedback_replies (id, feedback_id, text, created_at, author_id) values ('fbr-t1', 'fb-x-ali', 'Svar', '2027-02-01T09:31', 'tester-karim')"),
      replyForged: await attempt(tx, "insert into public.feedback_replies (id, feedback_id, text, created_at, author_id) values ('fbr-t2', 'fb-x-ali', 'Svar', '2027-02-01T09:31', 'tester-ali')"),
      replyEdit: await attempt(tx, "update public.feedback_replies set text = 'Ändrat' where id = 'fbr-x-1'"),
      del: await attempt(tx, "delete from public.feedback where id = 'fb-x-karim'"),
      delReply: await attempt(tx, "delete from public.feedback_replies where id = 'fbr-x-1'"),
      // Sidan får inte innehålla fritext (kontrollen i tabellen, samma tecken som sanitizeFeedbackPath).
      freeText: await attempt(tx, "insert into public.feedback (id, type, priority, text, status, role, path, view_title, created_at, author_id) values ('fb-t4', 'fraga', 'kan', 'Hej', 'ny', 'coach', '/arenden/Anna Svensson', 'Min vecka', '2027-02-01T09:30', 'tester-karim')"),
      // Aldrig en adress till en annan webbplats: '//värd/…' blir https://värd/… i webbläsaren ("Gå till sidan").
      otherSite: await attempt(tx, "insert into public.feedback (id, type, priority, text, status, role, path, view_title, created_at, author_id) values ('fb-t5', 'fraga', 'kan', 'Hej', 'ny', 'coach', '//evil.example/logga-in', 'Min vecka', '2027-02-01T09:30', 'tester-karim')"),
      // Den riktiga tiden sätter databasen – det som skickas in ersätts, och den ändras aldrig efteråt.
      forgedTime: await attempt(tx, "insert into public.feedback (id, type, priority, text, status, role, path, view_title, created_at, author_id, submitted_at) values ('fb-t6', 'fraga', 'kan', 'Hej', 'ny', 'coach', '/min-vecka', 'Min vecka', '2027-02-01T09:30', 'tester-karim', '2020-01-01T00:00')", [], { keep: true }),
      forgedReplyTime: await attempt(tx, "insert into public.feedback_replies (id, feedback_id, text, created_at, author_id, submitted_at) values ('fbr-t6', 'fb-t6', 'Svar', '2027-02-01T09:31', 'tester-karim', '2020-01-01T00:00')", [], { keep: true }),
      times: (await tx.query<{ ok: boolean }>("select submitted_at = now() as ok from public.feedback where id = 'fb-t6' union all select submitted_at = now() from public.feedback_replies where id = 'fbr-t6'")).rows,
      changeTime: await attempt(tx, "update public.feedback set submitted_at = '2020-01-01T00:00' where id = 'fb-t6'"),
    }), { before: chooseTestPerson("k-maria", "kommun_handlaggare") });
    expect([karim.feedback, karim.replies]).toEqual([2, 1]);
    expect(karim.own).toMatchObject({ ok: true, rows: 1 });
    expect([karim.forged.ok, karim.persona.ok]).toEqual([false, false]);
    expect(karim.status).toMatchObject({ ok: true, rows: 1 });
    expect([karim.statusOther.ok, karim.text.ok, karim.author.ok]).toEqual([false, false, false]);
    expect(karim.reply).toMatchObject({ ok: true, rows: 1 });
    expect([karim.replyForged.ok, allowed(karim.replyEdit), allowed(karim.del), allowed(karim.delReply), karim.freeText.ok]).toEqual([false, false, false, false, false]);
    expect(karim.otherSite.ok).toBe(false);
    expect([karim.forgedTime, karim.forgedReplyTime]).toMatchObject([{ ok: true, rows: 1 }, { ok: true, rows: 1 }]);
    expect(karim.times).toEqual([{ ok: true }, { ok: true }]);
    expect(karim.changeTime.ok).toBe(false);
    // Samma svar i minnesläget (policy.ts) för Karim som kommunens handläggare.
    const mem = { ...findPersona("k-maria").actor, testerId: "tester-karim" };
    const ali = raw.get("feedback", "fb-x-ali")!;
    const karimFb = raw.get("feedback", "fb-x-karim")!;
    expect(canWriteRow("feedback", { ...karimFb, id: "fb-t1" }, mem, raw)).toBe(true);
    expect(canWriteRow("feedback", { ...karimFb, id: "fb-t2", authorId: "tester-ali" }, mem, raw)).toBe(false);
    expect(canWriteRow("feedback", { ...ali, status: "andras", statusChangedBy: "tester-karim" }, mem, raw)).toBe(true);
    expect(canWriteRow("feedback", { ...karimFb, status: "klar", statusChangedBy: "tester-ali" }, mem, raw)).toBe(false);
    expect(canWriteRow("feedback", { ...ali, text: "Ändrad" }, mem, raw)).toBe(false);
    expect(canWriteRow("feedback_replies", { id: "fbr-t1", feedbackId: "fb-x-ali", text: "Svar", createdAt: "2027-02-01T09:31", authorId: "tester-karim", submittedAt: null }, mem, raw)).toBe(true);
    expect(canWriteRow("feedback_replies", { id: "fbr-t2", feedbackId: "fb-x-ali", text: "Svar", createdAt: "2027-02-01T09:31", authorId: "tester-ali", submittedAt: null }, mem, raw)).toBe(false);

    // Vanliga användare – även systemadministratören – ser inga synpunkter och kan inte skriva.
    for (const userId of ["u-robin", "u-sara", "k-maria"]) {
      const res = await asPersona(findPersona(userId), async (tx) => ({
        n: (await tx.query("select id from public.feedback")).rows.length + (await tx.query("select id from public.feedback_replies")).rows.length,
        ins: await attempt(tx, ...insertFb(`fb-${userId}`, userId)),
      }));
      expect(res.n, userId).toBe(0);
      expect(res.ins.ok, userId).toBe(false);
    }
    // Produktion: inte ens testarna.
    const prod = await asUser(db, ALI, async (tx) => ({
      n: (await tx.query("select id from public.feedback")).rows.length,
      ins: await attempt(tx, ...insertFb("fb-prod", "tester-ali")),
      upd: await attempt(tx, "update public.feedback set status = 'klar' where id = 'fb-x-ali'"),
    }), { before: async (tx) => { await tx.query("update public.app_settings set value = 'production' where key = 'environment'"); } });
    expect(prod.n).toBe(0);
    expect(prod.ins.ok).toBe(false);
    expect(allowed(prod.upd)).toBe(false);
  });

  it("inloggningskolumnerna (auth_user_id, is_tester) ändras bara av servern", async () => {
    const res = await asPersona(findPersona("u-sara"), async (tx) => ({
      tester: await attempt(tx, "update public.profiles set is_tester = true where id = 'u-sara'"),
      auth: await attempt(tx, "update public.profiles set auth_user_id = gen_random_uuid() where id = 'u-sara'"),
      phone: await attempt(tx, "update public.profiles set phone = '08-111 11 11' where id = 'u-sara'"),
    }));
    expect(res.tester.ok).toBe(false);
    expect(res.auth.ok).toBe(false);
    expect(allowed(res.phone)).toBe(true);
    const admin = await asPersona(findPersona("u-robin"), (tx) => attempt(tx, "update public.profiles set is_tester = true where id = 'k-maria'"));
    expect(admin.ok).toBe(false);
  });

  it("mm.claim_jobs hämtar jobb med radlås en gång, och bara service role får anropa den", async () => {
    const res = await asUser(db, null, async (tx) => {
      await tx.exec(`insert into public.jobs (id, kind, payload, status, attempts, run_after, last_error, created_at, created_by, finished_at) values
        ('job-1', 'send_message', '{}', 'queued', 0, '2027-02-01T09:00', null, '2027-02-01T09:00', null, null),
        ('job-2', 'send_message', '{}', 'queued', 0, '2027-02-01T10:00', null, '2027-02-01T09:00', null, null),
        ('job-3', 'send_message', '{}', 'queued', 5, '2027-02-01T09:00', null, '2027-02-01T09:00', null, null)`);
      const first = (await tx.query<{ id: string; status: string; attempts: number }>("select id, status, attempts from public.claim_jobs(10, '2027-02-01T09:30'::timestamptz)")).rows;
      const second = (await tx.query<{ id: string }>("select id from mm.claim_jobs(10, '2027-02-01T09:30'::timestamptz)")).rows;
      const later = (await tx.query<{ id: string }>("select id from mm.claim_jobs(10, '2027-02-01T09:45'::timestamptz)")).rows;
      return { first, second, later };
    }, { role: "service_role" });
    expect(res.first).toEqual([{ id: "job-1", status: "running", attempts: 1 }]);
    expect(res.second).toEqual([]);
    // job-1 har fastnat i running i mer än 10 minuter och hämtas igen; job-2 är fortfarande inte dags
    expect(res.later.map((r) => r.id)).toEqual(["job-1"]);
    const denied = await asPersona(findPersona("u-robin"), (tx) => attempt(tx, "select * from public.claim_jobs(1)"));
    expect(denied.ok).toBe(false);
  });

  it("mm.next_case_number ger löpnummer per avtal och år (bara service role)", async () => {
    const res = await asUser(db, null, async (tx) => {
      const a = (await tx.query<{ n: number }>("select public.next_case_number('c-bot', 2027) as n")).rows[0].n;
      const b = (await tx.query<{ n: number }>("select public.next_case_number('c-bot', 2027) as n")).rows[0].n;
      const c = (await tx.query<{ n: number }>("select public.next_case_number('c-bot', 2031) as n")).rows[0].n;
      return { a, b, c };
    }, { role: "service_role" });
    const start = data.case_counters.find((x) => x.id === "c-bot:2027")!.lastValue;
    expect(res).toEqual({ a: start + 1, b: start + 2, c: 1 });
    const denied = await asPersona(findPersona("u-sara"), (tx) => attempt(tx, "select public.next_case_number('c-bot', 2027)"));
    expect(denied.ok).toBe(false);
  });

  it("testklockan: mm.app_now() startar på testtiden när seeden lästes in", async () => {
    const r = await db.query<{ t: string }>("select to_char(mm.app_now() at time zone 'Europe/Stockholm', 'YYYY-MM-DD\"T\"HH24:MI') as t");
    expect(r.rows[0].t >= "2027-02-01T09:12" && r.rows[0].t <= "2027-02-01T09:20").toBe(true);
  });
});

// ================================================================ Fria anteckningar (0019, beslut 2026-10-01)
describe("anteckningar (0019): läsning, skrivning och dölja – samma regler i RLS, triggern och policy.ts", () => {
  const NADIA = "case-260143";
  const SKYDDAD = "case-260120";
  const note = (id: string) => raw.get("case_notes", id)!;
  const ids = (xs: { id: string }[]) => xs.map((x) => x.id).sort();
  const pgNotes = (userId: string, opts?: Parameters<typeof asUser>[3]) =>
    opts ? asUser(db, authOf(userId), async (tx) => (await tx.query<{ id: string }>("select id from public.case_notes order by id")).rows.map((r) => r.id), opts)
      : asPersona(findPersona(userId), async (tx) => (await tx.query<{ id: string }>("select id from public.case_notes order by id")).rows.map((r) => r.id));
  const memNotes = async (userId: string, rawOverride?: RawAccess<Tables>) =>
    ids(data.case_notes.filter((n) => canReadRow("case_notes", n, actorOf(findPersona(userId)), rawOverride ?? raw)));

  it("testdatat har anteckningar för full och team, en borttagen och en i det skyddade ärendet", () => {
    expect(data.case_notes.filter((n) => n.caseId === NADIA).map((n) => [n.audience, !!n.removedAt]).sort()).toEqual([["full", false], ["full", false], ["team", false], ["team", true]]);
    expect(note("note-skyddad")).toMatchObject({ caseId: SKYDDAD, audience: "full", authorId: "u-erik" });
  });

  it("läsning per roll: handledaren bara team i tilldelade ärenden, ekonom och kommunen inget, skyddat ärende bara namngivna", async () => {
    const expected: Record<string, string[]> = {
      // Amira är huvudcoach för både Nadia och Mehmet (Petras teamanteckning).
      "u-amira": ["note-mehmet-handledare", "note-nadia-borttagen", "note-nadia-kommun", "note-nadia-praktiskt", "note-nadia-samtal"],
      "u-petra": ["note-mehmet-handledare", "note-nadia-borttagen", "note-nadia-praktiskt"],
      "u-leila": [], "u-lars": [], "k-maria": [], "k-eva": [], "k-omar": [],
      "u-erik": ["note-skyddad"],
      "u-johan": [...data.case_notes.map((n) => n.id)].sort(),
      "u-sara": data.case_notes.filter((n) => n.caseId !== SKYDDAD).map((n) => n.id).sort(),
      "u-karin": data.case_notes.filter((n) => n.caseId !== SKYDDAD).map((n) => n.id).sort(),
      "u-robin": data.case_notes.filter((n) => n.caseId !== SKYDDAD).map((n) => n.id).sort(),
    };
    for (const [userId, want] of Object.entries(expected)) {
      expect(await pgNotes(userId), userId).toEqual(want);
      expect(await memNotes(userId), userId).toEqual(want);
    }
  });

  it("kommunen läser inga anteckningar – inte heller när avtalet har seesCoachNotes: true", async () => {
    const before = async (tx: Tx) => {
      await tx.query("update public.contracts set config = jsonb_set(config, '{customerVisibility,seesCoachNotes}', 'true'::jsonb) where id = 'c-bot'");
    };
    const bot = raw.get("contracts", "c-bot")!;
    const open = { ...bot, config: { ...bot.config, customerVisibility: { ...bot.config.customerVisibility!, seesCoachNotes: true } } };
    const rawOpen: RawAccess<Tables> = { ...raw, get: ((t: TableName, id: string) => (t === "contracts" && id === "c-bot" ? open : raw.get(t as never, id))) as RawAccess<Tables>["get"] };
    for (const userId of ["k-maria", "k-eva", "k-omar"]) {
      expect(await pgNotes(userId, { before }), userId).toEqual([]);
      expect(await memNotes(userId, rawOpen), userId).toEqual([]);
    }
  });

  /** Kör satsen som personen i Postgres och samma rad i policy.ts – svaren ska vara lika. */
  const both = async (userId: string, sql: string, params: unknown[], row: Tables["case_notes"], opts: { team?: boolean } = {}) => {
    const p = findPersona(userId);
    const extraTeam = opts.team ? [{ id: "ct-x-leila", caseId: NADIA, userId: "u-leila", role: "employer_matcher" as const }] : [];
    const st = opts.team ? new MemoryStore<Tables>({ ...data, case_team: [...data.case_team, ...extraTeam] }) : store;
    const r = st.raw();
    const cur = r.get("case_notes", row.id);
    const mem = (cur ? canReadRow("case_notes", cur, actorOf(p), r) : true) && canWriteRow("case_notes", row, actorOf(p), r);
    // Coach i teamet utan att vara huvudcoach: testdatat har ingen sådan, så en teamrad läggs in i samma transaktion.
    const pg = opts.team
      ? await asUser(db, authOf(userId), (tx) => attempt(tx, sql, params), {
          before: async (tx) => { await tx.query("insert into public.case_team (id, case_id, user_id, role) values ('ct-x-leila', $1, 'u-leila', 'employer_matcher')", [NADIA]); },
        })
      : await asPersona(p, (tx) => attempt(tx, sql, params));
    return { pg: allowed(pg), mem };
  };
  const at = "2027-02-01T09:30";
  const insertNote = (id: string, caseId: string, contractId: string, authorId: string, audience: string, extra = "") =>
    `insert into public.case_notes (id, contract_id, case_id, author_id, occurred_on, kind, audience, body, created_at, updated_at, removed_at, removed_by)
     values ('${id}', '${contractId}', '${caseId}', '${authorId}', '2027-01-30', 'other', '${audience}', 'Text', '${at}', ${extra || "null, null, null"})`;
  const newRow = (id: string, caseId: string, contractId: string, authorId: string, audience: "full" | "team", patch: Partial<Tables["case_notes"]> = {}): Tables["case_notes"] => ({
    id, contractId, caseId, authorId, occurredOn: "2027-01-30", kind: "other", audience, body: "Text", createdAt: at, updatedAt: null, removedAt: null, removedBy: null, ...patch,
  });

  it("ny anteckning: tillåten i eget namn – nekas för handledare med 'full', annan författare, fel avtal och borttagen/ändrad vid start", async () => {
    const cases: [string, string, Tables["case_notes"], boolean][] = [
      ["u-amira", insertNote("n-t1", NADIA, "c-bot", "u-amira", "full"), newRow("n-t1", NADIA, "c-bot", "u-amira", "full"), true],
      ["u-petra", insertNote("n-t2", NADIA, "c-bot", "u-petra", "team"), newRow("n-t2", NADIA, "c-bot", "u-petra", "team"), true],
      ["u-petra", insertNote("n-t3", NADIA, "c-bot", "u-petra", "full"), newRow("n-t3", NADIA, "c-bot", "u-petra", "full"), false],
      ["u-amira", insertNote("n-t4", NADIA, "c-bot", "u-sara", "full"), newRow("n-t4", NADIA, "c-bot", "u-sara", "full"), false],
      ["u-amira", insertNote("n-t5", NADIA, "c-kk", "u-amira", "full"), newRow("n-t5", NADIA, "c-kk", "u-amira", "full"), false],
      ["u-amira", insertNote("n-t6", NADIA, "c-bot", "u-amira", "full", `null, '${at}', 'u-amira'`), newRow("n-t6", NADIA, "c-bot", "u-amira", "full", { removedAt: at, removedBy: "u-amira" }), false],
      ["u-amira", insertNote("n-t7", NADIA, "c-bot", "u-amira", "full", `'${at}', null, null`), newRow("n-t7", NADIA, "c-bot", "u-amira", "full", { updatedAt: at }), false],
      ["u-karin", insertNote("n-t8", NADIA, "c-bot", "u-karin", "full"), newRow("n-t8", NADIA, "c-bot", "u-karin", "full"), false],
      ["u-robin", insertNote("n-t9", NADIA, "c-bot", "u-robin", "full"), newRow("n-t9", NADIA, "c-bot", "u-robin", "full"), false],
      ["u-lars", insertNote("n-t10", NADIA, "c-bot", "u-lars", "team"), newRow("n-t10", NADIA, "c-bot", "u-lars", "team"), false],
      ["k-maria", insertNote("n-t11", NADIA, "c-bot", "k-maria", "team"), newRow("n-t11", NADIA, "c-bot", "k-maria", "team"), false],
      ["u-sara", insertNote("n-t12", SKYDDAD, "c-bot", "u-sara", "full"), newRow("n-t12", SKYDDAD, "c-bot", "u-sara", "full"), false],
      ["u-erik", insertNote("n-t13", SKYDDAD, "c-bot", "u-erik", "full"), newRow("n-t13", SKYDDAD, "c-bot", "u-erik", "full"), true],
    ];
    for (const [userId, sql, row, want] of cases) {
      const r = await both(userId, sql, [], row);
      expect(r, `${userId} ${row.id}`).toEqual({ pg: want, mem: want });
    }
  });

  it("ändra: bara författaren; ärende, avtal och författare ändras aldrig; en borttagen anteckning är låst", async () => {
    const samtal = note("note-nadia-samtal");
    const gone = note("note-nadia-borttagen");
    const cases: [string, string, Tables["case_notes"], boolean][] = [
      ["u-amira", "update public.case_notes set body = 'Ny text' where id = 'note-nadia-samtal'", { ...samtal, body: "Ny text" }, true],
      ["u-sara", "update public.case_notes set body = 'Ny text' where id = 'note-nadia-samtal'", { ...samtal, body: "Ny text" }, false],
      ["u-johan", "update public.case_notes set kind = 'practical' where id = 'note-nadia-samtal'", { ...samtal, kind: "practical" }, false],
      ["u-amira", "update public.case_notes set case_id = 'case-260130' where id = 'note-nadia-samtal'", { ...samtal, caseId: "case-260130" }, false],
      ["u-amira", "update public.case_notes set contract_id = 'c-kk' where id = 'note-nadia-samtal'", { ...samtal, contractId: "c-kk" }, false],
      ["u-amira", "update public.case_notes set author_id = 'u-sara' where id = 'note-nadia-samtal'", { ...samtal, authorId: "u-sara" }, false],
      ["u-amira", "update public.case_notes set body = 'Ny text' where id = 'note-nadia-borttagen'", { ...gone, body: "Ny text" }, false],
      ["u-amira", "update public.case_notes set removed_at = null, removed_by = null where id = 'note-nadia-borttagen'", { ...gone, removedAt: null, removedBy: null }, false],
      ["u-sara", "update public.case_notes set removed_at = null, removed_by = null where id = 'note-nadia-borttagen'", { ...gone, removedAt: null, removedBy: null }, false],
      ["u-amira", "delete from public.case_notes where id = 'note-nadia-samtal'", samtal, false],
    ];
    for (const [userId, sql, row, want] of cases) {
      const r = await both(userId, sql, [], row);
      expect(r, `${userId}: ${sql}`).toEqual({ pg: want, mem: want });
    }
    // Ingen hård radering i minnesläget heller: MemoryRepo.remove() nekas av samma regel (raden ändras inte).
    expect(canWriteRow("case_notes", samtal, actorOf(findPersona("u-amira")), raw)).toBe(false);
  });

  it("dölja: författaren och samordnare/avtalsansvarig i eget namn – aldrig handledare, coach i teamet, ekonom, chef, admin eller kommunen", async () => {
    const praktiskt = note("note-nadia-praktiskt");
    const skyddad = note("note-skyddad");
    const hide = (id: string, by: string) => `update public.case_notes set removed_at = '${at}', removed_by = '${by}' where id = '${id}'`;
    const hidden = (n: Tables["case_notes"], by: string): Tables["case_notes"] => ({ ...n, removedAt: at, removedBy: by });
    const cases: [string, string, Tables["case_notes"], boolean, { team?: boolean }?][] = [
      ["u-amira", hide(praktiskt.id, "u-amira"), hidden(praktiskt, "u-amira"), true],
      ["u-sara", hide(praktiskt.id, "u-sara"), hidden(praktiskt, "u-sara"), true],
      ["u-johan", hide(praktiskt.id, "u-johan"), hidden(praktiskt, "u-johan"), true],
      ["u-sara", hide(praktiskt.id, "u-amira"), hidden(praktiskt, "u-amira"), false], // inte i någon annans namn
      ["u-sara", `update public.case_notes set removed_at = '${at}', removed_by = 'u-sara', body = 'Ändrad' where id = '${praktiskt.id}'`, { ...hidden(praktiskt, "u-sara"), body: "Ändrad" }, false],
      ["u-sara", `update public.case_notes set removed_by = 'u-sara' where id = '${praktiskt.id}'`, { ...praktiskt, removedBy: "u-sara" }, false],
      ["u-petra", hide(praktiskt.id, "u-petra"), hidden(praktiskt, "u-petra"), false],
      ["u-leila", hide(praktiskt.id, "u-leila"), hidden(praktiskt, "u-leila"), false, { team: true }],
      ["u-lars", hide(praktiskt.id, "u-lars"), hidden(praktiskt, "u-lars"), false],
      ["u-karin", hide(praktiskt.id, "u-karin"), hidden(praktiskt, "u-karin"), false],
      ["u-robin", hide(praktiskt.id, "u-robin"), hidden(praktiskt, "u-robin"), false],
      ["k-maria", hide(praktiskt.id, "k-maria"), hidden(praktiskt, "k-maria"), false],
      // Skyddat ärende: avtalsansvarig (full) får dölja, samordnaren (bara ärendenumret) får inte.
      ["u-johan", hide(skyddad.id, "u-johan"), hidden(skyddad, "u-johan"), true],
      ["u-sara", hide(skyddad.id, "u-sara"), hidden(skyddad, "u-sara"), false],
      ["u-petra", hide("note-mehmet-handledare", "u-petra"), hidden(note("note-mehmet-handledare"), "u-petra"), true],
    ];
    for (const [userId, sql, row, want, opts] of cases) {
      const r = await both(userId, sql, [], row, opts);
      expect(r, `${userId}: ${sql}`).toEqual({ pg: want, mem: want });
    }
  });

  it("reset_test_data tömmer anteckningarna (nya tabeller töms automatiskt)", async () => {
    const n = await asUser(db, null, async (tx) => {
      await tx.query("select public.reset_test_data('2027-02-01T09:12')");
      return (await tx.query<{ n: number }>("select count(*)::int as n from public.case_notes")).rows[0].n;
    }, { role: "service_role" });
    expect(n).toBe(0);
  });

  it("0020: talen för tydlig och någon progression läses ur avtalets fritext när de saknas – annars orört", async () => {
    const sql = readFileSync(`${MIGRATIONS_DIR}/0020_progressionsgranser.sql`, "utf8");
    const res = await asUser(db, null, async (tx) => {
      // Som en äldre konfiguration i testmiljön: fritexten finns, talen saknas.
      await tx.query(`update public.contracts set config = jsonb_set(config #- '{progression,clearFromLevel}' #- '{progression,anyFromLevel}', '{progression,statDefinition}',
        '{"clear":"minst ett område på nivå >= 2","any":"minst ett område på nivå >= 1"}'::jsonb) where id = 'c-bot'`);
      await tx.exec(sql);
      const after = (await tx.query<{ p: Record<string, unknown> }>("select config -> 'progression' as p from public.contracts where id = 'c-bot'")).rows[0].p;
      await tx.exec(sql); // idempotent
      const again = (await tx.query<{ p: Record<string, unknown> }>("select config -> 'progression' as p from public.contracts where id = 'c-bot'")).rows[0].p;
      const kk = (await tx.query<{ c: unknown }>("select config -> 'progression' as c from public.contracts where id = 'c-kk'")).rows[0].c;
      return { after, again, kk };
    }, { role: "service_role" });
    expect(res.after).toMatchObject({ clearFromLevel: 2, anyFromLevel: 1 });
    expect(res.again).toEqual(res.after);
    expect(res.kk).toBeNull();
    const cfg = { ...data.contracts.find((c) => c.id === "c-bot")!.config, progression: res.after };
    expect(() => requireOperational(cfg as never)).not.toThrow();
  });
});

// ================================================================ Sparade rapporter (0021)
describe("sparade rapporter (0021): läsning, skrivning och delning – samma regler i RLS, triggern och policy.ts", () => {
  const sr = (id: string) => raw.get("saved_reports", id)!;
  const pgSaved = (userId: string) => asPersona(findPersona(userId), async (tx) => (await tx.query<{ id: string }>("select id from public.saved_reports order by id")).rows.map((r) => r.id));
  const memSaved = (userId: string) => data.saved_reports.filter((x) => canReadRow("saved_reports", x, actorOf(findPersona(userId)), raw)).map((x) => x.id).sort();
  const at = "2027-02-01T09:30";

  it("läsning per testperson: byggrollerna egna och delade (också arkiverade), kommunens chef bara delade med kommunen i c-bot", async () => {
    const bot = (ids: string[]) => ids.sort();
    const expected: Record<string, string[]> = {
      "u-sara": bot(["sr-seed-privat", "sr-seed-mb", "sr-seed-kommun", "sr-x-arkiv", "sr-x-sara-kommun"]),
      "u-karin": bot(["sr-seed-mb", "sr-seed-kommun", "sr-x-arkiv", "sr-x-sara-kommun"]),
      "u-johan": bot(["sr-seed-mb", "sr-seed-kommun", "sr-x-arkiv", "sr-x-sara-kommun", "sr-x-kk"]),
      "u-robin": [], "u-amira": [], "u-petra": [], "u-lars": [], "k-maria": [], "tester-karim": [],
      "k-eva": bot(["sr-seed-kommun", "sr-x-sara-kommun"]),
      "k-chef-alby": bot(["sr-seed-kommun", "sr-x-sara-kommun"]),
    };
    for (const [userId, want] of Object.entries(expected)) {
      expect(await pgSaved(userId), userId).toEqual(want);
      expect(memSaved(userId), userId).toEqual(want);
    }
  });

  /** Kör satsen som personen i Postgres och samma rad i policy.ts – svaren ska vara lika. */
  const both = async (userId: string, sql: string, row: Tables["saved_reports"]) => {
    const p = findPersona(userId);
    const cur = raw.get("saved_reports", row.id);
    const mem = (cur ? canReadRow("saved_reports", cur, actorOf(p), raw) : true) && canWriteRow("saved_reports", row, actorOf(p), raw);
    const pg = await asPersona(p, (tx) => attempt(tx, sql));
    return { pg: allowed(pg), mem };
  };
  const insert = (r: Tables["saved_reports"]) => insertSql("saved_reports", r as unknown as Record<string, unknown>);
  const row = (id: string, ownerId: string, visibility: Tables["saved_reports"]["visibility"], sharedBy: string | null, patch: Partial<Tables["saved_reports"]> = {}): Tables["saved_reports"] => ({
    id, contractId: "c-bot", ownerId, title: "Ny rapport", templateKey: null, definition: { v: 1, dataset: "avslut" }, visibility, createdAt: at, updatedAt: null, updatedBy: null,
    sharedAt: sharedBy ? at : null, sharedBy, archivedAt: null, archivedBy: null, ...patch,
  });

  it("ny rad: i eget namn – samordnaren och chefen delar aldrig med kommunen, delningen i eget namn, ingen ändrad eller arkiverad", async () => {
    const cases: [string, Tables["saved_reports"], boolean][] = [
      ["u-sara", row("n-1", "u-sara", "private", null), true],
      ["u-karin", row("n-2", "u-karin", "mb", "u-karin"), true],
      ["u-johan", row("n-3", "u-johan", "customer", "u-johan"), true],
      ["u-sara", row("n-4", "u-sara", "customer", "u-sara"), false],
      ["u-karin", row("n-5", "u-karin", "customer", "u-karin"), false],
      ["u-sara", row("n-6", "u-karin", "private", null), false],
      ["u-sara", row("n-7", "u-sara", "mb", "u-karin"), false],
      ["u-sara", row("n-8", "u-sara", "private", "u-sara"), false],
      ["u-sara", row("n-9", "u-sara", "private", null, { archivedAt: at, archivedBy: "u-sara" }), false],
      ["u-sara", row("n-10", "u-sara", "private", null, { updatedAt: at, updatedBy: "u-sara" }), false],
      ["u-sara", row("n-11", "u-sara", "private", null, { templateKey: "Anna Andersson" }), false],
      ["u-johan", row("n-12", "u-johan", "customer", "u-johan", { contractId: "c-kk" }), false],
      ["u-robin", row("n-13", "u-robin", "private", null), false],
      ["u-amira", row("n-14", "u-amira", "private", null), false],
      ["u-lars", row("n-15", "u-lars", "private", null), false],
      ["k-eva", row("n-16", "k-eva", "private", null), false],
      // Titelns längd räknas i tecken som char_length (kodpunkter): "a📊" och "📊📊" är 2 tecken i Postgres (3 och 4 i JavaScript).
      ["u-sara", row("n-17", "u-sara", "private", null, { title: "a📊" }), false],
      ["u-sara", row("n-18", "u-sara", "private", null, { title: "📊📊" }), false],
      ["u-sara", row("n-19", "u-sara", "private", null, { title: "ab📊" }), true],
      ["u-sara", row("n-20", "u-sara", "private", null, { title: "📊".repeat(80) }), true],
      ["u-sara", row("n-21", "u-sara", "private", null, { title: "📊".repeat(81) }), false],
    ];
    for (const [userId, r, want] of cases) expect(await both(userId, insert(r), r), `${userId} ${r.id}`).toEqual({ pg: want, mem: want });
  });

  it("ändringar som nekas: fasta fält, delning i någon annans namn, tom ändring, mallnyckel, innehåll av någon annan än ägaren, privat av avtalsansvarig, arkiverad rad, delete", async () => {
    const privat = sr("sr-seed-privat");
    const mb = sr("sr-seed-mb");
    const kommun = sr("sr-x-sara-kommun");
    const arkiv = sr("sr-x-arkiv");
    const upd = (id: string, set: string) => `update public.saved_reports set ${set} where id = '${id}'`;
    const cases: [string, string, Tables["saved_reports"], boolean][] = [
      ["u-sara", upd(privat.id, "owner_id = 'u-karin'"), { ...privat, ownerId: "u-karin" }, false],
      ["u-sara", upd(privat.id, "contract_id = 'c-kk'"), { ...privat, contractId: "c-kk" }, false],
      ["u-sara", upd(privat.id, `created_at = '${at}'`), { ...privat, createdAt: at }, false],
      ["u-sara", upd(privat.id, `visibility = 'mb', shared_at = '${at}', shared_by = 'u-karin'`), { ...privat, visibility: "mb", sharedAt: at, sharedBy: "u-karin" }, false],
      ["u-sara", upd(privat.id, "visibility = 'mb'"), { ...privat, visibility: "mb" }, false],
      ["u-johan", upd(mb.id, "visibility = 'customer'"), { ...mb, visibility: "customer" }, false],
      ["u-karin", upd(mb.id, `shared_at = '${at}'`), { ...mb, sharedAt: at }, false],
      ["u-sara", upd(privat.id, "title = title"), privat, false],
      ["u-sara", upd(privat.id, "template_key = 'Anna Andersson'"), { ...privat, templateKey: "Anna Andersson" }, false],
      ["u-sara", upd(kommun.id, `title = 'Ändrad', updated_at = '${at}', updated_by = 'u-sara'`), { ...kommun, title: "Ändrad", updatedAt: at, updatedBy: "u-sara" }, false],
      ["u-johan", upd(kommun.id, `title = 'Ändrad', updated_at = '${at}', updated_by = 'u-johan'`), { ...kommun, title: "Ändrad", updatedAt: at, updatedBy: "u-johan" }, false],
      ["u-johan", upd(mb.id, `title = 'Ändrad', updated_at = '${at}', updated_by = 'u-johan'`), { ...mb, title: "Ändrad", updatedAt: at, updatedBy: "u-johan" }, false],
      ["u-johan", upd(mb.id, `visibility = 'private', shared_at = '${at}', shared_by = 'u-johan'`), { ...mb, visibility: "private", sharedAt: at, sharedBy: "u-johan" }, false],
      ["u-karin", upd(arkiv.id, `title = 'Ändrad', updated_at = '${at}', updated_by = 'u-karin'`), { ...arkiv, title: "Ändrad", updatedAt: at, updatedBy: "u-karin" }, false],
      ["u-karin", upd(mb.id, `updated_at = '${at}', updated_by = 'u-sara', title = 'X ändrad'`), { ...mb, updatedAt: at, updatedBy: "u-sara", title: "X ändrad" }, false],
      ["u-karin", `delete from public.saved_reports where id = '${mb.id}'`, mb, false],
      // Tillåtna: avtalsansvarig delar Karins rapport med kommunen i eget namn, ägaren ändrar sin egen, avtalsansvarig arkiverar.
      ["u-johan", upd(mb.id, `visibility = 'customer', shared_at = '${at}', shared_by = 'u-johan'`), { ...mb, visibility: "customer", sharedAt: at, sharedBy: "u-johan" }, true],
      ["u-sara", upd(privat.id, `title = 'Ändrad', updated_at = '${at}', updated_by = 'u-sara'`), { ...privat, title: "Ändrad", updatedAt: at, updatedBy: "u-sara" }, true],
      ["u-johan", upd(mb.id, `archived_at = '${at}', archived_by = 'u-johan'`), { ...mb, archivedAt: at, archivedBy: "u-johan" }, true],
      ["u-johan", upd(kommun.id, `visibility = 'mb', shared_at = '${at}', shared_by = 'u-johan'`), { ...kommun, visibility: "mb", sharedAt: at, sharedBy: "u-johan" }, true],
    ];
    for (const [userId, sql, r, want] of cases) expect(await both(userId, sql, r), `${userId}: ${sql}`).toEqual({ pg: want, mem: want });
    // Ingen hård radering i minnesläget heller: MemoryRepo.remove() nekas av samma regel (raden ändras inte).
    expect(canWriteRow("saved_reports", mb, actorOf(findPersona("u-karin")), raw)).toBe(false);
  });

  it("samma person ändrar delningen två gånger inom samma minut och ägaren arkiverar sin rad – och läser tillbaka den (update … select)", async () => {
    const mb = sr("sr-seed-mb");
    const shareTo = (v: string) => `update public.saved_reports set visibility = '${v}', shared_at = '${at}', shared_by = 'u-karin' where id = '${mb.id}' returning id`;
    const pg = await asPersona(findPersona("u-karin"), async (tx) => ({
      first: await attempt(tx, shareTo("private"), [], { keep: true }),
      second: await attempt(tx, shareTo("mb"), [], { keep: true }),
      archive: await attempt(tx, `update public.saved_reports set archived_at = '${at}', archived_by = 'u-karin' where id = '${mb.id}' returning *`, [], { keep: true }),
      readBack: (await tx.query<{ id: string }>("select id from public.saved_reports where id = $1", [mb.id])).rows.length,
    }));
    expect(pg.first).toMatchObject({ ok: true, rows: 1 });
    expect(pg.second).toMatchObject({ ok: true, rows: 1 });
    expect(pg.archive).toMatchObject({ ok: true, rows: 1 });
    expect(pg.readBack).toBe(1);
    // policy.ts med samma steg.
    const step1 = { ...mb, visibility: "private" as const, sharedAt: at, sharedBy: "u-karin" };
    const karin = actorOf(findPersona("u-karin"));
    expect(canWriteRow("saved_reports", step1, karin, raw)).toBe(true);
    const after1: RawAccess<Tables> = { ...raw, get: ((t: TableName, id: string) => (t === "saved_reports" && id === mb.id ? step1 : raw.get(t as never, id))) as RawAccess<Tables>["get"] };
    const step2 = { ...step1, visibility: "mb" as const };
    expect(canWriteRow("saved_reports", step2, karin, after1)).toBe(true);
    const after2: RawAccess<Tables> = { ...raw, get: ((t: TableName, id: string) => (t === "saved_reports" && id === mb.id ? step2 : raw.get(t as never, id))) as RawAccess<Tables>["get"] };
    const archived = { ...step2, archivedAt: at, archivedBy: "u-karin" };
    expect(canWriteRow("saved_reports", archived, karin, after2)).toBe(true);
    expect(canReadRow("saved_reports", archived, karin, after2)).toBe(true);
  });

  it("reset_test_data tömmer de sparade rapporterna (nya tabeller töms automatiskt)", async () => {
    const n = await asUser(db, null, async (tx) => {
      await tx.query("select public.reset_test_data('2027-02-01T09:12')");
      return (await tx.query<{ n: number }>("select count(*)::int as n from public.saved_reports")).rows[0].n;
    }, { role: "service_role" });
    expect(n).toBe(0);
  });
});

// ================================================================ Pulslänken (0016)
describe("pulslänken: ett svar per länk (0016)", () => {
  const answered = data.pulse_responses[0];
  const open = data.pulse_invites.find((i) => i.id === "pi-demo")!;
  const insert = (id: string, inviteId: string, caseId: string) =>
    `insert into public.pulse_responses (id, invite_id, case_id, coach_id, occasion, language, answers, text, contact_requested, submitted_at)
     values ('${id}', '${inviteId}', '${caseId}', null, 'periodic', 'sv', '{"q1":5,"q2":5,"q3":5,"q4":"jobb","q5":"nej"}', '', false, '2027-02-01T09:30')`;

  it("unik nyckel på invite_id – testdatat har ett svar per länk, och det gamla indexet är borta", async () => {
    expect(new Set(data.pulse_responses.map((r) => r.inviteId)).size).toBe(data.pulse_responses.length);
    const r = await db.query<{ name: string; type: string; def: string }>(
      "select conname as name, contype as type, pg_get_constraintdef(oid) as def from pg_constraint where conrelid = 'public.pulse_responses'::regclass and contype = 'u'",
    );
    expect(r.rows).toEqual([{ name: "pulse_responses_invite_id_key", type: "u", def: "UNIQUE (invite_id)" }]);
    const idx = await db.query<{ n: string }>("select indexname as n from pg_indexes where schemaname = 'public' and tablename = 'pulse_responses' order by 1");
    expect(idx.rows.map((x) => x.n)).not.toContain("pulse_responses_invite_id_idx");
  });

  it("två svar på samma länk: det andra stoppas (23505) – även för service role (hanterarens systemsteg)", async () => {
    const res = await asUser(db, null, async (tx) => ({
      again: await attempt(tx, insert("pr-dubblett", answered.inviteId, answered.caseId)),
      first: await attempt(tx, insert("pr-ett", open.id, open.caseId), [], { keep: true }),
      second: await attempt(tx, insert("pr-tva", open.id, open.caseId)),
    }), { role: "service_role" });
    expect(res.again).toMatchObject({ ok: false, code: "23505" });
    expect(allowed(res.first)).toBe(true);
    expect(res.second).toMatchObject({ ok: false, code: "23505" });
  });

  it("testaren som deltagaren (RLS): första svaret på en oanvänd länk går igenom, det andra stoppas", async () => {
    const res = await asPersona(findPersona("deltagare"), async (tx) => ({
      first: await attempt(tx, insert("pr-d1", open.id, open.caseId), [], { keep: true }),
      second: await attempt(tx, insert("pr-d2", open.id, open.caseId)),
    }));
    expect(allowed(res.first)).toBe(true);
    expect(res.second).toMatchObject({ ok: false, code: "23505" });
  });
});

// ================================================================ Röstinspelning (0015)
describe("röstinspelning: länkar, röstmeddelanden och ljudfiler (0015)", () => {
  /** Flera testpersoner mot databasen per test – längre tidsgräns när hela testsviten körs parallellt. */
  const SLOW = 30_000;
  const protectedIds = new Set(data.persons.filter((p) => p.protectedIdentity).map((p) => p.id));
  const prot = () => data.cases.find((c) => protectedIds.has(c.personId) && c.leadCoachId)!;
  const caseOfTag = (tag: string) => data.cases.find((c) => c.id === data.demo_tags.find((t) => t.tag === tag)!.entityIds[0])!;
  const at = "2027-02-01T09:30";
  const linkRow = (id: string, caseId: string, createdBy: string): Tables["voice_links"] => ({
    id, caseId, tokenHash: `hash-${id}`, channel: "sms", language: "sv", sentAt: at, expiresAt: "2027-02-08T09:30", usedAt: null, createdBy,
  });
  const memWrite = <N extends TableName>(t: N, row: Tables[N], userId: string, r: RawAccess<Tables> = raw) => {
    const a = findPersona(userId).actor;
    const cur = r.get(t, row.id);
    return (!cur || canReadRow(t, cur, a, r)) && canWriteRow(t, row, a, r);
  };

  it("testdatat: Nadias och Yusufs röstmeddelanden, en oanvänd länk och inga länkar i skyddade ärenden", () => {
    const seed = seedData();
    expect(seed.participant_voice_notes.map((n) => [n.id, n.language, n.status, n.textOriginal !== null])).toEqual([["pvn-yusuf", "sv", "reviewed", false], ["pvn-nadia", "so", "new", true]]);
    expect(seed.voice_links.filter((l) => !l.usedAt).map((l) => l.id)).toEqual(["vl-demo"]);
    const protCases = new Set(seed.cases.filter((c) => protectedIds.has(c.personId)).map((c) => c.id));
    expect(seed.voice_links.some((l) => protCases.has(l.caseId)) || seed.participant_voice_notes.some((n) => protCases.has(n.caseId))).toBe(false);
    expect(seed.audio_uploads.every((u) => u.status === "deleted" && u.deletedAt)).toBe(true);
  }, SLOW);

  it("inga röstlänkar i skyddade ärenden – inte ens för namngiven huvudcoach eller avtalsansvarig", async () => {
    const c = prot();
    const insert = (row: Tables["voice_links"]) => insertSql("voice_links", row as unknown as Record<string, unknown>);
    for (const userId of [c.leadCoachId!, "u-johan"]) {
      const row = linkRow(`vl-t-${userId}`, c.id, userId);
      const res = await asPersona(findPersona(userId), (tx) => attempt(tx, insert(row)));
      expect(allowed(res), userId).toBe(false);
      expect(memWrite("voice_links", row, userId), userId).toBe(false);
    }
    // Samma coach i ett vanligt ärende: tillåtet i båda.
    const nadia = caseOfTag("nadia");
    const ok = linkRow("vl-t-nadia", nadia.id, "u-amira");
    expect(allowed(await asPersona(findPersona("u-amira"), (tx) => attempt(tx, insert(ok))))).toBe(true);
    expect(memWrite("voice_links", ok, "u-amira")).toBe(true);
  }, SLOW);

  it("kommunen läser granskade röstmeddelanden bara när avtalet säger det (customerVisibility.seesParticipantVoiceNotes)", async () => {
    const withFlag = (v: boolean): RawAccess<Tables> => ({
      ...raw,
      get: ((t: TableName, id: string) => {
        const row = raw.get(t as never, id) as unknown;
        if (t !== "contracts" || !row) return row;
        const k = row as Tables["contracts"];
        return { ...k, config: { ...k.config, customerVisibility: { ...k.config.customerVisibility!, seesParticipantVoiceNotes: v } } };
      }) as RawAccess<Tables>["get"],
    });
    const flagOn = async (tx: Tx) => {
      await tx.query(`update public.contracts set config = jsonb_set(config, '{customerVisibility,seesParticipantVoiceNotes}', 'true'::jsonb) where id = 'c-bot'`);
    };
    const pgNotes = (userId: string) =>
      asPersona(findPersona(userId), async (tx) => (await tx.query<{ id: string }>("select id from public.participant_voice_notes order by id")).rows.map((r) => r.id));
    const pgNotesOn = (userId: string) =>
      asUser(db, authOf(userId), async (tx) => (await tx.query<{ id: string }>("select id from public.participant_voice_notes order by id")).rows.map((r) => r.id), { before: flagOn });
    const memNotes = (userId: string, r: RawAccess<Tables>) =>
      data.participant_voice_notes.filter((n) => canReadRow("participant_voice_notes", n, findPersona(userId).actor, r)).map((n) => n.id).sort();
    for (const userId of ["k-maria", "k-eva", "k-ahmed", "u-lars"]) {
      expect(await pgNotes(userId), userId).toEqual([]);
      expect(memNotes(userId, withFlag(false)), userId).toEqual([]);
      const on = await pgNotesOn(userId);
      expect(on, userId).toEqual(memNotes(userId, withFlag(true)));
      // Bara granskade röstmeddelanden, bara i ärenden där kommunen har åtkomst – aldrig ekonomen.
      for (const id of on) expect(data.participant_voice_notes.find((n) => n.id === id)!.status).toBe("reviewed");
      if (userId === "u-lars") expect(on).toEqual([]);
    }
    expect(await pgNotesOn("k-maria")).toEqual(["pvn-x-maria", "pvn-yusuf"]);
  }, SLOW);

  it("granskningen ändrar bara status – aldrig deltagarens text eller samtycke – och görs i eget namn", async () => {
    const n = data.participant_voice_notes.find((x) => x.id === "pvn-nadia")!;
    const upd = (set: string) => `update public.participant_voice_notes set ${set} where id = 'pvn-nadia'`;
    const res = await asPersona(findPersona("u-amira"), async (tx) => ({
      review: await attempt(tx, upd(`status = 'reviewed', reviewed_by = 'u-amira', reviewed_at = '${at}'`)),
      text: await attempt(tx, upd("text_sv = 'Ändrad text'")),
      consent: await attempt(tx, upd("consent_text_version = 'annan'")),
      otherName: await attempt(tx, upd(`status = 'reviewed', reviewed_by = 'u-sara', reviewed_at = '${at}'`)),
      archive: await attempt(tx, upd("status = 'archived'")),
    }));
    expect(res.review).toMatchObject({ ok: true, rows: 1 });
    expect(res.archive).toMatchObject({ ok: true, rows: 1 });
    expect(res.text.ok).toBe(false);
    expect(res.consent.ok).toBe(false);
    expect(res.otherName.ok).toBe(false);
    expect(memWrite("participant_voice_notes", { ...n, status: "reviewed", reviewedBy: "u-amira", reviewedAt: at }, "u-amira")).toBe(true);
    expect(memWrite("participant_voice_notes", { ...n, status: "archived" }, "u-amira")).toBe(true);
    expect(memWrite("participant_voice_notes", { ...n, textSv: "Ändrad text" }, "u-amira")).toBe(false);
    expect(memWrite("participant_voice_notes", { ...n, consentTextVersion: "annan" }, "u-amira")).toBe(false);
    expect(memWrite("participant_voice_notes", { ...n, status: "reviewed", reviewedBy: "u-sara", reviewedAt: at }, "u-amira")).toBe(false);
    // Handledaren i teamet granskar också; ekonomen och kommunen aldrig.
    const petra = await asPersona(findPersona("u-petra"), (tx) => attempt(tx, upd(`status = 'reviewed', reviewed_by = 'u-petra', reviewed_at = '${at}'`)));
    expect(petra).toMatchObject({ ok: true, rows: 1 });
    expect(memWrite("participant_voice_notes", { ...n, status: "reviewed", reviewedBy: "u-petra", reviewedAt: at }, "u-petra")).toBe(true);
    for (const userId of ["u-lars", "k-maria"]) {
      const r = await asPersona(findPersona(userId), (tx) => attempt(tx, upd(`status = 'reviewed', reviewed_by = '${userId}', reviewed_at = '${at}'`)));
      expect(allowed(r), userId).toBe(false);
      expect(memWrite("participant_voice_notes", { ...n, status: "reviewed", reviewedBy: userId, reviewedAt: at }, userId), userId).toBe(false);
    }
    // Deltagaren skriver aldrig själv – hanteraren sparar via ctx.system efter tokenkontrollen.
    const newNote = { ...n, id: "pvn-t-ny" };
    const del = await asPersona(findPersona("deltagare"), (tx) => attempt(tx, insertSql("participant_voice_notes", newNote as unknown as Record<string, unknown>)));
    expect(allowed(del)).toBe(false);
    expect(memWrite("participant_voice_notes", newNote, "deltagare")).toBe(false);
  }, SLOW);

  it("ljudfilernas rader skrivs bara av systemet (ctx.audio) – läses av den som spelade in och den som arbetar i ärendet", async () => {
    const mehmet = data.audio_uploads.find((u) => u.id === "aud-mehmet")!;
    const fresh: Tables["audio_uploads"] = { ...mehmet, id: "aud-t-ny", status: "pending", deletedAt: null };
    for (const userId of ["u-amira", "k-maria", "u-robin"]) {
      const res = await asPersona(findPersona(userId), async (tx) => ({
        ins: await attempt(tx, insertSql("audio_uploads", { ...fresh, ownerId: userId } as unknown as Record<string, unknown>)),
        upd: await attempt(tx, "update public.audio_uploads set status = 'uploaded', deleted_at = null where id = 'aud-mehmet'"),
      }));
      expect(allowed(res.ins) || allowed(res.upd), userId).toBe(false);
      expect(memWrite("audio_uploads", { ...fresh, ownerId: userId }, userId), userId).toBe(false);
      expect(memWrite("audio_uploads", { ...mehmet, status: "uploaded", deletedAt: null }, userId), userId).toBe(false);
    }
    const service = await asUser(db, null, async (tx) => ({
      ins: await attempt(tx, insertSql("audio_uploads", fresh as unknown as Record<string, unknown>)),
      upd: await attempt(tx, "update public.audio_uploads set status = 'deleted', deleted_at = '2027-02-01T09:31' where id = 'aud-x-petra'"),
    }), { role: "service_role" });
    expect(service.ins).toMatchObject({ ok: true, rows: 1 });
    expect(service.upd).toMatchObject({ ok: true, rows: 1 });
    // Läsning: kommunens "Tala in" bara den själv; deltagarens gemensamma id ger ingen läsrätt.
    const ids = async (userId: string) => ({
      pg: await asPersona(findPersona(userId), async (tx) => (await tx.query<{ id: string }>("select id from public.audio_uploads order by id")).rows.map((r) => r.id)),
      mem: await memIds(findPersona(userId), "audio_uploads"),
    });
    const maria = await ids("k-maria");
    expect(maria.pg).toEqual(["aud-x-diktat", "aud-x-diktat-arende"]);
    expect(maria.mem).toEqual(maria.pg);
    const amira = await ids("u-amira");
    expect(amira.pg).toEqual(amira.mem);
    expect(amira.pg).toEqual(expect.arrayContaining(["aud-mehmet", "aud-pvn-nadia", "aud-pvn-yusuf", "aud-x-deltagare"]));
    expect(amira.pg).not.toContain("aud-x-diktat-arende");
    const del = await ids("deltagare");
    expect(del.pg).toEqual([]);
    expect(del.mem).toEqual([]);
  }, SLOW);
});
