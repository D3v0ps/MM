// Hanterare för området röst (röstinspelning, docs/PLAN-ROST.md). Registreras via src/api/handlers.ts – importeras aldrig av skärmar.
//
// Uppladdning, behörighet och jobben är gemensamma för alla körlägen (src/features/_shared/voice-upload.ts och voice-jobs.ts):
//   startAudioUpload  vem som får spela in vad (roll, ärende, avtal, samtycke, skyddade personuppgifter)
//   confirmOwnUpload  uppladdningen är den egna och filen finns
//   enqueueVoiceJob   transkribering (+ översättning), radering av ljudet, ai_runs – minnesläget kör direkt, appen i kön
//
// Deltagaren har ingen inloggning – länken är behörigheten (samma mönster som pulslänken). Länken slås upp med ctx.system
// efter tokenkontrollen, och bara länkens läge lämnas ut. Aldrig länkar eller inspelning för skyddade personuppgifter.
// Röstmeddelandena är underlag för coachen: kommunen ser dem inte (policy.ts), ekonomen aldrig.
import { fail, ok } from "@/api/contract";
import type { Role } from "@/api/roles";
import { handleCommand, handleQuery, type Ctx } from "@/api/server";
import { aiLanguages, recordingMaxMinutes, type ContractConfig } from "@/core/config";
import { addDays, addMinutes, diffDays, type LocalDateTime } from "@/core/time";
import type { Case, ParticipantVoiceNote, Person, VoiceLink, VoiceLinkChannel } from "@/data/schema";
import { recordingBlock, RECORDING_BLOCK_TEXT } from "../_shared/ai-port";
import { canEditCase } from "../_shared/context";
import { enqueueVoiceJob, voiceRunState } from "../_shared/voice-jobs";
import { confirmOwnUpload, startAudioUpload, voiceLinkByToken, type VoiceLinkLookup } from "../_shared/voice-upload";
import {
  caseVoice, linkSend, noteReview, notesSeen, pendingNotes, rostLink, rostSend, rostSendStatus, ROST_LANGS, uploadStart,
  type CaseVoiceView, type RostLang, type RostLinkView, type VoiceLinkView, type VoiceNoteView, type VoiceState,
} from "./api";
import { sha256Hex } from "./sha256";
import { languageCodeOf, languageName, linkMessageText, VOICE_CONSENT_VERSION } from "./texts";

const NOT_FOUND = "Ärendet finns inte, eller så har du inte behörighet att se det.";
const NO_EDIT = "Du har inte behörighet att ändra i ärendet.";
/** Arbetar i ärendet och får skicka länk och granska röstmeddelanden. */
const VOICE_WORKERS: readonly Role[] = ["coach", "samordnare", "avtalsansvarig"];
/** Får läsa deltagarens röstmeddelanden (policyn filtrerar per ärende; ekonom, handledare och kommunen ser dem inte). */
const VOICE_READERS: readonly Role[] = ["coach", "samordnare", "avtalsansvarig", "chef", "admin"];

const isRostLang = (l: string): l is RostLang => (ROST_LANGS as readonly string[]).includes(l);
/** Avtalets språk som deltagarens sida har texter för (svenska först). */
const rostLanguages = (cfg: Pick<ContractConfig, "ai"> | null | undefined): RostLang[] => aiLanguages(cfg).filter(isRostLang);
const linkDays = (cfg: ContractConfig | null | undefined): number => {
  const d = (cfg?.ai as { participantLinkValidDays?: number } | undefined)?.participantLinkValidDays;
  return typeof d === "number" && d > 0 ? d : 7;
};
const stateOfLink = (l: Pick<VoiceLink, "usedAt" | "expiresAt">, now: LocalDateTime): VoiceLinkView["state"] => (l.usedAt ? "used" : now > l.expiresAt ? "expired" : "open");

