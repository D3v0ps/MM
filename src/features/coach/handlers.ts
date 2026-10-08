// Hanterare för området coach (frågor och kommandon). Registreras via src/api/handlers.ts – importeras aldrig av skärmar.
import { fail, ok } from "@/api/contract";
import { AI_OFF_TEXT, aiOff } from "@/features/_shared/ai-port";
import type { Role } from "@/api/roles";
import { handleCommand, type Ctx } from "@/api/server";
import { aiAllowed } from "@/core/cases";
import { latestCheckIn } from "@/core/db-index";
import { plural } from "@/core/format";
import { addDays, dayOf, isoWeek, monthKey } from "@/core/time";
import { by, uniq } from "@/core/util";
import { UniqueError } from "@/data/repo";
import type { Activity, AiRun, AiRunKind, Attendance, Case, CheckIn, CheckInAiDraft, Deviation, IntakeAssessment, MonthlyAssessment, TranscriptLine } from "@/data/schema";
import { simulateCheckInSuggestions, simulatedTranscript, type AiSource, type CheckInSuggestions } from "../_shared/ai-sim";
import { canEditCase, contractOf, customerDecisionTask, notifyReferrer, upsert } from "../_shared/context";
import { blankArea, newAssessment, newCheckIn, newIntake, newPlan } from "../_shared/rows";
import {
  aiRun, assessmentSave, attendanceSet, attendanceSetAll, checkinSave, deviationCallCustomer, deviationSave, eventAdd, intakeSave, resultVerify,
} from "./api";
import { publishWeeklyIfComplete, type WeeklyPublished } from "../_shared/weekly";
// Frågorna för coachens skärmar (vy-modellerna).
import "./query-handlers";
// Röstinspelning: inspelad avstämning och AI-utkast till månadsbedömningen.
import "./voice-handlers";

// ---- Delade kommandon (portade från prototypens 03-domain.js)

const NOT_FOUND = "Ärendet finns inte, eller så har du inte behörighet att se det.";
const NO_EDIT = "Du har inte behörighet att ändra i ärendet.";
const AI_BLOCKED = "AI används inte i det här ärendet: samtycke saknas eller deltagaren har skyddade personuppgifter. Dokumentera manuellt.";
/** Ärendets team: samordnare, avtalsansvarig och huvudcoach ändrar i ärendet (prototypens canEditCase). */
const CASE_EDITORS: readonly Role[] = ["samordnare", "avtalsansvarig", "coach"];
/** AI-körningar som ger förslag till en veckoavstämning. */
const CHECK_IN_AI_KINDS: readonly AiRunKind[] = ["transcribe_extract", "extract_teams", "extract_notes"];

/** Det som sparas i ai_runs.output för en avstämning. Råtranskriptet töms när avstämningen godkänts. */
type CheckInAiOutput = { source: AiSource; suggestions: CheckInSuggestions; transcript: TranscriptLine[] };

const AUTOSAVE_APPROVE = "Automatisk sparning kan inte godkänna. Godkänn med knappen.";
const CONFLICT = "Utkastet har ändrats i en annan flik eller på en annan enhet. Ladda om sidan för att se den senaste versionen – inget har skrivits över.";
const CHECK_IN_APPROVED = "Avstämningen är redan godkänd och ändras inte. Gör en ny avstämning om något behöver rättas.";
const ASSESSMENT_APPROVED = "Bedömningen är redan godkänd och ändras inte. En godkänd bedömning ändras genom en rättad rapportversion.";
type AutosaveParams = { autosave?: boolean; editSession?: string };
/**
 * Versionskontrollen (0022, två flikar): expectedVersion är versionen skärmen senast såg eller sparade. Stämmer den inte
 * med radens har någon annan sparat sedan dess – "conflict", inget skrivs över. Utan expectedVersion ingen kontroll.
 */
const versionMismatch = (existing: { version: number } | null, expected: number | undefined): boolean => !!existing && expected != null && existing.version !== expected;
/**
 * Loggraden för en sparning. Manuell sparning och godkännande loggas alltid (som förut). Automatisk utkastsparning
 * (autosave + editSession) loggas en gång per besök på sidan: har samma besök redan loggat en automatisk sparning av raden
 * loggas ingen ny – annars en rad med details.autosave och editSession (ett slumpat id utan personuppgift).
 * ctx.system: uppslaget i loggen är ett systemsteg – loggen (append-only) läses annars bara av chef och systemadministratör,
 * och den som sparar ska inte kunna se andras rader genom att spara. Indexet audit_log_entity_idx gör uppslaget billigt.
 */
