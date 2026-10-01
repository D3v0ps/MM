// Uppladdning av ljud för röstinspelningen (docs/PLAN-ROST.md, docs/AI.md) – vem som får spela in vad. Isomorf: samma
// kontroller i minnesläget/prototypen (via ett kommando) och på servern (POST /api/audio/upload-url och kommandona).
//
//   checkin      coachen i sitt eget ärende (huvudcoach), avtalet har ai.recording.coach, registrerat samtycke, inte skyddat
//   dictation    kommunens handläggare: i sitt eget ärende, eller i en ny beställning (avtalet ur medlemskapet); aldrig
//                skyddade personuppgifter. Inget ljud sparas efter transkriberingen.
//   participant  deltagarens länk /rost/:token (ingen inloggning – token är behörigheten): länken är oanvänd och gäller,
//                avtalet har ai.recording.participant, aldrig skyddade personuppgifter. Samtycket ges i länken.
//
// Flödet: startAudioUpload -> klienten laddar upp till uploadUrl (appen; minnesläget har ingen adress) -> confirmOwnUpload ->
// enqueueVoiceJob (voice-jobs.ts). Ärendet läses via ctx.repo (RLS/policy) för inloggade. Deltagarens länk och ärende läses
// via ctx.system efter tokenkontrollen (samma mönster som pulslänken i src/features/puls/handlers.ts).
import { z } from "zod";
import { fail, ok, type Result } from "@/api/contract";
import { ApiError, type Ctx } from "@/api/server";
import { aiLanguages, recordingMaxMinutes, type ContractConfig, type RecordingKind } from "@/core/config";
import { PARTICIPANT_USER_ID } from "@/data/actors";
import { AUDIO_PURPOSES, type AudioUpload, type Case, type Person, type VoiceLink } from "@/data/schema";
import { RECORDING_BLOCK_TEXT, recordingBlock, requireAi, type RecordingBlock } from "./ai-port";
import { requireAudio, validateAudioMeta, type AudioRef, type AudioUploadTicket } from "./audio-port";

// ---------------------------------------------------------------- Deltagarens länk
/** Token i länken /rost/<token>: bara bokstäver, siffror, - och _ (samma regel som pulslänken). */
export const VOICE_TOKEN_RE = /^[A-Za-z0-9_-]{8,200}$/;
/** Högst så många uppladdningar per länk (nya försök efter fel räknas). */
export const MAX_UPLOADS_PER_LINK = 10;

/** SHA-256 av token (hex) – samma som voice_links.tokenHash. Null om Web Crypto saknas. */
export async function voiceTokenHash(token: string): Promise<string | null> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return null;
  const buf = await subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export type VoiceLinkState = "open" | "used" | "expired" | "missing";
export type VoiceLinkLookup = {
  state: VoiceLinkState;
  /** Länken, ärendet och personen – null när länken saknas (eller gäller skyddade personuppgifter, som räknas som saknad). */
  link: VoiceLink | null;
  case: Case | null;
  person: Person | null;
  /** Avtalets konfiguration (ai-avsnittet: språk, maxlängd, om deltagarens inspelning är påslagen). */
  config: ContractConfig | null;
  /** Varför inspelning inte får göras (avtalet), eller null. */
  block: RecordingBlock | null;
};

/**
 * Länken för en token. Utan token: testdatats exempellänk (demo_tags "vl-demo", finns bara i testdata – samma som pulslänken).
 * ctx.system: deltagaren saknar läsbehörighet – token (hash) är behörigheten. Skyddade ärenden räknas som saknade.
 */
export async function voiceLinkByToken(ctx: Ctx, token: string | null | undefined): Promise<VoiceLinkLookup> {
  const none: VoiceLinkLookup = { state: "missing", link: null, case: null, person: null, config: null, block: null };
  let link: VoiceLink | null = null;
  if (token != null) {
    if (!VOICE_TOKEN_RE.test(token)) return none;
    const hash = await voiceTokenHash(token);
    link = hash ? await ctx.system.table("voice_links").first({ tokenHash: hash }) : null;
  } else {
    const tag = await ctx.system.table("demo_tags").get("vl-demo");
    const id = tag?.entity === "voice_links" ? tag.entityIds[0] : null;
    link = id ? await ctx.system.table("voice_links").get(id) : null;
  }
  if (!link) return none;
  const c = await ctx.system.table("cases").get(link.caseId);
  const person = c ? await ctx.system.table("persons").get(c.personId) : null;
  if (!c || !person || person.protectedIdentity) return none;
  const contract = await ctx.system.table("contracts").get(c.contractId);
  const config = contract?.config ?? null;
  const now = ctx.now();
  const state: VoiceLinkState = link.usedAt ? "used" : now > link.expiresAt ? "expired" : "open";
  return { state, link, case: c, person, config, block: recordingBlock({ cfg: config, kind: "participant", person }) };
}