// ================================================================ Uppladdning
handleCommand(uploadStart, { roles: ["coach", "kommun_handlaggare", "deltagare"] }, async (ctx, p) => {
  // Deltagarens inspelning: bara via länken och bara efter samtycke i länken (texten och versionen i rost/texts.ts).
  if (p.purpose === "participant") {
    if (ctx.actor.role !== "deltagare") return fail("forbidden", "Deltagarens inspelning görs bara via deltagarens länk.");
    if (p.consent !== true) return fail("consent", "Kryssa i samtycket innan du spelar in.");
  }
  const r = await startAudioUpload(ctx, {
    purpose: p.purpose, caseId: p.caseId ?? null, contractId: p.contractId ?? null, token: p.token ?? null, mimeType: p.mimeType, bytes: p.bytes ?? null,
    durationSec: p.durationSec ?? null, protectedOrder: p.protectedOrder,
  });
  if (!r.ok) return r;
  const t = r.ticket;
  return ok({ ticket: { uploadId: t.uploadId, uploadUrl: t.uploadUrl, expiresAt: t.expiresAt, maxBytes: t.maxBytes }, maxMinutes: r.maxMinutes });
});

// ================================================================ Deltagaren (/rost/:token)
const TEXT: Record<"link_missing" | "link_used" | "link_expired" | "language", string> = {
  link_missing: "Länken fungerar inte.",
  link_used: "Länken är redan använd.",
  link_expired: "Länken har gått ut.",
  language: "Språket finns inte bland avtalets språk.",
};

handleQuery(rostLink, { roles: ["deltagare"] }, async (ctx, p): Promise<RostLinkView> => {
  const l = await voiceLinkByToken(ctx, p.token);
  const langs = l.config ? rostLanguages(l.config) : [...ROST_LANGS];
  const pref = l.link?.language ?? "sv";
  const days = l.link ? diffDays(l.link.sentAt, l.link.expiresAt) : linkDays(l.config);
  return {
    // Avtalet har stängt av deltagarens inspelning (eller saknar godkännande): länken fungerar inte just nu.
    state: l.state === "open" && l.block ? "disabled" : l.state,
    language: isRostLang(pref) && langs.includes(pref) ? pref : "sv",
    languages: langs.length ? langs : ["sv"],
    maxMinutes: recordingMaxMinutes(l.config, "participant") ?? 5,
    days,
    location: l.case?.location || "Alby",
    consentVersion: VOICE_CONSENT_VERSION,
  };
});

/** Länken ska gälla nu: fel med deltagarens text, annars länken. */
function openLink(l: VoiceLinkLookup) {
  if (l.state === "missing" || !l.link || !l.case) return fail("link_missing", TEXT.link_missing);
  if (l.state === "used") return fail("link_used", TEXT.link_used);
  if (l.state === "expired") return fail("link_expired", TEXT.link_expired);
  if (l.block) return fail(l.block, RECORDING_BLOCK_TEXT[l.block]);
  return ok({ link: l.link, case: l.case });
}

async function stateOfRun(ctx: Ctx, aiRunId: string): Promise<VoiceState | null> {
  // ctx.system: deltagaren läser inte ai_runs – bara läget (inga texter) lämnas ut, efter länkkontrollen.
  const run = await ctx.system.table("ai_runs").get(aiRunId);
  if (!run) return null;
  const s = voiceRunState(run);
  return { aiRunId: s.aiRunId, status: s.status, error: s.error?.text ?? null, audioDeletedAt: s.audioDeletedAt };
}

handleCommand(rostSend, { roles: ["deltagare"] }, async (ctx, p) => {
  const l = await voiceLinkByToken(ctx, p.token);
  const o = openLink(l);
  if (!o.ok) return o;
  if (!rostLanguages(l.config).includes(p.language)) return fail("language", TEXT.language);
  const conf = await confirmOwnUpload(ctx, { uploadId: p.uploadId, token: p.token ?? null, durationSec: p.durationSec ?? null });
  if (!conf.ok) return conf;
  // ctx.system: deltagaren läser inte audio_uploads. Samtycket gavs i länken innan inspelningen startade (rost.uploadStart
  // kräver det) – tidpunkten är när uppladdningen skapades.
  const u = await ctx.system.table("audio_uploads").get(p.uploadId);
  const consentGivenAt = u?.createdAt ?? ctx.now();
  const r = await enqueueVoiceJob(ctx, {
    kind: "transcribe_participant", uploadId: p.uploadId, linkId: o.link.id, language: p.language, consentTextVersion: VOICE_CONSENT_VERSION, consentGivenAt,
  });
  if (r.status !== "failed") {
    // ctx.system: länken förbrukas (systemsteg – deltagaren får inte ändra utskicket). Misslyckas transkriberingen direkt
    // står länken kvar, så att deltagaren kan försöka igen.
    await ctx.system.table("voice_links").update(o.link.id, { usedAt: ctx.now(), language: p.language });
  }
  await ctx.audit({
    action: "voice.participant_sent", entity: "voice_link", entityId: o.link.id, contractId: o.case.contractId,
    details: { caseId: o.case.id, aiRunId: r.aiRunId, language: p.language, consentTextVersion: VOICE_CONSENT_VERSION },
  });
  const s = await stateOfRun(ctx, r.aiRunId);
  return ok(s ?? { aiRunId: r.aiRunId, status: r.status, error: r.error?.text ?? null, audioDeletedAt: null });
});

