import { describe, expect, it } from "vitest";
import type { Grouping, GroupingMember } from "@/data/schema";
import {
  caseGroupings, defaultGroupings, DEFAULT_LEVELS, groupingFilterOptions, groupingIdsByCase, groupingNameError, levelHistory, matchesGroupingFilter, nextLevelId, planCaseGroupings,
  sameName, slotOf, WANTS_WORK_CATEGORY, yrkesomradeFilterOptions,
} from "./groupings";

const at = "2027-02-01T09:12";
const defaults = defaultGroupings("c-bot", at);
const group = (id: string, name: string, archived = false): Grouping => ({
  id, contractId: "c-bot", kind: "group", category: null, name, description: "", sortOrder: 1, createdAt: at, createdBy: "u-amira", updatedAt: null, updatedBy: null,
  archivedAt: archived ? at : null, archivedBy: archived ? "u-sara" : null,
});
const tag = (id: string, category: string, name: string): Grouping => ({ ...group(id, name), kind: "tag", category });
const all: Grouping[] = [...defaults, group("g-1", "Måndagsgruppen"), group("g-2", "Lager"), group("g-old", "Höstgruppen", true), tag("t-k1", "Körkort", "B-körkort"), tag("t-k2", "Körkort", "Inget")];
const byId = new Map(all.map((g) => [g.id, g]));
const member = (caseId: string, groupingId: string, removed = false): GroupingMember => {
  const g = byId.get(groupingId)!;
  return {
    id: `m-${caseId}-${groupingId}`, contractId: "c-bot", caseId, groupingId, kind: g.kind, slot: slotOf(g), addedAt: at, addedBy: "u-amira",
    removedAt: removed ? at : null, removedBy: removed ? "u-amira" : null,
  };
};
const L = (n: number) => `grp-c-bot-niva-${n}`;
const W = (slug: string) => `grp-c-bot-vill-arbeta-${slug}`;

describe("standardvärden och plats", () => {
  it("fem nivåer med namn och taggkategorin Vill arbeta (Heltid, Deltid, Vet inte än) – inga standardgrupper", () => {
    expect(defaults.filter((g) => g.kind === "level").map((g) => [g.id, g.name, g.sortOrder])).toEqual(DEFAULT_LEVELS.map((n, i) => [L(i + 1), n, i + 1]));
    expect(defaults.filter((g) => g.kind === "tag").map((g) => [g.id, g.category, g.name])).toEqual([
      [W("heltid"), WANTS_WORK_CATEGORY, "Heltid"], [W("deltid"), WANTS_WORK_CATEGORY, "Deltid"], [W("vet-inte-an"), WANTS_WORK_CATEGORY, "Vet inte än"],
    ]);
    expect(defaults.some((g) => g.kind === "group")).toBe(false);
    expect(defaults.every((g) => g.createdBy === null && g.archivedAt === null)).toBe(true);
  });
  it("platsen: nivån, taggens kategori, ingen för grupper", () => {
    expect(slotOf(byId.get(L(1))!)).toBe("level");
    expect(slotOf(byId.get(W("deltid"))!)).toBe("tag:Vill arbeta");
    expect(slotOf(byId.get("g-1")!)).toBeNull();
  });
});

