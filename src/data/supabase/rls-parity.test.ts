// Bevis: Row Level Security i Postgres ger exakt samma resultat som prototypens policy (src/data/policy.ts).
// Kör alla migrationer och supabase/seed.sql i PGlite (lokal Postgres i processen) och jämför, för varje testperson och
// varje tabell, vad RLS släpper igenom med vad MemoryRepo + POLICIES släpper igenom på samma testdata.
// Kör: npx vitest run src/data/supabase/rls-parity.test.ts
import { readFileSync } from "node:fs";
import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { accessIndex, caseAccessIn } from "@/core/access";
import { defaultGroupings } from "@/core/groupings";
import { requireOperational } from "@/core/config";
import { COLUMNS, EXTRA_COLUMNS, quoteIdent, snakeCase, type SqlType } from "../../../scripts/db/columns";
import { authUserIdFor, seedData, seedSql, sqlLiteral, TESTERS } from "../../../scripts/db/seed-sql";
import { listPersonas, type Persona } from "../actors";
import { MemoryRepo, MemoryStore, UniqueError, type RawAccess } from "../memory";
import { canReadRow, canWriteRow, POLICIES } from "../policy";
import { TABLE_NAMES, UNIQUE_KEYS, type TableName, type Tables } from "../schema";
import { allowed, asUser, attempt, createMigratedDatabase, loadSeed, MIGRATIONS_DIR, SEED_FILE, type Tx } from "./pglite";

// Testarnas konton i auth.users (skapas av servern vid första inloggningen; seeden kopplar dem via e-postadressen).
const TESTER_AUTH: Record<string, string> = {
  "tester-karim": "aaaaaaaa-0000-4000-8000-000000000001",
  "tester-ali": "aaaaaaaa-0000-4000-8000-000000000002",
  "tester-sara": "aaaaaaaa-0000-4000-8000-000000000003",
  "tester-adam": "aaaaaaaa-0000-4000-8000-000000000004",
  "tester-shafik": "aaaaaaaa-0000-4000-8000-000000000005",
  "tester-moda": "aaaaaaaa-0000-4000-8000-000000000006",
  "tester-yacine": "aaaaaaaa-0000-4000-8000-000000000007",
};
const KARIM = TESTER_AUTH["tester-karim"];
const ALI = TESTER_AUTH["tester-ali"];
const authOf = (userId: string) => TESTER_AUTH[userId] ?? authUserIdFor(userId);

const data = seedData();
/**
 * Skyddade personuppgifter är borttagna ur appen (beslut 2026-10-07) och testdatat har inga skyddade personer – men spärren
 * ligger kvar vilande i RLS och policy.ts. Den prövas här: personen i ärendet "skyddad" (Omars beställning, huvudcoach Erik)
 * får protected_identity = true både i minnet och i databasen (beforeAll, som postgres).
 */
const SKYDDAD_CASE = data.cases.find((c) => c.id === data.demo_tags.find((t) => t.tag === "skyddad")!.entityIds[0])!;
const SKYDDAD_PERSON = data.persons.find((p) => p.id === SKYDDAD_CASE.personId)!;
SKYDDAD_PERSON.protectedIdentity = true;

/**
 * Extra rader för tabeller som testdatat lämnar tomma eller bara täcker delvis (flaggor, deadlines, bonus, fakturarader,
 * AI-beslut, skyddade ärenden …), så att deras policyer också prövas. Läggs in både i minnet och i databasen.
 */
