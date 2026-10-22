// Steg efter mappningen: nivåer och taggar (groupings, grouping_members – finns inte i den gamla prototypen, coachmötet
// 2026-10-09; Karims beslut 2026-10-22). Läggs till direkt i tabellerna efter toTables(), med fasta id:n. Påhittade namn – inga
// personuppgifter. Alla tider före DEMO_START (2027-02-01 09.12).
//
//   Standardvärdena (som migrationen 0031 lägger in för varje avtal): fem nivåer och taggkategorin "Vill arbeta".
//   Nivåer: varje pågående insats med godkänd kartläggning har en nivå (Karims beslut 2026-10-22: nivån sätts i kartläggningen
//     och krävs innan den godkänns). Amiras ärenden och tre av Eriks har nivåer som sattes för hand; övriga får nivån efter fasen
//     (påhittat, så att testdatat har deltagare på alla fem nivåerna). Nadia har nivåhistorik: Nivå 3 från 13 jan, Nivå 4 från 27
//     jan. Det skyddade ärendet har nivå 2 (den vilande spärren prövas i rls-parity.test.ts). Ärenden utan godkänd kartläggning
//     (Amal BOT-27-0012 m.fl.) har ingen nivå än – de står under "Utan nivå – att kartlägga" och e2e sätter Amals nivå.
//   Fria grupper (historik): grupperna är yrkesområdena sedan 2026-10-22 och fria grupper finns inte längre. Testdatat har kvar
//     de tre gamla grupperna som arkiverade rader med avslutade medlemskap – som migrationen 0035 lämnar dem – så att testerna
//     visar att de aldrig syns någonstans. Ingen aktiv grupp och inget aktivt medlemskap i en grupp.
import { defaultGroupings, defaultLevelId, defaultWantsWorkId, slotOf } from "@/core/groupings";
import type { Db, Grouping, GroupingMember } from "../schema";

const CONTRACT = "c-bot";
/** När standardvärdena kom in (avtalets start i testdatat). */
const DEFAULTS_AT = "2026-09-01T08:00";
/** När de fria grupperna arkiverades (motsvarar migrationen 0035 i testdatats tidslinje). */
const FREE_GROUPS_REMOVED_AT = "2027-01-29T18:00";

const tagged = (db: Db, tag: string): string => {
  const id = db.demo_tags.find((t) => t.tag === tag)?.entityIds[0];
  if (!id) throw new Error(`Testdatat saknar ärendet ${tag}`);
  return id;
};

/** De gamla fria grupperna (historik – arkiverade, visas aldrig). */
export const SEED_GROUP_IDS = { mandag: "grp-c-bot-g-mandag", lager: "grp-c-bot-g-lager", host: "grp-c-bot-g-host" } as const;

