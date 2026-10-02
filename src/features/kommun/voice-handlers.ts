// Kommunens "Tala in" (docs/PLAN-ROST.md, flöde 2). Registreras via handlers.ts – importeras aldrig av skärmar.
// Handläggaren talar in text i beställningens bakgrund och i meddelanden. Ljudet raderas direkt efter transkriberingen och
// texten går bara tillbaka till den som talade in – den sparas först när handläggaren själv skickar (beställningen eller
// meddelandet). Aldrig för skyddade personuppgifter. Behörigheten: startAudioUpload/confirmOwnUpload (voice-upload.ts).
import { fail, ok } from "@/api/contract";
import { handleCommand, handleQuery, type Ctx } from "@/api/server";
import { recordingMaxMinutes, type ContractConfig } from "@/core/config";
import { RECORDING_BLOCK_TEXT, recordingBlock, type RecordingBlock } from "../_shared/ai-port";
import { enqueueVoiceJob, ownDictation } from "../_shared/voice-jobs";
import { confirmOwnUpload } from "../_shared/voice-upload";
import { dictationFinish, dictationOptions, dictationState, type DictationOptions, type DictationState } from "./api";

const HANDL = ["kommun_handlaggare"] as const;

async function stateOf(ctx: Ctx, aiRunId: string): Promise<DictationState | null> {
  const d = await ownDictation(ctx, aiRunId);
  return d ? { aiRunId: d.aiRunId, status: d.status, error: d.error?.text ?? null, audioDeletedAt: d.audioDeletedAt, text: d.text } : null;
}

handleQuery(dictationOptions, { roles: HANDL }, async (ctx, p): Promise<DictationOptions> => {
  const off = (reason: string | null): DictationOptions => ({ enabled: false, maxMinutes: 0, reason });
  let block: RecordingBlock | null;
  let cfg: ContractConfig | null | undefined;
  if (p.caseId) {
    const c = await ctx.repo.table("cases").get(p.caseId);
    // Bara beställande handläggare skriver meddelanden i ärendet.
    if (!c || c.referrerId !== ctx.actor.userId) return off(null);
    const [person, contract] = await Promise.all([ctx.repo.table("persons").get(c.personId), ctx.repo.table("contracts").get(c.contractId)]);
    cfg = contract?.config;
    block = recordingBlock({ cfg, kind: "customer", person });
  } else {
    const contractId = ctx.actor.contractIds.length === 1 ? ctx.actor.contractIds[0] : null;
    const contract = contractId ? await ctx.repo.table("contracts").get(contractId) : null;
    if (!contract) return off(null);
    cfg = contract.config;
    block = recordingBlock({ cfg, kind: "customer", person: undefined, protectedOrder: !!p.protectedOrder });
  }
  if (block) return off(block === "disabled" ? null : RECORDING_BLOCK_TEXT[block]);
  return { enabled: true, maxMinutes: recordingMaxMinutes(cfg, "customer") ?? 0, reason: null };
});

handleCommand(dictationFinish, { roles: HANDL }, async (ctx, p) => {
  const u = await ctx.repo.table("audio_uploads").get(p.uploadId);
  if (!u || u.purpose !== "dictation" || u.ownerId !== ctx.actor.userId) return fail("not_found", "Inspelningen finns inte.");
  let contractId: string | null = null;
  if (u.caseId) {
    const c = await ctx.repo.table("cases").get(u.caseId);
    if (!c) return fail("not_found", "Ärendet finns inte, eller så har du inte behörighet att se det.");
    if (c.referrerId !== ctx.actor.userId) return fail("forbidden", "Bara handläggaren som beställde insatsen kan tala in här.");
    contractId = c.contractId;
  } else {
    contractId = ctx.actor.contractIds.length === 1 ? ctx.actor.contractIds[0] : null;
  }
  if (!contractId) return fail("forbidden", "Du har inte behörighet att tala in här.");
  const conf = await confirmOwnUpload(ctx, { uploadId: u.id, durationSec: p.durationSec ?? null });
  if (!conf.ok) return conf;
  const r = await enqueueVoiceJob(ctx, { kind: "transcribe_dictation", uploadId: u.id, contractId });
  const s = await stateOf(ctx, r.aiRunId);
  return ok(s ?? { aiRunId: r.aiRunId, status: r.status, error: r.error?.text ?? null, audioDeletedAt: null, text: null });
});

handleQuery(dictationState, { roles: HANDL }, async (ctx, p) => stateOf(ctx, p.aiRunId));