describe("planCaseGroupings – en nivå per ärende, en tagg per kategori, arkiverade kan inte väljas", () => {
  // c1 har en gammal grupp (g-1, historik från före 2026-10-22) – den rörs aldrig av planen.
  const current = [member("c1", L(2)), member("c1", "g-1"), member("c1", W("heltid")), member("c1", "t-k1"), member("c1", L(1), true)];

  it("byter nivå: den gamla tas bort och den nya läggs till – aldrig två aktiva", () => {
    const r = planCaseGroupings(current, { levelId: L(4), tags: { [WANTS_WORK_CATEGORY]: W("heltid") } }, all);
    expect(r.ok && { add: r.plan.add.map((g) => g.id), remove: r.plan.remove.map((m) => m.groupingId) }).toEqual({ add: [L(4)], remove: [L(2)] });
  });
  it("byter värde i en taggkategori och lämnar andra kategorier orörda", () => {
    const r = planCaseGroupings(current, { levelId: L(2), tags: { [WANTS_WORK_CATEGORY]: W("deltid") } }, all);
    expect(r.ok && { add: r.plan.add.map((g) => g.id), remove: r.plan.remove.map((m) => m.groupingId) }).toEqual({ add: [W("deltid")], remove: [W("heltid")] });
  });
  it("inget värde i kategorin tar bort taggen; gamla grupper rörs aldrig", () => {
    const r = planCaseGroupings(current, { levelId: L(2), tags: { [WANTS_WORK_CATEGORY]: null } }, all);
    expect(r.ok && { add: r.plan.add.map((g) => g.id), remove: r.plan.remove.map((m) => m.groupingId).sort() }).toEqual({ add: [], remove: [W("heltid")] });
  });
  it("en arkiverad tagg kan inte väljas – men den som redan har den får behålla den", () => {
    const old = tag("t-old", "Körkort", "Gammalt");
    const withOld = [...all, { ...old, archivedAt: at, archivedBy: "u-sara" }];
    expect(planCaseGroupings(current, { levelId: L(2), tags: { Körkort: "t-old" } }, withOld)).toEqual({ ok: false, error: "archived", groupingId: "t-old" });
    const byIdOld = new Map(withOld.map((g) => [g.id, g]));
    const has = [...current.filter((m) => m.groupingId !== "t-k1"), { ...member("c1", "t-k1"), id: "m-old", groupingId: "t-old", slot: slotOf(byIdOld.get("t-old")!) }];
    const r = planCaseGroupings(has, { levelId: L(2), tags: { Körkort: "t-old" } }, withOld);
    expect(r.ok && r.plan).toEqual({ add: [], remove: [] });
  });
  it("fel typ, fel kategori och okänd gruppering nekas – en fri grupp kan aldrig väljas som nivå", () => {
    expect(planCaseGroupings([], { levelId: "g-1", tags: {} }, all)).toMatchObject({ ok: false, error: "wrong_kind" });
    expect(planCaseGroupings([], { levelId: null, tags: { [WANTS_WORK_CATEGORY]: "t-k1" } }, all)).toMatchObject({ ok: false, error: "wrong_category" });
    expect(planCaseGroupings([], { levelId: null, tags: { Körkort: "g-2" } }, all)).toMatchObject({ ok: false, error: "wrong_kind" });
    expect(planCaseGroupings([], { levelId: "finns-inte", tags: {} }, all)).toMatchObject({ ok: false, error: "unknown" });
  });
  it("samma läge igen ändrar ingenting", () => {
    const r = planCaseGroupings(current, { levelId: L(2), tags: { [WANTS_WORK_CATEGORY]: W("heltid"), Körkort: "t-k1" } }, all);
    expect(r.ok && r.plan).toEqual({ add: [], remove: [] });
  });
});

describe("ärendets nivå och taggar, och filtret", () => {
  const members = [member("c1", L(3)), member("c1", "g-2"), member("c1", "g-1"), member("c1", W("deltid")), member("c1", "g-old", true), member("c2", L(5))];
  it("bara aktiva medlemskap, i grupperingarnas ordning – gamla fria grupper visas aldrig", () => {
    expect(caseGroupings("c1", members, all)).toEqual({
      level: { id: L(3), name: DEFAULT_LEVELS[2] },
      tags: [{ id: W("deltid"), category: WANTS_WORK_CATEGORY, name: "Deltid" }],
    });
    expect(caseGroupings("c3", members, all)).toEqual({ level: null, tags: [] });
  });
  it("filtret kombinerar nivå och tagg – borttagna och gamla grupper räknas inte", () => {
    const idx = groupingIdsByCase(members);
    expect(matchesGroupingFilter(idx.get("c1"), { level: L(3), tag: W("deltid") })).toBe(true);
    expect(idx.get("c1")?.has("g-1")).toBe(false);
    expect(matchesGroupingFilter(idx.get("c2"), { level: L(3) })).toBe(false);
    expect(matchesGroupingFilter(idx.get("c3"), {})).toBe(true);
    expect(matchesGroupingFilter(undefined, { tag: W("deltid") })).toBe(false);
  });
  it("filtrets val: nivåer och taggar – aldrig grupper", () => {
    const o = groupingFilterOptions(all, [{ id: "c-bot", casePrefix: "BOT" }]);
    expect(Object.keys(o).sort()).toEqual(["levels", "tags"]);
    expect(o.levels.map((x) => x.id)).toEqual([1, 2, 3, 4, 5].map(L));
    expect(o.tags.map((x) => x.name)).toContain("Vill arbeta: Heltid");
  });
});