export function addGroupings(db: Db): void {
  const legacy = { archivedAt: FREE_GROUPS_REMOVED_AT, archivedBy: "system" };
  const groupings: Grouping[] = [
    ...defaultGroupings(CONTRACT, DEFAULTS_AT),
    {
      id: SEED_GROUP_IDS.mandag, contractId: CONTRACT, kind: "group", category: null, name: "Måndagsgruppen", description: "Gruppträff på måndagar kl. 10.00 i Alby.",
      sortOrder: 1, createdAt: "2027-01-11T09:00", createdBy: "u-amira", updatedAt: null, updatedBy: null, ...legacy,
    },
    {
      id: SEED_GROUP_IDS.lager, contractId: CONTRACT, kind: "group", category: null, name: "Lagergruppen", description: "Deltagare som siktar på lagerarbete.",
      sortOrder: 2, createdAt: "2027-01-12T13:30", createdBy: "u-sara", updatedAt: null, updatedBy: null, ...legacy,
    },
    {
      id: SEED_GROUP_IDS.host, contractId: CONTRACT, kind: "group", category: null, name: "Höstgruppen 2026", description: "",
      sortOrder: 3, createdAt: "2026-09-15T10:00", createdBy: "u-sara", updatedAt: null, updatedBy: null, archivedAt: "2027-01-08T16:00", archivedBy: "u-sara",
    },
  ];
  const byId = new Map(groupings.map((g) => [g.id, g]));
  const cases = new Map(db.cases.map((c) => [c.id, c]));
  const members: GroupingMember[] = [];
  const add = (caseId: string, groupingId: string, addedBy: string, addedAt: string, removed?: { at: string; by: string }, idSuffix = "") => {
    const c = cases.get(caseId);
    const g = byId.get(groupingId);
    if (!c || !g) throw new Error(`Testdatat saknar ${caseId} eller ${groupingId}`);
    members.push({
      id: `gm-${caseId}-${groupingId.replace(/^grp-c-bot-/, "")}${idSuffix}`, contractId: c.contractId, caseId, groupingId, kind: g.kind, slot: slotOf(g), addedAt, addedBy,
      removedAt: removed?.at ?? null, removedBy: removed?.by ?? null,
    });
  };
  const level = (n: number) => defaultLevelId(CONTRACT, n);
  const wants = (slug: string) => defaultWantsWorkId(CONTRACT, slug);
  const removedWithGroups = { at: FREE_GROUPS_REMOVED_AT, by: "system" };

  // Amiras ärenden (kartlagda av Amira i januari). Grupperna är historik (avslutade när de fria grupperna togs bort).
  const nadia = tagged(db, "nadia");
  const mehmet = tagged(db, "mehmet");
  const hodan = tagged(db, "hodan");
  const yusuf = tagged(db, "yusuf");
  const plan: [string, number, string[], string | null][] = [
    [nadia, 4, [SEED_GROUP_IDS.lager], "heltid"],
    [mehmet, 3, [SEED_GROUP_IDS.mandag], "deltid"],
    [hodan, 5, [SEED_GROUP_IDS.lager], "heltid"],
    ["case-260126", 4, [SEED_GROUP_IDS.mandag], "heltid"],
    ["case-260133", 5, [SEED_GROUP_IDS.mandag], null],
    ["case-260163", 3, [SEED_GROUP_IDS.mandag], "vet-inte-an"],
    ["case-260174", 2, [SEED_GROUP_IDS.mandag], "deltid"],
    ["case-270025", 2, [], null],
    [yusuf, 4, [SEED_GROUP_IDS.lager], null],
  ];
  plan.forEach(([caseId, n, groups, want], i) => {
    const at = `2027-01-${String(13 + (i % 8)).padStart(2, "0")}T10:${String(10 + i).padStart(2, "0")}`;
    if (caseId === nadia) {
      // Nivåhistorik: Nivå 3 från 13 jan, höjd till Nivå 4 den 27 jan (Amira).
      add(caseId, level(3), "u-amira", at, { at: "2027-01-27T14:05", by: "u-amira" });
      add(caseId, level(n), "u-amira", "2027-01-27T14:05");
    } else add(caseId, level(n), "u-amira", at);
    for (const g of groups) add(caseId, g, "u-amira", at, removedWithGroups);
    if (want) add(caseId, wants(want), "u-amira", at);
  });
  // Yusuf var med i höstgruppen – borttagen när gruppen arkiverades.
  add(yusuf, SEED_GROUP_IDS.host, "u-sara", "2026-10-05T09:00", { at: "2027-01-08T15:55", by: "u-sara" });

  // Tre av Eriks pågående ärenden (inte det skyddade) – nivå 1–3.
  const skyddad = tagged(db, "skyddad");
  const erik = db.cases.filter((c) => c.leadCoachId === "u-erik" && c.status === "active" && c.id !== skyddad).map((c) => c.id).sort().slice(0, 3);
  erik.forEach((caseId, i) => add(caseId, level(i + 1), "u-erik", `2027-01-${20 + i}T14:00`));
  // Det skyddade ärendet (vilande spärr): nivå 2, satt av huvudcoachen.
  const skc = cases.get(skyddad)!;
  add(skyddad, level(2), skc.leadCoachId ?? "u-erik", "2027-01-19T11:00");

  // Övriga pågående insatser med godkänd kartläggning: nivån sattes när kartläggningen godkändes (påhittat: efter fasen, varannan
  // ett steg lägre), av huvudcoachen.
  const hasLevel = new Set(members.filter((m) => m.kind === "level" && m.removedAt == null).map((m) => m.caseId));
  const approvedIntake = new Map(db.intake_assessments.filter((x) => x.status === "approved" && x.approvedAt).map((x) => [x.caseId, x.approvedAt!]));
  const rest = db.cases.filter((c) => c.contractId === CONTRACT && (c.status === "active" || c.status === "paused") && approvedIntake.has(c.id) && !hasLevel.has(c.id))
    .sort((a, b) => (a.caseNumber < b.caseNumber ? -1 : 1));
  rest.forEach((c, i) => {
    const n = Math.min(5, Math.max(1, c.phase - (i % 2)));
    add(c.id, level(n), c.leadCoachId ?? "u-sara", approvedIntake.get(c.id)!);
  });

  db.groupings.push(...groupings);
  db.grouping_members.push(...members);
}
