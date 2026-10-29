// Bevis: Row Level Security i Postgres ger exakt samma resultat som prototypens policy (src/data/policy.ts).
// Kör alla migrationer och supabase/seed.sql i PGlite (lokal Postgres i processen) och jämför, för varje testperson och
// varje tabell, vad RLS släpper igenom med vad MemoryRepo + POLICIES släpper igenom på samma testdata.
// Kör: npx vitest run src/data/supabase/rls-parity.test.ts
import { readFileSync } from "node:fs";
import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { accessIndex, caseAccessIn } from "@/core/access";
import { defaultGroupings } from "@/core/groupings";
import { requireOperational } from "@/core/config";
import { COLUMNS, EXTRA_COLUMNS, quoteIdent, snakeCase, type SqlType } from "../../../scripts/db/columns";
import { authUserIdFor, seedData, seedSql, sqlLiteral, TESTERS } from "../../../scripts/db/seed-sql";
import { listPersonas, type Persona } from "../actors";
import { MemoryRepo, MemoryStore, UniqueError, type RawAccess } from "../memory";
import { canReadRow, canWriteRow, POLICIES } from "../policy";
import { TABLE_NAMES, UNIQUE_KEYS, type Case, type TableName, type Tables } from "../schema";
import {
  allowed, asUser, attempt, createMigratedDatabase, databaseFromSnapshot, loadSeed, MIGRATIONS_DIR, SEED_FILE, snapshotDatabase, type DatabaseSnapshot, type Tx,
} from "./pglite";

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
  // Ett ärende där en kollega (David, arbetsgivarmatchare) är med i teamet utan att vara huvudcoach. Före 2026-10-09 var det
  // Petras ärende som handledare – teamplatserna som yrkesspecifik handledare finns inte längre i testdatat.
  const petraCase = data.cases.find((c) => data.case_team.some((t) => t.caseId === c.id && t.userId === "u-david"))!;
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
  const attachment = (id: string, caseId: string | null, uploadedBy: string, deleted = false, category: Tables["case_attachments"]["category"] = null): Tables["case_attachments"] => ({
    id, contractId: "c-bot", kind: category ? "participant" : "order", category, caseId, uploadedBy, fileName: category ? "CV.pdf" : "Kartläggning.pdf", mimeType: "application/pdf", bytes: 2048, storagePath: `c-bot/${id}.pdf`,
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
  // Gruppaktiviteter (0030): Amiras i Botkyrka med två deltagare (Amiras och Marias ärenden), en inställd av Sara och en i c-ny.
  // Deltagarnas tillfällen i activities, och en automatiskt registrerad närvaro (attendance.source = auto, bara jobbet skriver) på
  // ett tillfälle i Saras aktivitet – en rad per deltagare och gruppaktivitet (activities_group_activity_case_key).
  const group = (id: string, contractId: string, createdBy: string, cancelledBy: string | null = null): Tables["group_activities"] => ({
    id, contractId, name: "CV-verkstad", kind: "yrkesmoment", startsAt: "2027-02-02T13:00", durationMin: 90, location: "Miljonbemanning Alby", responsibleId: createdBy,
    createdBy, createdAt: at, updatedAt: null, updatedBy: null, cancelledAt: cancelledBy ? at : null, cancelledBy, goal: null, goalVersion: 0,
    audience: "manual", audienceLevelId: null, audienceAreaCode: null, seriesId: null, notify: false,
  });
  // Gruppmål (0033): Amiras aktivitet har ett mål. Amira (Amiras ärende) och deltagaren i det skyddade ärendet (vilande spärr)
  // är markerade som Klarade inte; Maria (Marias ärende) har inget val – Klarade automatiskt. Valen gäller målets version 0 och
  // deltagarens tillfälle i aktiviteten.
  const goalResult = (id: string, caseId: string, activityId: string, setBy: string): Tables["group_goal_results"] => ({
    id, contractId: "c-bot", groupActivityId: "ga-x-bot", caseId, activityId, goalVersion: 0, achieved: false, setBy, setAt: at,
  });
  const groupAct = (id: string, caseId: string, groupActivityId: string, startsAt = "2027-02-02T13:00"): Tables["activities"] => ({
    id, caseId, kind: "yrkesmoment", startsAt, durationMin: 90, location: "Miljonbemanning Alby", note: "", groupActivityId, inviteSource: "manual",
  });
  return {
    // Först: raderna nedan pekar på avtalet (främmande nycklar).
    contracts: [other],
    group_activities: [
      { ...group("ga-x-bot", "c-bot", "u-amira"), goal: "Alla skriver ett CV" }, group("ga-x-installd", "c-bot", "u-sara", "u-sara"), group("ga-x-ny", "c-ny", "u-johan"),
    ],
    activities: [
      groupAct("a-x-grupp-amira", amiraCase.id, "ga-x-bot"), groupAct("a-x-grupp-maria", mariaCase.id, "ga-x-bot"), groupAct("a-x-grupp-forra", amiraCase.id, "ga-x-installd", "2027-01-28T13:00"),
      groupAct("a-x-grupp-skyddad", protectedCase.id, "ga-x-bot"),
    ],
    attendance: [{
      id: "at-x-auto", activityId: "a-x-grupp-forra", caseId: amiraCase.id, status: "present", reason: "", registeredBy: "system", registeredAt: "2027-01-28T18:00",
      customerNotifiedAt: null, source: "auto",
    }],
    group_goal_results: [
      goalResult("ggr-x-amira", amiraCase.id, "a-x-grupp-amira", "u-amira"), goalResult("ggr-x-skyddad", protectedCase.id, "a-x-grupp-skyddad", protectedCase.leadCoachId!),
    ],
    // Petra har två roller i testet (coach och den vilande rollen handledare, se memberships) – som Ali en rad för rollvalet.
    role_choices: [choice("tester-karim", "admin"), choice("u-sara", "samordnare"), choice("tester-ali", "avtalsansvarig"), choice("u-petra", "coach")],
    saved_reports: [
      saved("sr-x-arkiv", "c-bot", "u-karin", "mb", "u-karin", "u-karin"),
      saved("sr-x-ny", "c-ny", "u-johan", "mb", "u-johan"),
      saved("sr-x-sara-mb", "c-bot", "u-sara", "mb", "u-johan"),
    ],
    memberships: [
      { id: "u-johan:c-ny", userId: "u-johan", contractId: "c-ny", role: "avtalsansvarig", customerUnit: null },
      // Rollen handledare är vilande (Karims beslut 2026-10-09): ingen har den i testdatat och appen kan inte ge den. Petra (coach)
      // får den här så att RLS och policy.ts för den vilande rollen fortfarande jämförs – den ska kunna slås på utan migration.
      { id: "u-petra:c-bot:handledare", userId: "u-petra", contractId: "c-bot", role: "handledare", customerUnit: null },
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
    // Grupperingar (0031): en tagg i det andra avtalet (c-ny), där bara avtalsansvarig Johan är medlem. Fria grupper finns inte längre (0035).
    groupings: [{
      id: "grp-x-ny", contractId: "c-ny", kind: "tag", category: "Körkort", name: "B-körkort", description: "", sortOrder: 1, createdAt: at, createdBy: "u-johan",
      updatedAt: null, updatedBy: null, archivedAt: null, archivedBy: null,
    }],
    // Bilagor till beställningen (0024): i Marias ärende, en uppladdning som ännu inte hör till en beställning, en raderad,
    // en i det skyddade ärendet (Omar) och en i Petras ärende som samordnaren lade till.
    case_attachments: [
      attachment("att-x-maria", mariaCase.id, "k-maria"), attachment("att-x-utkast", null, "k-maria"),
      attachment("att-x-borttagen", mariaCase.id, "k-maria", true), attachment("att-x-skyddad", protectedCase.id, protectedCase.referrerId!),
      attachment("att-x-petra", petraCase.id, "u-sara"),
      // Filer på deltagarkortet (0037): i Marias ärende (Maria beställde – får ändå aldrig läsa dem), en raderad, en i det
      // skyddade ärendet och en som (felaktigt) skulle ha laddats upp av Maria själv – uppladdaren avgör aldrig läsrätten.
      attachment("att-x-deltagare-cv", mariaCase.id, "u-sara", false, "cv"), attachment("att-x-deltagare-borttagen", mariaCase.id, "u-sara", true, "betyg_intyg"),
      attachment("att-x-deltagare-skyddad", protectedCase.id, protectedCase.leadCoachId!, false, "personligt_brev"),
      attachment("att-x-deltagare-maria", mariaCase.id, "k-maria", false, "ovrigt"),
    ],
  };
}
const EXTRA = extraRows();
for (const [t, rows] of Object.entries(EXTRA)) (data[t as TableName] as unknown as object[]).push(...(rows as object[]));
const store = new MemoryStore<Tables>(data);
const raw: RawAccess<Tables> = store.raw();
const personas = listPersonas(raw);
const personaKey = (p: Persona) => `${p.actor.userId}|${p.actor.role}`;
/** Testpersonen för en användare – eller för en användare och roll ("u-petra|handledare", samma form som personaKey). */
const findPersona = (key: string) => {
  const [userId, role] = key.split("|");
  const p = personas.find((x) => x.actor.userId === userId && (!role || x.actor.role === role));
  if (!p) throw new Error(`Testperson saknas: ${key}`);
  return p;
};
/** Den vilande rollen handledare (se EXTRA.memberships). */
const SUPERVISOR = "u-petra|handledare";

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
  snapshot = await snapshotDatabase(db);
}, 120_000);