function extraRows(): { [N in TableName]?: Tables[N][] } {
  const protectedCase = SKYDDAD_CASE;
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
  // Fakturan (0023): en öppen faktura (underlag) för januari med en rad – raderna på de skapade fakturorna finns i testdatat.
  const draft: Tables["invoice_drafts"] = {
    ...data.invoice_drafts[0], id: "inv-c-bot-2027-01-avtal", month: "2027-01", billingRunId: "br-2027-01", status: "draft", buyerReference: null, approvedBy: null,
    approvedAt: null, fortnoxDocumentNumber: null, fortnoxIdempotencyKey: null, fortnoxCreatedAt: null,
  };
  const draftCase = data.cases.find((c) => c.status === "active")!;
  const returnedInvoice = data.invoice_drafts.find((d) => d.status === "returned")!;
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
  const attachment = (id: string, caseId: string | null, uploadedBy: string, deleted = false): Tables["case_attachments"] => ({
    id, contractId: "c-bot", caseId, uploadedBy, fileName: "Kartläggning.pdf", mimeType: "application/pdf", bytes: 2048, storagePath: `c-bot/${id}.pdf`,
    status: deleted ? "deleted" : "uploaded", createdAt: at, linkedAt: caseId ? at : null, removedAt: deleted ? at : null, removedBy: deleted ? uploadedBy : null,
    deletedAt: deleted ? at : null, deleteReason: deleted ? "removed" : null,
  });
  // Synpunkter (0017): Karims och Alis synpunkter, ett svar och en synpunkt med ändrad status.
  const fb = (id: string, authorId: string, status: Tables["feedback"]["status"]): Tables["feedback"] => ({
    id, type: "fel", priority: "bor", text: "Text", status, role: "coach", path: "/min-vecka", viewTitle: "Min vecka", createdAt: at, authorId,
    statusChangedAt: status === "ny" ? null : at, statusChangedBy: status === "ny" ? null : authorId, submittedAt: null,
  });
  // Ett andra kommunavtal i utkast (påhittat, c-ny) där bara avtalsansvarig är medlem: flera avtal i datamodellen prövas,
  // och kommunen ser inga individrapporter där.
  const bot = data.contracts.find((c) => c.id === "c-bot")!;
  const other: Tables["contracts"] = {
    ...bot, id: "c-ny", name: "Nytt kommunavtal (påhittat)", contractNumber: "000000000", dnr: null, startsOn: "2027-06-01", endsOn: null, casePrefix: "NYK", status: "draft",
    config: { casePrefix: "NYK", dataRole: "processor", customerVisibility: { seesIndividualReports: false, seesCoachNotes: false }, reportSchedule: { automatic: [] } },
  };
  // Rapportbyggaren (0021): en arkiverad mb-rad, en rad i c-ny och en rad som ägs av samordnaren och delades inom
  // Miljonbemanning av avtalsansvarig (delningen med kommunen är borttagen, 0026).
  const saved = (id: string, contractId: string, ownerId: string, visibility: Tables["saved_reports"]["visibility"], sharedBy: string | null, archivedBy: string | null = null): Tables["saved_reports"] => ({
    id, contractId, ownerId, title: "Testrapport", templateKey: null, definition: { v: 1, dataset: "deltagarmanader" }, visibility, createdAt: at, updatedAt: null, updatedBy: null,
    sharedAt: sharedBy ? at : null, sharedBy, archivedAt: archivedBy ? at : null, archivedBy,
  });
  // Rollval (0027): Karims och Saras val, och Alis val av sin andra roll (avtalsansvarig) – bara den egna raden får läsas.
  const choice = (userId: string, role: Tables["role_choices"]["role"]): Tables["role_choices"] => ({ id: userId, userId, role, chosenAt: at });
  return {
    // Först: raderna nedan pekar på avtalet (främmande nycklar).
    contracts: [other],
    role_choices: [choice("tester-karim", "admin"), choice("u-sara", "samordnare"), choice("tester-ali", "avtalsansvarig")],
    saved_reports: [
      saved("sr-x-arkiv", "c-bot", "u-karin", "mb", "u-karin", "u-karin"),
      saved("sr-x-ny", "c-ny", "u-johan", "mb", "u-johan"),
      saved("sr-x-sara-mb", "c-bot", "u-sara", "mb", "u-johan"),
    ],
    memberships: [
      { id: "u-johan:c-ny", userId: "u-johan", contractId: "c-ny", role: "avtalsansvarig", customerUnit: null },
    ],
    feedback: [fb("fb-x-karim", "tester-karim", "ny"), fb("fb-x-ali", "tester-ali", "klar")],
    feedback_replies: [{ id: "fbr-x-1", feedbackId: "fb-x-karim", text: "Svar", createdAt: at, authorId: "tester-ali", submittedAt: null }],
    alerts: [
      alert("al-1", "c-bot", amiraCase.id, ["coach", "samordnare"]), alert("al-2", "c-bot", null, ["chef"]),
      alert("al-3", "c-bot", protectedCase.id, ["avtalsansvarig", "samordnare"]), alert("al-4", "c-ny", null, ["avtalsansvarig"]),
      alert("al-5", "c-bot", petraCase.id, ["handledare", "ekonom"]),
    ],
    alert_acks: [{ id: "al-1-key", alertKey: "al-1-key", acknowledgedBy: "u-amira", acknowledgedAt: at, actionPlan: "Plan" }],
    deadlines: [deadline("dl-1", "c-bot", amiraCase.id), deadline("dl-2", "c-bot", null), deadline("dl-3", "c-bot", protectedCase.id), deadline("dl-4", "c-ny", null)],
    kpi_snapshots: [
      { id: "kpi-1", contractId: "c-bot", kpiKey: "resultatgrad", window: "rolling_6m", value: 0.34, numerator: 17, denominator: 50, computedAt: at },
      { id: "kpi-2", contractId: "c-ny", kpiKey: "resultatgrad", window: "month", value: null, numerator: 0, denominator: 0, computedAt: at },
    ],
    bonus_claims: [bonus("bc-1", mariaCase.id), bonus("bc-2", amiraCase.id), bonus("bc-3", protectedCase.id), bonus("bc-4", petraCase.id)],
    contract_deviations: [cdev("cd-x1", mariaCase.id), cdev("cd-x2", protectedCase.id)],
    invoice_drafts: [draft],
    invoice_lines: [{
      id: `${draft.id}:${draftCase.id}`, invoiceDraftId: draft.id, caseId: draftCase.id, priceItemId: "pi-G", quantity: 4, unitPriceOre: 350000, vatRate: 25,
      description: `${draftCase.caseNumber} · v. 1–4 2027`, isoWeeks: ["2027-W01", "2027-W02", "2027-W03", "2027-W04"], zeroAttendanceWeeks: [], note: "",
    }],
    billing_week_approvals: [{ id: `${draftCase.id}:2026-W45`, contractId: "c-bot", month: "2026-11", caseId: draftCase.id, weekKey: "2026-W45", approvedBy: "u-lars", approvedAt: at, note: "" }],
    invoice_credits: [{ id: "ic-1", contractId: "c-bot", month: "2026-12", invoiceDraftId: returnedInvoice.id, caseId: null, creditedAt: at, creditedBy: "u-lars", buyerReference: "55102938" }],
    fortnox_runs: [
      { id: "fr-1", contractId: "c-bot", month: "2027-01", kind: "create", ranAt: at, ranBy: "u-lars", created: 1, skipped: 0, notReady: 0, blocked: 0, changed: 0 },
      { id: "fr-2", contractId: "c-ny", month: "2027-01", kind: "sync", ranAt: at, ranBy: "u-lars", created: 0, skipped: 0, notReady: 0, blocked: 0, changed: 0 },
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
    // Grupper (0031): en grupp i det andra avtalet (c-ny), där bara avtalsansvarig Johan är medlem.
    groupings: [{
      id: "grp-x-ny", contractId: "c-ny", kind: "group", category: null, name: "Grupp i nytt avtal", description: "", sortOrder: 1, createdAt: at, createdBy: "u-johan",
      updatedAt: null, updatedBy: null, archivedAt: null, archivedBy: null,
    }],
    // Bilagor till beställningen (0024): i Marias ärende, en uppladdning som ännu inte hör till en beställning, en raderad,
    // en i det skyddade ärendet (Omar) och en i Petras ärende som samordnaren lade till.
    case_attachments: [
      attachment("att-x-maria", mariaCase.id, "k-maria"), attachment("att-x-utkast", null, "k-maria"),
      attachment("att-x-borttagen", mariaCase.id, "k-maria", true), attachment("att-x-skyddad", protectedCase.id, protectedCase.referrerId!),
      attachment("att-x-petra", petraCase.id, "u-sara"),
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

/**
 * Kör fn som testpersonen: vanliga personer med sitt auth-id, deltagaren (ingen profil) via testarens val. En person med flera
 * roller (Ali: admin och avtalsansvarig) agerar i rollen via rollvalet (0027, role_choices) – som sidopanelens rollväljare.
 */
function asPersona<T>(p: Persona, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (p.actor.role === "deltagare") return asUser(db, KARIM, fn, { before: chooseTestPerson(p.actor.userId, "deltagare") });
  const roles = new Set(data.memberships.filter((m) => m.userId === p.actor.userId).map((m) => m.role));
  const before = roles.size > 1 ? chooseRole(p.actor.userId, p.actor.role) : undefined;
  return asUser(db, authOf(p.actor.userId), fn, before ? { before } : {});
}

/** Välj roll (0027) i samma transaktion, som postgres. */
const chooseRole = (userId: string, role: string) => async (tx: Tx) => {
  await tx.query("insert into public.role_choices (id, user_id, role, chosen_at) values ($1, $1, $2, '2027-02-01T06:00') on conflict (id) do update set role = excluded.role", [userId, role]);
};

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
  // Den vilande spärren (se SKYDDAD_PERSON): samma person får skyddade personuppgifter i databasen.
  await db.query("update public.persons set protected_identity = true where id = $1", [SKYDDAD_PERSON.id]);
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
      "select mm.case_access_level('kommun_handlaggare', 'k-maria', array['c-bot'], 'Arbetsmarknadsenheten Alby', 'c-bot', 'u-amira', 'k-maria', false, false, 'Arbetsmarknadsenheten Alby', 'own') as a, mm.unit_covers('', 'x') as b, mm.customer_scope('{\"customerVisibility\":{\"scope\":\"ATT_FASTSTÄLLA\",\"prototypeScope\":\"own\"}}'::jsonb) as c",
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
    // Nio roller: kommunen har bara rollen handläggare (beslut 2026-10-07).
    expect(new Set(personas.map((p) => p.actor.role)).size).toBe(9);
    expect(personas.some((p) => (p.actor.role as string) === "kommun_chef")).toBe(false);
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
    for (const userId of ["u-sara", "u-johan", "u-amira", "u-petra", "u-karin", "u-lars", "u-robin", "k-maria", "k-omar"]) {
      const p = findPersona(userId);
      const expected = Object.fromEntries(data.cases.map((c) => [c.id, caseAccessIn(c, p.actor, src)]));
      const got = await asPersona(p, async (tx) =>
        Object.fromEntries((await tx.query<{ id: string; a: string }>("select c.id, mm.case_access(c.id) as a from (select id from unnest($1::text[]) as id) c", [data.cases.map((c) => c.id)])).rows.map((r) => [r.id, r.a])));
      expect(got).toEqual(expected);
      for (const v of Object.values(expected)) levels.add(v);
    }
    // Nivån "team" ges inte längre till någon (beslut 2026-10-09): coach och handledare har "full" i hela avtalet.
    expect([...levels].sort()).toEqual(["billing", "customer", "full", "none", "restricted"]);
  }, 30_000); // nio testpersoner mot databasen – tar längre tid när hela testsviten körs parallellt
});

// ================================================================ Kommunens roller (0026)
describe("kommunen har bara rollen handläggare (0026)", () => {
  it("mm.customer_roles() är bara handläggare, testdatat har inga chefsmedlemskap och ett nytt stoppas av kontrollen", async () => {
    const r = await db.query<{ roles: string[]; chefs: number }>("select mm.customer_roles() as roles, (select count(*)::int from public.memberships where role = 'kommun_chef') as chefs");
    expect(r.rows[0]).toEqual({ roles: ["kommun_handlaggare"], chefs: 0 });
    // Inte ens service role (servern) kan lägga till rollen.
    const ins = await asUser(db, null, (tx) => attempt(tx, "insert into public.memberships (id, user_id, contract_id, role, customer_unit) values ('ms-x-chef', 'k-maria', 'c-bot', 'kommun_chef', null)"), { role: "service_role" });
    expect(ins).toMatchObject({ ok: false, code: "23514" });
  });

  it("beställarrapporten: en per avtal och månad, utan mottagare – och kommunen läser den inte", async () => {
    const summaries = data.reports.filter((r) => r.kind === "customer_summary");
    expect(summaries.length).toBeGreaterThan(0);
    const pg = (await db.query<{ n: number; recipients: number }>("select count(*)::int as n, count(recipient_user_id)::int as recipients from public.reports where kind = 'customer_summary'")).rows[0];
    expect(pg).toEqual({ n: summaries.length, recipients: 0 });
    // En andra beställarrapport för samma avtal och månad stoppas av det unika indexet (också för service role).
    const first = summaries.find((r) => !r.previousId)!;
    const dup = await asUser(db, null, (tx) => attempt(tx, insertSql("reports", { ...first, id: "rep-x-dubblett" } as unknown as Record<string, unknown>)), { role: "service_role" });
    expect(dup).toMatchObject({ ok: false, code: "23505" });
    for (const userId of ["k-maria", "k-ahmed", "k-linda", "k-omar"]) {
      const n = await asPersona(findPersona(userId), async (tx) => (await tx.query<{ n: number }>("select count(*)::int as n from public.reports where kind = 'customer_summary'")).rows[0].n);
      expect([userId, n]).toEqual([userId, 0]);
    }
  });

  it("prislistan läses bara av Miljonbemanning (synpunkt #11)", async () => {
    for (const userId of ["k-maria", "k-omar", "u-johan", "u-lars"]) {
      const p = findPersona(userId);
      const pg = await asPersona(p, async (tx) => (await tx.query<{ n: number }>("select count(*)::int as n from public.price_items")).rows[0].n);
      const mem = data.price_items.filter((x) => canReadRow("price_items", x, actorOf(p), raw)).length;
      expect([userId, pg]).toEqual([userId, mem]);
      expect([userId, pg > 0]).toEqual([userId, userId.startsWith("u-")]);
    }
  });
});