handleQuery(rostSendStatus, { roles: ["deltagare"] }, async (ctx, p) => {
  const l = await voiceLinkByToken(ctx, p.token);
  if (!l.link || !l.case) return null;
  // Bara körningar för länkens ärende och deltagarens egna inspelningar efter att länken skickades.
  const run = await ctx.system.table("ai_runs").get(p.aiRunId);
  if (!run || run.kind !== "transcribe_participant" || run.caseId !== l.case.id || run.createdAt < l.link.sentAt) return null;
  return stateOfRun(ctx, run.id);
});

// ================================================================ Coachen: ärendekortet
/** Kanalen för länken: deltagarens föredragna kontaktväg (telefon -> SMS). Brev eller saknad uppgift: ingen kanal. */
function channelFor(person: Pick<Person, "preferredContact" | "phone" | "email">): VoiceLinkChannel | null {
  if (person.preferredContact === "email") return person.email ? "email" : null;
  if (person.preferredContact === "sms" || person.preferredContact === "phone") return person.phone ? "sms" : null;
  return null;
}
const CHANNEL_TEXT: Record<VoiceLinkChannel, string> = { sms: "SMS till deltagarens telefonnummer", email: "E-post till deltagarens e-postadress" };
const CHANNEL_TO: Record<VoiceLinkChannel, string> = { sms: "deltagare (SMS)", email: "deltagare (e-post)" };

type SendCheck = { allowed: true; channel: VoiceLinkChannel } | { allowed: false; error: "protected" | "disabled" | "no_channel" | "closed" | "forbidden"; reason: string };
function sendCheck(c: Case, person: Person | null, cfg: ContractConfig | null, canWork: boolean): SendCheck {
  if (!canWork) return { allowed: false, error: "forbidden", reason: "Bara den som arbetar i ärendet kan skicka länken." };
  const block = recordingBlock({ cfg, kind: "participant", person });
  if (block === "protected") return { allowed: false, error: "protected", reason: "Deltagaren har skyddade personuppgifter. Inga länkar, SMS eller mejl skickas och ingen inspelning görs." };
  if (block) return { allowed: false, error: "disabled", reason: "Deltagarens egen inspelning är inte påslagen i avtalet." };
  if (c.status === "closed" || c.status === "declined") return { allowed: false, error: "closed", reason: "Insatsen är avslutad." };
  const ch = person ? channelFor(person) : null;
  if (!ch) {
    return {
      allowed: false, error: "no_channel",
      reason: "Deltagaren har ingen kontaktväg för länken (brev eller uppgift saknas). Spela in samtalet i avstämningen i stället.",
    };
  }
  return { allowed: true, channel: ch };
}

async function caseContext(ctx: Ctx, caseId: string) {
  const c = await ctx.repo.table("cases").get(caseId);
  if (!c) return null;
  const [person, contract] = await Promise.all([ctx.repo.table("persons").get(c.personId), ctx.repo.table("contracts").get(c.contractId)]);
  return { c, person, cfg: (contract?.config ?? null) as ContractConfig | null };
}

