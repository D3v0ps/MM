// Steg efter mappningen: Karims beslut 2026-10-29 i testdatat (påhittade uppgifter). Prototypens tillstånd (createProtoState)
// och generatorerna ändras inte, så slumpen och ordningen ligger kvar.
//
//   Filer på deltagarkortet  CV, personligt brev, betyg och intyg (case_attachments kind participant, 0037). Bara
//                     Miljonbemanning ser dem – aldrig kommunen. Nadia Warsames ärende (BOT-26-0143, huvudcoach Amira): ett CV
//                     och ett personligt brev som Amira laddade upp, och ett intyg om truckkort som samordnaren Sara lade in.
//                     Linnea Olssons ärende (BOT-26-0163): ett CV. Innehållet finns inte i testdatat: prototypen och
//                     minnesläget visar en platshållare när filen öppnas, och testmiljön lägger en liten påhittad PDF i
//                     lagringen för varje fil när testdatat läses in (src/server/staging/placeholders.ts). Alla är PDF.
//
//   Ändra startdatum  BOT-27-0031 (huvudcoach Amira, handläggare Maria) startades först med startdatumet 1 februari, men
//                     deltagaren började vid första mötet den 26 januari. Amira ändrade startdatumet bakåt till 26 januari den
//                     28 januari med en motivering i deltagarkortet (case_start_changes, 0038). Inga tillfällen skapades bakåt –
//                     tillfällena från 26 januari är de som coachen lade till. Ärendets startdatum är redan 26 januari i
//                     testdatat, så ändringen rör inga andra rader. Revisionsloggen har ändringens rad (case.start_date_changed,
//                     id:n och datum) – ändringen är klar, så ingen gör om den (src/features/arenden/start-finish.ts).
//                     Prova Ändra startdatum på BOT-27-0041 (startade 1 februari, inga registrerade tillfällen än) – och på ett
//                     ärende som startade i december (december är fakturerad – ändringen stoppas).
import type { AuditLogEntry, CaseAttachment, CaseNote, CaseStartChange, Db } from "../schema";

const file = (id: string, caseId: string, category: NonNullable<CaseAttachment["category"]>, fileName: string, uploadedBy: string, createdAt: string, bytes: number): CaseAttachment => ({
  id, contractId: "c-bot", kind: "participant", category, caseId, uploadedBy, fileName, mimeType: "application/pdf", bytes, storagePath: `c-bot/${id}.pdf`,
  status: "uploaded", createdAt, linkedAt: createdAt, removedAt: null, removedBy: null, deletedAt: null, deleteReason: null,
});

/** Deltagarfilerna i testdatat (id:n börjar med att-seed-). */
export const SEED_PARTICIPANT_FILES: readonly CaseAttachment[] = [
  file("att-seed-nadia-cv", "case-260143", "cv", "CV truckförare januari 2027.pdf", "u-amira", "2027-01-12T14:05", 184_320),
  file("att-seed-nadia-brev", "case-260143", "personligt_brev", "Personligt brev lager.pdf", "u-amira", "2027-01-19T10:40", 96_256),
  file("att-seed-nadia-truck", "case-260143", "betyg_intyg", "Intyg truckkort A och B.pdf", "u-sara", "2027-01-26T15:20", 412_672),
  file("att-seed-linnea-cv", "case-260163", "cv", "CV restaurangbiträde.pdf", "u-amira", "2027-01-28T09:30", 158_720),
];

/** Ändringen av startdatum i testdatat. */
export const SEED_START_CHANGES: readonly CaseStartChange[] = [
  {
    id: "csc-seed-0031", contractId: "c-bot", caseId: "case-270031", fromDate: "2027-02-01", toDate: "2027-01-26", changedBy: "u-amira", changedAt: "2027-01-28T10:05",
    noteId: "note-startdatum-0031", seq: 1,
  },
];

const motivation = (x: CaseStartChange): CaseNote => ({
  id: x.noteId, contractId: x.contractId, caseId: x.caseId, authorId: x.changedBy, occurredOn: x.changedAt.slice(0, 10), kind: "other", audience: "team",
  body: "Ändrat startdatum: 1 feb 2027 → 26 jan 2027. Deltagaren började redan vid första mötet den 26 januari. Startdatumet var registrerat en vecka för sent.",
  createdAt: x.changedAt, updatedAt: null, removedAt: null, removedBy: null,
});

/** Revisionsloggens rad för ändringen: id:n och datum – aldrig motiveringen. Inga tillfällen togs bort (starten flyttades bakåt). */
const logged = (x: CaseStartChange): AuditLogEntry => ({
  id: `log-${x.id}`, occurredAt: x.changedAt, actorId: x.changedBy, action: "case.start_date_changed", entity: "case", entityId: x.caseId, contractId: x.contractId,
  details: { caseId: x.caseId, changeId: x.id, noteId: x.noteId, seq: x.seq, from: x.fromDate, to: x.toDate, removedActivityIds: [], removedAutoAttendanceIds: [] },
});

export function applyDecisions20261029(db: Db): void {
  for (const f of SEED_PARTICIPANT_FILES) {
    if (db.cases.some((c) => c.id === f.caseId)) db.case_attachments.push({ ...f });
  }
  for (const x of SEED_START_CHANGES) {
    const c = db.cases.find((k) => k.id === x.caseId);
    // Ärendet har redan det nya startdatumet (samma som triggern case_start_changes_apply skulle ge).
    if (!c || c.startDate !== x.toDate) continue;
    db.case_notes.push(motivation(x));
    db.case_start_changes.push({ ...x });
    db.audit_log.push(logged(x));
  }
}