// ---------------------------------------------------------------- Start av uppladdning
export const AudioUploadRequestSchema = z.strictObject({
  purpose: z.enum(AUDIO_PURPOSES),
  /** Ärendet (coachens avstämning, kommunens meddelande). Deltagaren: ärendet tas ur länken. */
  caseId: z.string().min(1).max(200).nullish(),
  /** Kommunens "Tala in" i en ny beställning: avtalet (standard: handläggarens enda avtal). */
  contractId: z.string().min(1).max(200).nullish(),
  /** Deltagarens länk. Utan token: testdatats exempellänk. */
  token: z.string().max(200).nullish(),
  /** Filtypen från webbläsaren, t.ex. "audio/webm;codecs=opus". */
  mimeType: z.string().min(1).max(120),
  bytes: z.int().min(0).nullish(),
  durationSec: z.number().min(0).max(86_400).nullish(),
  /** Kommunens nya beställning gäller skyddade personuppgifter – då stoppas "Tala in". */
  protectedOrder: z.boolean().optional(),
});
export type AudioUploadRequest = z.infer<typeof AudioUploadRequestSchema>;

export type AudioUploadError =
  | "not_found" | "forbidden" | "link_missing" | "link_used" | "link_expired" | RecordingBlock | "too_many" | "too_long" | "audio_type" | "audio_size" | "ai_unavailable";

export const AUDIO_UPLOAD_ERROR_TEXT: Record<AudioUploadError, string> = {
  not_found: "Ärendet finns inte, eller så har du inte behörighet att se det.",
  forbidden: "Du har inte behörighet att spela in här.",
  link_missing: "Länken fungerar inte. Kontakta din coach.",
  link_used: "Du har redan skickat ett meddelande med den här länken. Tack!",
  link_expired: "Länken har gått ut. Be din coach om en ny länk.",
  ...RECORDING_BLOCK_TEXT,
  too_many: "Det har laddats upp för många inspelningar med den här länken. Kontakta din coach.",
  too_long: "Inspelningen är för lång.",
  audio_type: "Filtypen stöds inte. Använd m4a, mp3, wav eller webm.",
  audio_size: "Ljudfilen är för stor (högst 25 MB).",
  ai_unavailable: "Inspelningen är inte tillgänglig just nu. Fyll i formuläret själv.",
};
const no = <E extends AudioUploadError>(e: E) => fail(e, AUDIO_UPLOAD_ERROR_TEXT[e]);

type Target = { caseId: string | null; contractId: string | null; ownerId: string; kind: RecordingKind; config: ContractConfig | null; linkId: string | null };

/** Vem, vilket ärende och vilket avtal – och får inspelningen göras? Samma kontroller som RLS/policy + avtalet + samtycket. */
export async function audioUploadTarget(ctx: Ctx, req: Pick<AudioUploadRequest, "purpose" | "caseId" | "contractId" | "token" | "protectedOrder">): Promise<Result<Target, AudioUploadError>> {
  const a = ctx.actor;
  if (req.purpose === "participant") {
    const l = await voiceLinkByToken(ctx, req.token);
    if (l.state === "missing" || !l.link || !l.case) return no("link_missing");
    if (l.state === "used") return no("link_used");
    if (l.state === "expired") return no("link_expired");
    if (l.block) return no(l.block);
    return ok({ caseId: l.case.id, contractId: l.case.contractId, ownerId: PARTICIPANT_USER_ID, kind: "participant", config: l.config, linkId: l.link.id });
  }
  if (req.purpose === "checkin") {
    // Veckoavstämningen är huvudcoachens (checkinSave: roles coach).
    if (a.role !== "coach") return no("forbidden");
    if (!req.caseId) return no("not_found");
    const c = await ctx.repo.table("cases").get(req.caseId);
    if (!c) return no("not_found");
    if (c.leadCoachId !== a.userId) return no("forbidden");
    const [contract, person] = await Promise.all([ctx.repo.table("contracts").get(c.contractId), ctx.repo.table("persons").get(c.personId)]);
    const block = recordingBlock({ cfg: contract?.config, kind: "coach", person, consent: c.aiConsentStatus });
    if (block) return no(block);
    return ok({ caseId: c.id, contractId: c.contractId, ownerId: a.userId, kind: "coach", config: contract?.config ?? null, linkId: null });
  }
  // Kommunens handläggare: "Tala in".
  if (a.role !== "kommun_handlaggare") return no("forbidden");
  if (req.caseId) {
    const c = await ctx.repo.table("cases").get(req.caseId);
    if (!c) return no("not_found");
    if (c.referrerId !== a.userId) return no("forbidden");
    const [contract, person] = await Promise.all([ctx.repo.table("contracts").get(c.contractId), ctx.repo.table("persons").get(c.personId)]);
    const block = recordingBlock({ cfg: contract?.config, kind: "customer", person });
    if (block) return no(block);
    return ok({ caseId: c.id, contractId: c.contractId, ownerId: a.userId, kind: "customer", config: contract?.config ?? null, linkId: null });
  }
  const contractId = req.contractId ?? (a.contractIds.length === 1 ? a.contractIds[0] : null);
  if (!contractId || !a.contractIds.includes(contractId)) return no("forbidden");
  const contract = await ctx.repo.table("contracts").get(contractId);
  if (!contract) return no("forbidden");
  const block = recordingBlock({ cfg: contract.config, kind: "customer", person: undefined, protectedOrder: !!req.protectedOrder });
  if (block) return no(block);
  return ok({ caseId: null, contractId, ownerId: a.userId, kind: "customer", config: contract.config, linkId: null });
}