function toNoteView(n: ParticipantVoiceNote, names: Map<string, string>): VoiceNoteView {
  return {
    id: n.id, caseId: n.caseId, createdAt: n.createdAt, language: n.language, languageName: languageName(n.language), textSv: n.textSv, textOriginal: n.textOriginal,
    translated: n.language !== "sv" && n.textOriginal != null, status: n.status, reviewedAt: n.reviewedAt,
    reviewedByName: n.reviewedBy ? (names.get(n.reviewedBy) ?? "–") : null, consentTextVersion: n.consentTextVersion, consentGivenAt: n.consentGivenAt,
  };
}

handleQuery(caseVoice, { roles: VOICE_READERS }, async (ctx, p): Promise<CaseVoiceView | null> => {
  const cc = await caseContext(ctx, p.caseId);
  if (!cc) return null;
  const { c, person, cfg } = cc;
  const now = ctx.now();
  const canWork = VOICE_WORKERS.includes(ctx.actor.role) && (await canEditCase(ctx, c));
  const [notes, links, profiles] = await Promise.all([
    ctx.repo.table("participant_voice_notes").list({ caseId: c.id }),
    ctx.repo.table("voice_links").list({ caseId: c.id }),
    ctx.repo.table("profiles").list(),
  ]);
  const names = new Map(profiles.map((x) => [x.id, x.fullName]));
  const last = [...links].sort((a, b) => (a.sentAt < b.sentAt ? 1 : a.sentAt > b.sentAt ? -1 : 0))[0] ?? null;
  const check = sendCheck(c, person, cfg, canWork);
  const langs = rostLanguages(cfg);
  const pref = languageCodeOf(person?.language);
  const days = linkDays(cfg);
  return {
    caseId: c.id,
    caseNumber: c.caseNumber,
    canWork,
    send: {
      allowed: check.allowed,
      reason: check.allowed ? null : check.reason,
      channel: check.allowed ? check.channel : null,
      channelText: check.allowed ? CHANNEL_TEXT[check.channel] : "",
      languages: langs.map((code) => ({ code, label: languageName(code) })),
      defaultLanguage: pref && langs.includes(pref) ? pref : "sv",
      days,
      maxMinutes: recordingMaxMinutes(cfg, "participant") ?? 0,
      messageText: linkMessageText(days),
    },
    lastLink: last
      ? {
          id: last.id, sentAt: last.sentAt, expiresAt: last.expiresAt, usedAt: last.usedAt, channel: last.channel, language: last.language,
          languageName: languageName(last.language), state: stateOfLink(last, now),
        }
      : null,
    // Nyast först. Arkiverade visas inte (de finns kvar som spår).
    notes: notes
      .filter((n) => n.status !== "archived")
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
      .map((n) => toNoteView(n, names)),
  };
});

handleCommand(linkSend, { roles: VOICE_WORKERS }, async (ctx, p) => {
  const cc = await caseContext(ctx, p.caseId);
  if (!cc) return fail("not_found", NOT_FOUND);
  const { c, person, cfg } = cc;
  if (!(await canEditCase(ctx, c))) return fail("forbidden", NO_EDIT);
  const check = sendCheck(c, person, cfg, true);
  if (!check.allowed) {
    if (check.error === "protected") {
      await ctx.audit({ action: "voice.link_blocked", entity: "case", entityId: c.id, contractId: c.contractId, details: { reason: "Skyddade personuppgifter" } });
    }
    return fail(check.error === "forbidden" ? "forbidden" : check.error, check.reason);
  }
  if (!rostLanguages(cfg).includes(p.language)) return fail("language", TEXT.language);
  const now = ctx.now();
  const days = linkDays(cfg);
  // Token: ctx.newId – i drift ett slumpat UUID (122 bitar), i minnesläget deterministiskt så att prototypen kan spela upp
  // kommandona igen. Bara hashen sparas (voice_links.tokenHash); token finns bara i utskicket.
  const token = ctx.newId("rost").replace(/[^A-Za-z0-9_-]/g, "");
  const table = ctx.repo.table("voice_links");
  // En länk i taget: tidigare oanvända länkar slutar gälla (sista giltiga minut: minuten före den nya länken).
  const closeAt = addMinutes(now, -1);
  for (const old of await table.list({ caseId: c.id, usedAt: { isNull: true } })) {
    if (old.expiresAt > closeAt) await table.update(old.id, { expiresAt: closeAt });
  }
  const link: VoiceLink = {
    id: ctx.newId("vl"), caseId: c.id, tokenHash: sha256Hex(token), channel: check.channel, language: p.language, sentAt: now, expiresAt: addDays(now, days),
    usedAt: null, createdBy: ctx.actor.userId,
  };
  await table.insert(link);
  const path = `/rost/${token}`;
  // Utskicket innehåller bara länken – inga namn, inget ärendenummer (CLAUDE.md punkt 9). Mottagaren anges som för kallelsen:
  // utskicksadaptern slår upp numret eller adressen via ärendet.
  await ctx.notify({ channel: check.channel, to: CHANNEL_TO[check.channel], template: "rostlank", body: `${linkMessageText(days)} ${path}`, caseId: c.id });
  await ctx.audit({ action: "voice.link_sent", entity: "voice_link", entityId: link.id, contractId: c.contractId, details: { caseId: c.id, channel: check.channel, language: p.language } });
  // Sökvägen (med token) lämnas bara ut i minnesläget/prototypen – aldrig från servern i supabase-läget.
  return ok({ linkId: link.id, path: ctx.exposeLinkPaths ? path : null, expiresAt: link.expiresAt, channel: check.channel });
});

