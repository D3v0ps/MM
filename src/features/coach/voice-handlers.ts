// Coachens röstinspelning (docs/PLAN-ROST.md, flöde 1): inspelad avstämning eller uppladdad ljudfil, och AI-utkast till
// månadsbedömningen. Registreras via handlers.ts – importeras aldrig av skärmar.
//
// Behörigheten kontrolleras här (ärendet via ctx.repo, huvudcoachen, avtalet, samtycket, skyddade personuppgifter) och igen
// när jobbet körs (src/features/_shared/voice-jobs.ts – samtycket kan ha återkallats). Jobbet raderar ljudet direkt efter
// transkriberingen och sparar förslagen med belägg i ai_runs; coachen granskar dem i avstämningen (checkinSave).
import { fail, ok } from "@/api/contract";
import { handleCommand, handleQuery, type Ctx } from "@/api/server";
import { aiAllowed } from "@/core/cases";
import { addDays } from "@/core/time";
import { recordingBlock, RECORDING_BLOCK_TEXT } from "../_shared/ai-port";
import { aiRunError, enqueueVoiceJob, RAW_TRANSCRIPT_DAYS, type CheckInAiOutput } from "../_shared/voice-jobs";
import { canEditCase } from "../_shared/context";
import { confirmOwnUpload } from "../_shared/voice-upload";
import { monthlyDraft, recordingFinish, recordingState, type RecordingState } from "./api";

const NOT_FOUND = "Ärendet finns inte, eller så har du inte behörighet att se det.";
const NOT_MINE = "Du har inte behörighet att spela in avstämningen i det här ärendet.";
const AI_BLOCKED = "AI används inte i det här ärendet: samtycke saknas eller deltagaren har skyddade personuppgifter. Dokumentera manuellt.";

/** Läget och förslagen för en inspelning. ai_runs läses via ctx.repo (coachen ser körningar i sina ärenden). */
async function stateOf(ctx: Ctx, aiRunId: string): Promise<RecordingState | null> {
  const run = await ctx.repo.table("ai_runs").get(aiRunId);
  if (!run || run.kind !== "transcribe_extract") return null;
  const out = run.status === "succeeded" ? (run.output as CheckInAiOutput | null) : null;
  return {
    aiRunId: run.id,
    status: run.status,
    error: aiRunError(run)?.text ?? null,
    audioDeletedAt: run.inputDeletedAt,
    result: out?.suggestions
      ? {
          runId: run.id, source: out.source, suggestions: out.suggestions, transcript: out.transcript ?? [], audioDeletedAt: run.inputDeletedAt,
          rawTranscriptDeleteBy: addDays(run.createdAt, RAW_TRANSCRIPT_DAYS),
        }
      : null,
  };
}

handleCommand(recordingFinish, { roles: ["coach"] }, async (ctx, p) => {
  const c = await ctx.repo.table("cases").get(p.caseId);
  if (!c) return fail("not_found", NOT_FOUND);
  if (!(await canEditCase(ctx, c))) return fail("forbidden", NOT_MINE);
  const [person, contract] = await Promise.all([ctx.repo.table("persons").get(c.personId), ctx.repo.table("contracts").get(c.contractId)]);
  const block = recordingBlock({ cfg: contract?.config, kind: "coach", person, consent: c.aiConsentStatus });
  if (block) {
    await ctx.audit({ action: "ai.blocked", entity: "case", entityId: c.id, contractId: c.contractId, details: { reason: block } });
    return fail(block, RECORDING_BLOCK_TEXT[block]);
  }
  // Uppladdningen ska vara coachens egen, för avstämningen i det här ärendet.
  const u = await ctx.repo.table("audio_uploads").get(p.uploadId);
  if (!u || u.caseId !== c.id || u.purpose !== "checkin" || u.ownerId !== ctx.actor.userId) return fail("not_found", "Inspelningen finns inte.");
  const conf = await confirmOwnUpload(ctx, { uploadId: u.id, durationSec: p.durationSec ?? null });
  if (!conf.ok) return conf;
  // Ett sparat utkast i samma ärende får förslagen direkt (om coachen lämnar sidan innan de är klara).
  let checkInId: string | null = null;
  if (p.checkInId) {
    const ci = await ctx.repo.table("check_ins").get(p.checkInId);
    if (ci && ci.caseId === c.id && ci.status === "draft") checkInId = ci.id;
  }
  const r = await enqueueVoiceJob(ctx, { kind: "transcribe_recording", uploadId: u.id, source: p.source, checkInId });
  const s = await stateOf(ctx, r.aiRunId);
  return ok(s ?? { aiRunId: r.aiRunId, status: r.status, error: r.error?.text ?? null, audioDeletedAt: null, result: null });
});

handleQuery(recordingState, { roles: ["coach"] }, async (ctx, p) => stateOf(ctx, p.aiRunId));

handleCommand(monthlyDraft, { roles: ["coach"] }, async (ctx, p) => {
  const c = await ctx.repo.table("cases").get(p.caseId);
  if (!c) return fail("not_found", NOT_FOUND);
  if (!(await canEditCase(ctx, c))) return fail("forbidden", "Du har inte behörighet att göra månadsbedömningen i det här ärendet.");
  const person = await ctx.repo.table("persons").get(c.personId);
  // AI bara med samtycke och aldrig vid skyddade personuppgifter (CLAUDE.md punkt 5 och 8).
  if (!aiAllowed(c, person)) {
    await ctx.audit({ action: "ai.blocked", entity: "case", entityId: c.id, contractId: c.contractId, details: { reason: "Samtycke saknas eller skyddade personuppgifter" } });
    return fail("ai_not_allowed", AI_BLOCKED);
  }
  const ma = await ctx.repo.table("monthly_assessments").first({ caseId: c.id, month: p.month });
  if (ma?.status === "approved") return fail("approved", "Månadsbedömningen är redan godkänd.");
  const r = await enqueueVoiceJob(ctx, { kind: "draft_monthly", caseId: c.id, month: p.month });
  return ok({ aiRunId: r.aiRunId, status: r.status, error: r.error?.text ?? null });
});