async function auditSave(ctx: Ctx, e: { action: string; entity: string; entityId: string; contractId: string; details: Record<string, unknown> }, p: AutosaveParams): Promise<void> {
  if (!p.autosave) return ctx.audit(e);
  const editSession = p.editSession ?? null;
  if (editSession) {
    const earlier = await ctx.system.table("audit_log").list({ entity: e.entity, entityId: e.entityId, action: e.action, actorId: ctx.actor.userId });
    if (earlier.some((x) => x.details?.autosave === true && x.details?.editSession === editSession)) return;
  }
  await ctx.audit({ ...e, details: { ...e.details, autosave: true, editSession } });
}

/** Ta bort nycklar utan värde, så att en ändring bara rör de fält som skickades. */
function defined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}

// ---------------------------------------------------------------- attendance.set (+ coach.attendanceSet)
const ACTIVITY_NOT_FOUND = "Tillfället finns inte, eller så har du inte behörighet till det.";
type AttendanceReg = Pick<Attendance, "status" | "reason" | "registeredBy" | "registeredAt">;
/**
 * Närvaroraden för ett tillfälle: uppdaterar den som finns, annars skapas den. Samma rad från enskild registrering och
 * "Markera alla som närvarande", så att fakturaunderlaget och veckorapporten blir identiska oavsett väg.
 */
async function writeAttendance(ctx: Ctx, act: Activity, existing: Attendance | null, reg: AttendanceReg): Promise<string> {
  const table = ctx.repo.table("attendance");
  if (existing) {
    await table.update(existing.id, reg);
    return existing.id;
  }
  const id = ctx.newId("at");
  try {
    await table.insert({ id, activityId: act.id, caseId: act.caseId, customerNotifiedAt: null, ...reg });
    return id;
  } catch (e) {
    // Ett annat kommando hann skriva raden (dubbelklick, eller "Markera alla" samtidigt med en radknapp): den unika nyckeln
    // (0022, UNIQUE_KEYS i minnet) stoppar en andra rad – uppdatera den som finns i stället. Aldrig två rader per tillfälle.
    if (!(e instanceof UniqueError)) throw e;
    const again = await table.first({ activityId: act.id });
    if (!again) throw e;
    await table.update(again.id, reg);
    return again.id;
  }
}

handleCommand(attendanceSet, { roles: ["coach", "handledare"] }, async (ctx, p) => {
  const act = await ctx.repo.table("activities").get(p.activityId);
  if (!act) return fail("not_found", ACTIVITY_NOT_FOUND);
  const c = await ctx.repo.table("cases").get(act.caseId);
  if (!c) return fail("not_found", NOT_FOUND);
  const now = ctx.now();
  const existing = await ctx.repo.table("attendance").first({ activityId: act.id });
  const attendanceId = await writeAttendance(ctx, act, existing, { status: p.status, reason: p.reason || "", registeredBy: ctx.actor.userId, registeredAt: now });
  await ctx.audit({ action: "attendance.registered", entity: "attendance", entityId: attendanceId, contractId: c.contractId, details: { caseId: act.caseId, status: p.status } });
  // Veckorapporten publiceras automatiskt när alla handläggarens deltagare är registrerade.
  const published = await publishWeeklyIfComplete(ctx, c.contractId, c.referrerId, isoWeek(act.startsAt).key);
  return ok({ attendanceId, published });
});

