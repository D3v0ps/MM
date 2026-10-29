// Steg efter mappningen: Karims beslut 2026-10-29 i testdatat (påhittade uppgifter) – filer på deltagarkortet (CV, personligt
// brev, betyg och intyg; case_attachments kind participant, 0037). Bara Miljonbemanning ser dem – aldrig kommunen.
//
//   Nadia Warsames ärende (BOT-26-0143, huvudcoach Amira): ett CV och ett personligt brev som Amira laddade upp, och ett intyg
//   om truckkort som samordnaren Sara lade in. Linnea Olssons ärende (BOT-26-0163): ett CV.
//
// Innehållet finns inte i testdatat: prototypen och minnesläget visar en platshållare när filen öppnas, och testmiljön lägger
// en liten påhittad PDF i lagringen för varje fil när testdatat läses in (src/server/staging/placeholders.ts). Alla är PDF.
import type { CaseAttachment, Db } from "../schema";

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

export function applyDecisions20261029(db: Db): void {
  for (const f of SEED_PARTICIPANT_FILES) {
    if (db.cases.some((c) => c.id === f.caseId)) db.case_attachments.push({ ...f });
  }
}
