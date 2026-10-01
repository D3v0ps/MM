// Kontrakt för området röst (röstinspelning, docs/PLAN-ROST.md). Importeras av skärmar – aldrig hanterarna.
//
//   Gemensamt för alla tre flödena
//     rost.uploadStart    börja en uppladdning: behörighet, avtal, samtycke, skyddade personuppgifter (startAudioUpload i
//                         src/features/_shared/voice-upload.ts). Appen får en signerad adress – webbläsaren laddar upp filen
//                         direkt till lagringen (privat bucket i Stockholm). Minnesläget och prototypen: ingen adress.
//   Deltagaren (/rost/:token, publik, ingen inloggning – länken är behörigheten)
//     rost.link           länkens läge, språk, längsta inspelning och samtyckestextens version – inga personuppgifter
//     rost.send           skicka inspelningen: transkribering (+ översättning till svenska) och radering av ljudet
//     rost.sendStatus     läget för en skickad inspelning (appen: jobbet körs direkt efter svaret)
//   Coachen (ärendekortet och Min vecka)
//     rost.caseVoice      röstlänken och deltagarens röstmeddelanden i ärendet
//     rost.linkSend       skicka inspelningslänk via deltagarens kontaktväg – aldrig vid skyddade personuppgifter
//     rost.noteReview     markera ett röstmeddelande som granskat (eller arkivera)
//     rost.pendingNotes   nya röstmeddelanden att granska i coachens ärenden
//
// Coachens inspelning av avstämningen finns i src/features/coach/api.ts (coach.recordingFinish) och kommunens "Tala in" i
// src/features/kommun/api.ts (kommun.dictationFinish).
import { z } from "zod";
import { command, query, type Result } from "@/api/contract";
import type { LocalDateTime } from "@/core/time";
import { AUDIO_PURPOSES, type AiRunStatus, type VoiceLinkChannel, type VoiceNoteStatus } from "@/data/schema";
import { IdSchema } from "../_shared/schemas";

// ================================================================ Uppladdning (alla flöden)
/** Största ljudfil (samma som AUDIO_MAX_BYTES i src/features/_shared/audio-port.ts och bucketens gräns). */
export const UPLOAD_MAX_BYTES = 25 * 1024 * 1024;

/** Token i deltagarens länk. Ett felaktigt format visas som "Länken fungerar inte" (inte som ett tekniskt fel). */
const TokenSchema = z.string().max(200);

export const UploadStartSchema = z.object({
  /** checkin = coachens avstämning, dictation = kommunens "Tala in", participant = deltagarens länk. */
  purpose: z.enum(AUDIO_PURPOSES),
  /** Ärendet (coachens avstämning, kommunens meddelande). Deltagaren: ärendet tas ur länken. */
  caseId: IdSchema.nullish(),
  /** Kommunens "Tala in" i en ny beställning: avtalet (standard: handläggarens enda avtal). */
  contractId: IdSchema.nullish(),
  /** Deltagarens länk. Utan token: testdatats exempellänk. */
  token: TokenSchema.nullish(),
  /** Filtypen från webbläsaren, t.ex. "audio/webm;codecs=opus". */
  mimeType: z.string().min(1).max(120),
  bytes: z.int().min(0).nullish(),
  durationSec: z.number().min(0).max(86_400).nullish(),
  /** Kommunens nya beställning gäller skyddade personuppgifter – då stoppas "Tala in". */
  protectedOrder: z.boolean().optional(),
  /** Deltagaren har kryssat i samtycket i länken. Krävs för purpose participant. */
  consent: z.boolean().optional(),
});
export type UploadStartInput = z.infer<typeof UploadStartSchema>;

/** Var webbläsaren laddar upp ljudet. uploadUrl null = minnesläget/prototypen (ingen uppladdning behövs). */
export type UploadTicket = { uploadId: string; uploadUrl: string | null; expiresAt: LocalDateTime | null; maxBytes: number };
export type UploadStartError =
  | "not_found" | "forbidden" | "link_missing" | "link_used" | "link_expired" | "disabled" | "protected" | "no_consent" | "too_many" | "too_long"
  | "audio_type" | "audio_size" | "ai_unavailable" | "consent";
export const uploadStart = command("rost.uploadStart", UploadStartSchema).returns<Result<{ ticket: UploadTicket; maxMinutes: number }, UploadStartError>>();

/** Läget för en AI-körning som skärmen väntar på. error är en fast text utan personuppgifter. */
export type VoiceState = { aiRunId: string; status: AiRunStatus; error: string | null; audioDeletedAt: LocalDateTime | null };
/** Fel när inspelningen skickas (bekräftelsen av uppladdningen). */
export type SendError = "not_found" | "forbidden" | "link_missing" | "link_used" | "link_expired" | "audio_missing" | "disabled" | "protected" | "no_consent" | "language";

