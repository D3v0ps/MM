// Steg efter mappningen: Karims beslut 2026-10-29 (Ändra startdatum) i testdatat (påhittade uppgifter). Prototypens tillstånd
// (createProtoState) och generatorerna ändras inte, så slumpen och ordningen ligger kvar.
//
//   Ändra startdatum  BOT-27-0031 (huvudcoach Amira, handläggare Maria) startades först med startdatumet 1 februari, men
//                     deltagaren började vid första mötet den 26 januari. Amira ändrade startdatumet bakåt till 26 januari den
//                     28 januari med en motivering i deltagarkortet (case_start_changes, 0038). Inga tillfällen skapades bakåt –
//                     tillfällena från 26 januari är de som coachen lade till. Ärendets startdatum är redan 26 januari i
//                     testdatat, så ändringen rör inga andra rader (paritetstestet mot den gamla prototypen påverkas inte).
//                     Prova Ändra startdatum på BOT-27-0041 (startade 1 februari, inga registrerade tillfällen än) – och på ett
//                     ärende som startade i december (december är fakturerad – ändringen stoppas).
import type { CaseNote, CaseStartChange, Db } from "../schema";

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

export function applyDecisions20261029(db: Db): void {
  for (const x of SEED_START_CHANGES) {
    const c = db.cases.find((k) => k.id === x.caseId);
    // Ärendet har redan det nya startdatumet (samma som triggern case_start_changes_apply skulle ge).
    if (!c || c.startDate !== x.toDate) continue;
    db.case_notes.push(motivation(x));
    db.case_start_changes.push({ ...x });
  }
}