// ================================================================ Bilagor till beställningen (0024)
describe("bilagor till beställningen (0024): läsning och skrivning – samma regler i RLS och policy.ts", () => {
  const pgAtt = (userId: string) => asPersona(findPersona(userId), async (tx) => (await tx.query<{ id: string }>("select id from public.case_attachments order by id")).rows.map((r) => r.id));
  const memAtt = (userId: string) => data.case_attachments.filter((x) => canReadRow("case_attachments", x, actorOf(findPersona(userId)), raw)).map((x) => x.id).sort();

  it("läsning per testperson: den som laddade upp, samordnare, avtalsansvarig, namngiven huvudcoach och beställande handläggare", async () => {
    // Samma rader i RLS och policy.ts för varje testperson.
    for (const p of personas) expect(await pgAtt(p.actor.userId), personaKey(p)).toEqual(memAtt(p.actor.userId));
    // Det som reglerna säger, i klartext.
    expect(memAtt("k-maria")).toEqual(expect.arrayContaining(["att-x-maria", "att-x-utkast"]));
    expect(memAtt("k-omar")).toEqual(["att-x-skyddad"]);
    expect(memAtt("u-sara")).toEqual(expect.arrayContaining(["att-x-maria", "att-x-petra"]));
    expect(memAtt("u-johan")).toEqual(["att-x-maria", "att-x-petra", "att-x-skyddad"]);
    expect(memAtt(SKYDDAD_CASE.leadCoachId!)).toContain("att-x-skyddad");
    // Den vilande spärren: samordnaren ser inte bilagan i det skyddade ärendet; ingen ser utkastet utom uppladdaren eller en raderad fil.
    for (const p of personas) {
      const ids = memAtt(p.actor.userId);
      if (p.actor.userId !== "k-maria") expect(ids, p.actor.userId).not.toContain("att-x-utkast");
      expect(ids, p.actor.userId).not.toContain("att-x-borttagen");
      if (!["u-johan", "k-omar", SKYDDAD_CASE.leadCoachId].includes(p.actor.userId)) expect(ids, p.actor.userId).not.toContain("att-x-skyddad");
    }
    for (const userId of ["u-petra", "u-lars", "u-karin", "u-robin", "deltagare", "tester-karim", "k-ahmed"]) expect(memAtt(userId), userId).toEqual([]);
  }, 30_000);

  it("ingen inloggad användare skriver raderna – bara servern (service role)", async () => {
    const row = { ...data.case_attachments.find((a) => a.id === "att-x-maria")!, id: "att-x-ny", storagePath: "c-bot/att-x-ny.pdf" };
    for (const userId of ["k-maria", "u-sara", "u-johan", "u-robin"]) {
      const res = await asPersona(findPersona(userId), async (tx) => ({
        insert: await attempt(tx, insertSql("case_attachments", row as unknown as Record<string, unknown>)),
        update: await attempt(tx, "update public.case_attachments set status = 'deleted' where id = 'att-x-maria'"),
        remove: await attempt(tx, "delete from public.case_attachments where id = 'att-x-maria'"),
      }));
      expect([userId, allowed(res.insert), allowed(res.update), allowed(res.remove)]).toEqual([userId, false, false, false]);
      expect(canWriteRow("case_attachments", row, actorOf(findPersona(userId)), raw)).toBe(false);
    }
    const sys = await asUser(db, null, (tx) => attempt(tx, insertSql("case_attachments", row as unknown as Record<string, unknown>)), { role: "service_role" });
    expect(sys).toMatchObject({ ok: true, rows: 1 });
  });

  it("filtyper, storlek och sökväg: kontrollerna i tabellen stoppar fel värden", async () => {
    const base = { ...data.case_attachments.find((a) => a.id === "att-x-maria")! };
    const tryRow = (patch: Partial<Tables["case_attachments"]>) =>
      asUser(db, null, (tx) => attempt(tx, insertSql("case_attachments", { ...base, id: "att-x-k", storagePath: "c-bot/att-x-k.pdf", ...patch } as unknown as Record<string, unknown>)), { role: "service_role" });
    expect(await tryRow({ mimeType: "application/zip" })).toMatchObject({ ok: false, code: "23514" });
    expect(await tryRow({ bytes: 10 * 1024 * 1024 + 1 })).toMatchObject({ ok: false, code: "23514" });
    expect(await tryRow({ fileName: "" })).toMatchObject({ ok: false, code: "23514" });
    expect(await tryRow({ storagePath: base.storagePath })).toMatchObject({ ok: false, code: "23505" });
    expect(await tryRow({ caseId: null })).toMatchObject({ ok: false, code: "23514" }); // kopplad tid utan ärende
    expect(await tryRow({})).toMatchObject({ ok: true, rows: 1 });
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

  it("samordnare, chef, admin och ekonom ser nummer och status – inte var eller när personen träffas", async () => {
    const c = prot();
    for (const userId of ["u-sara", "u-karin", "u-robin", "u-lars"]) {
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

  it("omfattning och kartläggning (0025): ekonomen ser antalet månader men inte motiveringen eller kartläggningssvaret", async () => {
    const c = data.cases.find((x) => x.orderPeriodMonths != null && x.priorAssessment)!;
    expect(c).toBeTruthy();
    const before = async (tx: Tx) => {
      await tx.query("update public.cases set order_period_reason = 'Motivering till perioden', prior_assessment = 'no' where id = $1", [c.id]);
    };
    const read = (userId: string) =>
      asUser(db, authOf(userId), async (tx) => (await tx.query("select order_period_months, order_period_reason, prior_assessment from public.cases_public where id = $1", [c.id])).rows[0], { before });
    expect(await read("u-lars")).toEqual({ order_period_months: c.orderPeriodMonths, order_period_reason: null, prior_assessment: null });
    expect(await read("u-sara")).toEqual({ order_period_months: c.orderPeriodMonths, order_period_reason: "Motivering till perioden", prior_assessment: "no" });
    // Testdatat utan ändring: samma värden som i minnet.
    const plain = await asPersona(findPersona("u-sara"), async (tx) => (await tx.query("select order_period_months, prior_assessment from public.cases_public where id = $1", [c.id])).rows[0]);
    expect(plain).toEqual({ order_period_months: c.orderPeriodMonths, prior_assessment: c.priorAssessment });
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

  it("meddelanden: bara läskvittot ändras – aldrig text eller avsändare – och en annan handläggare ändrar inget", async () => {
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
    const omar = await asPersona(findPersona("k-omar"), async (tx) => ({
      body: await attempt(tx, "update public.messages set body = 'Ändrad av Omar' where id = $1", [fromMb.id]),
      read: await attempt(tx, "update public.messages set read_by = array_append(read_by, 'k-omar') where id = $1", [fromMb.id]),
    }));
    expect(allowed(omar.body)).toBe(false);
    expect(allowed(omar.read)).toBe(false);
    const coach = await asPersona(findPersona("u-amira"), (tx) => attempt(tx, "update public.messages set body = 'Ändrad' where id = $1", [fromMb.id]));
    expect(coach.ok).toBe(false);
    // Samma svar i minnesläget (policy.ts).
    expect(memWrite("messages", { ...fromMb, body: "Ändrad av kommunen", senderId: "u-sara" }, "k-maria")).toBe(false);
    expect(memWrite("messages", { ...fromMb, readBy: [...fromMb.readBy, "u-sara"] }, "k-maria")).toBe(false);
    expect(memWrite("messages", { ...fromMb, body: "Ändrad av Omar" }, "k-omar")).toBe(false);
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
  // En närvarorad per tillfälle (0022): kopian får ett tillfälle i samma ärende som ännu saknar närvaro.
  if (t === "attendance") {
    const taken = new Set(data.attendance.map((a) => a.activityId));
    c.activityId = (data.activities.find((a) => a.caseId === row.caseId && !taken.has(a.id)) ?? data.activities.find((a) => !taken.has(a.id)))?.id;
  }
  // Fakturan (0023): en periodisk faktura per avtal, månad och grupp; en rad per ärende och faktura; unik idempotensnyckel.
  if (t === "invoice_drafts") {
    c.groupingKey = `${row.groupingKey}-kopia`;
    if (row.fortnoxIdempotencyKey) c.fortnoxIdempotencyKey = `${row.fortnoxIdempotencyKey}:kopia`;
  }
  if (t === "invoice_lines") c.caseId = data.cases.find((x) => !data.invoice_lines.some((l) => l.invoiceDraftId === row.invoiceDraftId && l.caseId === x.id))?.id;
  if (t === "memberships") {
    const taken = new Set(data.memberships.map((m) => `${m.userId}|${m.contractId}|${m.role}`));
    c.userId = data.profiles.map((p) => p.id).find((u) => !taken.has(`${u}|${row.contractId}|${row.role}`));
  }
  // Grupper (0031): högst en aktiv nivå och ett värde per taggkategori per ärende, samma gruppering en gång – kopian får ett
  // ärende i samma avtal som saknar platsen och grupperingen (bara ett ärende som inte är skyddat, så att bara policyn avgör).
  if (t === "grouping_members") {
    const active = data.grouping_members.filter((m) => m.removedAt == null);
    const free = (caseId: string) => !active.some((m) => m.caseId === caseId && (m.groupingId === row.groupingId || (row.slot != null && m.slot === row.slot)));
    c.caseId = data.cases.find((x) => x.contractId === row.contractId && x.personId !== SKYDDAD_PERSON.id && free(x.id))?.id;
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

  it("kommunen kan inte uppdatera ärenden den inte beställt", async () => {
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
    const omar = await asPersona(findPersona("k-omar"), (tx) => attempt(tx, ...msg(ownCase().id, "k-omar")));
    expect(omar.ok).toBe(false);
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

  it("rollval (0027): valet styr rollen bara med medlemskap, testpersonens roll vinner, bara den egna raden – och admin tar bort medlemskap", async () => {
    const actorSql = "select public.current_actor() as a";
    type A = { userId: string; role: string; contractIds: string[] };
    const actor = async (tx: Tx) => (await tx.query<{ a: A }>(actorSql)).rows[0].a;
    const ALI = TESTER_AUTH["tester-ali"];
    // Ali har admin och avtalsansvarig; testdatats val (EXTRA) är avtalsansvarig. Karims val är admin (samma som lägst id).
    expect(await asUser(db, ALI, actor)).toMatchObject({ userId: "tester-ali", role: "avtalsansvarig", contractIds: ["c-bot"] });
    expect(await asUser(db, KARIM, actor)).toMatchObject({ userId: "tester-karim", role: "admin" });
    // Utan rad: medlemskapet med lägst id ("tester-ali:c-bot" = admin).
    expect(await asUser(db, ALI, actor, { before: (tx) => tx.query("delete from public.role_choices where id = 'tester-ali'").then(() => undefined) })).toMatchObject({ role: "admin" });
    // Ett val utan medlemskap ignoreras (raden kan bara få en sådan roll med service role – RLS stoppar inloggade).
    expect(await asUser(db, ALI, actor, { before: (tx) => tx.query("update public.role_choices set role = 'coach' where id = 'tester-ali'").then(() => undefined) })).toMatchObject({ role: "admin" });
    // Testpersonens roll (tester_sessions, Ali som testare i testmiljön) vinner över valet.
    const aliChooses = (tx: Tx) => tx.query("insert into public.tester_sessions (auth_user_id, profile_id, role) values ($1, 'u-amira', 'coach')", [ALI]).then(() => undefined);
    expect(await asUser(db, ALI, actor, { before: aliChooses })).toMatchObject({ userId: "u-amira", role: "coach" });

    // RLS: bara den egna raden, id = user_id, bara en roll man har medlemskap för. Amira (en roll) väljer sin roll; aldrig någon annans.
    const amira = await asPersona(findPersona("u-amira"), async (tx) => ({
      own: await attempt(tx, "insert into public.role_choices (id, user_id, role, chosen_at) values ('u-amira', 'u-amira', 'coach', '2027-02-01T09:00')", [], { keep: true }),
      rows: (await tx.query("select id from public.role_choices")).rows.length,
      update: await attempt(tx, "update public.role_choices set role = 'chef' where id = 'u-amira'"),
      other: await attempt(tx, "update public.role_choices set role = 'coach' where id = 'u-sara'"),
      forOther: await attempt(tx, "insert into public.role_choices (id, user_id, role, chosen_at) values ('u-erik', 'u-erik', 'coach', '2027-02-01T09:00')"),
      wrongId: await attempt(tx, "insert into public.role_choices (id, user_id, role, chosen_at) values ('x', 'u-amira', 'coach', '2027-02-01T09:00')"),
      del: await attempt(tx, "delete from public.role_choices where id = 'u-amira'"),
    }));
    expect(allowed(amira.own)).toBe(true);
    expect(amira.rows).toBe(1); // bara den egna – inte Karims, Saras eller Alis
    expect(allowed(amira.update)).toBe(false);
    expect(allowed(amira.other)).toBe(false);
    expect(allowed(amira.forOther)).toBe(false);
    expect(allowed(amira.wrongId)).toBe(false);
    expect(allowed(amira.del)).toBe(true);
    // Ali byter till admin via RLS (eget val) – och får rollen i samma transaktion.
    const ali = await asUser(db, ALI, async (tx) => ({
      upd: await attempt(tx, "update public.role_choices set role = 'admin', chosen_at = '2027-02-01T09:30' where id = 'tester-ali'", [], { keep: true }),
      actor: await actor(tx),
    }));
    expect(allowed(ali.upd)).toBe(true);
    expect(ali.actor).toMatchObject({ role: "admin" });

    // Ändra roller (admin.setStaffRoles): admin tar bort medlemskap; avtalsansvarig bara kommunens; samordnaren inget.
    const petraMembership = data.memberships.find((m) => m.userId === "u-petra")!.id;
    const mariaMembership = data.memberships.find((m) => m.userId === "k-maria")!.id;
    const robin = await asPersona(findPersona("u-robin"), async (tx) => ({
      staff: await attempt(tx, "delete from public.memberships where id = $1", [petraMembership]),
      customer: await attempt(tx, "delete from public.memberships where id = $1", [mariaMembership]),
    }));
    expect(allowed(robin.staff)).toBe(true);
    expect(allowed(robin.customer)).toBe(true);
    const johan = await asPersona(findPersona("u-johan"), async (tx) => ({
      staff: await attempt(tx, "delete from public.memberships where id = $1", [petraMembership]),
      customer: await attempt(tx, "delete from public.memberships where id = $1", [mariaMembership]),
    }));
    expect(allowed(johan.staff)).toBe(false);
    expect(allowed(johan.customer)).toBe(true);
    expect(allowed(await asPersona(findPersona("u-sara"), (tx) => attempt(tx, "delete from public.memberships where id = $1", [mariaMembership])))).toBe(false);
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

  it("läsning per roll: coach och handledare alla anteckningar i avtalet (beslut 2026-10-09), ekonom och kommunen inget, skyddat ärende bara namngivna", async () => {
    const open = data.case_notes.filter((n) => n.caseId !== SKYDDAD).map((n) => n.id).sort();
    expect(open).toEqual(["note-mehmet-handledare", "note-nadia-borttagen", "note-nadia-kommun", "note-nadia-praktiskt", "note-nadia-samtal"]);
    const expected: Record<string, string[]> = {
      // Amira är huvudcoach för Nadia och Mehmet; Petra (handledare) och Leila (coach utanför teamet) läser samma anteckningar –
      // men inte det skyddade ärendets (vilande spärr: bara namngiven huvudcoach Erik och avtalsansvarig).
      "u-amira": open, "u-petra": open, "u-leila": open,
      "u-lars": [], "k-maria": [], "k-omar": [],
      "u-erik": [...data.case_notes.map((n) => n.id)].sort(),
      "u-johan": [...data.case_notes.map((n) => n.id)].sort(),
      "u-sara": open, "u-karin": open, "u-robin": open,
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
    for (const userId of ["k-maria", "k-ahmed", "k-omar"]) {
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

  it("ny anteckning: tillåten i eget namn (handledaren också 'full' sedan 2026-10-09) – nekas för annan författare, fel avtal och borttagen/ändrad vid start", async () => {
    const cases: [string, string, Tables["case_notes"], boolean][] = [
      ["u-amira", insertNote("n-t1", NADIA, "c-bot", "u-amira", "full"), newRow("n-t1", NADIA, "c-bot", "u-amira", "full"), true],
      ["u-petra", insertNote("n-t2", NADIA, "c-bot", "u-petra", "team"), newRow("n-t2", NADIA, "c-bot", "u-petra", "team"), true],
      ["u-petra", insertNote("n-t3", NADIA, "c-bot", "u-petra", "full"), newRow("n-t3", NADIA, "c-bot", "u-petra", "full"), true],
      ["u-amira", insertNote("n-t4", NADIA, "c-bot", "u-sara", "full"), newRow("n-t4", NADIA, "c-bot", "u-sara", "full"), false],
      ["u-amira", insertNote("n-t5", NADIA, "c-ny", "u-amira", "full"), newRow("n-t5", NADIA, "c-ny", "u-amira", "full"), false],
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
      ["u-amira", "update public.case_notes set contract_id = 'c-ny' where id = 'note-nadia-samtal'", { ...samtal, contractId: "c-ny" }, false],
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
      const draft = (await tx.query<{ c: unknown }>("select config -> 'progression' as c from public.contracts where id = 'c-ny'")).rows[0].c;
      return { after, again, draft };
    }, { role: "service_role" });
    expect(res.after).toMatchObject({ clearFromLevel: 2, anyFromLevel: 1 });
    expect(res.again).toEqual(res.after);
    expect(res.draft).toBeNull();
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

  it("läsning per testperson: byggrollerna egna och delade inom Miljonbemanning (också arkiverade) – aldrig kommunen", async () => {
    const bot = (ids: string[]) => ids.sort();
    const expected: Record<string, string[]> = {
      "u-sara": bot(["sr-seed-privat", "sr-seed-mb", "sr-seed-kommun", "sr-x-arkiv", "sr-x-sara-mb"]),
      "u-karin": bot(["sr-seed-mb", "sr-seed-kommun", "sr-x-arkiv", "sr-x-sara-mb"]),
      "u-johan": bot(["sr-seed-mb", "sr-seed-kommun", "sr-x-arkiv", "sr-x-sara-mb", "sr-x-ny"]),
      "u-robin": [], "u-amira": [], "u-petra": [], "u-lars": [], "k-maria": [], "k-omar": [], "tester-karim": [],
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

  it("ny rad: i eget namn – ingen delar med kommunen (0026), delningen i eget namn, ingen ändrad eller arkiverad", async () => {
    const cases: [string, Tables["saved_reports"], boolean][] = [
      ["u-sara", row("n-1", "u-sara", "private", null), true],
      ["u-karin", row("n-2", "u-karin", "mb", "u-karin"), true],
      ["u-johan", row("n-3", "u-johan", "customer" as never, "u-johan"), false],
      ["u-sara", row("n-4", "u-sara", "customer" as never, "u-sara"), false],
      ["u-karin", row("n-5", "u-karin", "customer" as never, "u-karin"), false],
      ["u-sara", row("n-6", "u-karin", "private", null), false],
      ["u-sara", row("n-7", "u-sara", "mb", "u-karin"), false],
      ["u-sara", row("n-8", "u-sara", "private", "u-sara"), false],
      ["u-sara", row("n-9", "u-sara", "private", null, { archivedAt: at, archivedBy: "u-sara" }), false],
      ["u-sara", row("n-10", "u-sara", "private", null, { updatedAt: at, updatedBy: "u-sara" }), false],
      ["u-sara", row("n-11", "u-sara", "private", null, { templateKey: "Anna Andersson" }), false],
      ["u-johan", row("n-12", "u-johan", "customer" as never, "u-johan", { contractId: "c-ny" }), false],
      ["u-robin", row("n-13", "u-robin", "private", null), false],
      ["u-amira", row("n-14", "u-amira", "private", null), false],
      ["u-lars", row("n-15", "u-lars", "private", null), false],
      ["k-maria", row("n-16", "k-maria", "private", null), false],
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
    const saras = sr("sr-x-sara-mb");
    const arkiv = sr("sr-x-arkiv");
    const upd = (id: string, set: string) => `update public.saved_reports set ${set} where id = '${id}'`;
    const cases: [string, string, Tables["saved_reports"], boolean][] = [
      ["u-sara", upd(privat.id, "owner_id = 'u-karin'"), { ...privat, ownerId: "u-karin" }, false],
      ["u-sara", upd(privat.id, "contract_id = 'c-ny'"), { ...privat, contractId: "c-ny" }, false],
      ["u-sara", upd(privat.id, `created_at = '${at}'`), { ...privat, createdAt: at }, false],
      ["u-sara", upd(privat.id, `visibility = 'mb', shared_at = '${at}', shared_by = 'u-karin'`), { ...privat, visibility: "mb", sharedAt: at, sharedBy: "u-karin" }, false],
      ["u-sara", upd(privat.id, "visibility = 'mb'"), { ...privat, visibility: "mb" }, false],
      ["u-johan", upd(mb.id, "visibility = 'customer'"), { ...mb, visibility: "customer" as never }, false],
      ["u-karin", upd(mb.id, `shared_at = '${at}'`), { ...mb, sharedAt: at }, false],
      ["u-sara", upd(privat.id, "title = title"), privat, false],
      ["u-sara", upd(privat.id, "template_key = 'Anna Andersson'"), { ...privat, templateKey: "Anna Andersson" }, false],
      ["u-johan", upd(saras.id, `title = 'Ändrad', updated_at = '${at}', updated_by = 'u-johan'`), { ...saras, title: "Ändrad", updatedAt: at, updatedBy: "u-johan" }, false],
      // Delningen med kommunen är borttagen (0026) – inte heller avtalsansvarig i eget namn.
      ["u-johan", upd(mb.id, `visibility = 'customer', shared_at = '${at}', shared_by = 'u-johan'`), { ...mb, visibility: "customer" as never, sharedAt: at, sharedBy: "u-johan" }, false],
      ["u-sara", upd(saras.id, `visibility = 'customer', shared_at = '${at}', shared_by = 'u-sara'`), { ...saras, visibility: "customer" as never, sharedAt: at, sharedBy: "u-sara" }, false],
      ["u-johan", upd(mb.id, `title = 'Ändrad', updated_at = '${at}', updated_by = 'u-johan'`), { ...mb, title: "Ändrad", updatedAt: at, updatedBy: "u-johan" }, false],
      ["u-johan", upd(mb.id, `visibility = 'private', shared_at = '${at}', shared_by = 'u-johan'`), { ...mb, visibility: "private", sharedAt: at, sharedBy: "u-johan" }, false],
      ["u-karin", upd(arkiv.id, `title = 'Ändrad', updated_at = '${at}', updated_by = 'u-karin'`), { ...arkiv, title: "Ändrad", updatedAt: at, updatedBy: "u-karin" }, false],
      ["u-karin", upd(mb.id, `updated_at = '${at}', updated_by = 'u-sara', title = 'X ändrad'`), { ...mb, updatedAt: at, updatedBy: "u-sara", title: "X ändrad" }, false],
      ["u-karin", `delete from public.saved_reports where id = '${mb.id}'`, mb, false],
      // Tillåtna: ägaren ändrar sin egen (också den som avtalsansvarig delade), avtalsansvarig arkiverar.
      ["u-sara", upd(privat.id, `title = 'Ändrad', updated_at = '${at}', updated_by = 'u-sara'`), { ...privat, title: "Ändrad", updatedAt: at, updatedBy: "u-sara" }, true],
      ["u-sara", upd(saras.id, `title = 'Ändrad', updated_at = '${at}', updated_by = 'u-sara'`), { ...saras, title: "Ändrad", updatedAt: at, updatedBy: "u-sara" }, true],
      ["u-johan", upd(mb.id, `archived_at = '${at}', archived_by = 'u-johan'`), { ...mb, archivedAt: at, archivedBy: "u-johan" }, true],
      ["u-johan", upd(saras.id, `archived_at = '${at}', archived_by = 'u-johan'`), { ...saras, archivedAt: at, archivedBy: "u-johan" }, true],
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

  it("kontrollen tillåter bara private och mb – inte ens servern sparar en rapport delad med kommunen (0026)", async () => {
    const r = row("n-kommun", "u-johan", "customer" as never, "u-johan");
    const res = await asUser(db, null, (tx) => attempt(tx, insert(r)), { role: "service_role" });
    expect(res).toMatchObject({ ok: false, code: "23514" });
  });
});

// ================================================================ Grupper, nivåer och taggar (0031)
describe("grupper, nivåer och taggar (0031): läsning och skrivning – samma regler i RLS, triggrarna och policy.ts", () => {
  const NADIA = "case-260143";
  const AMAL = "case-270012";
  const SKYDDAD = SKYDDAD_CASE.id;
  const at = "2027-02-01T09:30";
  const sorted = (xs: string[]) => [...xs].sort();
  const pgIdsOf = (userId: string, t: "groupings" | "grouping_members") =>
    asPersona(findPersona(userId), async (tx) => (await tx.query<{ id: string }>(`select id from public.${t} order by id`)).rows.map((r) => r.id));
  const memIdsOf = (userId: string, t: "groupings" | "grouping_members") =>
    sorted((data[t] as Tables[typeof t][]).filter((x) => canReadRow(t, x as never, actorOf(findPersona(userId)), raw)).map((x) => x.id));

  it("testdatat: standardvärdena (fem nivåer, Vill arbeta), tre grupper varav en arkiverad, och medlemskap i det skyddade ärendet", () => {
    const bot = data.groupings.filter((g) => g.contractId === "c-bot");
    expect(bot.filter((g) => g.kind === "level").map((g) => g.name)).toEqual([
      "Nivå 1 – Långt från arbete", "Nivå 2 – Behöver stöd för att komma igång", "Nivå 3 – På väg", "Nivå 4 – Nära arbete", "Nivå 5 – Redo för arbete",
    ]);
    expect(bot.filter((g) => g.kind === "tag").map((g) => `${g.category}: ${g.name}`)).toEqual(["Vill arbeta: Heltid", "Vill arbeta: Deltid", "Vill arbeta: Vet inte än"]);
    expect(bot.filter((g) => g.kind === "group").map((g) => [g.name, !!g.archivedAt])).toEqual([["Måndagsgruppen", false], ["Lager och logistik", false], ["Höstgruppen 2026", true]]);
    expect(data.grouping_members.some((m) => m.caseId === SKYDDAD && m.removedAt == null)).toBe(true);
    expect(data.grouping_members.some((m) => m.removedAt != null)).toBe(true);
  });

  it("läsning per roll: MB utom ekonomen läser grupperingarna och medlemskapen – kommunen, ekonomen och deltagaren inget; skyddat ärende bara namngivna", async () => {
    const botGroupings = sorted(data.groupings.filter((g) => g.contractId === "c-bot").map((g) => g.id));
    const allGroupings = sorted(data.groupings.map((g) => g.id));
    const open = sorted(data.grouping_members.filter((m) => m.caseId !== SKYDDAD).map((m) => m.id));
    const all = sorted(data.grouping_members.map((m) => m.id));
    const expected: Record<string, [string[], string[]]> = {
      "u-sara": [botGroupings, open], "u-amira": [botGroupings, open], "u-petra": [botGroupings, open], "u-karin": [botGroupings, open],
      // Admin: alla avtal (också c-ny) – men det skyddade ärendet bara som ärende (vilande spärr).
      "u-robin": [allGroupings, open],
      // Avtalsansvarig Johan är medlem i c-ny och ser det skyddade ärendet; Erik är namngiven huvudcoach i det.
      "u-johan": [allGroupings, all], "u-erik": [botGroupings, all],
      "u-lars": [[], []], "k-maria": [[], []], "k-omar": [[], []], deltagare: [[], []],
    };
    for (const [userId, [g, m]] of Object.entries(expected)) {
      expect([userId, await pgIdsOf(userId, "groupings")]).toEqual([userId, g]);
      expect([userId, memIdsOf(userId, "groupings")]).toEqual([userId, g]);
      expect([userId, await pgIdsOf(userId, "grouping_members")]).toEqual([userId, m]);
      expect([userId, memIdsOf(userId, "grouping_members")]).toEqual([userId, m]);
    }
  }, 60_000);

  /** Kör satsen som personen i Postgres och samma rad i policy.ts – svaren ska vara lika. */
  async function both<T extends "groupings" | "grouping_members">(t: T, userId: string, sql: string, row: Tables[T]) {
    const p = findPersona(userId);
    const cur = raw.get(t, row.id);
    const mem = (cur ? canReadRow(t, cur, actorOf(p), raw) : true) && canWriteRow(t, row, actorOf(p), raw);
    const pg = await asPersona(p, (tx) => attempt(tx, sql));
    return { pg: allowed(pg), mem };
  }
  const level = (n: number) => `grp-c-bot-niva-${n}`;
  const member = (id: string, caseId: string, groupingId: string, addedBy: string, patch: Partial<Tables["grouping_members"]> = {}): Tables["grouping_members"] => {
    const g = raw.get("groupings", groupingId)!;
    return {
      id, contractId: "c-bot", caseId, groupingId, kind: g.kind, slot: g.kind === "level" ? "level" : g.kind === "tag" ? `tag:${g.category}` : null, addedAt: at, addedBy,
      removedAt: null, removedBy: null, ...patch,
    };
  };
  const insertMember = (r: Tables["grouping_members"]) => insertSql("grouping_members", r as unknown as Record<string, unknown>);

  it("nytt medlemskap: samordnare, avtalsansvarig, coach och admin med full åtkomst i eget namn – aldrig handledare, chef, ekonom eller kommunen", async () => {
    const cases: [string, Tables["grouping_members"], boolean][] = [
      ["u-amira", member("gm-t1", AMAL, level(3), "u-amira"), true],
      ["u-sara", member("gm-t2", AMAL, level(3), "u-sara"), true],
      ["u-johan", member("gm-t3", AMAL, level(3), "u-johan"), true],
      ["u-robin", member("gm-t4", AMAL, level(3), "u-robin"), true],
      ["u-petra", member("gm-t5", AMAL, level(3), "u-petra"), false],
      ["u-karin", member("gm-t6", AMAL, level(3), "u-karin"), false],
      ["u-lars", member("gm-t7", AMAL, level(3), "u-lars"), false],
      ["k-maria", member("gm-t8", AMAL, level(3), "k-maria"), false],
      // I någon annans namn, redan borttaget, fel plats, fel avtal, arkiverad grupp.
      ["u-amira", member("gm-t9", AMAL, level(3), "u-sara"), false],
      ["u-amira", member("gm-t10", AMAL, level(3), "u-amira", { removedAt: at, removedBy: "u-amira" }), false],
      ["u-amira", member("gm-t11", AMAL, level(3), "u-amira", { slot: null }), false],
      ["u-amira", member("gm-t12", AMAL, level(3), "u-amira", { kind: "group", slot: null }), false],
      ["u-amira", member("gm-t13", AMAL, "grp-x-ny", "u-amira"), false],
      ["u-johan", member("gm-t14", AMAL, "grp-x-ny", "u-johan"), false],
      ["u-amira", member("gm-t15", AMAL, "grp-c-bot-g-host", "u-amira"), false],
      ["u-amira", member("gm-t16", AMAL, "grp-c-bot-g-mandag", "u-amira"), true],
      ["u-amira", member("gm-t17", AMAL, "grp-c-bot-vill-arbeta-deltid", "u-amira"), true],
      // Det skyddade ärendet (vilande spärr): samordnaren har bara "restricted"; namngiven huvudcoach och avtalsansvarig får.
      ["u-sara", member("gm-t18", SKYDDAD, "grp-c-bot-vill-arbeta-heltid", "u-sara"), false],
      ["u-erik", member("gm-t19", SKYDDAD, "grp-c-bot-vill-arbeta-heltid", "u-erik"), true],
      ["u-johan", member("gm-t20", SKYDDAD, "grp-c-bot-vill-arbeta-heltid", "u-johan"), true],
    ];
    for (const [userId, r, want] of cases) expect([userId, r.id, await both("grouping_members", userId, insertMember(r), r)]).toEqual([userId, r.id, { pg: want, mem: want }]);
  }, 60_000);

  it("ändra medlemskap: bara ta bort ett aktivt, i eget namn – inget annat ändras, inget återställs och ingen raderar", async () => {
    const nadiaGroup = data.grouping_members.find((m) => m.caseId === NADIA && m.kind === "group" && m.removedAt == null)!;
    const removed = data.grouping_members.find((m) => m.removedAt != null)!;
    const upd = (id: string, set: string) => `update public.grouping_members set ${set} where id = '${id}'`;
    const cases: [string, string, Tables["grouping_members"], boolean][] = [
      ["u-amira", upd(nadiaGroup.id, `removed_at = '${at}', removed_by = 'u-amira'`), { ...nadiaGroup, removedAt: at, removedBy: "u-amira" }, true],
      ["u-sara", upd(nadiaGroup.id, `removed_at = '${at}', removed_by = 'u-sara'`), { ...nadiaGroup, removedAt: at, removedBy: "u-sara" }, true],
      ["u-amira", upd(nadiaGroup.id, `removed_at = '${at}', removed_by = 'u-sara'`), { ...nadiaGroup, removedAt: at, removedBy: "u-sara" }, false],
      ["u-amira", upd(nadiaGroup.id, "grouping_id = 'grp-c-bot-g-mandag'"), { ...nadiaGroup, groupingId: "grp-c-bot-g-mandag" }, false],
      ["u-amira", upd(nadiaGroup.id, `added_by = 'u-sara'`), { ...nadiaGroup, addedBy: "u-sara" }, false],
      ["u-amira", upd(nadiaGroup.id, "id = id"), nadiaGroup, false],
      ["u-petra", upd(nadiaGroup.id, `removed_at = '${at}', removed_by = 'u-petra'`), { ...nadiaGroup, removedAt: at, removedBy: "u-petra" }, false],
      ["u-karin", upd(nadiaGroup.id, `removed_at = '${at}', removed_by = 'u-karin'`), { ...nadiaGroup, removedAt: at, removedBy: "u-karin" }, false],
      ["u-sara", upd(removed.id, "removed_at = null, removed_by = null"), { ...removed, removedAt: null, removedBy: null }, false],
      ["u-sara", `delete from public.grouping_members where id = '${nadiaGroup.id}'`, nadiaGroup, false],
    ];
    for (const [userId, sql, r, want] of cases) expect([userId, sql, await both("grouping_members", userId, sql, r)]).toEqual([userId, sql, { pg: want, mem: want }]);
  }, 60_000);

  it("en nivå och ett värde per taggkategori per ärende – databasens unika index och minnets UNIQUE_KEYS stoppar en andra (också för servern)", async () => {
    const nadiaLevel = data.grouping_members.find((m) => m.caseId === NADIA && m.kind === "level" && m.removedAt == null)!;
    const nadiaTag = data.grouping_members.find((m) => m.caseId === NADIA && m.kind === "tag" && m.removedAt == null)!;
    const second = [
      member("gm-u1", NADIA, level(nadiaLevel.groupingId === level(2) ? 3 : 2), "u-amira"),
      member("gm-u2", NADIA, nadiaTag.groupingId === "grp-c-bot-vill-arbeta-deltid" ? "grp-c-bot-vill-arbeta-heltid" : "grp-c-bot-vill-arbeta-deltid", "u-amira"),
      member("gm-u3", NADIA, nadiaLevel.groupingId, "u-amira"),
    ];
    for (const r of second) {
      const pg = await asUser(db, null, (tx) => attempt(tx, insertMember(r)), { role: "service_role" });
      expect([r.id, pg]).toMatchObject([r.id, { ok: false, code: "23505" }]);
      const st = new MemoryStore<Tables>(JSON.parse(JSON.stringify(data)) as typeof data, UNIQUE_KEYS);
      expect(() => st.insertRow("grouping_members", r), r.id).toThrow(UniqueError);
    }
    // När den gamla nivån är borttagen går en ny bra – i samma transaktion i databasen och i minnet.
    const replace = member("gm-u4", NADIA, level(nadiaLevel.groupingId === level(2) ? 3 : 2), "u-amira");
    const pg = await asPersona(findPersona("u-amira"), async (tx) => ({
      remove: await attempt(tx, `update public.grouping_members set removed_at = '${at}', removed_by = 'u-amira' where id = '${nadiaLevel.id}'`, [], { keep: true }),
      add: await attempt(tx, insertMember(replace)),
    }));
    expect(pg).toEqual({ remove: { ok: true, rows: 1 }, add: { ok: true, rows: 1 } });
    const st = new MemoryStore<Tables>(JSON.parse(JSON.stringify(data)) as typeof data, UNIQUE_KEYS);
    st.updateRow("grouping_members", nadiaLevel.id, { removedAt: at, removedBy: "u-amira" });
    expect(() => st.insertRow("grouping_members", replace)).not.toThrow();
  }, 60_000);

  const grouping = (id: string, createdBy: string, patch: Partial<Tables["groupings"]> = {}): Tables["groupings"] => ({
    id, contractId: "c-bot", kind: "group", category: null, name: "Tisdagsgruppen", description: "", sortOrder: 9, createdAt: at, createdBy,
    updatedAt: null, updatedBy: null, archivedAt: null, archivedBy: null, ...patch,
  });
  const insertGrouping = (r: Tables["groupings"]) => insertSql("groupings", r as unknown as Record<string, unknown>);

  it("ny gruppering: skrivrollerna i eget namn – inte handledare, chef, ekonom eller kommunen; varken ändrad, arkiverad eller med fel form", async () => {
    const cases: [string, Tables["groupings"], boolean][] = [
      ["u-amira", grouping("g-t1", "u-amira"), true],
      ["u-sara", grouping("g-t2", "u-sara"), true],
      ["u-johan", grouping("g-t3", "u-johan"), true],
      ["u-robin", grouping("g-t4", "u-robin"), true],
      ["u-petra", grouping("g-t5", "u-petra"), false],
      ["u-karin", grouping("g-t6", "u-karin"), false],
      ["u-lars", grouping("g-t7", "u-lars"), false],
      ["k-maria", grouping("g-t8", "k-maria"), false],
      ["u-amira", grouping("g-t9", "u-sara"), false],
      ["u-amira", grouping("g-t10", "u-amira", { archivedAt: at, archivedBy: "u-amira" }), false],
      ["u-amira", grouping("g-t11", "u-amira", { updatedAt: at, updatedBy: "u-amira" }), false],
      ["u-amira", grouping("g-t12", "u-amira", { kind: "tag" }), false],
      ["u-amira", grouping("g-t13", "u-amira", { kind: "tag", category: "Körkort" }), true],
      ["u-amira", grouping("g-t14", "u-amira", { category: "Körkort" }), false],
      ["u-amira", grouping("g-t15", "u-amira", { name: "x".repeat(81) }), false],
      ["u-amira", grouping("g-t16", "u-amira", { name: "  " }), false],
      ["u-amira", grouping("g-t17", "u-amira", { contractId: "c-ny" }), false],
      ["u-johan", grouping("g-t18", "u-johan", { contractId: "c-ny" }), true],
    ];
    for (const [userId, r, want] of cases) expect([userId, r.id, await both("groupings", userId, insertGrouping(r), r)]).toEqual([userId, r.id, { pg: want, mem: want }]);
  }, 60_000);

  it("ändra gruppering: namn och beskrivning, arkivera och återställ i eget namn – avtal, typ, kategori och skapad ändras aldrig, ingen raderar", async () => {
    const mandag = raw.get("groupings", "grp-c-bot-g-mandag")!;
    const host = raw.get("groupings", "grp-c-bot-g-host")!;
    const heltid = raw.get("groupings", "grp-c-bot-vill-arbeta-heltid")!;
    const upd = (id: string, set: string) => `update public.groupings set ${set} where id = '${id}'`;
    const cases: [string, string, Tables["groupings"], boolean][] = [
      ["u-sara", upd(mandag.id, `name = 'Måndagar', updated_at = '${at}', updated_by = 'u-sara'`), { ...mandag, name: "Måndagar", updatedAt: at, updatedBy: "u-sara" }, true],
      ["u-sara", upd(mandag.id, `name = 'Måndagar', updated_at = '${at}', updated_by = 'u-amira'`), { ...mandag, name: "Måndagar", updatedAt: at, updatedBy: "u-amira" }, false],
      ["u-amira", upd(mandag.id, `archived_at = '${at}', archived_by = 'u-amira'`), { ...mandag, archivedAt: at, archivedBy: "u-amira" }, true],
      ["u-amira", upd(mandag.id, `archived_at = '${at}', archived_by = 'u-sara'`), { ...mandag, archivedAt: at, archivedBy: "u-sara" }, false],
      ["u-sara", upd(host.id, "archived_at = null, archived_by = null"), { ...host, archivedAt: null, archivedBy: null }, true],
      ["u-sara", upd(mandag.id, "kind = 'level'"), { ...mandag, kind: "level" }, false],
      ["u-sara", upd(heltid.id, "category = 'Annan'"), { ...heltid, category: "Annan" }, false],
      ["u-sara", upd(mandag.id, "contract_id = 'c-ny'"), { ...mandag, contractId: "c-ny" }, false],
      ["u-sara", upd(mandag.id, `created_by = 'u-sara'`), { ...mandag, createdBy: "u-sara" }, false],
      ["u-sara", upd(mandag.id, "name = name"), mandag, false],
      ["u-petra", upd(mandag.id, `name = 'X', updated_at = '${at}', updated_by = 'u-petra'`), { ...mandag, name: "X", updatedAt: at, updatedBy: "u-petra" }, false],
      ["u-lars", upd(mandag.id, `name = 'X', updated_at = '${at}', updated_by = 'u-lars'`), { ...mandag, name: "X", updatedAt: at, updatedBy: "u-lars" }, false],
      ["u-sara", `delete from public.groupings where id = '${mandag.id}'`, mandag, false],
    ];
    for (const [userId, sql, r, want] of cases) expect([userId, sql, await both("groupings", userId, sql, r)]).toEqual([userId, sql, { pg: want, mem: want }]);
  }, 60_000);

  it("migrationen lägger in standardvärdena för befintliga avtal med samma id som testdatat – och kan köras igen", async () => {
    const sqlText = readFileSync(`${MIGRATIONS_DIR}/0031_grupper.sql`, "utf8");
    // Som postgres (migrationen skapar tabeller och funktioner) i en transaktion som rullas tillbaka.
    type G = { id: string; contract_id: string; kind: string; category: string | null; name: string; sort_order: number };
    let got: G[] = [];
    await db.transaction(async (tx) => {
      await tx.query("delete from public.grouping_members");
      await tx.query("delete from public.groupings");
      await tx.exec(sqlText);
      await tx.exec(sqlText);
      got = (await tx.query<G>("select id, contract_id, kind, category, name, sort_order from public.groupings order by contract_id, kind, sort_order")).rows;
      await tx.rollback();
    });
    const want = (contractId: string) => defaultGroupings(contractId, at).map((g) => ({ id: g.id, contract_id: contractId, kind: g.kind, category: g.category, name: g.name, sort_order: g.sortOrder }));
    const expected = ["c-bot", "c-ny"].flatMap(want).sort((a, b) => (a.contract_id + a.kind + a.sort_order < b.contract_id + b.kind + b.sort_order ? -1 : 1));
    expect(got).toEqual(expected);
  }, 60_000);
});

// ================================================================ Pulslänken (0016)
describe("fakturan per avtal och månad (0023): frysta rader – samma regler i RLS och policy.ts", () => {
  const lars = () => findPersona("u-lars");
  const open = () => data.invoice_drafts.find((d) => d.id === "inv-c-bot-2027-01-avtal")!;
  const paid = () => data.invoice_drafts.find((d) => d.month === "2026-11")!;
  const caseWithout = (draftId: string) => data.cases.find((c) => c.startDate && !data.invoice_lines.some((l) => l.invoiceDraftId === draftId && l.caseId === c.id))!;
  const line = (draftId: string, caseId: string): Tables["invoice_lines"] => ({
    id: `${draftId}:${caseId}`, invoiceDraftId: draftId, caseId, priceItemId: "pi-G", quantity: 1, unitPriceOre: 139800, vatRate: 25, description: "BOT-26-0001 · v. 1 2027",
    isoWeeks: ["2027-W01"], zeroAttendanceWeeks: [], note: "",
  });

  it("testdatat: en faktura per avtal och månad, tilläggsfakturan i december och frysta rader; körningen har ingen standardstatus längre", async () => {
    const r = await db.query<{ month: string; grouping_key: string; status: string; case_id: string | null }>(
      "select month, grouping_key, status, case_id from public.invoice_drafts where id like 'inv-c-bot-2026%' order by month, grouping_key",
    );
    expect(r.rows).toEqual([
      { month: "2026-09", grouping_key: "avtal", status: "paid", case_id: null }, { month: "2026-10", grouping_key: "avtal", status: "paid", case_id: null },
      { month: "2026-11", grouping_key: "avtal", status: "paid", case_id: null }, { month: "2026-12", grouping_key: "avtal", status: "sent", case_id: null },
      { month: "2026-12", grouping_key: "avtal-tillagg-2", status: "returned", case_id: null },
    ]);
    const cols = await db.query<{ column_name: string }>("select column_name from information_schema.columns where table_name = 'billing_runs'");
    expect(cols.rows.map((c) => c.column_name)).not.toContain("default_invoice_status");
    const n = await db.query<{ n: number }>("select count(*)::int as n from public.invoice_lines");
    expect(n.rows[0].n).toBe(data.invoice_lines.length);
  });

  it("ekonomen lägger till och ändrar rader bara medan fakturan är underlag eller godkänd – aldrig på en skapad faktura", async () => {
    const onOpen = line(open().id, caseWithout(open().id).id);
    const onPaid = line(paid().id, caseWithout(paid().id).id);
    const frozenRow = data.invoice_lines.find((l) => l.invoiceDraftId === paid().id)!;
    const openRow = data.invoice_lines.find((l) => l.invoiceDraftId === open().id)!;
    const actor = actorOf(lars());
    const expected = {
      insertOpen: canWriteRow("invoice_lines", onOpen, actor, raw), insertPaid: canWriteRow("invoice_lines", onPaid, actor, raw),
      updateOpen: canWriteRow("invoice_lines", openRow, actor, raw), updatePaid: canWriteRow("invoice_lines", frozenRow, actor, raw),
    };
    expect(expected).toEqual({ insertOpen: true, insertPaid: false, updateOpen: true, updatePaid: false });
    const got = await asPersona(lars(), async (tx) => ({
      insertOpen: allowed(await attempt(tx, insertSql("invoice_lines", onOpen))),
      insertPaid: allowed(await attempt(tx, insertSql("invoice_lines", onPaid))),
      updateOpen: allowed(await attempt(tx, "update public.invoice_lines set note = 'Ändrad' where id = $1", [openRow.id])),
      updatePaid: allowed(await attempt(tx, "update public.invoice_lines set quantity = 99 where id = $1", [frozenRow.id])),
    }));
    expect(got).toEqual(expected);
    // Chef och avtalsansvarig läser fakturorna men skriver inga rader (belopp visas bara för ekonomen i appen – beslut 5).
    for (const userId of ["u-karin", "u-johan"]) {
      const p = findPersona(userId);
      expect(canWriteRow("invoice_lines", onOpen, actorOf(p), raw), userId).toBe(false);
      expect(await asPersona(p, async (tx) => allowed(await attempt(tx, insertSql("invoice_lines", onOpen)))), userId).toBe(false);
    }
  });

  it("en returnerad faktura görs om med raderna frysta på nytt; ta bort går bara medan fakturan får ändras (underlag, godkänd, returnerad)", async () => {
    const returned = data.invoice_drafts.find((d) => d.status === "returned")!;
    const retRow = data.invoice_lines.find((l) => l.invoiceDraftId === returned.id)!;
    const paidRow = data.invoice_lines.find((l) => l.invoiceDraftId === paid().id)!;
    const openRow = data.invoice_lines.find((l) => l.invoiceDraftId === open().id)!;
    const actor = actorOf(lars());
    const expected = {
      updateReturned: canWriteRow("invoice_lines", retRow, actor, raw), deleteOpen: canWriteRow("invoice_lines", openRow, actor, raw),
      deleteReturned: canWriteRow("invoice_lines", retRow, actor, raw), deletePaid: canWriteRow("invoice_lines", paidRow, actor, raw),
    };
    expect(expected).toEqual({ updateReturned: true, deleteOpen: true, deleteReturned: true, deletePaid: false });
    const got = await asPersona(lars(), async (tx) => ({
      updateReturned: allowed(await attempt(tx, "update public.invoice_lines set note = 'Rättad' where id = $1", [retRow.id])),
      deleteOpen: allowed(await attempt(tx, "delete from public.invoice_lines where id = $1", [openRow.id])),
      deleteReturned: allowed(await attempt(tx, "delete from public.invoice_lines where id = $1", [retRow.id])),
      deletePaid: allowed(await attempt(tx, "delete from public.invoice_lines where id = $1", [paidRow.id])),
    }));
    expect(got).toEqual(expected);
    // Chef, avtalsansvarig och admin tar aldrig bort rader.
    for (const userId of ["u-karin", "u-johan", "u-robin"]) {
      const p = findPersona(userId);
      expect(canWriteRow("invoice_lines", openRow, actorOf(p), raw), userId).toBe(false);
      expect(await asPersona(p, async (tx) => allowed(await attempt(tx, "delete from public.invoice_lines where id = $1", [openRow.id]))), userId).toBe(false);
    }
    const editable = await db.query<{ r: boolean }>("select mm.invoice_editable($1) as r", [returned.id]);
    expect(editable.rows[0].r).toBe(true);
  });

  it("unika nycklar: en periodisk faktura per avtal, månad och grupp; en rad per ärende och faktura; en kreditering gäller en faktura", async () => {
    const dup = await asUser(db, null, (tx) => attempt(tx, insertSql("invoice_drafts", { ...open(), id: "inv-x-dubblett" })), { role: "service_role" });
    expect(dup).toMatchObject({ ok: false, code: "23505" });
    const row = data.invoice_lines.find((l) => l.invoiceDraftId === paid().id)!;
    const twice = await asUser(db, null, (tx) => attempt(tx, insertSql("invoice_lines", { ...row, id: "il-x-dubblett" })), { role: "service_role" });
    expect(twice).toMatchObject({ ok: false, code: "23505" });
    const credit = { id: "ic-x", contractId: "c-bot", month: "2026-12", invoiceDraftId: null, caseId: null, creditedAt: "2027-02-01T09:00", creditedBy: "u-lars", buyerReference: null };
    const none = await asUser(db, null, (tx) => attempt(tx, insertSql("invoice_credits", credit)), { role: "service_role" });
    expect(none).toMatchObject({ ok: false, code: "23514" });
    const editable = await db.query<{ a: boolean; b: boolean; c: boolean }>(
      "select mm.invoice_editable($1) as a, mm.invoice_editable($2) as b, mm.invoice_editable('finns-inte') as c", [open().id, paid().id],
    );
    expect(editable.rows[0]).toEqual({ a: true, b: false, c: false });
  });
});

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
    for (const userId of ["k-maria", "k-omar", "k-ahmed", "u-lars"]) {
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