// Varje describe-block börjar med en egen kopia av databasen ovan. PGlite tappar lite stack för varje fel som når testet
// (se snapshotDatabase i pglite.ts) – med alla block mot samma databas stoppades till slut också enkla satser. Testerna lämnar
// inga spår (asUser rullar alltid tillbaka), så kopian är samma databas som blocken annars hade sett.
let snapshot: DatabaseSnapshot;
let currentSuite: unknown;
beforeEach(async (ctx) => {
  const suite = ctx.task.suite;
  if (suite === currentSuite) return;
  const first = currentSuite === undefined;
  currentSuite = suite;
  if (first) return;
  await db.close();
  db = await databaseFromSnapshot(snapshot);
}, 60_000);

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
    for (const userId of ["u-sara", "u-johan", "u-amira", "u-petra", SUPERVISOR, "u-karin", "u-lars", "u-robin", "k-maria", "k-omar"]) {
      const p = findPersona(userId);
      const expected = Object.fromEntries(data.cases.map((c) => [c.id, caseAccessIn(c, p.actor, src)]));
      const got = await asPersona(p, async (tx) =>
        Object.fromEntries((await tx.query<{ id: string; a: string }>("select c.id, mm.case_access(c.id) as a from (select id from unnest($1::text[]) as id) c", [data.cases.map((c) => c.id)])).rows.map((r) => [r.id, r.a])));
      expect(got).toEqual(expected);
      for (const v of Object.values(expected)) levels.add(v);
    }
    // Nivån "team" ges inte längre till någon (beslut 2026-10-09): coach och den vilande rollen handledare har "full" i hela avtalet.
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

  // Beställningens bilagor (kind order) – deltagarfilerna prövas i blocket för 0037 nedan.
  const orderAtt = (userId: string) => memAtt(userId).filter((id) => data.case_attachments.find((x) => x.id === id)?.kind === "order");

  it("läsning per testperson: den som laddade upp, samordnare, avtalsansvarig, namngiven huvudcoach och beställande handläggare", async () => {
    // Samma rader i RLS och policy.ts för varje testperson.
    for (const p of personas) expect(await pgAtt(p.actor.userId), personaKey(p)).toEqual(memAtt(p.actor.userId));
    // Det som reglerna säger, i klartext.
    expect(memAtt("k-maria")).toEqual(expect.arrayContaining(["att-x-maria", "att-x-utkast"]));
    expect(memAtt("k-omar")).toEqual(["att-x-skyddad"]);
    expect(memAtt("u-sara")).toEqual(expect.arrayContaining(["att-x-maria", "att-x-petra"]));
    expect(orderAtt("u-johan")).toEqual(["att-x-maria", "att-x-petra", "att-x-skyddad"]);
    expect(memAtt(SKYDDAD_CASE.leadCoachId!)).toContain("att-x-skyddad");
    // Den vilande spärren: samordnaren ser inte bilagan i det skyddade ärendet; ingen ser utkastet utom uppladdaren eller en raderad fil.
    for (const p of personas) {
      const ids = memAtt(p.actor.userId);
      if (p.actor.userId !== "k-maria") expect(ids, p.actor.userId).not.toContain("att-x-utkast");
      expect(ids, p.actor.userId).not.toContain("att-x-borttagen");
      if (!["u-johan", "k-omar", SKYDDAD_CASE.leadCoachId].includes(p.actor.userId)) expect(ids, p.actor.userId).not.toContain("att-x-skyddad");
    }
    for (const userId of [SUPERVISOR, "u-lars", "u-karin", "u-robin", "deltagare", "tester-karim", "k-ahmed"]) expect(memAtt(userId), userId).toEqual([]);
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

// ================================================================ Filer på deltagarkortet (0037)
describe("filer på deltagarkortet (0037): bara Miljonbemanning – samma regler i RLS och policy.ts", () => {
  const PARTICIPANT = () => data.case_attachments.filter((x) => x.kind === "participant").map((x) => x.id);
  const pgFiles = (key: string) =>
    asPersona(findPersona(key), async (tx) => (await tx.query<{ id: string }>("select id from public.case_attachments where kind = 'participant' order by id")).rows.map((r) => r.id));
  const memFiles = (key: string) => data.case_attachments.filter((x) => x.kind === "participant" && canReadRow("case_attachments", x, actorOf(findPersona(key)), raw)).map((x) => x.id).sort();

  it("läsning per testperson: samordnare, avtalsansvarig och coach med full åtkomst – aldrig kommunen, ekonom, chef, admin eller handledare", async () => {
    // Testdatats egna deltagarfiler (att-seed-…) och de extra raderna ovan.
    expect(PARTICIPANT().filter((id) => id.startsWith("att-seed-")).length).toBeGreaterThan(0);
    for (const p of personas) expect(await pgFiles(personaKey(p)), personaKey(p)).toEqual(memFiles(personaKey(p)));
    const live = PARTICIPANT().filter((id) => !["att-x-deltagare-borttagen", "att-x-deltagare-skyddad"].includes(id)).sort();
    for (const key of ["u-sara", "u-johan", "u-amira", "u-erik"]) expect(memFiles(key), key).toEqual(expect.arrayContaining(live));
    expect(memFiles("u-johan")).toContain("att-x-deltagare-skyddad");
    expect(memFiles(SKYDDAD_CASE.leadCoachId!)).toContain("att-x-deltagare-skyddad");
    expect(memFiles("u-sara"), "den vilande spärren: samordnaren ser inte det skyddade ärendets filer").not.toContain("att-x-deltagare-skyddad");
    // Kommunen aldrig – inte heller handläggaren som beställde, inte heller en fil som står i hennes namn.
    for (const key of ["k-maria", "k-omar", "k-ahmed", SUPERVISOR, "u-lars", "u-karin", "u-robin", "deltagare", "tester-karim"]) expect(memFiles(key), key).toEqual([]);
    for (const p of personas) expect(memFiles(personaKey(p)), personaKey(p)).not.toContain("att-x-deltagare-borttagen");
  }, 30_000);

  it("kommunens handläggare läser beställningens bilagor i sitt ärende men aldrig deltagarfilerna – också med get på id", async () => {
    const got = await asPersona(findPersona("k-maria"), async (tx) => ({
      order: (await tx.query<{ id: string }>("select id from public.case_attachments where id = 'att-x-maria'")).rows.length,
      files: (await tx.query<{ id: string }>("select id from public.case_attachments where id in ('att-x-deltagare-cv', 'att-x-deltagare-maria')")).rows.length,
    }));
    expect(got).toEqual({ order: 1, files: 0 });
  });

  it("ingen inloggad användare skriver deltagarfilerna – bara servern (service role)", async () => {
    const row = { ...data.case_attachments.find((a) => a.id === "att-x-deltagare-cv")!, id: "att-x-deltagare-ny", storagePath: "c-bot/att-x-deltagare-ny.pdf" };
    for (const userId of ["u-sara", "u-johan", "u-amira", "k-maria"]) {
      const res = await asPersona(findPersona(userId), async (tx) => ({
        insert: await attempt(tx, insertSql("case_attachments", row as unknown as Record<string, unknown>)),
        update: await attempt(tx, "update public.case_attachments set category = 'ovrigt' where id = 'att-x-deltagare-cv'"),
        kind: await attempt(tx, "update public.case_attachments set kind = 'order', category = null where id = 'att-x-deltagare-cv'"),
        remove: await attempt(tx, "delete from public.case_attachments where id = 'att-x-deltagare-cv'"),
      }));
      expect([userId, allowed(res.insert), allowed(res.update), allowed(res.kind), allowed(res.remove)]).toEqual([userId, false, false, false, false]);
      expect(canWriteRow("case_attachments", row, actorOf(findPersona(userId)), raw)).toBe(false);
    }
    const sys = await asUser(db, null, (tx) => attempt(tx, insertSql("case_attachments", row as unknown as Record<string, unknown>)), { role: "service_role" });
    expect(sys).toMatchObject({ ok: true, rows: 1 });
  });

  it("kontrollerna i tabellen: en deltagarfil har alltid en typ och ett ärende, en bilaga till beställningen aldrig en typ", async () => {
    const base = { ...data.case_attachments.find((a) => a.id === "att-x-deltagare-cv")! };
    const tryRow = (patch: Partial<Tables["case_attachments"]>) =>
      asUser(db, null, (tx) => attempt(tx, insertSql("case_attachments", { ...base, id: "att-x-k", storagePath: "c-bot/att-x-k.pdf", ...patch } as unknown as Record<string, unknown>)), { role: "service_role" });
    expect(await tryRow({ category: null })).toMatchObject({ ok: false, code: "23514" });
    expect(await tryRow({ category: "intyg" as never })).toMatchObject({ ok: false, code: "23514" });
    expect(await tryRow({ caseId: null, linkedAt: null })).toMatchObject({ ok: false, code: "23514" });
    expect(await tryRow({ kind: "annat" as never })).toMatchObject({ ok: false, code: "23514" });
    expect(await tryRow({ kind: "order" })).toMatchObject({ ok: false, code: "23514" }); // bilaga med typ
    expect(await tryRow({})).toMatchObject({ ok: true, rows: 1 });
    // Befintliga rader (före 0037) blev bilagor till beställningen: standardvärdet order och ingen typ.
    const def = await db.query<{ d: string | null; n: string }>("select column_default as d, is_nullable as n from information_schema.columns where table_name = 'case_attachments' and column_name = 'kind'");
    expect(def.rows[0]).toEqual({ d: "'order'::text", n: "NO" });
  });

  it("migrationen tål att köras igen (SQL Editor) och ändrar då ingenting", async () => {
    const sql = readFileSync(`${MIGRATIONS_DIR}/0037_deltagarfiler.sql`, "utf8");
    type Snap = { rows: string; policies: string; constraints: string };
    let res: { before: Snap; after: Snap } | null = null;
    await db.transaction(async (tx) => {
      const snap = async (): Promise<Snap> => ({
        rows: (await tx.query<{ x: string }>("select string_agg(id || ':' || kind || ':' || coalesce(category, '-'), ',' order by id) as x from public.case_attachments")).rows[0].x,
        policies: (await tx.query<{ x: string }>("select string_agg(policyname || ':' || cmd || ':' || coalesce(qual, '-'), ',' order by policyname) as x from pg_policies where tablename = 'case_attachments'")).rows[0].x,
        constraints: (await tx.query<{ x: string }>("select string_agg(conname, ',' order by conname) as x from pg_constraint where conrelid = 'public.case_attachments'::regclass")).rows[0].x,
      });
      const before = await snap();
      await tx.exec(sql);
      await tx.exec(sql);
      res = { before, after: await snap() };
      await tx.rollback();
    });
    expect(res).not.toBeNull();
    expect(res!.after).toEqual(res!.before);
    // En enda policy (select) – ingen insert-, update- eller delete-policy.
    expect(res!.after.policies.startsWith("case_attachments_select:SELECT:")).toBe(true);
    expect(res!.after.policies.match(/case_attachments_\w+:(SELECT|INSERT|UPDATE|DELETE|ALL):/g)).toHaveLength(1);
    expect(res!.after.policies).toContain("kind = 'order'");
    expect(res!.after.constraints).toContain("case_attachments_participant_shape");
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
  // Gruppmål (0033): ett val per deltagare och aktivitet – kopian får en inbjuden deltagare i samma aktivitet som saknar val, och
  // deltagarens tillfälle.
  if (t === "group_goal_results") {
    const taken = new Set(data.group_goal_results.filter((r) => r.groupActivityId === row.groupActivityId).map((r) => r.caseId));
    const act = data.activities.find((a) => a.groupActivityId === row.groupActivityId && !taken.has(a.caseId));
    c.caseId = act?.caseId;
    c.activityId = act?.id;
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

// Testpersonerna i två block: varje block börjar från en egen kopia av databasen (PGlite tappar stack för varje nekad sats –
// med 0035:s tabell blev det för många i ett och samma block, "stack depth limit exceeded" för den sista personen).
const WRITE_HALF = Math.ceil(personas.length / 2);
for (const [part, group] of [["1", personas.slice(0, WRITE_HALF)], ["2", personas.slice(WRITE_HALF)]] as const) describe(`skrivning: samma regler som policy.ts (del ${part})`, () => {
  for (const p of group) {
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

// ================================================================ Kontaktvägen på deltagarkortet (0032, coachmötet 2026-10-09)
describe("kontaktvägen (0032): vem ändrar deltagarens kontaktuppgifter – samma regler i RLS, triggern och policy.ts", () => {
  const NADIA = "case-260143";
  const person = () => raw.get("persons", raw.get("cases", NADIA)!.personId)!;
  /** policy.ts: läsrätt på den befintliga raden och skrivrätt på den nya. */
  const memWrite = (row: Tables["persons"], key: string) => {
    const a = findPersona(key).actor;
    return canReadRow("persons", raw.get("persons", row.id)!, a, raw) && canWriteRow("persons", row, a, raw);
  };
  const changes = (p: Tables["persons"]) => ({
    contact: { sql: "update public.persons set preferred_contact = 'email', phone = '', email = 'ny@example.invalid', address = null where id = $1", row: { ...p, preferredContact: "email" as const, phone: "", email: "ny@example.invalid", address: null } },
    phone: { sql: "update public.persons set phone = '070-000 00 09' where id = $1", row: { ...p, phone: "070-000 00 09" } },
    name: { sql: "update public.persons set first_name = 'Annat' where id = $1", row: { ...p, firstName: "Annat" } },
    language: { sql: "update public.persons set language = 'engelska', phone = '070-000 00 09' where id = $1", row: { ...p, language: "engelska", phone: "070-000 00 09" } },
  });

  it("systemadministratören ändrar bara kontaktuppgifterna; samordnare, avtalsansvarig och coach som förut; ekonom och chef aldrig", async () => {
    const p = person();
    const c = changes(p);
    const expected: Record<string, Record<keyof typeof c, boolean>> = {
      "u-robin|admin": { contact: true, phone: true, name: false, language: false },
      "u-sara|samordnare": { contact: true, phone: true, name: true, language: true },
      "u-johan|avtalsansvarig": { contact: true, phone: true, name: true, language: true },
      "u-amira|coach": { contact: true, phone: true, name: true, language: true },
      "u-lars|ekonom": { contact: false, phone: false, name: false, language: false },
      "u-karin|chef": { contact: false, phone: false, name: false, language: false },
    };
    for (const [key, want] of Object.entries(expected)) {
      const got = await asPersona(findPersona(key), async (tx) => {
        const out: Record<string, boolean> = {};
        for (const [k, v] of Object.entries(c)) out[k] = allowed(await attempt(tx, v.sql, [p.id]));
        return out;
      });
      expect(got, key).toEqual(want);
      const mem = Object.fromEntries(Object.entries(c).map(([k, v]) => [k, memWrite(v.row, key)]));
      expect(mem, key).toEqual(want);
    }
  });

  it("triggern stoppar systemadministratörens ändring av annat än kontaktuppgifterna med ett behörighetsfel (42501)", async () => {
    const p = person();
    const res = await asPersona(findPersona("u-robin|admin"), (tx) => attempt(tx, "update public.persons set first_name = 'Annat' where id = $1", [p.id]));
    expect(res).toMatchObject({ ok: false, code: "42501" });
    // Servern (service role) påverkas inte av triggern.
    const service = await asUser(db, null, (tx) => attempt(tx, "update public.persons set first_name = 'Annat' where id = $1", [p.id]), { role: "service_role" });
    expect(service).toMatchObject({ ok: true, rows: 1 });
  });

  it("den vilande spärren: i ett skyddat ärende ändrar systemadministratören ingenting (åtkomsten är 'restricted')", async () => {
    const p = SKYDDAD_PERSON;
    const res = await asPersona(findPersona("u-robin|admin"), (tx) => attempt(tx, "update public.persons set phone = '070-000 00 09' where id = $1", [p.id]));
    expect(allowed(res)).toBe(false);
    expect(canWriteRow("persons", { ...raw.get("persons", p.id)!, phone: "070-000 00 09" }, findPersona("u-robin|admin").actor, raw)).toBe(false);
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
    // note-byte-linnea: motiveringen till testdatats byte av yrkesområde (Karims beslut 2026-10-22).
    expect(open).toEqual(["note-byte-linnea", "note-mehmet-handledare", "note-nadia-borttagen", "note-nadia-kommun", "note-nadia-praktiskt", "note-nadia-samtal"]);
    const expected: Record<string, string[]> = {
      // Amira är huvudcoach för Nadia och Mehmet; Petra (coach, och i den vilande rollen handledare) och Leila läser samma
      // anteckningar – men inte det skyddade ärendets (vilande spärr: bara namngiven huvudcoach Erik och avtalsansvarig).
      "u-amira": open, "u-petra": open, [SUPERVISOR]: open, "u-leila": open,
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
      [SUPERVISOR, insertNote("n-t2", NADIA, "c-bot", "u-petra", "team"), newRow("n-t2", NADIA, "c-bot", "u-petra", "team"), true],
      [SUPERVISOR, insertNote("n-t3", NADIA, "c-bot", "u-petra", "full"), newRow("n-t3", NADIA, "c-bot", "u-petra", "full"), true],
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
      [SUPERVISOR, hide(praktiskt.id, "u-petra"), hidden(praktiskt, "u-petra"), false],
      ["u-leila", hide(praktiskt.id, "u-leila"), hidden(praktiskt, "u-leila"), false, { team: true }],
      ["u-lars", hide(praktiskt.id, "u-lars"), hidden(praktiskt, "u-lars"), false],
      ["u-karin", hide(praktiskt.id, "u-karin"), hidden(praktiskt, "u-karin"), false],
      ["u-robin", hide(praktiskt.id, "u-robin"), hidden(praktiskt, "u-robin"), false],
      ["k-maria", hide(praktiskt.id, "k-maria"), hidden(praktiskt, "k-maria"), false],
      // Skyddat ärende: avtalsansvarig (full) får dölja, samordnaren (bara ärendenumret) får inte.
      ["u-johan", hide(skyddad.id, "u-johan"), hidden(skyddad, "u-johan"), true],
      ["u-sara", hide(skyddad.id, "u-sara"), hidden(skyddad, "u-sara"), false],
      [SUPERVISOR, hide("note-mehmet-handledare", "u-petra"), hidden(note("note-mehmet-handledare"), "u-petra"), true],
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
      "u-robin": [], "u-amira": [], "u-petra": [], [SUPERVISOR]: [], "u-lars": [], "k-maria": [], "k-omar": [], "tester-karim": [],
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

  it("testdatat: standardvärdena (fem nivåer, Vill arbeta), tre gamla grupper – alla arkiverade (0035) – och medlemskap i det skyddade ärendet", () => {
    const bot = data.groupings.filter((g) => g.contractId === "c-bot");
    expect(bot.filter((g) => g.kind === "level").map((g) => g.name)).toEqual([
      "Nivå 1 – Långt från arbete", "Nivå 2 – Behöver stöd för att komma igång", "Nivå 3 – På väg", "Nivå 4 – Nära arbete", "Nivå 5 – Redo för arbete",
    ]);
    expect(bot.filter((g) => g.kind === "tag").map((g) => `${g.category}: ${g.name}`)).toEqual(["Vill arbeta: Heltid", "Vill arbeta: Deltid", "Vill arbeta: Vet inte än"]);
    expect(bot.filter((g) => g.kind === "group").map((g) => [g.name, !!g.archivedAt])).toEqual([["Måndagsgruppen", true], ["Lagergruppen", true], ["Höstgruppen 2026", true]]);
    // Fria grupper finns inte längre (Karims beslut 2026-10-22): inga aktiva medlemskap i grupper – bara historik.
    expect(data.grouping_members.filter((m) => m.kind === "group" && m.removedAt == null)).toEqual([]);
    expect(data.grouping_members.some((m) => m.kind === "group" && m.removedAt != null)).toBe(true);
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

  it("nytt medlemskap: samordnare, avtalsansvarig och coach med full åtkomst i eget namn – aldrig admin (läsläge), handledare, chef, ekonom eller kommunen", async () => {
    const cases: [string, Tables["grouping_members"], boolean][] = [
      ["u-amira", member("gm-t1", AMAL, level(3), "u-amira"), true],
      ["u-sara", member("gm-t2", AMAL, level(3), "u-sara"), true],
      ["u-johan", member("gm-t3", AMAL, level(3), "u-johan"), true],
      ["u-robin", member("gm-t4", AMAL, level(3), "u-robin"), false],
      // Petra är coach sedan rollen handledare togs bort (Karims beslut 2026-10-09); den vilande rollen placerar aldrig.
      ["u-petra", member("gm-t5", AMAL, level(3), "u-petra"), true],
      [SUPERVISOR, member("gm-t5b", AMAL, level(3), "u-petra"), false],
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
      // Fria grupper finns inte längre (0035): de gamla är arkiverade, och ett nytt aktivt medlemskap i en grupp nekas.
      ["u-amira", member("gm-t16", AMAL, "grp-c-bot-g-mandag", "u-amira"), false],
      ["u-amira", member("gm-t17", AMAL, "grp-c-bot-vill-arbeta-deltid", "u-amira"), true],
      // Det skyddade ärendet (vilande spärr): samordnaren har bara "restricted"; namngiven huvudcoach och avtalsansvarig får.
      ["u-sara", member("gm-t18", SKYDDAD, "grp-c-bot-vill-arbeta-heltid", "u-sara"), false],
      ["u-erik", member("gm-t19", SKYDDAD, "grp-c-bot-vill-arbeta-heltid", "u-erik"), true],
      ["u-johan", member("gm-t20", SKYDDAD, "grp-c-bot-vill-arbeta-heltid", "u-johan"), true],
    ];
    for (const [userId, r, want] of cases) expect([userId, r.id, await both("grouping_members", userId, insertMember(r), r)]).toEqual([userId, r.id, { pg: want, mem: want }]);
  }, 60_000);

  it("ändra medlemskap: bara ta bort ett aktivt, i eget namn – inget annat ändras, inget återställs och ingen raderar", async () => {
    // Nadias tagg (Vill arbeta) – fria grupper finns inte längre (0035).
    const nadiaGroup = data.grouping_members.find((m) => m.caseId === NADIA && m.kind === "tag" && m.removedAt == null)!;
    const removed = data.grouping_members.find((m) => m.removedAt != null)!;
    const upd = (id: string, set: string) => `update public.grouping_members set ${set} where id = '${id}'`;
    const cases: [string, string, Tables["grouping_members"], boolean][] = [
      ["u-amira", upd(nadiaGroup.id, `removed_at = '${at}', removed_by = 'u-amira'`), { ...nadiaGroup, removedAt: at, removedBy: "u-amira" }, true],
      ["u-sara", upd(nadiaGroup.id, `removed_at = '${at}', removed_by = 'u-sara'`), { ...nadiaGroup, removedAt: at, removedBy: "u-sara" }, true],
      ["u-amira", upd(nadiaGroup.id, `removed_at = '${at}', removed_by = 'u-sara'`), { ...nadiaGroup, removedAt: at, removedBy: "u-sara" }, false],
      ["u-amira", upd(nadiaGroup.id, "grouping_id = 'grp-c-bot-vill-arbeta-deltid'"), { ...nadiaGroup, groupingId: "grp-c-bot-vill-arbeta-deltid" }, false],
      ["u-amira", upd(nadiaGroup.id, `added_by = 'u-sara'`), { ...nadiaGroup, addedBy: "u-sara" }, false],
      ["u-amira", upd(nadiaGroup.id, "id = id"), nadiaGroup, false],
      ["u-petra", upd(nadiaGroup.id, `removed_at = '${at}', removed_by = 'u-petra'`), { ...nadiaGroup, removedAt: at, removedBy: "u-petra" }, true],
      [SUPERVISOR, upd(nadiaGroup.id, `removed_at = '${at}', removed_by = 'u-petra'`), { ...nadiaGroup, removedAt: at, removedBy: "u-petra" }, false],
      ["u-karin", upd(nadiaGroup.id, `removed_at = '${at}', removed_by = 'u-karin'`), { ...nadiaGroup, removedAt: at, removedBy: "u-karin" }, false],
      ["u-robin", upd(nadiaGroup.id, `removed_at = '${at}', removed_by = 'u-robin'`), { ...nadiaGroup, removedAt: at, removedBy: "u-robin" }, false],
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

  // En ny tagg (fria grupper finns inte längre – 0035).
  const grouping = (id: string, createdBy: string, patch: Partial<Tables["groupings"]> = {}): Tables["groupings"] => ({
    id, contractId: "c-bot", kind: "tag", category: "Körkort", name: "B-körkort", description: "", sortOrder: 9, createdAt: at, createdBy,
    updatedAt: null, updatedBy: null, archivedAt: null, archivedBy: null, ...patch,
  });
  const insertGrouping = (r: Tables["groupings"]) => insertSql("groupings", r as unknown as Record<string, unknown>);

  it("ny gruppering: skrivrollerna i eget namn – inte handledare, chef, ekonom eller kommunen; varken ändrad, arkiverad eller med fel form", async () => {
    const cases: [string, Tables["groupings"], boolean][] = [
      ["u-amira", grouping("g-t1", "u-amira"), true],
      ["u-sara", grouping("g-t2", "u-sara"), true],
      ["u-johan", grouping("g-t3", "u-johan"), true],
      ["u-robin", grouping("g-t4", "u-robin"), true],
      ["u-petra", grouping("g-t5", "u-petra"), true],
      [SUPERVISOR, grouping("g-t5b", "u-petra"), false],
      ["u-karin", grouping("g-t6", "u-karin"), false],
      ["u-lars", grouping("g-t7", "u-lars"), false],
      ["k-maria", grouping("g-t8", "k-maria"), false],
      ["u-amira", grouping("g-t9", "u-sara"), false],
      ["u-amira", grouping("g-t10", "u-amira", { archivedAt: at, archivedBy: "u-amira" }), false],
      ["u-amira", grouping("g-t11", "u-amira", { updatedAt: at, updatedBy: "u-amira" }), false],
      ["u-amira", grouping("g-t12", "u-amira", { category: null }), false],
      // Fria grupper finns inte längre (Karims beslut 2026-10-22, triggern groupings_no_free_groups).
      ["u-amira", grouping("g-t13", "u-amira", { kind: "group", category: null, name: "Tisdagsgruppen" }), false],
      ["u-robin", grouping("g-t13b", "u-robin", { kind: "group", category: null, name: "Tisdagsgruppen" }), false],
      ["u-amira", grouping("g-t14", "u-amira", { kind: "level", category: "Körkort" }), false],
      ["u-amira", grouping("g-t15", "u-amira", { name: "x".repeat(81) }), false],
      ["u-amira", grouping("g-t16", "u-amira", { name: "  " }), false],
      ["u-amira", grouping("g-t17", "u-amira", { contractId: "c-ny" }), false],
      ["u-johan", grouping("g-t18", "u-johan", { contractId: "c-ny" }), true],
    ];
    for (const [userId, r, want] of cases) expect([userId, r.id, await both("groupings", userId, insertGrouping(r), r)]).toEqual([userId, r.id, { pg: want, mem: want }]);
  }, 60_000);

  it("ändra gruppering: namn och beskrivning, arkivera och återställ i eget namn – avtal, typ, kategori och skapad ändras aldrig, ingen raderar", async () => {
    // Taggen Deltid (fria grupper finns inte längre – 0035; en gammal grupp återställs aldrig).
    const mandag = raw.get("groupings", "grp-c-bot-vill-arbeta-deltid")!;
    const host = raw.get("groupings", "grp-c-bot-g-host")!;
    const heltid = raw.get("groupings", "grp-c-bot-vill-arbeta-heltid")!;
    const upd = (id: string, set: string) => `update public.groupings set ${set} where id = '${id}'`;
    const cases: [string, string, Tables["groupings"], boolean][] = [
      ["u-sara", upd(mandag.id, `name = 'Måndagar', updated_at = '${at}', updated_by = 'u-sara'`), { ...mandag, name: "Måndagar", updatedAt: at, updatedBy: "u-sara" }, true],
      ["u-sara", upd(mandag.id, `name = 'Måndagar', updated_at = '${at}', updated_by = 'u-amira'`), { ...mandag, name: "Måndagar", updatedAt: at, updatedBy: "u-amira" }, false],
      ["u-amira", upd(mandag.id, `archived_at = '${at}', archived_by = 'u-amira'`), { ...mandag, archivedAt: at, archivedBy: "u-amira" }, true],
      ["u-amira", upd(mandag.id, `archived_at = '${at}', archived_by = 'u-sara'`), { ...mandag, archivedAt: at, archivedBy: "u-sara" }, false],
      ["u-sara", upd(host.id, "archived_at = null, archived_by = null"), { ...host, archivedAt: null, archivedBy: null }, false],
      ["u-sara", upd(mandag.id, "kind = 'level'"), { ...mandag, kind: "level" }, false],
      ["u-sara", upd(heltid.id, "category = 'Annan'"), { ...heltid, category: "Annan" }, false],
      ["u-sara", upd(mandag.id, "contract_id = 'c-ny'"), { ...mandag, contractId: "c-ny" }, false],
      ["u-sara", upd(mandag.id, `created_by = 'u-sara'`), { ...mandag, createdBy: "u-sara" }, false],
      ["u-sara", upd(mandag.id, "name = name"), mandag, false],
      ["u-petra", upd(mandag.id, `name = 'X', updated_at = '${at}', updated_by = 'u-petra'`), { ...mandag, name: "X", updatedAt: at, updatedBy: "u-petra" }, true],
      [SUPERVISOR, upd(mandag.id, `name = 'X', updated_at = '${at}', updated_by = 'u-petra'`), { ...mandag, name: "X", updatedAt: at, updatedBy: "u-petra" }, false],
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
      // Gruppaktiviteternas målgrupp och serierna pekar på nivåerna (0035) – de släpps först (transaktionen rullas tillbaka).
      await tx.query("update public.group_activities set series_id = null, audience = 'manual', audience_level_id = null, audience_area_code = null");
      await tx.query("delete from public.group_activity_series");
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
    // Den vilande rollen handledare granskar också; ekonomen och kommunen aldrig.
    const petra = await asPersona(findPersona(SUPERVISOR), (tx) => attempt(tx, upd(`status = 'reviewed', reviewed_by = 'u-petra', reviewed_at = '${at}'`)));
    expect(petra).toMatchObject({ ok: true, rows: 1 });
    expect(memWrite("participant_voice_notes", { ...n, status: "reviewed", reviewedBy: "u-petra", reviewedAt: at }, SUPERVISOR)).toBe(true);
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

// ================================================================ Gruppaktiviteter och närvarons källa (0030)
describe("gruppaktiviteter och automatisk närvaro (0030): samma regler i RLS, triggern och policy.ts", () => {
  const ga = (id: string) => raw.get("group_activities", id)!;
  const memWrite = <N extends TableName>(t: N, row: Tables[N], userId: string) => {
    const a = actorOf(findPersona(userId));
    const cur = raw.get(t, row.id);
    return (!cur || canReadRow(t, cur, a, raw)) && canWriteRow(t, row, a, raw);
  };
  const pgWrite = async (userId: string, sql: string, params: unknown[] = []) => allowed(await asPersona(findPersona(userId), (tx) => attempt(tx, sql, params)));
  const at = "2027-02-01T09:30";
  const insertGroup = (id: string, contractId: string, createdBy: string, extra = "null, null, null, null") =>
    `insert into public.group_activities (id, contract_id, name, kind, starts_at, duration_min, location, responsible_id, created_by, created_at, updated_at, updated_by, cancelled_at, cancelled_by)
     values ('${id}', '${contractId}', 'Intervjuträning', 'annat', '2027-02-03T10:00', 60, 'Miljonbemanning Alby', null, '${createdBy}', '${at}', ${extra})`;
  const newGroup = (id: string, contractId: string, createdBy: string, patch: Partial<Tables["group_activities"]> = {}): Tables["group_activities"] => ({
    id, contractId, name: "Intervjuträning", kind: "annat", startsAt: "2027-02-03T10:00", durationMin: 60, location: "Miljonbemanning Alby", responsibleId: null, createdBy,
    createdAt: at, updatedAt: null, updatedBy: null, cancelledAt: null, cancelledBy: null, goal: null, goalVersion: 0, audience: "manual", audienceLevelId: null,
    audienceAreaCode: null, seriesId: null, notify: false, ...patch,
  });

  it("läsning per testperson: Miljonbemanning i avtalet utom ekonomen – aldrig kommunen", async () => {
    for (const p of personas) {
      const pg = await asPersona(p, async (tx) => (await tx.query<{ id: string }>("select id from public.group_activities order by id")).rows.map((r) => r.id));
      const mem = data.group_activities.filter((x) => canReadRow("group_activities", x, actorOf(p), raw)).map((x) => x.id).sort();
      expect(pg, personaKey(p)).toEqual(mem);
    }
    const memOf = (userId: string) => data.group_activities.filter((x) => canReadRow("group_activities", x, actorOf(findPersona(userId)), raw)).map((x) => x.id).sort();
    // Testdatat har nivåaktiviteterna och yrkesområdesträffarna (0035) i Botkyrka; ga-x-ny är i c-ny.
    const bot = data.group_activities.filter((g) => g.contractId === "c-bot").map((g) => g.id).sort();
    const all = data.group_activities.map((g) => g.id).sort();
    expect(bot).toEqual(expect.arrayContaining(["ga-x-bot", "ga-x-installd"]));
    for (const userId of ["u-amira", "u-petra", "u-sara", "u-karin"]) expect(memOf(userId), userId).toEqual(bot);
    // Avtalsansvarig Johan är medlem också i c-ny; admin ser alla avtal.
    expect(memOf("u-johan")).toEqual(all);
    expect(memOf("u-robin")).toEqual(all);
    for (const userId of ["u-lars", "k-maria", "k-omar"]) expect(memOf(userId), userId).toEqual([]);
  });

  it("ny gruppaktivitet: i eget namn av den som arbetar i ärendena – aldrig chef, admin, ekonom, kommunen, i någon annans namn, utanför avtalet eller redan inställd", async () => {
    const cases: [string, string, Tables["group_activities"], boolean][] = [
      ["u-amira", insertGroup("ga-t1", "c-bot", "u-amira"), newGroup("ga-t1", "c-bot", "u-amira"), true],
      ["u-sara", insertGroup("ga-t2", "c-bot", "u-sara"), newGroup("ga-t2", "c-bot", "u-sara"), true],
      ["u-petra", insertGroup("ga-t3", "c-bot", "u-petra"), newGroup("ga-t3", "c-bot", "u-petra"), true],
      ["u-amira", insertGroup("ga-t4", "c-bot", "u-sara"), newGroup("ga-t4", "c-bot", "u-sara"), false],
      ["u-amira", insertGroup("ga-t5", "c-ny", "u-amira"), newGroup("ga-t5", "c-ny", "u-amira"), false],
      ["u-karin", insertGroup("ga-t6", "c-bot", "u-karin"), newGroup("ga-t6", "c-bot", "u-karin"), false],
      ["u-robin", insertGroup("ga-t7", "c-bot", "u-robin"), newGroup("ga-t7", "c-bot", "u-robin"), false],
      ["u-lars", insertGroup("ga-t8", "c-bot", "u-lars"), newGroup("ga-t8", "c-bot", "u-lars"), false],
      ["k-maria", insertGroup("ga-t9", "c-bot", "k-maria"), newGroup("ga-t9", "c-bot", "k-maria"), false],
      ["u-amira", insertGroup("ga-t10", "c-bot", "u-amira", `null, null, '${at}', 'u-amira'`), newGroup("ga-t10", "c-bot", "u-amira", { cancelledAt: at, cancelledBy: "u-amira" }), false],
    ];
    for (const [userId, sql, row, want] of cases) {
      expect({ pg: await pgWrite(userId, sql), mem: memWrite("group_activities", row, userId) }, `${userId} ${row.id}`).toEqual({ pg: want, mem: want });
    }
  });

  it("ändra och ställa in: i eget namn; avtal, skapare och tid ändras aldrig; en inställd ändras inte; ingen raderar", async () => {
    const bot = ga("ga-x-bot");
    const gone = ga("ga-x-installd");
    const cases: [string, string, Tables["group_activities"], boolean][] = [
      ["u-petra", `update public.group_activities set location = 'Rum 2', updated_at = '${at}', updated_by = 'u-petra' where id = 'ga-x-bot'`, { ...bot, location: "Rum 2", updatedAt: at, updatedBy: "u-petra" }, true],
      ["u-sara", `update public.group_activities set cancelled_at = '${at}', cancelled_by = 'u-sara' where id = 'ga-x-bot'`, { ...bot, cancelledAt: at, cancelledBy: "u-sara" }, true],
      ["u-sara", `update public.group_activities set cancelled_at = '${at}', cancelled_by = 'u-amira' where id = 'ga-x-bot'`, { ...bot, cancelledAt: at, cancelledBy: "u-amira" }, false],
      ["u-amira", `update public.group_activities set updated_at = '${at}', updated_by = 'u-sara', name = 'X' where id = 'ga-x-bot'`, { ...bot, updatedAt: at, updatedBy: "u-sara", name: "X" }, false],
      ["u-amira", "update public.group_activities set contract_id = 'c-ny' where id = 'ga-x-bot'", { ...bot, contractId: "c-ny" }, false],
      ["u-amira", "update public.group_activities set created_by = 'u-sara' where id = 'ga-x-bot'", { ...bot, createdBy: "u-sara" }, false],
      ["u-amira", "update public.group_activities set name = name where id = 'ga-x-bot'", bot, false],
      ["u-amira", `update public.group_activities set name = 'Ny', updated_at = '${at}', updated_by = 'u-amira' where id = 'ga-x-installd'`, { ...gone, name: "Ny", updatedAt: at, updatedBy: "u-amira" }, false],
      ["u-karin", `update public.group_activities set name = 'Ny', updated_at = '${at}', updated_by = 'u-karin' where id = 'ga-x-bot'`, { ...bot, name: "Ny", updatedAt: at, updatedBy: "u-karin" }, false],
      ["u-lars", `update public.group_activities set name = 'Ny', updated_at = '${at}', updated_by = 'u-lars' where id = 'ga-x-bot'`, { ...bot, name: "Ny", updatedAt: at, updatedBy: "u-lars" }, false],
    ];
    for (const [userId, sql, row, want] of cases) {
      expect({ pg: await pgWrite(userId, sql), mem: memWrite("group_activities", row, userId) }, `${userId} ${sql}`).toEqual({ pg: want, mem: want });
    }
    for (const userId of ["u-amira", "u-johan", "u-robin"]) {
      expect(await pgWrite(userId, "delete from public.group_activities where id = 'ga-x-bot'"), userId).toBe(false);
      expect(canWriteRow("group_activities", bot, actorOf(findPersona(userId)), raw), userId).toBe(false);
    }
  });

  it("deltagarens tillfälle: tas bort av den som arbetar i ärendet (activities_delete) – aldrig ekonomen eller kommunen, och aldrig med närvaro (främmande nyckel)", async () => {
    expect(await pgWrite("u-amira", "delete from public.activities where id = 'a-x-grupp-maria'")).toBe(true);
    expect(await pgWrite("u-sara", "delete from public.activities where id = 'a-x-grupp-maria'")).toBe(true);
    expect(await pgWrite("u-lars", "delete from public.activities where id = 'a-x-grupp-maria'")).toBe(false);
    expect(await pgWrite("k-maria", "delete from public.activities where id = 'a-x-grupp-maria'")).toBe(false);
    // Tillfället med (automatisk) närvaro: databasen stoppar borttagningen.
    expect(await pgWrite("u-amira", "delete from public.activities where id = 'a-x-grupp-forra'")).toBe(false);
    // policy.ts: samma regel som skrivningen (workOn) – hanterarna nekar tillfällen med närvaro.
    const row = raw.get("activities", "a-x-grupp-maria")!;
    for (const [userId, want] of [["u-amira", true], ["u-sara", true], ["u-lars", false], ["k-maria", false]] as const) {
      expect(canWriteRow("activities", row, actorOf(findPersona(userId)), raw), userId).toBe(want);
    }
  });

  it("närvarons källa: användare skriver bara manuell närvaro – en automatisk rad som ändras blir manuell; bara servern skriver auto", async () => {
    const auto = raw.get("attendance", "at-x-auto")!;
    expect(auto.source).toBe("auto");
    const free = data.activities.find((a) => a.caseId === auto.caseId && !data.attendance.some((x) => x.activityId === a.id))!;
    const ins = (id: string, source: string) =>
      `insert into public.attendance (id, activity_id, case_id, status, reason, registered_by, registered_at, customer_notified_at, source)
       values ('${id}', '${free.id}', '${auto.caseId}', 'present', '', 'u-amira', '${at}', null, '${source}')`;
    const newAtt = (id: string, source: Tables["attendance"]["source"]): Tables["attendance"] => ({
      id, activityId: free.id, caseId: auto.caseId, status: "present", reason: "", registeredBy: "u-amira", registeredAt: at, customerNotifiedAt: null, source,
    });
    const cases: [string, string, Tables["attendance"], boolean][] = [
      ["u-amira", ins("at-t1", "manual"), newAtt("at-t1", "manual"), true],
      ["u-amira", ins("at-t2", "auto"), newAtt("at-t2", "auto"), false],
      ["u-amira", "update public.attendance set status = 'absent_invalid', source = 'manual' where id = 'at-x-auto'", { ...auto, status: "absent_invalid", source: "manual" }, true],
      ["u-amira", "update public.attendance set status = 'absent_invalid' where id = 'at-x-auto'", { ...auto, status: "absent_invalid" }, false],
      ["u-lars", "update public.attendance set status = 'absent_invalid', source = 'manual' where id = 'at-x-auto'", { ...auto, status: "absent_invalid", source: "manual" }, false],
    ];
    for (const [userId, sql, row, want] of cases) {
      expect({ pg: await pgWrite(userId, sql), mem: memWrite("attendance", row, userId) }, `${userId} ${sql}`).toEqual({ pg: want, mem: want });
    }
    // Servern (service role) skriver en automatisk rad – jobbet auto_attendance.
    const service = await asUser(db, null, (tx) => attempt(tx, ins("at-t3", "auto")), { role: "service_role" });
    expect(service).toMatchObject({ ok: true, rows: 1 });
    // Kontrollen i tabellen: bara manual och auto.
    const bad = await asUser(db, null, (tx) => attempt(tx, ins("at-t4", "maskin")), { role: "service_role" });
    expect(bad).toMatchObject({ ok: false, code: "23514" });
  });

  it("en rad per deltagare och gruppaktivitet: databasen och minnet stoppar en andra rad (23505) – deltagarens egna tillfällen omfattas inte", async () => {
    const amiraRow = raw.get("activities", "a-x-grupp-amira")!;
    const ins = (id: string, groupActivityId: string | null) =>
      `insert into public.activities (id, case_id, kind, starts_at, duration_min, location, note, group_activity_id)
       values ('${id}', '${amiraRow.caseId}', 'yrkesmoment', '2027-02-02T15:00', 60, 'Rum 2', '', ${groupActivityId ? `'${groupActivityId}'` : "null"})`;
    const pg = await asPersona(findPersona("u-amira"), async (tx) => ({
      dup: await attempt(tx, ins("a-t-dup", "ga-x-bot")),
      own1: await attempt(tx, ins("a-t-own1", null), [], { keep: true }),
      own2: await attempt(tx, ins("a-t-own2", null)),
    }));
    expect(pg.dup).toMatchObject({ ok: false, code: "23505" });
    expect(pg.own1).toMatchObject({ ok: true, rows: 1 });
    expect(pg.own2).toMatchObject({ ok: true, rows: 1 });
    // Minnet (UNIQUE_KEYS): samma nyckel, samma fel.
    const mem = new MemoryStore<Tables>(structuredClone(data), UNIQUE_KEYS);
    expect(() => mem.insertRow("activities", { ...amiraRow, id: "a-t-dup", startsAt: "2027-02-02T15:00" })).toThrow(UniqueError);
    mem.insertRow("activities", { ...amiraRow, id: "a-t-own1", groupActivityId: null });
    mem.insertRow("activities", { ...amiraRow, id: "a-t-own2", groupActivityId: null });
    expect(mem.rows("activities").filter((a) => a.groupActivityId === "ga-x-bot" && a.caseId === amiraRow.caseId)).toHaveLength(1);
  });

  it("migrationen tål att köras igen (SQL Editor, t.ex. efter en avbruten körning) och ändrar då ingenting", async () => {
    const sql = readFileSync(`${MIGRATIONS_DIR}/0030_gruppaktiviteter.sql`, "utf8");
    // Som i SQL Editor: ägaren (postgres) kör hela filen två gånger. Transaktionen rullas tillbaka.
    let res: { before: number; after: number; policies: number; triggers: number } | null = null;
    await db.transaction(async (tx) => {
      const before = (await tx.query<{ n: number }>("select (select count(*) from public.group_activities) + (select count(*) from public.attendance where source = 'auto') as n")).rows[0].n;
      await tx.exec(sql);
      await tx.exec(sql);
      const after = (await tx.query<{ n: number }>("select (select count(*) from public.group_activities) + (select count(*) from public.attendance where source = 'auto') as n")).rows[0].n;
      const policies = (await tx.query<{ n: number }>(
        "select count(*)::int as n from pg_policies where (tablename = 'group_activities') or (tablename = 'activities' and policyname = 'activities_delete') or (tablename = 'attendance' and policyname in ('attendance_insert', 'attendance_update'))",
      )).rows[0].n;
      const triggers = (await tx.query<{ n: number }>("select count(*)::int as n from pg_trigger where tgname = 'group_activities_protect_columns'")).rows[0].n;
      res = { before, after, policies, triggers };
      await tx.rollback();
    });
    expect(res).not.toBeNull();
    expect(res!.after).toEqual(res!.before);
    expect(res!.policies).toBe(6);
    expect(res!.triggers).toBe(1);
  });

  it("befintlig närvaro är manuell och kolumnen har standardvärdet manual (migrationen ändrar inga rader)", async () => {
    const r = await db.query<{ n: number }>("select count(*)::int as n from public.attendance where source = 'manual'");
    expect(r.rows[0].n).toBe(data.attendance.filter((a) => a.source === "manual").length);
    const def = await db.query<{ d: string }>("select column_default as d from information_schema.columns where table_name = 'attendance' and column_name = 'source'");
    expect(def.rows[0].d).toContain("manual");
  });
});

describe("gruppmål (0033): läsning och skrivning – samma regler i RLS, triggern och policy.ts", () => {
  const memWrite = (row: Tables["group_goal_results"], userId: string, rawAccess: RawAccess<Tables> = raw) => {
    const a = actorOf(findPersona(userId));
    const cur = rawAccess.get("group_goal_results", row.id);
    return (!cur || canReadRow("group_goal_results", cur, a, rawAccess)) && canWriteRow("group_goal_results", row, a, rawAccess);
  };
  const pgWrite = async (userId: string, sql: string) => allowed(await asPersona(findPersona(userId), (tx) => attempt(tx, sql)));
  const at = "2027-02-02T15:00";
  const mariaCaseId = raw.get("activities", "a-x-grupp-maria")!.caseId;
  const amiraCaseId = raw.get("activities", "a-x-grupp-amira")!.caseId;
  /** Ett ärende i avtalet som inte är inbjudet till Amiras aktivitet. */
  const notInvitedCaseId = data.cases.find((c) => c.contractId === "c-bot" && !data.activities.some((a) => a.groupActivityId === "ga-x-bot" && a.caseId === c.id))!.id;
  /** Deltagarens tillfälle i aktiviteten (ett id som inte finns när deltagaren inte är inbjuden). */
  const actOf = (groupActivityId: string, caseId: string) => data.activities.find((a) => a.groupActivityId === groupActivityId && a.caseId === caseId)?.id ?? "a-x-saknas";
  const ins = (id: string, groupActivityId: string, caseId: string, setBy: string, contractId = "c-bot", activityId = actOf(groupActivityId, caseId), goalVersion = 0) =>
    `insert into public.group_goal_results (id, contract_id, group_activity_id, case_id, activity_id, goal_version, achieved, set_by, set_at)
     values ('${id}', '${contractId}', '${groupActivityId}', '${caseId}', '${activityId}', ${goalVersion}, false, '${setBy}', '${at}')`;
  const row = (
    id: string, groupActivityId: string, caseId: string, setBy: string, contractId = "c-bot", activityId = actOf(groupActivityId, caseId), goalVersion = 0,
  ): Tables["group_goal_results"] => ({ id, contractId, groupActivityId, caseId, activityId, goalVersion, achieved: false, setBy, setAt: at });

  it("testdatat: Amiras aktivitet har ett mål, två deltagare är markerade och en har inget val (Klarade automatiskt)", () => {
    expect(raw.get("group_activities", "ga-x-bot")!.goal).toBe("Alla skriver ett CV");
    expect(data.group_goal_results.map((r) => [r.id, r.achieved])).toEqual([["ggr-x-amira", false], ["ggr-x-skyddad", false]]);
    expect(data.group_goal_results.some((r) => r.caseId === mariaCaseId)).toBe(false);
  });

  it("läsning per roll: Miljonbemanning utom ekonomen med full- eller teamåtkomst – aldrig kommunen eller ekonomen; skyddat ärende bara namngivna", async () => {
    for (const p of personas) {
      const pg = await asPersona(p, async (tx) => (await tx.query<{ id: string }>("select id from public.group_goal_results order by id")).rows.map((r) => r.id));
      const mem = data.group_goal_results.filter((x) => canReadRow("group_goal_results", x, actorOf(p), raw)).map((x) => x.id).sort();
      expect(pg, personaKey(p)).toEqual(mem);
    }
    const memOf = (key: string) => data.group_goal_results.filter((x) => canReadRow("group_goal_results", x, actorOf(findPersona(key)), raw)).map((x) => x.id).sort();
    for (const key of ["u-amira", "u-petra|coach", "u-sara", "u-karin", "u-robin"]) expect(memOf(key), key).toContain("ggr-x-amira");
    for (const key of ["u-lars", "k-maria", "k-omar"]) expect(memOf(key), key).toEqual([]);
    // Den vilande spärren: bara namngiven huvudcoach och avtalsansvarig ser valet i det skyddade ärendet.
    expect(memOf(SKYDDAD_CASE.leadCoachId!)).toContain("ggr-x-skyddad");
    expect(memOf("u-johan")).toContain("ggr-x-skyddad");
    for (const key of ["u-amira", "u-sara", "u-karin", "u-robin"]) expect(memOf(key), key).not.toContain("ggr-x-skyddad");
  });

  it("nytt val: den som arbetar i ärendet i eget namn, bara för en inbjuden deltagare i en aktivitet med mål som inte är inställd – aldrig chef, admin, ekonom eller kommunen", async () => {
    const cases: [string, string, Tables["group_goal_results"], boolean][] = [
      ["u-amira", ins("ggr-t1", "ga-x-bot", mariaCaseId, "u-amira"), row("ggr-t1", "ga-x-bot", mariaCaseId, "u-amira"), true],
      ["u-sara", ins("ggr-t2", "ga-x-bot", mariaCaseId, "u-sara"), row("ggr-t2", "ga-x-bot", mariaCaseId, "u-sara"), true],
      ["u-petra|coach", ins("ggr-t3", "ga-x-bot", mariaCaseId, "u-petra"), row("ggr-t3", "ga-x-bot", mariaCaseId, "u-petra"), true],
      [SUPERVISOR, ins("ggr-t3b", "ga-x-bot", mariaCaseId, "u-petra"), row("ggr-t3b", "ga-x-bot", mariaCaseId, "u-petra"), true],
      // I någon annans namn, fel avtal, inte inbjuden, inställd aktivitet.
      ["u-amira", ins("ggr-t4", "ga-x-bot", mariaCaseId, "u-sara"), row("ggr-t4", "ga-x-bot", mariaCaseId, "u-sara"), false],
      ["u-amira", ins("ggr-t5", "ga-x-bot", mariaCaseId, "u-amira", "c-ny"), row("ggr-t5", "ga-x-bot", mariaCaseId, "u-amira", "c-ny"), false],
      ["u-amira", ins("ggr-t6", "ga-x-installd", amiraCaseId, "u-amira"), row("ggr-t6", "ga-x-installd", amiraCaseId, "u-amira"), false],
      ["u-amira", ins("ggr-t7", "ga-x-bot", notInvitedCaseId, "u-amira"), row("ggr-t7", "ga-x-bot", notInvitedCaseId, "u-amira"), false],
      // Läsläge, ekonomen och kommunen.
      ["u-karin", ins("ggr-t8", "ga-x-bot", mariaCaseId, "u-karin"), row("ggr-t8", "ga-x-bot", mariaCaseId, "u-karin"), false],
      ["u-robin", ins("ggr-t9", "ga-x-bot", mariaCaseId, "u-robin"), row("ggr-t9", "ga-x-bot", mariaCaseId, "u-robin"), false],
      ["u-lars", ins("ggr-t10", "ga-x-bot", mariaCaseId, "u-lars"), row("ggr-t10", "ga-x-bot", mariaCaseId, "u-lars"), false],
      ["k-maria", ins("ggr-t11", "ga-x-bot", mariaCaseId, "k-maria"), row("ggr-t11", "ga-x-bot", mariaCaseId, "k-maria"), false],
    ];
    for (const [key, sql, r, want] of cases) {
      expect({ pg: await pgWrite(key, sql), mem: memWrite(r, key) }, `${key} ${r.id}`).toEqual({ pg: want, mem: want });
    }
  });

  it("aktiviteten utan mål: inget val kan sparas (triggern och policy.ts)", async () => {
    // Coachen tar bort målet och försöker sedan markera en deltagare – i samma transaktion.
    const pg = await asPersona(findPersona("u-amira"), async (tx) => {
      const clear = await attempt(tx, `update public.group_activities set goal = null, goal_version = 1, updated_at = '${at}', updated_by = 'u-amira' where id = 'ga-x-bot'`, [], { keep: true });
      return { clear, insert: await attempt(tx, ins("ggr-t12", "ga-x-bot", mariaCaseId, "u-amira")) };
    });
    expect(pg.clear).toMatchObject({ ok: true, rows: 1 });
    expect(pg.insert).toMatchObject({ ok: false, code: "23514" });
    const mem = new MemoryStore<Tables>(structuredClone(data), UNIQUE_KEYS);
    const ga = mem.rows("group_activities").find((g) => g.id === "ga-x-bot")!;
    ga.goal = null;
    ga.goalVersion = 1;
    expect(memWrite(row("ggr-t12", "ga-x-bot", mariaCaseId, "u-amira"), "u-amira", mem.raw())).toBe(false);
  });

  it("målets version följer målet: ändras målet räknas den upp med ett, och bara då – för alla (triggern och policy.ts)", async () => {
    const bot = raw.get("group_activities", "ga-x-bot")!;
    const upd = (sets: string) => `update public.group_activities set ${sets}, updated_at = '${at}', updated_by = 'u-amira' where id = 'ga-x-bot'`;
    const cases: [string, string, Partial<Tables["group_activities"]>, boolean][] = [
      ["nytt mål, ny version", "goal = 'Alla gör en intervju', goal_version = 1", { goal: "Alla gör en intervju", goalVersion: 1 }, true],
      ["målet borttaget, ny version", "goal = null, goal_version = 1", { goal: null, goalVersion: 1 }, true],
      ["nytt mål, samma version", "goal = 'Alla gör en intervju'", { goal: "Alla gör en intervju" }, false],
      ["nytt mål, två steg", "goal = 'Alla gör en intervju', goal_version = 2", { goal: "Alla gör en intervju", goalVersion: 2 }, false],
      ["samma mål, ny version", "name = 'Nytt namn', goal_version = 1", { name: "Nytt namn", goalVersion: 1 }, false],
      ["samma mål, samma version", "name = 'Nytt namn'", { name: "Nytt namn" }, true],
    ];
    for (const [label, sets, patch, want] of cases) {
      const r = { ...bot, ...patch, updatedAt: at, updatedBy: "u-amira" };
      expect({ pg: await pgWrite("u-amira", upd(sets)), mem: canWriteRow("group_activities", r, actorOf(findPersona("u-amira")), raw) }, label).toEqual({ pg: want, mem: want });
    }
    const service = await asUser(db, null, (tx) => attempt(tx, "update public.group_activities set goal = 'Alla gör en intervju' where id = 'ga-x-bot'"), { role: "service_role" });
    expect(service).toMatchObject({ ok: false, code: "23514" });
  });

  it("ett val gäller målet och inbjudan det gjordes för: en annan version eller ett annat tillfälle nekas, ett gammalt val kan föras över", async () => {
    const cases: [string, string, Tables["group_goal_results"], boolean][] = [
      ["målets nuvarande version och tillfälle", ins("ggr-t20", "ga-x-bot", mariaCaseId, "u-amira"), row("ggr-t20", "ga-x-bot", mariaCaseId, "u-amira"), true],
      ["en annan version", ins("ggr-t21", "ga-x-bot", mariaCaseId, "u-amira", "c-bot", "a-x-grupp-maria", 1), row("ggr-t21", "ga-x-bot", mariaCaseId, "u-amira", "c-bot", "a-x-grupp-maria", 1), false],
      ["en annan deltagares tillfälle", ins("ggr-t22", "ga-x-bot", mariaCaseId, "u-amira", "c-bot", "a-x-grupp-amira"), row("ggr-t22", "ga-x-bot", mariaCaseId, "u-amira", "c-bot", "a-x-grupp-amira"), false],
      ["ett tillfälle i en annan aktivitet", ins("ggr-t23", "ga-x-bot", amiraCaseId, "u-amira", "c-bot", "a-x-grupp-forra"), row("ggr-t23", "ga-x-bot", amiraCaseId, "u-amira", "c-bot", "a-x-grupp-forra"), false],
    ];
    for (const [label, sql, r, want] of cases) {
      expect({ pg: await pgWrite("u-amira", sql), mem: memWrite(r, "u-amira") }, label).toEqual({ pg: want, mem: want });
    }
    // Coachen byter målet: Amiras val gäller det tidigare målet. Ett nytt val utan att föra över raden nekas; raden förs över till
    // det nya målet (samma tillfälle) – också med samma val; en ny rad för det tidigare målet nekas, för det nya tillåts.
    const pg = await asPersona(findPersona("u-amira"), async (tx) => {
      const change = await attempt(tx, `update public.group_activities set goal = 'Alla gör en intervju', goal_version = 1, updated_at = '${at}', updated_by = 'u-amira' where id = 'ga-x-bot'`, [], { keep: true });
      return {
        change,
        stale: await attempt(tx, `update public.group_goal_results set achieved = true, set_at = '${at}' where id = 'ggr-x-amira'`),
        moved: await attempt(tx, `update public.group_goal_results set goal_version = 1, set_at = '${at}' where id = 'ggr-x-amira'`),
        old: await attempt(tx, ins("ggr-t24", "ga-x-bot", mariaCaseId, "u-amira")),
        fresh: await attempt(tx, ins("ggr-t25", "ga-x-bot", mariaCaseId, "u-amira", "c-bot", "a-x-grupp-maria", 1)),
      };
    });
    expect(pg).toMatchObject({ change: { ok: true, rows: 1 }, stale: { ok: false }, moved: { ok: true, rows: 1 }, old: { ok: false }, fresh: { ok: true, rows: 1 } });
    const mem = new MemoryStore<Tables>(structuredClone(data), UNIQUE_KEYS);
    Object.assign(mem.rows("group_activities").find((g) => g.id === "ga-x-bot")!, { goal: "Alla gör en intervju", goalVersion: 1 });
    const cur = mem.raw().get("group_goal_results", "ggr-x-amira")!;
    expect({
      stale: memWrite({ ...cur, achieved: true, setAt: at }, "u-amira", mem.raw()),
      moved: memWrite({ ...cur, goalVersion: 1, setAt: at }, "u-amira", mem.raw()),
      old: memWrite(row("ggr-t24", "ga-x-bot", mariaCaseId, "u-amira"), "u-amira", mem.raw()),
      fresh: memWrite(row("ggr-t25", "ga-x-bot", mariaCaseId, "u-amira", "c-bot", "a-x-grupp-maria", 1), "u-amira", mem.raw()),
    }).toEqual({ stale: false, moved: true, old: false, fresh: true });
  });

  it("deltagaren tas bort ur aktiviteten: valet försvinner med tillfället (on delete cascade) – också utan rätt att radera val", async () => {
    const pg = await asPersona(findPersona("u-amira"), async (tx) => {
      const del = await attempt(tx, "delete from public.activities where id = 'a-x-grupp-amira'", [], { keep: true });
      const left = (await tx.query<{ n: number }>("select count(*)::int as n from public.group_goal_results where id = 'ggr-x-amira'")).rows[0].n;
      return { del, left };
    });
    expect(pg).toEqual({ del: { ok: true, rows: 1 }, left: 0 });
  });

  it("ändra: bara valet, i eget namn – aktivitet, ärende och avtal ändras aldrig, en ändring utan nytt val nekas och ingen raderar", async () => {
    const cur = raw.get("group_goal_results", "ggr-x-amira")!;
    const cases: [string, string, Tables["group_goal_results"], boolean][] = [
      ["u-amira", `update public.group_goal_results set achieved = true, set_at = '${at}' where id = 'ggr-x-amira'`, { ...cur, achieved: true, setAt: at }, true],
      ["u-sara", `update public.group_goal_results set achieved = true, set_by = 'u-sara', set_at = '${at}' where id = 'ggr-x-amira'`, { ...cur, achieved: true, setBy: "u-sara", setAt: at }, true],
      ["u-sara", `update public.group_goal_results set achieved = true, set_at = '${at}' where id = 'ggr-x-amira'`, { ...cur, achieved: true, setAt: at }, false],
      ["u-amira", `update public.group_goal_results set set_at = '${at}' where id = 'ggr-x-amira'`, { ...cur, setAt: at }, false],
      ["u-amira", `update public.group_goal_results set activity_id = 'a-x-grupp-maria', set_at = '${at}' where id = 'ggr-x-amira'`, { ...cur, activityId: "a-x-grupp-maria", setAt: at }, false],
      ["u-amira", `update public.group_goal_results set achieved = true, case_id = '${mariaCaseId}' where id = 'ggr-x-amira'`, { ...cur, achieved: true, caseId: mariaCaseId }, false],
      ["u-karin", `update public.group_goal_results set achieved = true, set_by = 'u-karin' where id = 'ggr-x-amira'`, { ...cur, achieved: true, setBy: "u-karin" }, false],
      ["u-lars", `update public.group_goal_results set achieved = true, set_by = 'u-lars' where id = 'ggr-x-amira'`, { ...cur, achieved: true, setBy: "u-lars" }, false],
      ["k-maria", `update public.group_goal_results set achieved = true, set_by = 'k-maria' where id = 'ggr-x-amira'`, { ...cur, achieved: true, setBy: "k-maria" }, false],
    ];
    for (const [key, sql, r, want] of cases) {
      expect({ pg: await pgWrite(key, sql), mem: memWrite(r, key) }, `${key} ${sql}`).toEqual({ pg: want, mem: want });
    }
    for (const key of ["u-amira", "u-johan", "u-robin"]) {
      expect(await pgWrite(key, "delete from public.group_goal_results where id = 'ggr-x-amira'"), key).toBe(false);
      expect(canWriteRow("group_goal_results", cur, actorOf(findPersona(key)), raw), key).toBe(false);
    }
  });

  it("ett val per deltagare och aktivitet: databasen och minnet stoppar ett andra (23505), också för servern", async () => {
    const service = await asUser(db, null, (tx) => attempt(tx, ins("ggr-t13", "ga-x-bot", amiraCaseId, "u-amira")), { role: "service_role" });
    expect(service).toMatchObject({ ok: false, code: "23505" });
    const mem = new MemoryStore<Tables>(structuredClone(data), UNIQUE_KEYS);
    expect(() => mem.insertRow("group_goal_results", row("ggr-t13", "ga-x-bot", amiraCaseId, "u-amira"))).toThrow(UniqueError);
  });

  it("gruppmålets längd: 1–300 tecken (btrim) – kontrollen i tabellen och policy.ts", async () => {
    const bot = raw.get("group_activities", "ga-x-bot")!;
    const set = (goal: string) => `update public.group_activities set goal = '${goal}', goal_version = 1, updated_at = '${at}', updated_by = 'u-amira' where id = 'ga-x-bot'`;
    for (const [goal, want] of [["Alla gör en intervju", true], ["   ", false], ["x".repeat(301), false], ["x".repeat(300), true]] as const) {
      const r = { ...bot, goal, goalVersion: 1, updatedAt: at, updatedBy: "u-amira" };
      expect({ pg: await pgWrite("u-amira", set(goal)), mem: canWriteRow("group_activities", r, actorOf(findPersona("u-amira")), raw) }, goal.slice(0, 10)).toEqual({ pg: want, mem: want });
    }
  });

  it("migrationen tål att köras igen och ändrar då ingenting", async () => {
    const sql = readFileSync(`${MIGRATIONS_DIR}/0033_gruppmal.sql`, "utf8");
    let res: { before: number; after: number; policies: number; triggers: number } | null = null;
    await db.transaction(async (tx) => {
      const count = async () => (await tx.query<{ n: number }>("select (select count(*) from public.group_goal_results) + (select count(*) from public.group_activities where goal is not null) as n")).rows[0].n;
      const before = await count();
      await tx.exec(sql);
      await tx.exec(sql);
      const after = await count();
      const policies = (await tx.query<{ n: number }>("select count(*)::int as n from pg_policies where tablename = 'group_goal_results'")).rows[0].n;
      const triggers = (await tx.query<{ n: number }>("select count(*)::int as n from pg_trigger where tgname in ('group_goal_results_check', 'group_activities_goal_version')")).rows[0].n;
      res = { before, after, policies, triggers };
      await tx.rollback();
    });
    expect(res).not.toBeNull();
    expect(res!.after).toEqual(res!.before);
    expect(res!.policies).toBe(3);
    expect(res!.triggers).toBe(2);
  });
});

// ================================================================ Yrkesområden, nivåer och återkommande aktiviteter (0035)
describe("återkommande aktiviteter (0035): läsning och skrivning – samma regler i RLS, triggern och policy.ts", () => {
  const at = "2027-02-01T09:30";
  const pgWrite = async (userId: string, sql: string) => allowed(await asPersona(findPersona(userId), (tx) => attempt(tx, sql)));
  const memWrite = (row: Tables["group_activity_series"], userId: string) => {
    const a = actorOf(findPersona(userId));
    const cur = raw.get("group_activity_series", row.id);
    return (!cur || canReadRow("group_activity_series", cur, a, raw)) && canWriteRow("group_activity_series", row, a, raw);
  };
  const LEVEL_2 = "grp-c-bot-niva-2";
  const series = (id: string, createdBy: string, patch: Partial<Tables["group_activity_series"]> = {}): Tables["group_activity_series"] => ({
    id, contractId: "c-bot", name: "Jobbsök", kind: "annat", audience: "level", audienceLevelId: LEVEL_2, audienceAreaCode: null, weekdays: [2, 4], startTime: "10:00",
    durationMin: 90, location: "Miljonbemanning Alby", responsibleId: null, goal: null, startsOn: "2027-02-08", endsOn: null, notify: false, createdBy, createdAt: at,
    updatedAt: null, updatedBy: null, endedAt: null, endedBy: null, ...patch,
  });
  const insertSeries = (r: Tables["group_activity_series"]) => insertSql("group_activity_series", r as unknown as Record<string, unknown>);

  it("testdatat: en serie per nivå med tillfällen 14 dagar framåt och månadens yrkesområdesträffar – deltagarna inbjudna av målgruppen", () => {
    expect(data.group_activity_series.map((x) => [x.audienceLevelId, x.weekdays.length])).toEqual([1, 2, 3, 4, 5].map((n) => [`grp-c-bot-niva-${n}`, n === 5 ? 1 : 2]));
    const occ = data.group_activities.filter((g) => g.seriesId);
    expect(occ.length).toBeGreaterThan(5);
    expect(occ.every((g) => g.startsAt > "2027-02-01T09:12" && g.startsAt <= "2027-02-15T23:59")).toBe(true);
    expect(data.group_activities.filter((g) => g.audience === "area").map((g) => g.audienceAreaCode)).toEqual(["G", "F", "D"]);
    expect(data.activities.filter((a) => a.inviteSource === "audience").length).toBeGreaterThan(50);
  });

  it("läsning per testperson: Miljonbemanning i avtalet utom ekonomen – aldrig kommunen", async () => {
    for (const p of personas) {
      const pg = await asPersona(p, async (tx) => (await tx.query<{ id: string }>("select id from public.group_activity_series order by id")).rows.map((r) => r.id));
      const mem = data.group_activity_series.filter((x) => canReadRow("group_activity_series", x, actorOf(p), raw)).map((x) => x.id).sort();
      expect(pg, personaKey(p)).toEqual(mem);
    }
    const memOf = (userId: string) => data.group_activity_series.filter((x) => canReadRow("group_activity_series", x, actorOf(findPersona(userId)), raw)).length;
    for (const userId of ["u-amira", "u-sara", "u-karin", "u-robin"]) expect(memOf(userId), userId).toBe(5);
    for (const userId of ["u-lars", "k-maria", "k-omar"]) expect(memOf(userId), userId).toBe(0);
  }, 60_000);

  it("ny serie: i eget namn av den som arbetar i ärendena, med en nivå eller ett yrkesområde i avtalet och giltiga dagar och tid", async () => {
    const cases: [string, Tables["group_activity_series"], boolean][] = [
      ["u-amira", series("ser-t1", "u-amira"), true],
      ["u-sara", series("ser-t2", "u-sara", { audience: "area", audienceLevelId: null, audienceAreaCode: "G" }), true],
      ["u-amira", series("ser-t3", "u-sara"), false],
      ["u-karin", series("ser-t4", "u-karin"), false],
      ["u-robin", series("ser-t5", "u-robin"), false],
      ["u-lars", series("ser-t6", "u-lars"), false],
      ["k-maria", series("ser-t7", "k-maria"), false],
      ["u-amira", series("ser-t8", "u-amira", { contractId: "c-ny" }), false],
      ["u-amira", series("ser-t9", "u-amira", { endedAt: at, endedBy: "u-amira" }), false],
      // Målgruppen: alltid en nivå eller ett yrkesområde, och den ska finnas i avtalet.
      ["u-amira", series("ser-t10", "u-amira", { audience: "manual" as never, audienceLevelId: null }), false],
      ["u-amira", series("ser-t11", "u-amira", { audienceLevelId: "grp-c-bot-vill-arbeta-heltid" }), false],
      ["u-amira", series("ser-t12", "u-amira", { audience: "area", audienceLevelId: null, audienceAreaCode: "X" }), false],
      ["u-amira", series("ser-t13", "u-amira", { audienceAreaCode: "G" }), false],
      // Veckodagarna: 1–5, stigande, minst en, inga dubbletter; tiden HH:MM; sista dagen inte före första.
      ["u-amira", series("ser-t14", "u-amira", { weekdays: [] }), false],
      ["u-amira", series("ser-t15", "u-amira", { weekdays: [6] }), false],
      ["u-amira", series("ser-t16", "u-amira", { weekdays: [2, 2] }), false],
      ["u-amira", series("ser-t17", "u-amira", { weekdays: [4, 2] }), false],
      ["u-amira", series("ser-t18", "u-amira", { weekdays: [1, 2, 3, 4, 5] }), true],
      ["u-amira", series("ser-t19", "u-amira", { startTime: "25:00" }), false],
      ["u-amira", series("ser-t20", "u-amira", { endsOn: "2027-02-01" }), false],
    ];
    for (const [userId, r, want] of cases) {
      expect({ pg: await pgWrite(userId, insertSeries(r)), mem: memWrite(r, userId) }, `${userId} ${r.id}`).toEqual({ pg: want, mem: want });
    }
  }, 60_000);

  it("ändra och avsluta: namn, plats, ansvarig, gruppmål och meddelandet i eget namn – dagar, tid, typ och målgrupp aldrig; avslutad ändras inte; ingen raderar", async () => {
    const s0 = raw.get("group_activity_series", "ser-c-bot-niva-2")!;
    const upd = (set: string) => `update public.group_activity_series set ${set} where id = '${s0.id}'`;
    const cases: [string, string, Tables["group_activity_series"], boolean][] = [
      ["u-amira", upd(`name = 'Rutiner', updated_at = '${at}', updated_by = 'u-amira'`), { ...s0, name: "Rutiner", updatedAt: at, updatedBy: "u-amira" }, true],
      ["u-amira", upd(`notify = true, updated_at = '${at}', updated_by = 'u-amira'`), { ...s0, notify: true, updatedAt: at, updatedBy: "u-amira" }, true],
      ["u-amira", upd(`name = 'Rutiner', updated_at = '${at}', updated_by = 'u-sara'`), { ...s0, name: "Rutiner", updatedAt: at, updatedBy: "u-sara" }, false],
      ["u-amira", upd(`weekdays = array[1]::integer[], updated_at = '${at}', updated_by = 'u-amira'`), { ...s0, weekdays: [1], updatedAt: at, updatedBy: "u-amira" }, false],
      ["u-amira", upd(`start_time = '11:00', updated_at = '${at}', updated_by = 'u-amira'`), { ...s0, startTime: "11:00", updatedAt: at, updatedBy: "u-amira" }, false],
      ["u-amira", upd(`audience_level_id = 'grp-c-bot-niva-3', updated_at = '${at}', updated_by = 'u-amira'`), { ...s0, audienceLevelId: "grp-c-bot-niva-3", updatedAt: at, updatedBy: "u-amira" }, false],
      ["u-amira", upd(`kind = 'yrkesmoment', updated_at = '${at}', updated_by = 'u-amira'`), { ...s0, kind: "yrkesmoment", updatedAt: at, updatedBy: "u-amira" }, false],
      ["u-amira", upd(`ends_on = '2027-02-01', ended_at = '${at}', ended_by = 'u-amira'`), { ...s0, endsOn: "2027-02-01", endedAt: at, endedBy: "u-amira" }, false],
      ["u-amira", upd(`ends_on = '2027-02-09', ended_at = '${at}', ended_by = 'u-amira'`), { ...s0, endsOn: "2027-02-09", endedAt: at, endedBy: "u-amira" }, true],
      ["u-amira", upd(`ends_on = '2027-03-01'`), { ...s0, endsOn: "2027-03-01" }, false],
      ["u-amira", upd(`ended_at = '${at}', ended_by = 'u-sara'`), { ...s0, endedAt: at, endedBy: "u-sara" }, false],
      ["u-amira", upd("name = name"), s0, false],
      ["u-karin", upd(`name = 'X', updated_at = '${at}', updated_by = 'u-karin'`), { ...s0, name: "X", updatedAt: at, updatedBy: "u-karin" }, false],
      ["u-lars", upd(`name = 'X', updated_at = '${at}', updated_by = 'u-lars'`), { ...s0, name: "X", updatedAt: at, updatedBy: "u-lars" }, false],
    ];
    for (const [userId, sql, row, want] of cases) {
      expect({ pg: await pgWrite(userId, sql), mem: memWrite(row, userId) }, `${userId} ${sql}`).toEqual({ pg: want, mem: want });
    }
    // En avslutad serie ändras inte.
    const ended = { ...s0, endsOn: "2027-02-09", endedAt: at, endedBy: "u-amira" };
    const pg = await asPersona(findPersona("u-amira"), async (tx) => {
      await attempt(tx, upd(`ends_on = '2027-02-09', ended_at = '${at}', ended_by = 'u-amira'`), [], { keep: true });
      return allowed(await attempt(tx, upd(`name = 'Igen', updated_at = '${at}', updated_by = 'u-amira'`)));
    });
    const rawEnded: RawAccess<Tables> = { ...raw, get: ((t: TableName, id: string) => (t === "group_activity_series" && id === s0.id ? ended : raw.get(t as never, id))) as RawAccess<Tables>["get"] };
    expect({ pg, mem: canWriteRow("group_activity_series", { ...ended, name: "Igen", updatedAt: at, updatedBy: "u-amira" }, actorOf(findPersona("u-amira")), rawEnded) }).toEqual({ pg: false, mem: false });
    for (const userId of ["u-amira", "u-johan", "u-robin"]) {
      expect(await pgWrite(userId, `delete from public.group_activity_series where id = '${s0.id}'`), userId).toBe(false);
      expect(canWriteRow("group_activity_series", s0, actorOf(findPersona(userId)), raw), userId).toBe(false);
    }
  }, 60_000);
});

describe("målgrupp, serie och inbjudningens källa på gruppaktiviteterna (0035) – samma regler i RLS, triggrarna och policy.ts", () => {
  const at = "2027-02-01T09:30";
  const pgWrite = async (userId: string, sql: string) => allowed(await asPersona(findPersona(userId), (tx) => attempt(tx, sql)));
  const memWrite = <N extends TableName>(t: N, row: Tables[N], userId: string) => {
    const a = actorOf(findPersona(userId));
    const cur = raw.get(t, row.id);
    return (!cur || canReadRow(t, cur, a, raw)) && canWriteRow(t, row, a, raw);
  };
  const newGroup = (id: string, createdBy: string, patch: Partial<Tables["group_activities"]> = {}): Tables["group_activities"] => ({
    id, contractId: "c-bot", name: "Yrkesområdesträff", kind: "annat", startsAt: "2027-02-18T14:00", durationMin: 90, location: "Miljonbemanning Alby", responsibleId: null, createdBy,
    createdAt: at, updatedAt: null, updatedBy: null, cancelledAt: null, cancelledBy: null, goal: null, goalVersion: 0, audience: "manual", audienceLevelId: null,
    audienceAreaCode: null, seriesId: null, notify: false, ...patch,
  });
  const ins = (r: Tables["group_activities"]) => insertSql("group_activities", r as unknown as Record<string, unknown>);

  it("ny aktivitet: målgruppen ska finnas i avtalet; tillfällen i en serie skapas bara av servern", async () => {
    const cases: [string, Tables["group_activities"], boolean][] = [
      ["u-sara", newGroup("ga-t1", "u-sara", { audience: "area", audienceAreaCode: "G" }), true],
      ["u-amira", newGroup("ga-t2", "u-amira", { audience: "level", audienceLevelId: "grp-c-bot-niva-3" }), true],
      ["u-amira", newGroup("ga-t3", "u-amira", { audience: "area", audienceAreaCode: "X" }), false],
      ["u-amira", newGroup("ga-t4", "u-amira", { audience: "level", audienceLevelId: "grp-c-bot-vill-arbeta-deltid" }), false],
      ["u-amira", newGroup("ga-t5", "u-amira", { audience: "manual", audienceAreaCode: "G" }), false],
      ["u-amira", newGroup("ga-t6", "u-amira", { audience: "level" }), false],
      ["u-amira", newGroup("ga-t7", "u-amira", { audience: "level", audienceLevelId: "grp-c-bot-niva-2", seriesId: "ser-c-bot-niva-2" }), false],
    ];
    for (const [userId, r, want] of cases) {
      expect({ pg: await pgWrite(userId, ins(r)), mem: memWrite("group_activities", r, userId) }, `${userId} ${r.id}`).toEqual({ pg: want, mem: want });
    }
    // Servern (service role) skapar tillfället i serien.
    const occ = newGroup("ga-t8", "u-erik", { audience: "level", audienceLevelId: "grp-c-bot-niva-2", seriesId: "ser-c-bot-niva-2", startsAt: "2027-02-17T13:30" });
    expect(await asUser(db, null, (tx) => attempt(tx, ins(occ)), { role: "service_role" })).toMatchObject({ ok: true, rows: 1 });
  }, 60_000);

  it("ändra: serien ändras aldrig; målgruppen kan sättas på en aktivitet utan målgrupp", async () => {
    const bot = raw.get("group_activities", "ga-x-bot")!;
    const occ = data.group_activities.find((g) => g.seriesId === "ser-c-bot-niva-2")!;
    const cases: [string, string, Tables["group_activities"], boolean][] = [
      ["u-amira", `update public.group_activities set audience = 'level', audience_level_id = 'grp-c-bot-niva-3', updated_at = '${at}', updated_by = 'u-amira' where id = 'ga-x-bot'`,
        { ...bot, audience: "level", audienceLevelId: "grp-c-bot-niva-3", updatedAt: at, updatedBy: "u-amira" }, true],
      ["u-amira", `update public.group_activities set series_id = 'ser-c-bot-niva-2', updated_at = '${at}', updated_by = 'u-amira' where id = 'ga-x-bot'`,
        { ...bot, seriesId: "ser-c-bot-niva-2", updatedAt: at, updatedBy: "u-amira" }, false],
      ["u-amira", `update public.group_activities set series_id = null, updated_at = '${at}', updated_by = 'u-amira' where id = '${occ.id}'`,
        { ...occ, seriesId: null, updatedAt: at, updatedBy: "u-amira" }, false],
      ["u-amira", `update public.group_activities set location = 'Rum 3', updated_at = '${at}', updated_by = 'u-amira' where id = '${occ.id}'`,
        { ...occ, location: "Rum 3", updatedAt: at, updatedBy: "u-amira" }, true],
    ];
    for (const [userId, sql, row, want] of cases) {
      expect({ pg: await pgWrite(userId, sql), mem: memWrite("group_activities", row, userId) }, `${userId} ${sql}`).toEqual({ pg: want, mem: want });
    }
  }, 60_000);

  it("ett tillfälle per serie och starttid: databasen och minnet stoppar en dubblett (23505), också för servern", async () => {
    const occ = data.group_activities.find((g) => g.seriesId === "ser-c-bot-niva-2")!;
    const dup = { ...occ, id: "ga-t-dup" };
    // Tiderna i testdatat är Stockholms tid (seed.sql sätter tidszonen) – samma tidszon här, så att starttiden är samma tidpunkt.
    expect(await asUser(db, null, async (tx) => {
      await tx.exec("set local timezone to 'Europe/Stockholm'");
      return attempt(tx, ins(dup));
    }, { role: "service_role" })).toMatchObject({ ok: false, code: "23505" });
    const mem = new MemoryStore<Tables>(structuredClone(data), UNIQUE_KEYS);
    expect(() => mem.insertRow("group_activities", dup)).toThrow(UniqueError);
    // Utan serie gäller ingen sådan regel (två aktiviteter samma tid går bra).
    mem.insertRow("group_activities", { ...dup, id: "ga-t-utan-1", seriesId: null, audience: "manual", audienceLevelId: null });
    mem.insertRow("group_activities", { ...dup, id: "ga-t-utan-2", seriesId: null, audience: "manual", audienceLevelId: null });
  });

  it("inbjudningens källa: användare skapar bara manual och ändrar aldrig källan – audience skriver bara servern; borttagning prövas som förut", async () => {
    // En rad som målgruppen bjöd in, i ett ärende som Amira arbetar i (inte det skyddade – vilande spärr).
    const audienceRow = data.activities.find((a) => a.inviteSource === "audience" && a.caseId !== SKYDDAD_CASE.id)!;
    const own = data.activities.find((a) => a.caseId === audienceRow.caseId && a.inviteSource === "manual" && !a.groupActivityId)!;
    const insAct = (id: string, source: string) =>
      `insert into public.activities (id, case_id, kind, starts_at, duration_min, location, note, group_activity_id, invite_source)
       values ('${id}', '${own.caseId}', 'möte', '2027-03-01T15:00', 60, 'Alby', '', null, '${source}')`;
    const newAct = (id: string, inviteSource: Tables["activities"]["inviteSource"]): Tables["activities"] => ({
      id, caseId: own.caseId, kind: "möte", startsAt: "2027-03-01T15:00", durationMin: 60, location: "Alby", note: "", groupActivityId: null, inviteSource,
    });
    const coach = "u-amira";
    const cases: [string, string, Tables["activities"], boolean][] = [
      [coach, insAct("a-t-src1", "manual"), newAct("a-t-src1", "manual"), true],
      [coach, insAct("a-t-src2", "audience"), newAct("a-t-src2", "audience"), false],
      [coach, `update public.activities set invite_source = 'manual' where id = '${audienceRow.id}'`, { ...audienceRow, inviteSource: "manual" }, false],
      [coach, `update public.activities set invite_source = 'audience' where id = '${own.id}'`, { ...own, inviteSource: "audience" }, false],
      [coach, `update public.activities set location = 'Rum 4' where id = '${audienceRow.id}'`, { ...audienceRow, location: "Rum 4" }, true],
    ];
    for (const [userId, sql, row, want] of cases) {
      expect({ pg: await pgWrite(userId, sql), mem: memWrite("activities", row, userId) }, `${userId} ${sql}`).toEqual({ pg: want, mem: want });
    }
    // Borttagning (ingen närvaro): den som arbetar i ärendet – också en rad som målgruppen bjöd in (inställd aktivitet).
    expect(await pgWrite(coach, `delete from public.activities where id = '${audienceRow.id}'`)).toBe(true);
    expect(canWriteRow("activities", audienceRow, actorOf(findPersona(coach)), raw)).toBe(true);
    // Servern skriver audience.
    expect(await asUser(db, null, (tx) => attempt(tx, insAct("a-t-src3", "audience")), { role: "service_role" })).toMatchObject({ ok: true, rows: 1 });
    // Kontrollen i tabellen: bara manual och audience.
    expect(await asUser(db, null, (tx) => attempt(tx, insAct("a-t-src4", "annat")), { role: "service_role" })).toMatchObject({ ok: false, code: "23514" });
  }, 60_000);

  it("fria grupper finns inte längre: en ny aktiv grupp, en återställd grupp och ett nytt aktivt medlemskap i en grupp nekas – också för servern", async () => {
    const service = <T>(fn: (tx: Tx) => Promise<T>) => asUser(db, null, fn, { role: "service_role" });
    const g = (id: string, archived: boolean) =>
      `insert into public.groupings (id, contract_id, kind, category, name, description, sort_order, created_at, created_by, updated_at, updated_by, archived_at, archived_by)
       values ('${id}', 'c-bot', 'group', null, 'Tisdagsgruppen', '', 9, '${at}', 'u-sara', null, null, ${archived ? `'${at}', 'system'` : "null, null"})`;
    expect(await service((tx) => attempt(tx, g("grp-t-aktiv", false)))).toMatchObject({ ok: false, code: "23514" });
    // Historik (arkiverad) går att läsa in.
    expect(await service((tx) => attempt(tx, g("grp-t-arkiv", true)))).toMatchObject({ ok: true, rows: 1 });
    expect(await service((tx) => attempt(tx, "update public.groupings set archived_at = null, archived_by = null where id = 'grp-c-bot-g-mandag'"))).toMatchObject({ ok: false, code: "23514" });
    const removed = data.grouping_members.find((m) => m.kind === "group" && m.removedAt != null)!;
    expect(await service((tx) => attempt(tx, `update public.grouping_members set removed_at = null, removed_by = null where id = '${removed.id}'`))).toMatchObject({ ok: false, code: "23514" });
  });

  it("migrationen tål att köras igen (SQL Editor) och ändrar då ingenting", async () => {
    const sql = readFileSync(`${MIGRATIONS_DIR}/0035_yrkesomraden_nivaer.sql`, "utf8");
    type Snap = { groupings: string; members: string; policies: number; triggers: number };
    let res: { before: Snap; after: Snap } | null = null;
    await db.transaction(async (tx) => {
      const snap = async (): Promise<Snap> => ({
        groupings: (await tx.query<{ x: string }>("select string_agg(id || ':' || coalesce(archived_by, '-') || ':' || coalesce(archived_at::text, '-'), ',' order by id) as x from public.groupings")).rows[0].x,
        members: (await tx.query<{ x: string }>("select string_agg(id || ':' || coalesce(removed_at::text, '-'), ',' order by id) as x from public.grouping_members")).rows[0].x,
        policies: (await tx.query<{ n: number }>("select count(*)::int as n from pg_policies where tablename in ('group_activity_series', 'group_activities')")).rows[0].n,
        triggers: (await tx.query<{ n: number }>(
          "select count(*)::int as n from pg_trigger where tgname in ('groupings_no_free_groups', 'grouping_members_no_free_groups', 'group_activity_series_protect_columns', 'group_activities_audience', 'group_activity_series_audience', 'group_activities_series', 'activities_invite_source')",
        )).rows[0].n,
      });
      const before = await snap();
      await tx.exec(sql);
      await tx.exec(sql);
      res = { before, after: await snap() };
      await tx.rollback();
    });
    expect(res).not.toBeNull();
    expect(res!.after).toEqual(res!.before);
    expect(res!.after.policies).toBe(6);
    expect(res!.after.triggers).toBe(7);
  });
});

describe("byt yrkesområde (0036): läsning och skrivning – samma regler i RLS, triggern och policy.ts", () => {
  const LINNEA = "case-260163";
  const NADIA = "case-260143";
  // Ett nytt byte i Linneas ärende (D → C, nummer 2) – Linnea har D och yrkesspåret Restaurangbiträde sedan testdatats byte,
  // inget alternativ. Den 1 februari – fakturan från mars. Varje byte har en egen ny anteckning (note-<id>) av den som byter.
  // Tiden är testklockans (mm.app_now(): klockan står på 09.12 när blocket börjar – se beforeEach nedan).
  const at = "2027-02-01T09:12";
  const row = (id: string, changedBy: string, patch: Partial<Tables["case_area_changes"]> = {}): Tables["case_area_changes"] => ({
    id, contractId: "c-bot", caseId: LINNEA, fromArea: "D", toArea: "C", effectiveMonth: "2027-03", changedBy, changedAt: at, noteId: `note-${id}`, seq: 2,
    fromTrack: "Restaurangbiträde", toTrack: "", fromSecondaryArea: null, ...patch,
  });
  const ins = (r: Tables["case_area_changes"]) => insertSql("case_area_changes", r as unknown as Record<string, unknown>);
  /** Motiveringen till bytet: en ny anteckning av den som byter (eller det som patch säger), i bytets ärende. */
  const noteFor = (r: Tables["case_area_changes"], patch: Partial<Tables["case_notes"]> = {}): Tables["case_notes"] => ({
    id: `note-${r.id}`, contractId: "c-bot", caseId: r.caseId, authorId: r.changedBy, occurredOn: "2027-02-01", kind: "other", audience: "team",
    body: "Byte av yrkesområde: motivering.", createdAt: at, updatedAt: null, removedAt: null, removedBy: null, ...patch,
  });
  const insNote = (n: Tables["case_notes"]) => insertSql("case_notes", n as unknown as Record<string, unknown>);
  // Minnet med samma klocka som databasen (RawAccess.now – triggern jämför med mm.app_now()) och anteckningen för bytet.
  const clockedWith = (notes: Tables["case_notes"][] = []): RawAccess<Tables> => ({
    get: ((n: TableName, id: string) => (n === "case_notes" ? notes.find((x) => x.id === id) ?? raw.get("case_notes", id) : raw.get(n, id))) as RawAccess<Tables>["get"],
    all: ((n: TableName) => (n === "case_notes" ? [...raw.all("case_notes"), ...notes] : raw.all(n))) as RawAccess<Tables>["all"],
    now: () => at,
  });
  const memWrite = (r: Tables["case_area_changes"], key: string, notes: Tables["case_notes"][] = [noteFor(r)]) => canWriteRow("case_area_changes", r, actorOf(findPersona(key)), clockedWith(notes));
  /** Som testpersonen, med anteckningen (anteckningarna) inlagd först som postgres i samma transaktion. */
  const asPersonaWith = <T,>(key: string, notes: Tables["case_notes"][], fn: (tx: Tx) => Promise<T>): Promise<T> => {
    const p = findPersona(key);
    const roles = new Set(data.memberships.filter((m) => m.userId === p.actor.userId).map((m) => m.role));
    return asUser(db, authOf(p.actor.userId), fn, {
      before: async (tx) => {
        for (const n of notes) await tx.query(insNote(n));
        if (roles.size > 1) await chooseRole(p.actor.userId, p.actor.role)(tx);
      },
    });
  };
  const pgChange = async (key: string, r: Tables["case_area_changes"], notes: Tables["case_notes"][] = [noteFor(r)]) => allowed(await asPersonaWith(key, notes, (tx) => attempt(tx, ins(r))));
  const serviceChange = (r: Tables["case_area_changes"], notes: Tables["case_notes"][] = [noteFor(r)]) =>
    asUser(db, null, (tx) => attempt(tx, ins(r)), { role: "service_role", before: async (tx) => { for (const n of notes) await tx.query(insNote(n)); } });
  const pgWrite = async (key: string, sql: string) => allowed(await asPersona(findPersona(key), (tx) => attempt(tx, sql)));
  // Testklockan startar om på 09.12 (som när seeden lästes in) – blocket kan köras långt efter att databasen skapades. Tiderna i
  // raderna är Stockholms tid: samma tidszon som databasen har i drift (0001; en kopia av databasen i testet startar i UTC).
  beforeEach(async () => {
    await db.exec("set timezone to 'Europe/Stockholm'");
    await db.query(`update public.app_settings set value = to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') where key = 'clock_real_epoch'`);
  });

  it("testdatat: Linneas byte G → D den 27 januari med motiveringen i en anteckning, fakturan på D från februari", () => {
    expect(data.case_area_changes).toEqual([expect.objectContaining({
      id: "cac-seed-linnea", caseId: LINNEA, fromArea: "G", toArea: "D", effectiveMonth: "2027-02", noteId: "note-byte-linnea", seq: 1,
      fromTrack: "Lagerarbetare – plock och pack", toTrack: "Restaurangbiträde", fromSecondaryArea: "D",
    })]);
    expect(raw.get("case_notes", "note-byte-linnea")?.caseId).toBe(LINNEA);
    expect(raw.get("cases", LINNEA)).toMatchObject({ primaryAreaCode: "D", vocationalTrack: "Restaurangbiträde", secondaryAreaCode: null });
  });

  it("läsning per roll: Miljonbemanning i avtalet, också ekonomen – aldrig kommunen", async () => {
    for (const p of personas) {
      const pg = await asPersona(p, async (tx) => (await tx.query<{ id: string }>("select id from public.case_area_changes order by id")).rows.map((r) => r.id));
      const mem = data.case_area_changes.filter((x) => canReadRow("case_area_changes", x, actorOf(p), raw)).map((x) => x.id).sort();
      expect(pg, personaKey(p)).toEqual(mem);
    }
    const memOf = (key: string) => data.case_area_changes.filter((x) => canReadRow("case_area_changes", x, actorOf(findPersona(key)), raw)).map((x) => x.id);
    for (const key of ["u-amira", "u-erik", "u-sara", "u-johan", "u-karin", "u-robin", "u-lars", SUPERVISOR]) expect(memOf(key), key).toEqual(["cac-seed-linnea"]);
    for (const key of ["k-maria", "k-omar", "deltagare"]) expect(memOf(key), key).toEqual([]);
  });

  it("nytt byte: coach, samordnare och avtalsansvarig i eget namn – aldrig chef, admin, ekonom, kommunen eller den vilande rollen handledare", async () => {
    const cases: [string, Tables["case_area_changes"], boolean][] = [
      ["u-amira", row("cac-t1", "u-amira"), true],
      ["u-erik", row("cac-t2", "u-erik"), true],
      ["u-sara", row("cac-t3", "u-sara"), true],
      ["u-johan", row("cac-t4", "u-johan"), true],
      ["u-amira", row("cac-t5", "u-sara"), false],
      ["u-karin", row("cac-t6", "u-karin"), false],
      ["u-robin", row("cac-t7", "u-robin"), false],
      ["u-lars", row("cac-t8", "u-lars"), false],
      ["k-maria", row("cac-t9", "k-maria"), false],
      [SUPERVISOR, row("cac-t10", "u-petra"), false],
    ];
    for (const [key, r, want] of cases) {
      expect({ pg: await pgChange(key, r), mem: memWrite(r, key) }, `${key} ${r.id}`).toEqual({ pg: want, mem: want });
    }
  });

  it("raden stämmer med ärendet: aktivt nytt yrkesområde i avtalet, skilt från det gamla, anteckningen i ärendet och månaden efter bytet – för alla", async () => {
    const bad: [string, Tables["case_area_changes"]][] = [
      ["okänt yrkesområde", row("cac-b1", "u-amira", { toArea: "Z" })],
      ["samma yrkesområde", row("cac-b2", "u-amira", { toArea: "D" })],
      ["anteckning i ett annat ärende", row("cac-b3", "u-amira", { noteId: "note-nadia-samtal" })],
      ["fel månad", row("cac-b4", "u-amira", { effectiveMonth: "2027-02" })],
      ["fel avtal", row("cac-b5", "u-amira", { contractId: "c-ny" })],
      ["ärende i ett annat avtal än raden", row("cac-b6", "u-amira", { caseId: NADIA })],
    ];
    for (const [label, r] of bad) {
      expect({ pg: await pgChange("u-amira", r), mem: memWrite(r, "u-amira") }, label).toEqual({ pg: false, mem: false });
      const service = await serviceChange(r);
      expect(service.ok, `${label} (service role)`).toBe(false);
    }
    // Ett inaktivt yrkesområde i avtalet: nekas av triggern också för servern.
    const b7 = row("cac-b7", "u-amira");
    const inactive = async (tx: Tx) => {
      await tx.query(insNote(noteFor(b7)));
      await tx.query("update public.contract_areas set active = false where contract_id = 'c-bot' and code = 'C'");
    };
    const pg = await asUser(db, authOf("u-amira"), (tx) => attempt(tx, ins(b7)), { before: inactive });
    expect(pg).toMatchObject({ ok: false, code: "23514" });
    const mem = new MemoryStore<Tables>(structuredClone(data), UNIQUE_KEYS);
    mem.rows("contract_areas").find((a) => a.contractId === "c-bot" && a.code === "C")!.active = false;
    mem.insertRow("case_notes", noteFor(b7));
    expect(canWriteRow("case_area_changes", b7, actorOf(findPersona("u-amira")), { ...mem.raw(), now: () => at })).toBe(false);
    // Fel nummer (inte nästa i ärendet) och en anteckning som redan är motivering till ett annat byte (unik): nekas för alla,
    // också servern.
    const reused = row("cac-b10", "u-amira", { noteId: "note-byte-linnea" });
    for (const [label, r] of [["nummer 1 igen", row("cac-b8", "u-amira", { seq: 1 })], ["nummer 3", row("cac-b9", "u-amira", { seq: 3 })], ["samma motivering igen", reused]] as const) {
      expect({ pg: await pgChange("u-amira", r), mem: memWrite(r, "u-amira") }, label).toEqual({ pg: false, mem: false });
      const service = await serviceChange(r);
      expect(service.ok, `${label} (service role)`).toBe(false);
    }
    expect(await serviceChange(reused)).toMatchObject({ ok: false, code: "23505" });
  });

  it("kedjan för inloggade: ingen påhittad historik – från ärendets nuvarande yrkesområde, inte äldre än det förra bytet, med aktuell tid", async () => {
    const bad: [string, Tables["case_area_changes"]][] = [
      // Ett byte "från A" ändrar vilket yrkesområde tidigare månader faktureras på (areaForMonth) – Linnea har D.
      ["från ett annat yrkesområde än ärendets", row("cac-k1", "u-amira", { fromArea: "A", toArea: "D" })],
      ["från det gamla yrkesområdet före förra bytet", row("cac-k2", "u-amira", { fromArea: "G" })],
      ["bakåtdaterat före förra bytet", row("cac-k3", "u-amira", { changedAt: "2027-01-20T10:00", effectiveMonth: "2027-02" })],
      ["bakåtdaterat i samma månad", row("cac-k4", "u-amira", { changedAt: "2027-02-01T08:00" })],
      ["framåtdaterat", row("cac-k5", "u-amira", { changedAt: "2027-02-01T10:00" })],
    ];
    for (const [label, r] of bad) {
      expect({ pg: await pgChange("u-amira", r), mem: memWrite(r, "u-amira") }, label).toEqual({ pg: false, mem: false });
    }
    const k1 = row("cac-k1", "u-amira", { fromArea: "A", toArea: "D" });
    const pg = await asPersonaWith("u-amira", [noteFor(k1)], (tx) => attempt(tx, ins(k1)));
    expect(pg).toMatchObject({ ok: false, code: "23514" });
    // Inom 10 minuter från klockan: giltigt.
    const near = row("cac-k6", "u-amira", { changedAt: "2027-02-01T09:15" });
    expect({ pg: await pgChange("u-amira", near), mem: memWrite(near, "u-amira") }).toEqual({ pg: true, mem: true });
  });

  it("bytet utgår från ärendets nuvarande yrkesspår och alternativ – annars nekas hela bytet (23514)", async () => {
    const bad: [string, Tables["case_area_changes"]][] = [
      ["ett annat yrkesspår än ärendets", row("cac-s1", "u-amira", { fromTrack: "Lagerarbetare – plock och pack" })],
      ["ett alternativ som ärendet inte har", row("cac-s2", "u-amira", { fromSecondaryArea: "G" })],
    ];
    for (const [label, r] of bad) {
      expect({ pg: await pgChange("u-amira", r), mem: memWrite(r, "u-amira") }, label).toEqual({ pg: false, mem: false });
      expect(await asPersonaWith("u-amira", [noteFor(r)], (tx) => attempt(tx, ins(r))), label).toMatchObject({ ok: false, code: "23514" });
    }
    // Ett avslutat ärende: nekas.
    const closed = row("cac-s3", "u-amira");
    const pg = await asUser(db, authOf("u-amira"), (tx) => attempt(tx, ins(closed)), {
      before: async (tx) => { await tx.query(insNote(noteFor(closed))); await tx.query(`update public.cases set status = 'closed' where id = '${LINNEA}'`); },
    });
    expect(pg).toMatchObject({ ok: false, code: "23514" });
  });

  it("motiveringen är en ny anteckning av den som byter: aldrig någon annans, en borttagen, en gammal eller en annan typ – samma i RLS och policy.ts", async () => {
    const r = (id: string) => row(id, "u-amira");
    const bad: [string, Tables["case_area_changes"], Tables["case_notes"]][] = [
      ["Saras anteckning", r("cac-n1"), noteFor(r("cac-n1"), { authorId: "u-sara" })],
      ["en borttagen anteckning", r("cac-n2"), noteFor(r("cac-n2"), { removedAt: at, removedBy: "u-amira" })],
      ["en gammal anteckning", r("cac-n3"), noteFor(r("cac-n3"), { createdAt: "2027-01-20T10:00" })],
      ["en kundkontakt", r("cac-n4"), noteFor(r("cac-n4"), { kind: "customer_contact", audience: "full" })],
    ];
    for (const [label, change, note] of bad) {
      expect({ pg: await pgChange("u-amira", change, [note]), mem: memWrite(change, "u-amira", [note]) }, label).toEqual({ pg: false, mem: false });
    }
    // En befintlig anteckning i ärendet (testdatat – Saras samtalsanteckning i Nadias ärende) kan inte göras till motivering av
    // någon annan, och blir alltså aldrig låst för sin författare.
    const sara = raw.get("case_notes", "note-nadia-samtal")!;
    expect(sara.authorId).not.toBe("u-erik");
    const hijack: Tables["case_area_changes"] = {
      ...row("cac-n5", "u-erik"), caseId: NADIA, fromArea: "G", toArea: "C", seq: 1, noteId: sara.id, fromTrack: raw.get("cases", NADIA)!.vocationalTrack,
    };
    expect({ pg: await pgChange("u-erik", hijack, []), mem: memWrite(hijack, "u-erik", []) }).toEqual({ pg: false, mem: false });
  });

  it("bytet och ärendet i samma transaktion: en enda sats ändrar ärendets yrkesområde, yrkesspår och alternativ – ett halvt byte kan inte bli kvar", async () => {
    const r = row("cac-t1", "u-amira", { toTrack: "Bygg – grund och arbetsmiljö" });
    const res = await asPersonaWith("u-amira", [noteFor(r)], async (tx) => {
      const change = await attempt(tx, ins(r), [], { keep: true });
      const after = (await tx.query<{ a: string; t: string; s: string | null }>(`select primary_area_code as a, vocational_track as t, secondary_area_code as s from public.cases_public where id = '${LINNEA}'`)).rows[0];
      return { change, after };
    });
    expect(res).toEqual({ change: { ok: true, rows: 1 }, after: { a: "C", t: "Bygg – grund och arbetsmiljö", s: null } });
    // Ett alternativt yrkesområde som blir det nya tas bort i samma sats.
    const viaSecondary = row("cac-t2", "u-amira", { fromSecondaryArea: "C" });
    const res2 = await asUser(db, authOf("u-amira"), async (tx) => {
      const change = await attempt(tx, ins(viaSecondary), [], { keep: true });
      const after = (await tx.query<{ a: string; s: string | null }>(`select primary_area_code as a, secondary_area_code as s from public.cases_public where id = '${LINNEA}'`)).rows[0];
      return { change, after };
    }, { before: async (tx) => { await tx.query(insNote(noteFor(viaSecondary))); await tx.query(`update public.cases set secondary_area_code = 'C' where id = '${LINNEA}'`); } });
    expect(res2).toEqual({ change: { ok: true, rows: 1 }, after: { a: "C", s: null } });
    // Servern (service role, t.ex. testdatat) skriver bara raden – ärendet ändras inte.
    const sys = await asUser(db, null, async (tx) => {
      await tx.query(insNote(noteFor(r)));
      await tx.query(ins(r));
      return (await tx.query<{ a: string }>(`select primary_area_code as a from public.cases where id = '${LINNEA}'`)).rows[0].a;
    }, { role: "service_role" });
    expect(sys).toBe("D");
  });

  it("ärendets yrkesområde ändras aldrig direkt efter bekräftelsen, och kommunen ändrar aldrig yrkesområdena efter mottagandet – samma i triggern och policy.ts", async () => {
    const cur = (id: string) => raw.get("cases", id)!;
    const memCase = (key: string, id: string, patch: Partial<Case>) => canWriteRow("cases", { ...cur(id), ...patch }, actorOf(findPersona(key)), raw);
    const cases: [string, string, string, Partial<Case>, boolean][] = [
      ["u-amira", LINNEA, "update public.cases set primary_area_code = 'C' where id = '${id}'", { primaryAreaCode: "C" }, false],
      ["u-sara", LINNEA, "update public.cases set primary_area_code = 'C' where id = '${id}'", { primaryAreaCode: "C" }, false],
      ["u-johan", NADIA, "update public.cases set primary_area_code = 'C', vocational_track = '' where id = '${id}'", { primaryAreaCode: "C", vocationalTrack: "" }, false],
      ["k-maria", NADIA, "update public.cases set primary_area_code = 'C' where id = '${id}' and primary_area_code = 'G'", { primaryAreaCode: "C" }, false],
      ["k-maria", NADIA, "update public.cases set secondary_area_code = 'C' where id = '${id}'", { secondaryAreaCode: "C" }, false],
      // Det alternativa yrkesområdet (Miljonbemanning) och kommunens kontaktuppgifter ändras som förut.
      ["u-sara", NADIA, "update public.cases set secondary_area_code = 'C' where id = '${id}'", { secondaryAreaCode: "C" }, true],
      ["k-maria", NADIA, "update public.cases set referrer_phone = '08-000 00 00' where id = '${id}'", { referrerPhone: "08-000 00 00" }, true],
    ];
    for (const [key, id, sql, patch, want] of cases) {
      expect({ pg: await pgWrite(key, sql.replace("${id}", id)), mem: memCase(key, id, patch) }, `${key} ${sql}`).toEqual({ pg: want, mem: want });
    }
    // Före bekräftelsen väljs yrkesområdet som förut (avropsinkorgen, accepten) – av Miljonbemanning, aldrig av kommunen.
    const waiting = data.cases.find((c) => c.status === "acknowledged" && c.contractId === "c-bot")!;
    expect({ pg: await pgWrite("u-sara", `update public.cases set primary_area_code = 'C' where id = '${waiting.id}'`), mem: memCase("u-sara", waiting.id, { primaryAreaCode: "C" }) }).toEqual({ pg: true, mem: true });
    if (waiting.referrerId) {
      const ref = personas.find((p) => p.actor.userId === waiting.referrerId);
      if (ref) {
        expect({ pg: await pgWrite(ref.actor.userId, `update public.cases set primary_area_code = 'C' where id = '${waiting.id}'`), mem: memCase(ref.actor.userId, waiting.id, { primaryAreaCode: "C" }) }).toEqual({ pg: false, mem: false });
      }
    }
    expect(await asPersona(findPersona("u-amira"), (tx) => attempt(tx, `update public.cases set primary_area_code = 'C' where id = '${LINNEA}'`))).toMatchObject({ ok: false, code: "42501" });

    // Statusen som spärren utgår från går inte runt: först statusen tillbaka, sedan yrkesområdet, sist statusen fram igen – varje
    // steg en egen sats (som PostgREST), i triggern och i policy.ts. Kommunen ändrar aldrig status; ett bekräftat ärende blir
    // aldrig en väntande eller avböjd beställning igen.
    const kommunCase = data.cases.find((c) => c.status === "active" && c.referrerId === "k-maria" && c.contractId === "c-bot")!;
    const coachCase = data.cases.find((c) => c.status === "active" && c.leadCoachId === "u-amira" && c.id !== LINNEA && c.contractId === "c-bot")!;
    const sqlOf = (patch: Partial<Case>) => Object.entries(patch).map(([k, v]) => `${snakeCase(k)} = ${v == null ? "null" : `'${String(v)}'`}`).join(", ");
    /** Stegen i tur och ordning: om varje steg gick igenom, och ärendets status och yrkesområden efteråt – i PG och i minnet. */
    const stepwise = async (key: string, caseId: string, steps: Partial<Case>[]) => {
      const pg = await asPersona(findPersona(key), async (tx) => {
        const ok: boolean[] = [];
        for (const st of steps) ok.push(allowed(await attempt(tx, `update public.cases set ${sqlOf(st)} where id = '${caseId}'`, [], { keep: true })));
        const end = (await tx.query<{ s: string; p: string | null; q: string | null }>(`select status as s, primary_area_code as p, secondary_area_code as q from public.cases_public where id = '${caseId}'`)).rows[0];
        return { ok, end: [end.s, end.p, end.q] };
      });
      const st = new MemoryStore<Tables>(structuredClone(data), UNIQUE_KEYS);
      const repo = new MemoryRepo<Tables>(st, actorOf(findPersona(key)), POLICIES);
      const ok: boolean[] = [];
      for (const x of steps) ok.push(await repo.table("cases").update(caseId, x).then(() => true, () => false));
      const end = st.getRow("cases", caseId)!;
      return { pg, mem: { ok, end: [end.status, end.primaryAreaCode, end.secondaryAreaCode] } };
    };
    const kc = kommunCase;
    expect(kc).toBeDefined();
    const kommunSteps = await stepwise("k-maria", kc.id, [{ status: "received" }, { primaryAreaCode: "C", secondaryAreaCode: "D" }, { status: "active" }]);
    expect(kommunSteps, "k-maria").toEqual({
      pg: { ok: [false, false, true], end: ["active", kc.primaryAreaCode, kc.secondaryAreaCode] },
      mem: { ok: [false, false, true], end: ["active", kc.primaryAreaCode, kc.secondaryAreaCode] },
    });
    const cc = coachCase;
    expect(cc).toBeDefined();
    for (const back of ["acknowledged", "received", "declined"] as const) {
      const coachSteps = await stepwise("u-amira", cc.id, [{ status: back }, { primaryAreaCode: "C" }, { status: "active" }]);
      expect(coachSteps, `u-amira ${back}`).toEqual({
        pg: { ok: [false, false, true], end: ["active", cc.primaryAreaCode, cc.secondaryAreaCode] },
        mem: { ok: [false, false, true], end: ["active", cc.primaryAreaCode, cc.secondaryAreaCode] },
      });
    }
    // Samma för samordnaren i ett avslutat ärende.
    const closedCase = data.cases.find((c) => c.status === "closed" && c.contractId === "c-bot" && c.primaryAreaCode)!;
    const closedSteps = await stepwise("u-sara", closedCase.id, [{ status: "acknowledged" }, { primaryAreaCode: closedCase.primaryAreaCode === "C" ? "D" : "C" }]);
    expect(closedSteps.pg.ok, "u-sara closed").toEqual([false, false]);
    expect(closedSteps.mem.ok, "u-sara closed").toEqual([false, false]);
    // Framåt som förut: Miljonbemanning bekräftar, startar och avslutar, och avböjer en väntande beställning. Kommunen ändrar
    // inte statusen i sin egen väntande beställning heller.
    const waitingOwn = data.cases.find((c) => c.status === "acknowledged" && c.referrerId === "k-maria" && c.contractId === "c-bot");
    const forward: [string, string, Partial<Case>[], boolean[]][] = [
      ["u-sara", waiting.id, [{ status: "confirmed" }, { status: "active" }, { status: "closed" }], [true, true, true]],
      ["u-sara", waiting.id, [{ status: "declined" }], [true]],
      ["u-amira", cc.id, [{ status: "closed" }], [true]],
      ...(waitingOwn ? [["k-maria", waitingOwn.id, [{ status: "declined" }], [false]] as [string, string, Partial<Case>[], boolean[]]] : []),
    ];
    for (const [key, id, steps, want] of forward) {
      const r = await stepwise(key, id, steps);
      expect({ pg: r.pg.ok, mem: r.mem.ok }, `${key} ${JSON.stringify(steps)}`).toEqual({ pg: want, mem: want });
    }
  });

  it("ett byte ändras och raderas aldrig – inte heller av den som gjorde det eller av avtalsansvarig", async () => {
    const cur = raw.get("case_area_changes", "cac-seed-linnea")!;
    for (const key of ["u-amira", "u-johan", "u-sara", "u-robin"]) {
      expect(await pgWrite(key, "update public.case_area_changes set to_area = 'C' where id = 'cac-seed-linnea'"), key).toBe(false);
      expect(await pgWrite(key, "delete from public.case_area_changes where id = 'cac-seed-linnea'"), key).toBe(false);
      expect(canWriteRow("case_area_changes", { ...cur, toArea: "C" }, actorOf(findPersona(key)), raw), key).toBe(false);
    }
  });

  it("hela bytet som SupabaseRepo skickar det: anteckningen och bytet – två begäranden, ärendet följer med bytet", async () => {
    for (const key of ["u-amira", "u-sara", "u-johan"]) {
      const r = row("cac-r1", key);
      const res = await asPersona(findPersona(key), async (tx) => ({
        note: await attempt(tx, insNote(noteFor(r)), [], { keep: true }),
        change: await attempt(tx, ins(r), [], { keep: true }),
        area: (await tx.query<{ a: string }>(`select primary_area_code as a from public.cases_public where id = '${LINNEA}'`)).rows[0].a,
      }));
      expect(res, key).toEqual({ note: { ok: true, rows: 1 }, change: { ok: true, rows: 1 }, area: "C" });
    }
  });

  it("inloggade läser fortfarande bara id direkt i public.cases – övriga kolumner via cases_public (0036 ger ingen ny läsrätt)", async () => {
    for (const key of ["u-amira", "k-maria"]) {
      const res = await asPersona(findPersona(key), (tx) => attempt(tx, "select primary_area_code from public.cases limit 1"));
      expect(res, key).toMatchObject({ ok: false, code: "42501" });
    }
    const r = await db.query<{ a: boolean; b: boolean }>("select has_column_privilege('authenticated', 'public.cases', 'primary_area_code', 'select') as a, has_column_privilege('authenticated', 'public.cases', 'person_id', 'select') as b");
    expect(r.rows[0]).toEqual({ a: false, b: false });
  });

  it("motiveringen är låst: ingen inloggad ändrar eller döljer anteckningen som ett byte pekar på – servern kan", async () => {
    const cur = raw.get("case_notes", "note-byte-linnea")!;
    expect(cur.authorId).toBe("u-amira");
    for (const key of ["u-amira", "u-sara", "u-johan"]) {
      expect(await pgWrite(key, "update public.case_notes set body = 'Ny text i anteckningen.', updated_at = '2027-02-01T09:12' where id = 'note-byte-linnea'"), key).toBe(false);
      expect(await pgWrite(key, `update public.case_notes set removed_at = '2027-02-01T09:12', removed_by = '${key}' where id = 'note-byte-linnea'`), key).toBe(false);
      expect(canWriteRow("case_notes", { ...cur, body: "Ny text i anteckningen.", updatedAt: at }, actorOf(findPersona(key)), raw), key).toBe(false);
      expect(canWriteRow("case_notes", { ...cur, removedAt: at, removedBy: key }, actorOf(findPersona(key)), raw), key).toBe(false);
    }
    // En vanlig anteckning i samma ärende ändras som förut.
    const other = data.case_notes.find((n) => n.authorId === "u-amira" && n.id !== "note-byte-linnea" && !n.removedAt)!;
    expect(await pgWrite("u-amira", `update public.case_notes set body = 'Ny text.' where id = '${other.id}'`)).toBe(true);
    const service = await asUser(db, null, (tx) => attempt(tx, "update public.case_notes set removed_at = '2027-02-01T09:12', removed_by = 'u-amira' where id = 'note-byte-linnea'"), { role: "service_role" });
    expect(service).toEqual({ ok: true, rows: 1 });
  });

  it("de sammansatta främmande nycklarna mot avtalets yrkesområden har var sitt index", async () => {
    const r = await db.query<{ indexname: string; indexdef: string }>("select indexname, indexdef from pg_indexes where tablename = 'case_area_changes' order by indexname");
    const defs = Object.fromEntries(r.rows.map((x) => [x.indexname, x.indexdef]));
    expect(defs.case_area_changes_from_area_idx).toMatch(/\(contract_id, from_area\)/);
    expect(defs.case_area_changes_to_area_idx).toMatch(/\(contract_id, to_area\)/);
  });

  it("monthly_assessments.prefill (0036): standard {} och alltid ett objekt", async () => {
    const r = await db.query<{ n: number }>("select count(*)::int as n from public.monthly_assessments where prefill = '{}'::jsonb");
    expect(r.rows[0].n).toBe(data.monthly_assessments.filter((m) => Object.keys(m.prefill).length === 0).length);
    const ma = data.monthly_assessments.find((m) => m.status === "draft" && m.month === "2027-01")!;
    expect(Object.keys(ma.prefill).length).toBeGreaterThan(0);
    const service = await asUser(db, null, (tx) => attempt(tx, "update public.monthly_assessments set prefill = '[]'::jsonb where id = $1", [ma.id]), { role: "service_role" });
    expect(service).toMatchObject({ ok: false, code: "23514" });
  });

  it("migrationen tål att köras igen och ändrar då ingenting", async () => {
    const sql = readFileSync(`${MIGRATIONS_DIR}/0036_byt_yrkesomrade.sql`, "utf8");
    let res: { before: number; after: number; policies: number; triggers: number } | null = null;
    await db.transaction(async (tx) => {
      const count = async () => (await tx.query<{ n: number }>("select (select count(*) from public.case_area_changes) + (select count(*) from public.monthly_assessments where prefill <> '{}'::jsonb) as n")).rows[0].n;
      const before = await count();
      await tx.exec(sql);
      await tx.exec(sql);
      const after = await count();
      const policies = (await tx.query<{ n: number }>("select count(*)::int as n from pg_policies where tablename = 'case_area_changes'")).rows[0].n;
      const triggers = (await tx.query<{ n: number }>(
        "select count(*)::int as n from pg_trigger where tgname in ('case_area_changes_check', 'case_area_changes_apply', 'case_notes_area_change_lock', 'cases_area_guard')",
      )).rows[0].n;
      res = { before, after, policies, triggers };
      await tx.rollback();
    });
    expect(res).not.toBeNull();
    expect(res!.after).toEqual(res!.before);
    expect(res!.policies).toBe(2);
    expect(res!.triggers).toBe(4);
  });
});