describe("filtret Yrkesområde – grupperna är yrkesområdena (Karims beslut 2026-10-22)", () => {
  const areas = [
    { contractId: "c-bot", code: "G", name: "Lager och logistik", active: true },
    { contractId: "c-bot", code: "A", name: "Administration", active: true },
    { contractId: "c-bot", code: "Z", name: "Gammalt", active: false },
    { contractId: "c-annat", code: "A", name: "Kontor", active: true },
  ];
  it("avtalets aktiva avtalsområden i bokstavsordning som \"G – Lager och logistik\"", () => {
    expect(yrkesomradeFilterOptions(areas, [{ id: "c-bot", casePrefix: "BOT" }])).toEqual([
      { code: "A", name: "A – Administration" }, { code: "G", name: "G – Lager och logistik" },
    ]);
  });
  it("med fler avtal står prefixet efter namnet, och samma kod blir ett val", () => {
    expect(yrkesomradeFilterOptions(areas, [{ id: "c-bot", casePrefix: "BOT" }, { id: "c-annat", casePrefix: "ANN" }])).toEqual([
      { code: "A", name: "A – Administration (BOT) / A – Kontor (ANN)" }, { code: "G", name: "G – Lager och logistik (BOT)" },
    ]);
  });
});

describe("nivån: höja, byta och historiken (Karims beslut 2026-10-22)", () => {
  it("Höj nivå: nästa nivå i ordningen – ingen på nivå 5 och ingen utan nivå", () => {
    expect(nextLevelId(defaults, L(1))).toBe(L(2));
    expect(nextLevelId(defaults, L(4))).toBe(L(5));
    expect(nextLevelId(defaults, L(5))).toBeNull();
    expect(nextLevelId(defaults, null)).toBeNull();
    expect(nextLevelId(defaults, "g-1")).toBeNull();
  });
  it("historiken: alla nivåer över tid, också borttagna, äldst först med vem som satte dem", () => {
    const ms: GroupingMember[] = [
      { ...member("c1", L(2)), id: "m2", addedAt: "2026-10-22T10:00", addedBy: "u-sara" },
      { ...member("c1", L(1), true), id: "m1", addedAt: "2026-10-09T09:00", addedBy: "u-amira", removedAt: "2026-10-22T10:00" },
      { ...member("c1", W("heltid")), id: "m3" },
      { ...member("c2", L(4)), id: "m4" },
    ];
    expect(levelHistory("c1", ms, all, new Map([["u-amira", "Amira"], ["u-sara", "Sara"]]))).toEqual([
      { levelId: L(1), name: DEFAULT_LEVELS[0], from: "2026-10-09T09:00", until: "2026-10-22T10:00", byName: "Amira" },
      { levelId: L(2), name: DEFAULT_LEVELS[1], from: "2026-10-22T10:00", until: null, byName: "Sara" },
    ]);
  });
});

describe("namn", () => {
  it("1–80 tecken och inga personnummer", () => {
    expect(groupingNameError("Måndagsgruppen")).toBeNull();
    expect(groupingNameError("  ")).toBe("Skriv ett namn.");
    expect(groupingNameError("x".repeat(81))).toMatch(/högst 80/);
    expect(groupingNameError("Grupp 850101-1234")).toMatch(/personnummer/);
  });
  it("samma namn oavsett stora och små bokstäver", () => {
    expect(sameName(" måndagsgruppen", "Måndagsgruppen ")).toBe(true);
    expect(sameName("Lager", "Lagret")).toBe(false);
  });
});