handleCommand(noteReview, { roles: VOICE_WORKERS }, async (ctx, p) => {
  const n = await ctx.repo.table("participant_voice_notes").get(p.noteId);
  if (!n) return fail("not_found", "Röstmeddelandet finns inte, eller så har du inte behörighet att se det.");
  const c = await ctx.repo.table("cases").get(n.caseId);
  if (!c) return fail("not_found", NOT_FOUND);
  if (!(await canEditCase(ctx, c))) return fail("forbidden", NO_EDIT);
  const back = p.status === "new";
  await ctx.repo.table("participant_voice_notes").update(n.id, { status: p.status, reviewedBy: back ? null : ctx.actor.userId, reviewedAt: back ? null : ctx.now() });
  await ctx.audit({ action: `voice_note.${p.status === "new" ? "reopened" : p.status}`, entity: "participant_voice_note", entityId: n.id, contractId: c.contractId, details: { caseId: c.id } });
  return ok({});
});

// Visningen av deltagarens röstmeddelanden loggas (transkript – CLAUDE.md punkt 3). Tyst: flyttar inte demoklockan.
handleCommand(notesSeen, { roles: VOICE_READERS, silent: true }, async (ctx, p) => {
  const c = await ctx.repo.table("cases").get(p.caseId);
  if (!c) return fail("not_found", NOT_FOUND);
  const notes = await ctx.repo.table("participant_voice_notes").list({ caseId: c.id });
  if (!notes.length) return ok({});
  await ctx.audit({ action: "voice_note.view", entity: "case", entityId: c.id, contractId: c.contractId, details: { notes: notes.length } });
  return ok({});
});

// ================================================================ Min vecka: nya röstmeddelanden
handleQuery(pendingNotes, { roles: ["coach"] }, async (ctx) => {
  const notes = await ctx.repo.table("participant_voice_notes").list({ status: "new" });
  if (!notes.length) return [];
  const cases = await ctx.repo.table("cases").list({ id: { in: [...new Set(notes.map((n) => n.caseId))] } });
  // Coachen: bara de egna ärendena (huvudcoach).
  const mine = new Map(cases.filter((c) => c.leadCoachId === ctx.actor.userId).map((c) => [c.id, c]));
  const persons = await ctx.repo.table("persons").list({ id: { in: [...mine.values()].map((c) => c.personId) } });
  const pname = new Map(persons.map((x) => [x.id, `${x.firstName} ${x.lastName}`]));
  return notes
    .filter((n) => mine.has(n.caseId))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
    .map((n) => {
      const c = mine.get(n.caseId) as Case;
      const text = n.textSv.trim();
      return {
        id: n.id, caseId: c.id, caseNumber: c.caseNumber, name: pname.get(c.personId) ?? "–", createdAt: n.createdAt, languageName: languageName(n.language),
        translated: n.language !== "sv" && n.textOriginal != null, excerpt: text.length > 140 ? `${text.slice(0, 137).trimEnd()} …` : text,
      };
    });
});