// ---------------------------------------------------------------- coach.attendanceSetAll ("Markera alla som närvarande")
handleCommand(attendanceSetAll, { roles: ["coach", "handledare"] }, async (ctx, p) => {
  const ids = uniq(p.activityIds);
  // Alla tillfällen läses via ctx.repo (policyn/RLS: egna eller teamets ärenden, skyddade bara för namngiven coach).
  // Saknas något skrivs ingenting – listan i bekräftelsen ska stämma med det som registreras.
  const acts = (await ctx.repo.table("activities").list({ id: { in: ids } })).sort(by<Activity>("startsAt"));
  if (acts.length !== ids.length) return fail("not_found", "Något tillfälle finns inte längre eller får inte registreras av dig. Ladda om sidan.");
  const now = ctx.now();
  if (acts.some((a) => dayOf(a.startsAt) !== p.day)) return fail("wrong_day", "Alla tillfällen måste ligga på samma dag. Ladda om sidan.");
  if (acts.some((a) => a.startsAt >= now)) return fail("not_started", "Ett tillfälle som inte har startat kan inte registreras ännu.");
  const caseIds = uniq(acts.map((a) => a.caseId));
  const cases = await ctx.repo.table("cases").list({ id: { in: caseIds } });
  if (cases.length !== caseIds.length) return fail("not_found", NOT_FOUND);
  const caseById = new Map(cases.map((c) => [c.id, c]));
  const existing = await ctx.repo.table("attendance").list({ activityId: { in: ids } });
  const existingByAct = new Map(existing.map((a) => [a.activityId, a]));

  // Bara tillfällen utan registrering – en rad som redan finns (närvaro eller frånvaro) ändras aldrig.
  const marked: string[] = [];
  const skipped: string[] = [];
  const attendanceIdOf = new Map<string, string>();
  const reg: AttendanceReg = { status: "present", reason: "", registeredBy: ctx.actor.userId, registeredAt: now };
  for (const act of acts) {
    if (existingByAct.has(act.id)) {
      skipped.push(act.id);
      continue;
    }
    attendanceIdOf.set(act.id, await writeAttendance(ctx, act, null, reg));
    marked.push(act.id);
  }
  // En loggrad för dagen per avtal (vanligen ett): revisionsloggen läses per avtal (RLS) och kortets Historik läser
  // ärendets avtal – en rad med bara det första avtalet syntes inte i det andra avtalets ärenden. Antal och id:n, aldrig
  // namn. Kortets Historik hittar raden via details.caseIds.
  const contractOfAct = (a: Activity) => (caseById.get(a.caseId) as Case).contractId;
  for (const contractId of uniq(acts.map(contractOfAct)).sort()) {
    const mine = acts.filter((a) => contractOfAct(a) === contractId);
    const m = mine.filter((a) => marked.includes(a.id));
    await ctx.audit({
      action: "attendance.registered_all", entity: "attendance", entityId: null, contractId,
      details: {
        day: p.day, status: "present", count: m.length, activityIds: m.map((a) => a.id), attendanceIds: m.map((a) => attendanceIdOf.get(a.id) as string),
        caseIds: uniq(m.map((a) => a.caseId)), skippedActivityIds: mine.filter((a) => skipped.includes(a.id)).map((a) => a.id),
      },
    });
  }
  // Veckorapporterna: en kontroll per handläggare, avtal och vecka bland de markerade – i fast ordning.
  const published: WeeklyPublished[] = [];
  const keys = uniq(acts.filter((a) => marked.includes(a.id)).map((a) => {
    const c = caseById.get(a.caseId) as Case;
    return `${c.contractId}|${c.referrerId ?? ""}|${isoWeek(a.startsAt).key}`;
  })).sort();
  for (const k of keys) {
    const [contractId, referrerId, weekKey] = k.split("|");
    const pub = await publishWeeklyIfComplete(ctx, contractId, referrerId || null, weekKey);
    if (pub) published.push(pub);
  }
  return ok({ marked, skipped, published, registeredAt: now });
});

