import { describe, expect, it } from "vitest";
import type { Grouping, GroupingMember } from "@/data/schema";
import {
  caseGroupings, defaultGroupings, DEFAULT_LEVELS, groupingIdsByCase, groupingNameError, matchesGroupingFilter, planCaseGroupings, sameName, slotOf, WANTS_WORK_CATEGORY,
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
  const current = [member("c1", L(2)), member("c1", "g-1"), member("c1", W("heltid")), member("c1", "t-k1"), member("c1", L(1), true)];

  it("byter nivå: den gamla tas bort och den nya läggs till – aldrig två aktiva", () => {
    const r = planCaseGroupings(current, { levelId: L(4), groupIds: ["g-1"], tags: { [WANTS_WORK_CATEGORY]: W("heltid") } }, all);
    expect(r.ok && { add: r.plan.add.map((g) => g.id), remove: r.plan.remove.map((m) => m.groupingId) }).toEqual({ add: [L(4)], remove: [L(2)] });
  });
  it("byter värde i en taggkategori och lämnar andra kategorier orörda", () => {
    const r = planCaseGroupings(current, { levelId: L(2), groupIds: ["g-1"], tags: { [WANTS_WORK_CATEGORY]: W("deltid") } }, all);
    expect(r.ok && { add: r.plan.add.map((g) => g.id), remove: r.plan.remove.map((m) => m.groupingId) }).toEqual({ add: [W("deltid")], remove: [W("heltid")] });
  });
  it("inget värde i kategorin tar bort taggen; ingen nivå tar bort nivån; grupperna styrs av listan", () => {
    const r = planCaseGroupings(current, { levelId: null, groupIds: ["g-2"], tags: { [WANTS_WORK_CATEGORY]: null } }, all);
    expect(r.ok && { add: r.plan.add.map((g) => g.id), remove: r.plan.remove.map((m) => m.groupingId).sort() }).toEqual({ add: ["g-2"], remove: [L(2), "g-1", W("heltid")].sort() });
  });
  it("en arkiverad grupp kan inte väljas – men den som redan är med får vara kvar", () => {
    expect(planCaseGroupings(current, { levelId: L(2), groupIds: ["g-old"], tags: {} }, all)).toEqual({ ok: false, error: "archived", groupingId: "g-old" });
    const withOld = [...current, member("c1", "g-old")];
    const r = planCaseGroupings(withOld, { levelId: L(2), groupIds: ["g-1", "g-old"], tags: {} }, all);
    expect(r.ok && r.plan).toEqual({ add: [], remove: [] });
  });
  it("fel typ, fel kategori och okänd gruppering nekas", () => {
    expect(planCaseGroupings([], { levelId: "g-1", groupIds: [], tags: {} }, all)).toMatchObject({ ok: false, error: "wrong_kind" });
    expect(planCaseGroupings([], { levelId: null, groupIds: [L(1)], tags: {} }, all)).toMatchObject({ ok: false, error: "wrong_kind" });
    expect(planCaseGroupings([], { levelId: null, groupIds: [], tags: { [WANTS_WORK_CATEGORY]: "t-k1" } }, all)).toMatchObject({ ok: false, error: "wrong_category" });
    expect(planCaseGroupings([], { levelId: "finns-inte", groupIds: [], tags: {} }, all)).toMatchObject({ ok: false, error: "unknown" });
  });
  it("samma läge igen ändrar ingenting (dubbletter i listan räknas en gång)", () => {
    const r = planCaseGroupings(current, { levelId: L(2), groupIds: ["g-1", "g-1"], tags: { [WANTS_WORK_CATEGORY]: W("heltid"), Körkort: "t-k1" } }, all);
    expect(r.ok && r.plan).toEqual({ add: [], remove: [] });
  });
});

describe("ärendets nivå, grupper och taggar, och filtret", () => {
  const members = [member("c1", L(3)), member("c1", "g-2"), member("c1", "g-1"), member("c1", W("deltid")), member("c1", "g-old", true), member("c2", L(5))];
  it("bara aktiva medlemskap, i grupperingarnas ordning", () => {
    expect(caseGroupings("c1", members, all)).toEqual({
      level: { id: L(3), name: DEFAULT_LEVELS[2] },
      groups: [{ id: "g-2", name: "Lager" }, { id: "g-1", name: "Måndagsgruppen" }],
      tags: [{ id: W("deltid"), category: WANTS_WORK_CATEGORY, name: "Deltid" }],
    });
    expect(caseGroupings("c3", members, all)).toEqual({ level: null, groups: [], tags: [] });
  });
  it("filtret kombinerar nivå, grupp och tagg – borttagna räknas inte", () => {
    const idx = groupingIdsByCase(members);
    expect(matchesGroupingFilter(idx.get("c1"), { level: L(3), group: "g-1", tag: W("deltid") })).toBe(true);
    expect(matchesGroupingFilter(idx.get("c1"), { level: L(3), group: "g-old" })).toBe(false);
    expect(matchesGroupingFilter(idx.get("c2"), { level: L(3) })).toBe(false);
    expect(matchesGroupingFilter(idx.get("c3"), {})).toBe(true);
    expect(matchesGroupingFilter(undefined, { tag: W("deltid") })).toBe(false);
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