/**
 * Starta en uppladdning: kontrollera behörigheten och skapa raden i audio_uploads via ctx.audio. Appen får en signerad
 * uppladdningsadress (ticket.uploadUrl, PUT med filen och Content-Type = grundtypen); minnesläget och prototypen får ingen
 * adress – anropa confirmOwnUpload direkt. maxMinutes = längsta inspelning för flödet (avtalet).
 */
export async function startAudioUpload(ctx: Ctx, req: AudioUploadRequest): Promise<Result<{ ticket: AudioUploadTicket; maxMinutes: number; languages: string[] }, AudioUploadError>> {
  const t = await audioUploadTarget(ctx, req);
  if (!t.ok) return t;
  const maxMinutes = recordingMaxMinutes(t.config, t.kind) ?? 0;
  if (req.durationSec != null && req.durationSec > maxMinutes * 60 + 30) return no("too_long");
  // Utan AI finns inget att transkribera med – ingen fil tas emot (den manuella vägen gäller).
  try {
    requireAi(ctx);
  } catch {
    return no("ai_unavailable");
  }
  const audio = requireAudio(ctx);
  if (t.kind === "participant" && t.linkId) {
    // ctx.system: deltagaren läser inte audio_uploads. Spärr mot att en läckt länk används för många uppladdningar.
    const link = await ctx.system.table("voice_links").get(t.linkId);
    const n = link ? await ctx.system.table("audio_uploads").count({ caseId: t.caseId ?? "", purpose: "participant", createdAt: { gte: link.sentAt } }) : 0;
    if (n >= MAX_UPLOADS_PER_LINK) return no("too_many");
  }
  const meta = { caseId: t.caseId, ownerId: t.ownerId, purpose: req.purpose, mimeType: req.mimeType, bytes: req.bytes ?? null, durationSec: req.durationSec ?? null };
  try {
    validateAudioMeta(meta);
  } catch (e) {
    if (e instanceof ApiError && (e.code === "audio_type" || e.code === "audio_size")) return no(e.code);
    throw e;
  }
  const ticket = await audio.createUpload(meta);
  await ctx.audit({
    action: "audio.upload_started", entity: "audio_upload", entityId: ticket.uploadId, contractId: t.contractId,
    details: { purpose: req.purpose, caseId: t.caseId },
  });
  return ok({ ticket, maxMinutes, languages: t.kind === "participant" ? aiLanguages(t.config) : ["sv"] });
}

// ---------------------------------------------------------------- Bekräftelse
export type ConfirmError = "not_found" | "link_missing" | "link_used" | "link_expired" | "audio_missing" | RecordingBlock;
const CONFIRM_TEXT: Record<"audio_missing", string> = { audio_missing: "Ljudfilen kom inte fram. Försök igen." };

/**
 * Klienten har laddat upp (eller spelat in i minnet): kontrollera att uppladdningen är den egna och bekräfta den
 * (ctx.audio.confirm – storleken tas från lagringen). Inloggade: raden läses via ctx.repo och ägaren är anroparen.
 * Deltagaren (token angiven – null = testdatats exempellänk – eller rollen deltagare): länken kontrolleras igen och
 * uppladdningen hör till länkens ärende.
 */
export async function confirmOwnUpload(ctx: Ctx, p: { uploadId: string; token?: string | null; durationSec?: number | null }): Promise<Result<{ audio: AudioRef }, ConfirmError>> {
  let u: AudioUpload | null;
  if (p.token !== undefined || ctx.actor.role === "deltagare") {
    const l = await voiceLinkByToken(ctx, p.token);
    if (l.state === "missing" || !l.case) return fail("link_missing", AUDIO_UPLOAD_ERROR_TEXT.link_missing);
    if (l.state === "used") return fail("link_used", AUDIO_UPLOAD_ERROR_TEXT.link_used);
    if (l.state === "expired") return fail("link_expired", AUDIO_UPLOAD_ERROR_TEXT.link_expired);
    if (l.block) return fail(l.block, RECORDING_BLOCK_TEXT[l.block]);
    // ctx.system: deltagaren läser inte audio_uploads – länken (kontrollerad ovan) är behörigheten.
    u = await ctx.system.table("audio_uploads").get(p.uploadId);
    if (u && (u.purpose !== "participant" || u.ownerId !== PARTICIPANT_USER_ID || u.caseId !== l.case.id)) u = null;
  } else {
    u = await ctx.repo.table("audio_uploads").get(p.uploadId);
    if (u && u.ownerId !== ctx.actor.userId) u = null;
  }
  if (!u) return fail("not_found", "Inspelningen finns inte.");
  const ref = await requireAudio(ctx).confirm(u.id, { durationSec: p.durationSec ?? null });
  if (!ref) return fail("audio_missing", CONFIRM_TEXT.audio_missing);
  return ok({ audio: ref });
}