// ---------------------------------------------------------------- checkin.save
handleCommand(checkinSave, { roles: ["coach"] }, async (ctx, p) => {
  if (p.autosave && p.approve) return fail("invalid", AUTOSAVE_APPROVE);
  const c = await ctx.repo.table("cases").get(p.caseId);
  if (!c) return fail("not_found", NOT_FOUND);
  if (!(await canEditCase(ctx, c))) return fail("forbidden", NO_EDIT);
  const d = p.data;
  // Röd samlad status kräver en avvikelse med beskrivning och åtgärd.
  if (d.overallStatus === "red" && (!p.deviation || !p.deviation.description.trim() || !p.deviation.action.trim())) {
    return fail("deviation_required", "Röd status kräver en avvikelse med åtgärd, ansvarig och uppföljningsdatum.");
  }
  const person = await ctx.repo.table("persons").get(c.personId);
  if (d.inputMethod && d.inputMethod !== "manual" && !aiAllowed(c, person)) return fail("ai_not_allowed", AI_BLOCKED);

  const table = ctx.repo.table("check_ins");
  const existing = p.checkInId ? await table.get(p.checkInId) : null;
  if (existing && existing.caseId !== c.id) return fail("not_found", "Avstämningen finns inte.");
  // En godkänd avstämning ändras inte (SPEC §7.5) – inte heller av en autosparning från en flik som inte vet att den godkänts.
  if (existing && existing.status === "approved") return fail("approved", CHECK_IN_APPROVED);
  if (versionMismatch(existing, p.expectedVersion)) return fail("conflict", CONFLICT);
  const now = ctx.now();

  // AI-utkastet hämtas från AI-körningen (inte från anroparen), så att förslagen och beläggen är det AI faktiskt gav.
  let ai: CheckInAiDraft | null = existing?.ai ?? null;
  let aiRunId: string | null = existing?.aiRunId ?? null;
  let run: AiRun | null = null;
  if (d.aiRunId && d.aiRunId !== aiRunId) {
    run = await ctx.repo.table("ai_runs").get(d.aiRunId);
    if (!run || run.caseId !== c.id) return fail("not_found", "AI-körningen finns inte.");
    const out = run.output as CheckInAiOutput | null;
    if (out?.suggestions) {
      // Förslag utan belägg ("Framgår inte") har t = null – samma form som prototypens utkast.
      ai = { ...out.suggestions, transcript: out.transcript, audioDeletedAt: run.inputDeletedAt, rawTranscriptDeleteBy: addDays(run.createdAt, 30) } as unknown as CheckInAiDraft;
    }
    aiRunId = run.id;
  } else if (aiRunId) {
    run = await ctx.repo.table("ai_runs").get(aiRunId);
  }

  const { aiRunId: _ignored, ...fields } = d;
  void _ignored;
  const ci: CheckIn = { ...(existing ?? newCheckIn({ id: ctx.newId("ci"), caseId: c.id, heldAt: d.heldAt || now })), ...defined(fields), ai, aiRunId, version: existing ? existing.version + 1 : 1 };
  if (p.approve) {
    ci.status = "approved";
    ci.approvedBy = ctx.actor.userId;
    ci.approvedAt = now;
  }
  const rawDelete = !!(p.approve && ci.ai);
  if (rawDelete && ci.ai) ci.ai = { ...ci.ai, rawTranscriptDeletedAt: now, transcript: [] };
  // Ny rad, eller villkorad uppdatering på versionen: hann någon annan skriva raden emellan sparas ingenting (conflict).
  if (existing) {
    if (!(await table.updateIf(ci.id, { version: existing.version }, ci))) return fail("conflict", CONFLICT);
  } else await table.insert(ci);
  if (p.approve && ci.phase) await ctx.repo.table("cases").update(c.id, { phase: Number(ci.phase) });

  for (const x of p.aiDecisions ?? []) {
    await ctx.repo.table("ai_field_decisions").insert({
      id: ctx.newId("afd"), aiRunId: ci.aiRunId, field: x.field, suggested: x.suggested ?? null, final: x.final ?? null, decision: x.decision,
      changed: x.changed ?? x.decision === "edited", decidedBy: ctx.actor.userId, decidedAt: now,
    });
  }
  if (rawDelete) {
    // Råtranskriptet raderas när avstämningen godkänts (CLAUDE.md punkt 7) – även i AI-körningens utdata.
    const out = run?.output as CheckInAiOutput | null | undefined;
    if (run && out?.transcript?.length) await ctx.repo.table("ai_runs").update(run.id, { output: { ...out, transcript: [] } });
    await ctx.audit({ action: "transcript.deleted", entity: "check_in", entityId: ci.id, contractId: c.contractId, details: { reason: "Avstämningen godkänd" } });
  }
  let deviationId: string | null = null;
  if (d.overallStatus === "red" && p.deviation) {
    // Avvikelsen hör till avstämningen (checkInId): en senare sparning av samma avstämning (autosparning, Spara utkast,
    // Godkänn) uppdaterar samma avvikelse – aldrig en ny per sparning.
    const devs = ctx.repo.table("deviations");
    const prev = await devs.first({ checkInId: ci.id });
    const values = {
      description: p.deviation.description.trim(), assessment: (p.deviation.assessment ?? "").trim(), action: p.deviation.action.trim(),
      ownerId: p.deviation.ownerId ?? null, followUpOn: p.deviation.followUpOn ?? null, needsCustomerDecision: !!p.deviation.needsCustomerDecision,
    };
    let dv: Deviation;
    if (prev) {
      dv = await devs.update(prev.id, values);
      // Manuell sparning och godkännande loggas; en autosparning av samma avvikelse loggas inte (check_in.saved täcker besöket).
      if (!p.autosave) await ctx.audit({ action: "deviation.saved", entity: "deviation", entityId: dv.id, contractId: c.contractId, details: { caseId: c.id, status: dv.status, fromCheckIn: ci.id } });
    } else {
      dv = { id: ctx.newId("dev"), caseId: c.id, createdAt: now, ...values, followUpMeetingAt: null, status: "open", checkInId: ci.id };
      await devs.insert(dv);
      await ctx.audit({ action: "deviation.created", entity: "deviation", entityId: dv.id, contractId: c.contractId, details: { caseId: c.id, fromCheckIn: ci.id } });
    }
    deviationId = dv.id;
    // Uppgiften till kommunens handläggare och mejlet: bara när coachen själv sparar eller godkänner – aldrig av en automatisk
    // sparning medan texten skrivs. customerDecisionTask skapar bara en uppgift per avvikelse.
    if (dv.needsCustomerDecision && !p.autosave) await customerDecisionTask(ctx, c, dv);
  }
  await auditSave(ctx, { action: p.approve ? "check_in.approved" : "check_in.saved", entity: "check_in", entityId: ci.id, contractId: c.contractId, details: { caseId: c.id, aiUsed: !!ci.ai } }, p);
  return ok({ checkInId: ci.id, deviationId, rawTranscriptDeletedAt: ci.ai?.rawTranscriptDeletedAt ?? null, savedAt: now, version: ci.version });
});