// ================================================================ Deltagaren (/rost/:token)
export const ROST_LANGS = ["sv", "en", "ar", "so"] as const;
export type RostLang = (typeof ROST_LANGS)[number];

export type RostLinkState = "open" | "used" | "expired" | "missing" | "disabled";
export type RostLinkView = {
  state: RostLinkState;
  /** Förvalt språk (det coachen valde när länken skickades). */
  language: RostLang;
  /** Språken deltagaren kan välja (avtalets språk som sidan har texter för). Svenska först. */
  languages: RostLang[];
  /** Längsta inspelning i minuter. */
  maxMinutes: number;
  /** Antal dagar länken gäller. */
  days: number;
  /** Var insatsen hålls (kontoret, t.ex. "Alby") – visas i sidhuvudet. */
  location: string;
  /** Samtyckestextens version som deltagaren godkänner. */
  consentVersion: string;
};
export const rostLink = query("rost.link", z.object({ token: TokenSchema.optional() })).returns<RostLinkView>();

export const rostSend = command("rost.send", z.object({
  token: TokenSchema.optional(),
  uploadId: IdSchema,
  /** Språket deltagaren valde (talar). */
  language: z.enum(ROST_LANGS),
  /** Deltagaren har godkänt samtyckestexten (krävs). Versionen som sparas är den aktuella (VOICE_CONSENT_VERSION). */
  consent: z.literal(true),
  durationSec: z.number().min(0).max(86_400).nullish(),
})).returns<Result<VoiceState, SendError>>();

export const rostSendStatus = query("rost.sendStatus", z.object({ token: TokenSchema.optional(), aiRunId: IdSchema })).returns<VoiceState | null>();

// ================================================================ Coachen: ärendekortet och Min vecka
export type VoiceNoteView = {
  id: string;
  caseId: string;
  createdAt: LocalDateTime;
  /** Språket deltagaren talade (ISO 639-1) och dess namn ("somaliska"). */
  language: string;
  languageName: string;
  /** Texten på svenska. Översatt av AI när deltagaren talade ett annat språk (translated). */
  textSv: string;
  /** Transkriptet på originalspråket (bara vid översättning). */
  textOriginal: string | null;
  translated: boolean;
  status: VoiceNoteStatus;
  reviewedAt: LocalDateTime | null;
  reviewedByName: string | null;
  consentTextVersion: string;
  consentGivenAt: LocalDateTime;
};
export type VoiceLinkView = {
  id: string;
  sentAt: LocalDateTime;
  expiresAt: LocalDateTime;
  usedAt: LocalDateTime | null;
  channel: VoiceLinkChannel;
  language: string;
  languageName: string;
  state: "open" | "used" | "expired";
};
export type CaseVoiceView = {
  caseId: string;
  caseNumber: string;
  /** Får granska röstmeddelanden och skicka länk (arbetar i ärendet och får ändra det). */
  canWork: boolean;
  /** Länken kan skickas – annars varför inte (text till coachen). */
  send: {
    allowed: boolean;
    reason: string | null;
    /** Kanal och text: "SMS till deltagarens telefonnummer". */
    channel: VoiceLinkChannel | null;
    channelText: string;
    languages: { code: string; label: string }[];
    defaultLanguage: string;
    days: number;
    maxMinutes: number;
    /** Texten i utskicket (utan länkens adress) – visas innan coachen skickar. */
    messageText: string;
  };
  lastLink: VoiceLinkView | null;
  notes: VoiceNoteView[];
};
export const caseVoice = query("rost.caseVoice", z.object({ caseId: IdSchema })).returns<CaseVoiceView | null>();

export type LinkSendError = "not_found" | "forbidden" | "protected" | "disabled" | "no_channel" | "closed" | "language";
/** path: länkens sökväg ("/rost/<token>"). Visas bara i prototypen (förhandsvisning) – deltagaren får den i utskicket. */
export const linkSend = command("rost.linkSend", z.object({ caseId: IdSchema, language: z.enum(ROST_LANGS) })).returns<
  Result<{ linkId: string; path: string; expiresAt: LocalDateTime; channel: VoiceLinkChannel }, LinkSendError>
>();

/** Deltagarens röstmeddelanden visades (loggas i revisionsloggen – transkript, CLAUDE.md punkt 3). Tyst. */
export const notesSeen = command("rost.notesSeen", z.object({ caseId: IdSchema })).returns<Result<object, "not_found">>();

export const noteReview = command("rost.noteReview", z.object({ noteId: IdSchema, status: z.enum(["new", "reviewed", "archived"]) })).returns<Result<object, "not_found" | "forbidden">>();

export type PendingNoteRow = { id: string; caseId: string; caseNumber: string; name: string; createdAt: LocalDateTime; languageName: string; translated: boolean; excerpt: string };
export const pendingNotes = query("rost.pendingNotes", z.object({})).returns<PendingNoteRow[]>();
