// Steg efter mappningen: fria anteckningar i deltagarkortet (case_notes – finns inte i den gamla prototypen, rapporter steg 2).
// Läggs till direkt i tabellen efter toTables(), med fasta id:n, så att prototypens testdata och paritetstesterna inte ändras.
// Påhittade texter: inga personnummer, inga diagnoser och inga hälsouppgifter. Alla datum före DEMO_START (2027-02-01 09.12).
//
//   NADIA (BOT-26-0143, huvudcoach Amira, handledaren Petra i teamet):
//     note-nadia-samtal     Amira, samtal, bara full åtkomst (ändrad dagen efter)
//     note-nadia-kommun     Sara (samordnare), kontakt med kommunen, bara full åtkomst
//     note-nadia-praktiskt  Amira, praktiskt, även teamet
//     note-nadia-borttagen  Amira, övrigt, även teamet – borttagen av Sara (Amira ser "Borttagen av Sara Lindqvist")
//   MEHMET (BOT-26-0130, Petra i teamet):
//     note-mehmet-handledare  Petra (handledare), praktiskt, även teamet
//   Skyddat ärende (BOT-26-0120, huvudcoach Erik):
//     note-skyddad          Erik, samtal, bara full åtkomst (= bara namngiven huvudcoach och avtalsansvarig)
import type { CaseNote, Db } from "../schema";

const tagged = (db: Db, tag: string): string => {
  const id = db.demo_tags.find((t) => t.tag === tag)?.entityIds[0];
  if (!id) throw new Error(`Testdatat saknar ärendet ${tag}`);
  return id;
};

export function addCaseNotes(db: Db): void {
  const caseOf = (tag: string) => {
    const id = tagged(db, tag);
    const c = db.cases.find((x) => x.id === id);
    if (!c) throw new Error(`Testdatat saknar ärendet ${tag}`);
    return c;
  };
  const nadia = caseOf("nadia");
  const mehmet = caseOf("mehmet");
  const skyddad = caseOf("skyddad");
  const note = (c: { id: string; contractId: string }, n: Omit<CaseNote, "caseId" | "contractId" | "updatedAt" | "removedAt" | "removedBy"> & Partial<Pick<CaseNote, "updatedAt" | "removedAt" | "removedBy">>): CaseNote => ({
    caseId: c.id, contractId: c.contractId, updatedAt: null, removedAt: null, removedBy: null, ...n,
  });
  const notes: CaseNote[] = [
    note(nadia, {
      id: "note-nadia-kommun", authorId: "u-sara", occurredOn: "2027-01-22", kind: "customer_contact", audience: "full", createdAt: "2027-01-22T14:05",
      body: "Handläggaren ringde och frågade om det planerade slutdatumet. Jag bekräftade att planen gäller och att månadsrapporten för januari kommer i början av februari.",
    }),
    note(nadia, {
      id: "note-nadia-samtal", authorId: "u-amira", occurredOn: "2027-01-27", kind: "conversation", audience: "full", createdAt: "2027-01-27T15:40", updatedAt: "2027-01-28T08:15",
      body: "Samtal om praktiken på lagret. Nadia beskriver att arbetsuppgifterna går bra och att hon vill öva mer på plockning med handdator.\n\nVi bokar ett uppföljningssamtal med handledaren på arbetsplatsen nästa vecka.",
    }),
    note(nadia, {
      id: "note-nadia-praktiskt", authorId: "u-amira", occurredOn: "2027-01-29", kind: "practical", audience: "team", createdAt: "2027-01-29T11:20",
      body: "Praktikplatsen flyttar starttiden till 07.30 från och med måndag. Handledaren påminner Nadia om de nya tiderna.",
    }),
    note(nadia, {
      id: "note-nadia-borttagen", authorId: "u-amira", occurredOn: "2027-01-29", kind: "other", audience: "team", createdAt: "2027-01-29T11:25",
      removedAt: "2027-01-29T13:10", removedBy: "u-sara",
      body: "Påminnelse: mötet med arbetsgivaren är flyttat till torsdag kl. 10.",
    }),
    note(mehmet, {
      id: "note-mehmet-handledare", authorId: "u-petra", occurredOn: "2027-01-26", kind: "practical", audience: "team", createdAt: "2027-01-26T16:05",
      body: "Mehmet har fått egna skyddsskor och arbetskläder till yrkesmomenten. Inget mer behövs inför nästa vecka.",
    }),
    note(skyddad, {
      id: "note-skyddad", authorId: skyddad.leadCoachId ?? "u-erik", occurredOn: "2027-01-25", kind: "conversation", audience: "full", createdAt: "2027-01-25T10:30",
      body: "Samtal per telefon enligt den säkra rutinen. Deltagaren följer planen och vill fortsätta med yrkesmomenten i februari.",
    }),
  ];
  db.case_notes.push(...notes);
}