// ---------------------------------------------------------------- deviation.save
handleCommand(deviationSave, { roles: CASE_EDITORS }, async (ctx, p) => {
  const c = await ctx.repo.table("cases").get(p.caseId);
  if (!c) return fail("not_found", NOT_FOUND);
  if (!(await canEditCase(ctx, c))) return fail("forbidden", NO_EDIT);
  const table = ctx.repo.table("deviations");
  const existing = p.id ? await table.get(p.id) : null;
  if (p.id && (!existing || existing.caseId !== c.id)) return fail("not_found", "Avvikelsen finns inte.");
  const data = defined(p.data);
  let dv: Deviation;
  if (existing) {
    // När avvikelsen stängdes (resultatfilens avvikelser_oppna = öppna vid månadens slut). Öppnas den igen nollställs tiden.
    const closing = data.status === "closed" && existing.status !== "closed";
    const reopening = data.status === "open" && existing.status === "closed";
    dv = await table.update(existing.id, { ...data, ...(closing ? { closedAt: ctx.now() } : reopening ? { closedAt: null } : {}) });
  } else {
    dv = {
      id: ctx.newId("dev"), caseId: c.id, createdAt: ctx.now(), description: "", assessment: "", action: "", ownerId: null, followUpOn: null,
      needsCustomerDecision: false, followUpMeetingAt: null, status: "open", checkInId: null, ...data,
      ...(data.status === "closed" ? { closedAt: ctx.now() } : {}),
    };
    await table.insert(dv);
  }
  await ctx.audit({ action: "deviation.saved", entity: "deviation", entityId: dv.id, contractId: c.contractId, details: { caseId: c.id, status: dv.status } });
  if (dv.needsCustomerDecision) await customerDecisionTask(ctx, c, dv);
  return ok({ deviationId: dv.id });
});

