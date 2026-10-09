// Steg efter mappningen: grupper, nivåer och taggar (groupings, grouping_members – finns inte i den gamla prototypen,
// coachmötet 2026-10-09). Läggs till direkt i tabellerna efter toTables(), med fasta id:n, så att prototypens testdata och
// paritetstesterna inte ändras. Påhittade gruppnamn – inga personuppgifter. Alla tider före DEMO_START (2027-02-01 09.12).
//
//   Standardvärdena (som migrationen 0031 lägger in för varje avtal): fem nivåer och taggkategorin "Vill arbeta".
//   Grupper (MB skapar dem fritt):  Måndagsgruppen (Amira) · Lagergruppen (Sara) · Höstgruppen 2026 (arkiverad av Sara)
//   Medlemskap: Nadia (nivå 4, Lagergruppen, Heltid), Mehmet (nivå 3, Måndagsgruppen, Deltid), fler av Amiras ärenden,
//   tre av Eriks, det skyddade ärendet (nivå 2 – den vilande spärren prövas i rls-parity.test.ts) och ett borttaget
//   medlemskap i den arkiverade gruppen (Yusuf). Amal (BOT-27-0012, kartläggning pågår) har ingen nivå än – e2e sätter den.
import { defaultGroupings, defaultLevelId, defaultWantsWorkId, slotOf } from "@/core/groupings";
import type { Db, Grouping, GroupingMember } from "../schema";

const CONTRACT = "c-bot";
/** När standardvärdena kom in (avtalets start i testdatat). */
const DEFAULTS_AT = "2026-09-01T08:00";

const tagged = (db: Db, tag: string): string => {
  const id = db.demo_tags.find((t) => t.tag === tag)?.entityIds[0];
  if (!id) throw new Error(`Testdatat saknar ärendet ${tag}`);
  return id;
};

export const SEED_GROUP_IDS = { mandag: "grp-c-bot-g-mandag", lager: "grp-c-bot-g-lager", host: "grp-c-bot-g-host" } as const;

export function addGroupings(db: Db): void {
  const groupings: Grouping[] = [
    ...defaultGroupings(CONTRACT, DEFAULTS_AT),
    {
      id: SEED_GROUP_IDS.mandag, contractId: CONTRACT, kind: "group", category: null, name: "Måndagsgruppen", description: "Gruppträff på måndagar kl. 10.00 i Alby.",
      sortOrder: 1, createdAt: "2027-01-11T09:00", createdBy: "u-amira", updatedAt: null, updatedBy: null, archivedAt: null, archivedBy: null,
    },
    {
      id: SEED_GROUP_IDS.lager, contractId: CONTRACT, kind: "group", category: null, name: "Lagergruppen", description: "Deltagare som siktar på lagerarbete.",
      sortOrder: 2, createdAt: "2027-01-12T13:30", createdBy: "u-sara", updatedAt: null, updatedBy: null, archivedAt: null, archivedBy: null,
    },
    {
      id: SEED_GROUP_IDS.host, contractId: CONTRACT, kind: "group", category: null, name: "Höstgruppen 2026", description: "",
      sortOrder: 3, createdAt: "2026-09-15T10:00", createdBy: "u-sara", updatedAt: null, updatedBy: null, archivedAt: "2027-01-08T16:00", archivedBy: "u-sara",
    },
  ];
  const byId = new Map(groupings.map((g) => [g.id, g]));
  const cases = new Map(db.cases.map((c) => [c.id, c]));
  const members: GroupingMember[] = [];
  const add = (caseId: string, groupingId: string, addedBy: string, addedAt: string, removed?: { at: string; by: string }) => {
    const c = cases.get(caseId);
    const g = byId.get(groupingId);
    if (!c || !g) throw new Error(`Testdatat saknar ${caseId} eller ${groupingId}`);
    members.push({
      id: `gm-${caseId}-${groupingId.replace(/^grp-c-bot-/, "")}`, contractId: c.contractId, caseId, groupingId, kind: g.kind, slot: slotOf(g), addedAt, addedBy,
      removedAt: removed?.at ?? null, removedBy: removed?.by ?? null,
    });
  };
  const level = (n: number) => defaultLevelId(CONTRACT, n);
  const wants = (slug: string) => defaultWantsWorkId(CONTRACT, slug);

  // Amiras ärenden (kartlagda av Amira i januari).
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
    add(caseId, level(n), "u-amira", at);
    for (const g of groups) add(caseId, g, "u-amira", at);
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

  db.groupings.push(...groupings);
  db.grouping_members.push(...members);
}
