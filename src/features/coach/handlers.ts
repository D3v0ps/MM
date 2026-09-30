// Hanterare för området coach (frågor och kommandon). Registreras via src/api/handlers.ts – importeras aldrig av skärmar.
import { fail, ok } from "@/api/contract";
import type { Role } from "@/api/roles";
import { handleCommand } from "@/api/server";
import { aiAllowed } from "@/core/cases";
import { latestCheckIn } from "@/core/db-index";
import { plural } from "@/core/format";
import { addDays, isoWeek } from "@/core/time";
import type { AiRun, AiRunKind, CheckIn, CheckInAiDraft, Deviation, IntakeAssessment, MonthlyAssessment, TranscriptLine } from "@/data/schema";
import { simulateCheckInSuggestions, simulatedTranscript, type AiSource, type CheckInSuggestions } from "../_shared/ai-sim";
import { canEditCase, contractOf, customerDecisionTask, notifyReferrer, upsert } from "../_shared/context";
import { blankArea, newAssessment, newCheckIn, newIntake, newPlan } from "../_shared/rows";
import {
  aiRun, assessmentSave, attendanceSet, checkinSave, deviationCallCustomer, deviationSave, eventAdd, intakeSave, resultVerify,
} from "./api";
import { publishWeeklyIfComplete } from "../_shared/weekly";

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

/** Ta bort nycklar utan värde, så att en ändring bara rör de fält som skickades. */
function defined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}

// ---------------------------------------------------------------- attendance.set (+ coach.attendanceSet)
handleCommand(attendanceSet, { roles: ["coach", "handledare"] }, async (ctx, p) => {
  const act = await ctx.repo.table("activities").get(p.activityId);
  if (!act) return fail("not_found", "Tillfället finns inte, eller så har du inte behörighet till det.");
  const c = await ctx.repo.table("cases").get(act.caseId);
  if (!c) return fail("not_found", NOT_FOUND);
  const now = ctx.now();
  const table = ctx.repo.table("attendance");
  const existing = await table.first({ activityId: act.id });
  const reg = { status: p.status, reason: p.reason || "", registeredBy: ctx.actor.userId, registeredAt: now };
  const attendanceId = existing ? existing.id : ctx.newId("at");
  if (existing) await table.update(existing.id, reg);
  else await table.insert({ id: attendanceId, activityId: act.id, caseId: act.caseId, customerNotifiedAt: null, ...reg });
  await ctx.audit({ action: "attendance.registered", entity: "attendance", entityId: attendanceId, contractId: c.contractId, details: { caseId: act.caseId, status: p.status } });
  // Veckorapporten publiceras automatiskt när alla handläggarens deltagare är registrerade.
  const published = await publishWeeklyIfComplete(ctx, c.contractId, c.referrerId, isoWeek(act.startsAt).key);
  return ok({ attendanceId, published });
});

// ---------------------------------------------------------------- checkin.save
handleCommand(checkinSave, { roles: ["coach"] }, async (ctx, p) => {
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
  const ci: CheckIn = { ...(existing ?? newCheckIn({ id: ctx.newId("ci"), caseId: c.id, heldAt: d.heldAt || now })), ...defined(fields), ai, aiRunId };
  if (p.approve) {
    ci.status = "approved";
    ci.approvedBy = ctx.actor.userId;
    ci.approvedAt = now;
  }
  const rawDelete = !!(p.approve && ci.ai);
  if (rawDelete && ci.ai) ci.ai = { ...ci.ai, rawTranscriptDeletedAt: now, transcript: [] };
  await upsert(table, ci);
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
    const dv: Deviation = {
      id: ctx.newId("dev"), caseId: c.id, createdAt: now, description: p.deviation.description.trim(), assessment: (p.deviation.assessment ?? "").trim(),
      action: p.deviation.action.trim(), ownerId: p.deviation.ownerId ?? null, followUpOn: p.deviation.followUpOn ?? null,
      needsCustomerDecision: !!p.deviation.needsCustomerDecision, followUpMeetingAt: null, status: "open", checkInId: ci.id,
    };
    await ctx.repo.table("deviations").insert(dv);
    deviationId = dv.id;
    await ctx.audit({ action: "deviation.created", entity: "deviation", entityId: dv.id, contractId: c.contractId, details: { caseId: c.id, fromCheckIn: ci.id } });
    if (dv.needsCustomerDecision) await customerDecisionTask(ctx, c, dv);
  }
  await ctx.audit({ action: p.approve ? "check_in.approved" : "check_in.saved", entity: "check_in", entityId: ci.id, contractId: c.contractId, details: { caseId: c.id, aiUsed: !!ci.ai } });
  return ok({ checkInId: ci.id, deviationId, rawTranscriptDeletedAt: ci.ai?.rawTranscriptDeletedAt ?? null });
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
    dv = await table.update(existing.id, data);
  } else {
    dv = {
      id: ctx.newId("dev"), caseId: c.id, createdAt: ctx.now(), description: "", assessment: "", action: "", ownerId: null, followUpOn: null,
      needsCustomerDecision: false, followUpMeetingAt: null, status: "open", checkInId: null, ...data,
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
  const c = await ctx.repo.table("cases").get(p.caseId);
  if (!c) return fail("not_found", NOT_FOUND);
  if (!(await canEditCase(ctx, c))) return fail("forbidden", NO_EDIT);
  const { cfg } = await contractOf(ctx, c.contractId);
  const table = ctx.repo.table("monthly_assessments");
  const existing = await table.first({ caseId: c.id, month: p.month });
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
  await upsert(table, ma);
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
  await ctx.audit({ action: p.approve ? "assessment.approved" : "assessment.saved", entity: "monthly_assessment", entityId: ma.id, contractId: c.contractId, details: { caseId: c.id, month: p.month } });
  return ok({ assessmentId: ma.id });
});

// ---------------------------------------------------------------- intake.save
handleCommand(intakeSave, { roles: ["coach"] }, async (ctx, p) => {
  const c = await ctx.repo.table("cases").get(p.caseId);
  if (!c) return fail("not_found", NOT_FOUND);
  if (!(await canEditCase(ctx, c))) return fail("forbidden", NO_EDIT);
  const table = ctx.repo.table("intake_assessments");
  const existing = await table.first({ caseId: c.id });
  const ia: IntakeAssessment = { ...(existing ?? newIntake({ id: ctx.newId("ia"), caseId: c.id })), ...defined(p.data ?? {}) };
  if (p.approve) {
    ia.status = "approved";
    ia.approvedBy = ctx.actor.userId;
    ia.approvedAt = ctx.now();
  }
  await upsert(table, ia);
  if (p.approve && ia.chosenTrack) await ctx.repo.table("cases").update(c.id, { vocationalTrack: ia.chosenTrack });
  await ctx.audit({ action: p.approve ? "intake.approved" : "intake.saved", entity: "intake_assessment", entityId: ia.id, contractId: c.contractId, details: { caseId: c.id } });
  return ok({ intakeId: ia.id });
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
  return ok({});
});

// ---------------------------------------------------------------- ai.run (simulerad)
handleCommand(aiRun, { roles: ["coach"] }, async (ctx, p) => {
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