// ---------------------------------------------------------------- deviation.callCustomer
handleCommand(deviationCallCustomer, { roles: CASE_EDITORS }, async (ctx, p) => {
  const c = await ctx.repo.table("cases").get(p.caseId);
  if (!c) return fail("not_found", NOT_FOUND);
  if (!(await canEditCase(ctx, c))) return fail("forbidden", NO_EDIT);
  const body = p.body.trim();
  if (!body) return fail("empty", "Skriv ett meddelande till kommunen.");
  if (p.deviationId) {
    const dv = await ctx.repo.table("deviations").get(p.deviationId);
    if (dv && dv.caseId === c.id) await ctx.repo.table("deviations").update(dv.id, { followUpMeetingAt: p.proposedAt || null });
  }
  const messageId = ctx.newId("msg");
  await ctx.repo.table("messages").insert({ id: messageId, caseId: c.id, senderId: ctx.actor.userId, body, createdAt: ctx.now(), readBy: [], readAt: null, kind: "meeting_request" });
  await notifyReferrer(ctx, c, "nytt_meddelande", `Du har ett nytt meddelande om ärende ${c.caseNumber} – logga in för att läsa.`);
  await ctx.audit({ action: "deviation.customer_called", entity: "case", entityId: c.id, contractId: c.contractId, details: { deviationId: p.deviationId ?? null } });
  return ok({ messageId });
});

// ---------------------------------------------------------------- assessment.save
handleCommand(assessmentSave, { roles: ["coach"] }, async (ctx, p) => {
  if (p.autosave && p.approve) return fail("invalid", AUTOSAVE_APPROVE);
  const c = await ctx.repo.table("cases").get(p.caseId);
  if (!c) return fail("not_found", NOT_FOUND);
  if (!(await canEditCase(ctx, c))) return fail("forbidden", NO_EDIT);
  const { cfg } = await contractOf(ctx, c.contractId);
  // Anteckningar som lagts in i sammanfattningen: läsbara via ctx.repo, samma ärende, från månaden och inte borttagna.
  const usedNotes = [...new Set(p.usedNoteIds ?? [])];
  for (const id of usedNotes) {
    const n = await ctx.repo.table("case_notes").get(id);
    if (!n || n.caseId !== c.id || n.removedAt || monthKey(n.occurredOn) !== p.month) {
      return fail("bad_note", "En av anteckningarna hör inte till den här månaden eller finns inte längre. Ladda om sidan och försök igen.");
    }
  }
  const table = ctx.repo.table("monthly_assessments");
  const existing = await table.first({ caseId: c.id, month: p.month });
  // En godkänd bedömning ändras inte (rapporten byggs av den) – inte heller av en autosparning från en annan flik.
  if (existing && existing.status === "approved") return fail("approved", ASSESSMENT_APPROVED);
  if (versionMismatch(existing, p.expectedVersion)) return fail("conflict", CONFLICT);
  // Raden ändras på plats nedan – versionen den hade när den lästes behövs för den villkorade skrivningen.
  const readVersion = existing?.version ?? null;
  const ma: MonthlyAssessment = existing ?? newAssessment({ id: ctx.newId("ma"), caseId: c.id, month: p.month });
  // Bara avtalets progressionsområden. Nivån sätts av coachen – AI:s förslag ligger kvar som förslag.
  const known = new Set([...cfg.progression.areas, ...cfg.progression.optionalAreas]);
  const areas = { ...ma.areas };
  for (const [k, v] of Object.entries(p.areas ?? {})) if (known.has(k)) areas[k] = { ...(areas[k] ?? blankArea()), ...defined(v) };
  ma.areas = areas;
  if (p.summary != null) ma.summary = p.summary;
  if (p.overallStatus != null) ma.overallStatus = p.overallStatus;
  if (p.approve) {
    const from = cfg.progression.observationRequiredFromLevel;
    const missing = cfg.progression.areas.filter((k) => {
      const a = areas[k];
      return !a || a.level == null || (a.level >= from && !String(a.observation ?? "").trim());
    });
    if (missing.length || !ma.overallStatus) {
      const text = `Bedömningen kan inte godkännas: ${plural(missing.length, "område saknar", "områden saknar")} uppgifter${!ma.overallStatus ? " och samlad status saknas" : ""}.`;
      return { ...fail("incomplete", text), missing };
    }
    ma.status = "approved";
    ma.decidedBy = ctx.actor.userId;
    ma.decidedAt = ctx.now();
  }
  ma.version = readVersion != null ? readVersion + 1 : 1;
  if (readVersion != null) {
    if (!(await table.updateIf(ma.id, { version: readVersion }, ma))) return fail("conflict", CONFLICT);
  } else await table.insert(ma);
  if (p.approve) {
    const rep = await ctx.repo.table("reports").first({ kind: "monthly", caseId: c.id, month: p.month });
    if (rep && rep.status === "draft") await ctx.repo.table("reports").update(rep.id, { status: "reviewed" });
  }
  if (p.plan) {
    const plans = ctx.repo.table("monthly_plans");
    const cur = (await plans.first({ caseId: c.id, month: p.month })) ?? newPlan({ id: ctx.newId("mp"), caseId: c.id, month: p.month });
    const { nextCustomerMeeting, ...rest } = p.plan;
    await upsert(plans, { ...cur, ...defined(rest), ...(nextCustomerMeeting !== undefined ? { nextCustomerMeeting: nextCustomerMeeting || null } : {}) });
  }
  await auditSave(ctx, { action: p.approve ? "assessment.approved" : "assessment.saved", entity: "monthly_assessment", entityId: ma.id, contractId: c.contractId, details: { caseId: c.id, month: p.month } }, p);
  // En loggrad per anteckning: bara id:n och månaden – aldrig texten.
  for (const id of usedNotes) {
    await ctx.audit({ action: "case_note.used_in_summary", entity: "case_note", entityId: id, contractId: c.contractId, details: { caseId: c.id, month: p.month } });
  }
  return ok({ assessmentId: ma.id, savedAt: ctx.now(), version: ma.version });
});

