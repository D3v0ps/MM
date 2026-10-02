// Steg efter mappningen: röstinspelningens testdata (finns inte i den gamla prototypen – beslut 2026-09-30, docs/PLAN-ROST.md).
// Läggs till direkt i tabellerna efter toTables(), med fasta id:n, så att prototypens testdata (paritetstestet mot
// prototyp/src/01-seed.js, antalet rader i ai_runs, consents, outbound_messages och audit_log) inte ändras.
//
//   pvn-nadia   Nadia (BOT-26-0143) spelade in på somaliska via länken vl-nadia – svensk översättning, väntar på granskning
//   pvn-yusuf   Yusuf (BOT-26-0148) spelade in på svenska via länken vl-yusuf – granskat av coachen Amira.
//               Yusuf har sagt nej till inspelning av avstämningarna (consents); deltagarens egen inspelning har ett eget
//               samtycke i länken – ett nej till det ena påverkar inte det andra.
//   vl-demo     Oanvänd länk till Amal (BOT-27-0012, arabiska som förval) – exempellänken på /rost utan token
//   aud-*       ljudfilernas spår: raderade direkt efter transkriberingen (deltagarnas två och Mehmets inspelade avstämning)
// Inga länkar eller röstmeddelanden i det skyddade ärendet. AI-körningarna finns inte i testdatat (aiRunId null) – utom
// Mehmets befintliga ai-run-mehmet, som nu pekar på sin ljudfil (inputRef).
import { addDays, addMinutes } from "@/core/time";
import type { AudioUpload, Db, DemoTag, ParticipantVoiceNote, VoiceLink } from "../schema";
import { participantMessage } from "./voice-texts";

/** Samtyckestextens version i testdatat (deltagarens samtycke i länken). */
export const TEST_VOICE_CONSENT_VERSION = "röst-v1.0 (2026-09-30)";
/** Länkarna gäller sju dagar (Botkyrkas ai.participantLinkValidDays). */
const LINK_DAYS = 7;
/** Ungefär 32 kbit/s (SPEC §8.2): 4 000 byte per sekund. */
const BYTES_PER_SECOND = 4000;

const tagged = (db: Db, tag: string): string => {
  const id = db.demo_tags.find((t) => t.tag === tag)?.entityIds[0];
  if (!id) throw new Error(`Testdatat saknar ärendet ${tag}`);
  return id;
};
const expires = (sentAt: string) => addDays(sentAt, LINK_DAYS);

export function addVoiceData(db: Db): void {
  const nadia = tagged(db, "nadia");
  const yusuf = tagged(db, "yusuf");
  const amal = tagged(db, "amal");
  const mehmet = tagged(db, "mehmet");
  const coach = "u-amira";

  // ---- Länkarna (token lagras bara som SHA-256; testdatats påhittade token "testdata-vl-nadia" respektive "testdata-vl-yusuf")
  const links: VoiceLink[] = [
    { id: "vl-yusuf", caseId: yusuf, tokenHash: "7ccf2ec74283f5d7aee9bb82505f2d1e965c426c905d1f3864d16a81d7aa4b14", channel: "sms", language: "sv",
      sentAt: "2027-01-25T11:40", expiresAt: expires("2027-01-25T11:40"), usedAt: "2027-01-26T07:55", createdBy: coach },
    { id: "vl-nadia", caseId: nadia, tokenHash: "3cb860bc33b1dce96d11e26e2a095e5e549a0f23e56340fd7261a53e59f42cb7", channel: "sms", language: "so",
      sentAt: "2027-01-28T15:10", expiresAt: expires("2027-01-28T15:10"), usedAt: "2027-01-28T19:42", createdBy: coach },
    { id: "vl-demo", caseId: amal, tokenHash: null, channel: "sms", language: "ar",
      sentAt: "2027-02-01T08:40", expiresAt: expires("2027-02-01T08:40"), usedAt: null, createdBy: coach },
  ];
  db.voice_links.push(...links);

  // ---- Röstmeddelandena (text – inget ljud sparas)
  const notes: ParticipantVoiceNote[] = [
    { id: "pvn-yusuf", caseId: yusuf, linkId: "vl-yusuf", language: "sv", textSv: participantMessage(1, "sv"), textOriginal: null,
      consentTextVersion: TEST_VOICE_CONSENT_VERSION, consentGivenAt: "2027-01-26T07:53", status: "reviewed", createdAt: "2027-01-26T07:55",
      reviewedBy: coach, reviewedAt: "2027-01-26T10:20", aiRunId: null },
    { id: "pvn-nadia", caseId: nadia, linkId: "vl-nadia", language: "so", textSv: participantMessage(0, "sv"), textOriginal: participantMessage(0, "so"),
      consentTextVersion: TEST_VOICE_CONSENT_VERSION, consentGivenAt: "2027-01-28T19:40", status: "new", createdAt: "2027-01-28T19:42",
      reviewedBy: null, reviewedAt: null, aiRunId: null },
  ];
  db.participant_voice_notes.push(...notes);

  // ---- Ljudfilernas spår: raderade direkt efter lyckad transkribering (CLAUDE.md punkt 7)
  const upload = (id: string, caseId: string, ownerId: string, purpose: AudioUpload["purpose"], seconds: number, createdAt: string, deletedAt: string): AudioUpload => ({
    id, caseId, ownerId, purpose, storagePath: `${purpose}/${id}.webm`, mimeType: "audio/webm", bytes: seconds * BYTES_PER_SECOND, durationSec: seconds,
    status: "deleted", createdAt, deletedAt,
  });
  const mehRun = db.ai_runs.find((r) => r.id === "ai-run-mehmet");
  const uploads: AudioUpload[] = [
    upload("aud-pvn-yusuf", yusuf, "deltagare", "participant", 38, "2027-01-26T07:54", "2027-01-26T07:55"),
    upload("aud-pvn-nadia", nadia, "deltagare", "participant", 53, "2027-01-28T19:41", "2027-01-28T19:42"),
  ];
  if (mehRun) {
    // Mehmets inspelade avstämning (AI-utkastet som väntar på granskning): ljudet laddades upp efter mötet och raderades
    // när transkriberingen var klar (ai_runs.inputDeletedAt).
    uploads.push(upload("aud-mehmet", mehmet, coach, "checkin", mehRun.audioSeconds ?? 0, addMinutes(mehRun.createdAt, -1), mehRun.inputDeletedAt ?? mehRun.createdAt));
    mehRun.inputRef = "aud-mehmet";
  }
  db.audio_uploads.push(...uploads);

  // ---- Namngivna rader för scenarier och förklaringar (bara testdata)
  const tags: DemoTag[] = [
    { id: "vl-demo", tag: "vl-demo", entity: "voice_links", entityIds: ["vl-demo"] },
    { id: "pvn-nadia", tag: "pvn-nadia", entity: "participant_voice_notes", entityIds: ["pvn-nadia"] },
    { id: "pvn-yusuf", tag: "pvn-yusuf", entity: "participant_voice_notes", entityIds: ["pvn-yusuf"] },
  ];
  db.demo_tags.push(...tags);
}