// ---------------------------------------------------------------- intake.save
handleCommand(intakeSave, { roles: ["coach"] }, async (ctx, p) => {
  if (p.autosave && p.approve) return fail("invalid", AUTOSAVE_APPROVE);
  const c = await ctx.repo.table("cases").get(p.caseId);
  if (!c) return fail("not_found", NOT_FOUND);
  if (!(await canEditCase(ctx, c))) return fail("forbidden", NO_EDIT);
  const table = ctx.repo.table("intake_assessments");
  const existing = await table.first({ caseId: c.id });
  if (versionMismatch(existing, p.expectedVersion)) return fail("conflict", CONFLICT);
  const ia: IntakeAssessment = { ...(existing ?? newIntake({ id: ctx.newId("ia"), caseId: c.id })), ...defined(p.data ?? {}), version: existing ? existing.version + 1 : 1 };
  if (p.approve) {
    ia.status = "approved";
    ia.approvedBy = ctx.actor.userId;
    ia.approvedAt = ctx.now();
  }
  if (existing) {
    if (!(await table.updateIf(ia.id, { version: existing.version }, ia))) return fail("conflict", CONFLICT);
  } else await table.insert(ia);
  if (p.approve && ia.chosenTrack) await ctx.repo.table("cases").update(c.id, { vocationalTrack: ia.chosenTrack });
  await auditSave(ctx, { action: p.approve ? "intake.approved" : "intake.saved", entity: "intake_assessment", entityId: ia.id, contractId: c.contractId, details: { caseId: c.id } }, p);
  return ok({ intakeId: ia.id, savedAt: ctx.now(), version: ia.version });
});

// ---------------------------------------------------------------- event.add
handleCommand(eventAdd, { roles: ["coach"] }, async (ctx, p) => {
  const c = await ctx.repo.table("cases").get(p.caseId);
  if (!c) return fail("not_found", NOT_FOUND);
  if (!(await canEditCase(ctx, c))) return fail("forbidden", NO_EDIT);
  const id = ctx.newId("oe");
  await ctx.repo.table("outcome_events").insert({
    id, caseId: c.id, kind: p.kind, occurredOn: p.occurredOn, actor: p.actor ?? "", verificationKind: p.verificationKind || null,
    verificationPath: p.verificationFile || null, note: p.note ?? "", possibleBonus: p.kind === "arbete_paborjat",
  });
  await ctx.audit({ action: "event.added", entity: "outcome_event", entityId: id, contractId: c.contractId, details: { caseId: c.id, kind: p.kind } });
  return ok({ eventId: id });
});

// ---------------------------------------------------------------- result.verify
handleCommand(resultVerify, { roles: CASE_EDITORS }, async (ctx, p) => {
  const c = await ctx.repo.table("cases").get(p.caseId);
  if (!c) return fail("not_found", NOT_FOUND);
  if (!(await canEditCase(ctx, c))) return fail("forbidden", NO_EDIT);
  await ctx.repo.table("cases").update(c.id, { resultVerifiedAt: ctx.now() });
  const e = await ctx.repo.table("outcome_events").first({ caseId: c.id, kind: { in: ["arbete_paborjat", "studier_paborjade"] } });
  if (e) await ctx.repo.table("outcome_events").update(e.id, { verificationKind: p.verificationKind, verificationPath: p.file || "verifiering.pdf" });
  await ctx.audit({ action: "result.verified", entity: "case", entityId: c.id, contractId: c.contractId, details: { kind: p.verificationKind } });
  // Är slutrapporten redan levererad? Då kommer verifieringen med i rapporten och i kommunens resultatfil först när
  // slutrapporten har rättats och den nya versionen levererats (beslut sätt a, rapporter steg 3).
  const finals = await ctx.repo.table("reports").list({ caseId: c.id, kind: "final" });
  const delivered = finals.find((r) => (r.status === "delivered" || r.status === "opened") && !r.superseded) ?? null;
  return ok({ finalDelivered: !!delivered, finalReportId: delivered?.id ?? null });
});

// ---------------------------------------------------------------- ai.run (simulerad)
handleCommand(aiRun, { roles: ["coach"] }, async (ctx, p) => {
  // AI av (produktion utan MM_AI_PROVIDER): ingen simulerad text – klartext och den manuella vägen (beslut 2026-10-08).
  if (aiOff(ctx)) return fail("ai_unavailable", AI_OFF_TEXT);
  const c = p.caseId ? await ctx.repo.table("cases").get(p.caseId) : null;
  if (p.caseId && !c) return fail("not_found", NOT_FOUND);
  if (c) {
    // AI bara med registrerat samtycke och aldrig vid skyddade personuppgifter (CLAUDE.md punkt 5 och 8).
    // Tolkning av ett inkommande mejl kräver inget samtycke – men aldrig AI för en skyddad person.
    const person = await ctx.repo.table("persons").get(c.personId);
    const blocked = p.kind === "parse_email" ? !person || person.protectedIdentity : !aiAllowed(c, person);
    if (blocked) {
      await ctx.audit({ action: "ai.blocked", entity: "case", entityId: c.id, contractId: c.contractId, details: { reason: "Samtycke saknas eller skyddade personuppgifter" } });
      return fail("ai_not_allowed", AI_BLOCKED);
    }
  }
  const now = ctx.now();
  let source: AiSource | null = null;
  let suggestions: CheckInSuggestions | null = null;
  let transcript: TranscriptLine[] = [];
  if (c && CHECK_IN_AI_KINDS.includes(p.kind)) {
    source = p.source ?? (p.kind === "extract_notes" ? "notes" : p.kind === "extract_teams" ? "teams" : "recording");
    const last = latestCheckIn({ check_ins: await ctx.repo.table("check_ins").list({ caseId: c.id }) }, c.id);
    suggestions = simulateCheckInSuggestions({ source, phase: c.phase, lastApproved: last, notesText: p.notesText });
    transcript = simulatedTranscript(suggestions, source);
  }
  const audio = (p.audioSeconds ?? 0) > 0;
  const output: CheckInAiOutput | null = source && suggestions ? { source, suggestions, transcript } : null;
  const run: AiRun = {
    id: ctx.newId("ai"), caseId: c?.id ?? null, kind: p.kind, provider: "Berget AI (test)", model: p.model || "KB-Whisper + öppen språkmodell", inputRef: null,
    status: "succeeded", createdAt: now, audioSeconds: p.audioSeconds || 0, tokensIn: null, tokensOut: null, costOre: p.costOre || 80, latencyMs: 64000,
    output, evidence: null, inputDeletedAt: audio ? now : null,
  };
  await ctx.repo.table("ai_runs").insert(run);
  await ctx.audit({ action: "ai.run", entity: "ai_run", entityId: run.id, contractId: c?.contractId ?? null, details: { kind: p.kind, caseId: c?.id ?? null } });
  // Ljudet raderas direkt efter lyckad transkribering (CLAUDE.md punkt 7).
  if (audio) await ctx.audit({ action: "audio.deleted", entity: "ai_run", entityId: run.id, contractId: c?.contractId ?? null, details: { reason: "Transkribering klar" } });
  return ok({ runId: run.id, source, suggestions, transcript, audioDeletedAt: audio ? now : null, rawTranscriptDeleteBy: output ? addDays(now, 30) : null });
});
