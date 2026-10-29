// Nivåer, yrkesområden och taggar och massanteckningar (coachmötet 2026-10-09; Karims beslut 2026-10-22) – mot testdatat i minnet
// (MemoryRuntime, samma hanterare som appen): exakt en nivå per ärende som höjs eller byts (och aldrig tas bort), en tagg per
// kategori, fria grupper finns inte längre (grupperna är yrkesområdena), arkiverade kan inte väljas, nivåaktiviteterna följer med
// när nivån ändras, Grupper-sidan, massanteckningarna (allt eller inget, personnummer stoppas per rad), behörigheten per roll –
// och att inget av grupperingarna syns för kommunen, i rapporterna, resultatfilen, rapportbyggarens export eller fakturaunderlaget.
import { beforeEach, describe, expect, it } from "vitest";
import type { ParamsOf, QueryDef, ResultOf } from "@/api/contract";
import type { Actor, Role } from "@/api/roles";
import { ApiError } from "@/api/server";
import { listPersonas } from "@/data/actors";
import { dormantSupervisor } from "@/data/dormant-role.test-helper";
import type { MemoryData } from "@/data/memory";
import { createMemoryRuntime, demoClock, type MemoryRuntime } from "@/data/memory-runtime";
import { createSeed, DEMO_START } from "@/data/seed";
import { createEmptySeed } from "@/data/seed/empty";
import { defaultGroupings } from "@/core/groupings";
import type { Tables } from "@/data/schema";
import {
  caseGroupingsSave, caseGroupingsView, caseLevelRaise, caseLevelSet, groupingArchive, groupingCatalog, groupingCreate, groupingDefaults, groupingFilterData,
  groupingOverview, groupingRename, massNotePage, massNoteSave,
} from "./api";

const SEED: MemoryData<Tables> = createSeed();
let rt: MemoryRuntime;
beforeEach(() => {
  rt = createMemoryRuntime({ data: structuredClone(SEED), clock: demoClock(DEMO_START) });
});
const as = (userId: string, role?: Role): Actor => {
  const p = listPersonas(rt.raw()).find((x) => x.actor.userId === userId && (!role || x.actor.role === role));
  if (!p) throw new Error(`Ingen testperson ${userId}`);
  return p.actor;
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const q = <D extends QueryDef<any, any>>(def: D, input: ParamsOf<D>, actor: Actor) => rt.run("query", def.key, input, actor) as Promise<ResultOf<D>>;
type Res = { ok: boolean; error?: string; message?: string; fields?: Record<string, string>; [k: string]: unknown };
const cmd = (key: string, input: unknown, actor: Actor) => rt.run("command", key, input, actor) as Promise<Res>;
const amira = () => as("u-amira", "coach");
const sara = () => as("u-sara", "samordnare");
// Den vilande rollen handledare (Karims beslut 2026-10-09): ingen har den i testdatat – aktören byggs för att pröva att reglerna
// ligger kvar (läser men placerar inte).
const petra = () => dormantSupervisor();
const karin = () => as("u-karin", "chef");
const robin = () => as("u-robin", "admin");
const lars = () => as("u-lars", "ekonom");
const maria = () => as("k-maria", "kommun_handlaggare");

const NADIA = "case-260143";
const AMAL = "case-270012";
const MEHMET = "case-260130";
const L = (n: number) => `grp-c-bot-niva-${n}`;
const W = (slug: string) => `grp-c-bot-vill-arbeta-${slug}`;
/** De gamla fria grupperna (arkiverade sedan 0035 – historik, visas aldrig). */
const MANDAG = "grp-c-bot-g-mandag";
const LAGER = "grp-c-bot-g-lager";
const OLD_GROUP_NAMES = /Måndagsgruppen|Lagergruppen|Höstgruppen/;
/** Skärmens sparnyckel för massanteckningarna (samma vid varje nytt försök). */
const KEY = "nyckel-0123456789abcdef";
const OPEN = ["confirmed", "active", "paused"];
/** Låt skrivning nummer `nth` i tabellen misslyckas (som ett avbrott i nätverket mitt i en sparning). */
function failInsert(table: string, nth: number): () => void {
  const store = rt.store as unknown as { insertRow: (name: string, row: unknown) => void };
  const orig = store.insertRow.bind(store);
  let n = 0;
  store.insertRow = (name, row) => {
    if (name === table && ++n === nth) throw new Error("Anslutningen bröts");
    orig(name, row);
  };
  return () => {
    store.insertRow = orig;
  };
}
/** Ett andra avtal där Amira också är coach – med ett id som sorteras före Botkyrkaavtalet. */
function addSecondContract(): void {
  const bot = rt.raw().get("contracts", "c-bot")!;
  rt.store.insertRow("contracts", { ...structuredClone(bot), id: "c-aaa", name: "Ett annat avtal", casePrefix: "AAA" });
  const m = rt.store.rows("memberships").find((x) => x.userId === "u-amira" && x.contractId === "c-bot")!;
  rt.store.insertRow("memberships", { ...m, id: "mem-amira-aaa", contractId: "c-aaa" });
}
const active = (caseId: string) => rt.store.rows("grouping_members").filter((m) => m.caseId === caseId && m.removedAt == null);
const logsSince = (n: number) => rt.store.rows("audit_log").slice(n);
/** Ärendets rader i de återkommande nivåaktiviteterna (testdatat: ga-ser-c-bot-niva-N-datum). */
const levelRows = (caseId: string) => rt.store.rows("activities").filter((a) => a.caseId === caseId && a.groupActivityId?.startsWith("ga-ser-")).map((a) => a.groupActivityId!).sort();
async function newTag(name: string, extra: Record<string, unknown> = {}, actor = sara()): Promise<string> {
  const r = await cmd(groupingCreate.key, { kind: "tag", category: "Körkort", name, ...extra }, actor);
  expect(r, name).toMatchObject({ ok: true });
  return r.id as string;
}

describe("ärendets nivå och taggar (grupper.arendeSpara)", () => {
  it("coachen sätter nivå och Vill arbeta i ett ärende utan – sparas direkt, loggas med id:n (aldrig namnen); fria grupper nekas", async () => {
    expect(active(AMAL)).toEqual([]);
    expect(await cmd(caseGroupingsSave.key, { caseId: AMAL, levelId: L(2), groupIds: [LAGER], tags: {} }, amira())).toMatchObject({ ok: false, error: "group" });
    expect(active(AMAL)).toEqual([]);
    const before = rt.store.rows("audit_log").length;
    const r = await cmd(caseGroupingsSave.key, { caseId: AMAL, levelId: L(2), tags: { "Vill arbeta": W("deltid") } }, amira());
    expect(r).toMatchObject({ ok: true, added: 2, removed: 0 });
    // Svaret har inbjudningarna (kartläggningen säger samma mening som Höj nivå).
    expect((r as unknown as { invites: { invited: number; removed: number } }).invites).toEqual({ invited: levelRows(AMAL).length, removed: 0 });
    expect(active(AMAL).map((m) => [m.groupingId, m.kind, m.slot, m.addedBy]).sort()).toEqual([
      [L(2), "level", "level", "u-amira"], [W("deltid"), "tag", "tag:Vill arbeta", "u-amira"],
    ].sort());
    const log = logsSince(before);
    expect(log.filter((x) => x.entity === "grouping_member").map((x) => [x.action, x.entity, x.details])).toEqual(
      active(AMAL).map((m) => ["grouping_member.added", "grouping_member", { caseId: AMAL, groupingId: m.groupingId, kind: m.kind }]),
    );
    expect(JSON.stringify(log)).not.toMatch(/Nivå 2|Deltid|Vardag och rutiner/);
    // Nivån bjuder in till nivåns kommande aktiviteter (Karims beslut 2026-10-22) – systemsteget loggas med id:n.
    expect(levelRows(AMAL).length).toBeGreaterThan(0);
    expect(levelRows(AMAL).every((id) => id.startsWith("ga-ser-c-bot-niva-2-"))).toBe(true);
    expect(log.some((x) => x.action === "group_activity.audience_synced" && (x.details as { addedCaseIds?: string[] }).addedCaseIds?.includes(AMAL))).toBe(true);
    const v = await q(caseGroupingsView, { caseId: AMAL }, amira());
    expect(v?.current).toEqual({ level: { id: L(2), name: "Nivå 2 – Behöver stöd för att komma igång" }, tags: [{ id: W("deltid"), category: "Vill arbeta", name: "Deltid" }] });
    // Gruppen är yrkesområdet (härlett ur ärendet), nästa nivå för Höj nivå och historiken.
    expect(v?.area).toBe("L – Övrigt");
    expect(v?.nextLevel).toEqual({ id: L(3), name: "Nivå 3 – På väg" });
    expect(v?.levelHistory).toEqual([{ name: "Nivå 2 – Behöver stöd för att komma igång", from: expect.any(String), until: null, byName: "Amira Haddad" }]);
  });

  it("en nivå per ärende: en ny nivå tar bort den gamla och nivåaktiviteterna följer med; en tagg per kategori; nivån tas aldrig bort", async () => {
    const cur = active(NADIA);
    expect(cur.map((m) => m.groupingId).sort()).toEqual([L(4), W("heltid")].sort());
    expect(levelRows(NADIA)).toEqual(["ga-ser-c-bot-niva-4-2027-02-08", "ga-ser-c-bot-niva-4-2027-02-10", "ga-ser-c-bot-niva-4-2027-02-15"]);
    const r = await cmd(caseGroupingsSave.key, { caseId: NADIA, levelId: L(5), tags: { "Vill arbeta": W("deltid") } }, sara());
    expect(r).toMatchObject({ ok: true, added: 2, removed: 2 });
    const now = active(NADIA);
    expect(now.filter((m) => m.kind === "level").map((m) => m.groupingId)).toEqual([L(5)]);
    expect(now.filter((m) => m.kind === "tag").map((m) => m.groupingId)).toEqual([W("deltid")]);
    // De gamla raderna finns kvar som borttagna (inget raderas).
    const removed = rt.store.rows("grouping_members").filter((m) => m.caseId === NADIA && m.removedAt != null);
    expect(removed.map((m) => [m.groupingId, m.removedBy])).toEqual(expect.arrayContaining([[L(4), "u-sara"], [W("heltid"), "u-sara"]]));
    // Nivå 4:s tillfällen är borta, nivå 5:s (fredag 10.00) har kommit till.
    expect(levelRows(NADIA)).toEqual(["ga-ser-c-bot-niva-5-2027-02-12"]);
    // Nivån tas aldrig bort – den byts.
    expect(await cmd(caseGroupingsSave.key, { caseId: NADIA, levelId: null, tags: {} }, sara())).toMatchObject({ ok: false, error: "level" });
    expect(active(NADIA).filter((m) => m.kind === "level")).toHaveLength(1);
    // Minnets unika index stoppar en andra aktiv nivå även förbi hanteraren.
    const level = now.find((m) => m.kind === "level")!;
    expect(() => rt.store.insertRow("grouping_members", { ...level, id: "gm-x", groupingId: L(1) })).toThrow(/Dubblett/);
  });

  it("en arkiverad tagg kan inte väljas – men den kan tas bort; okänd gruppering och fel kategori nekas", async () => {
    const korkort = await newTag("B-körkort");
    expect(await cmd(caseGroupingsSave.key, { caseId: MEHMET, levelId: L(3), tags: { Körkort: korkort } }, amira())).toMatchObject({ ok: true, added: 1 });
    expect(await cmd(groupingArchive.key, { id: korkort, archived: true }, sara())).toMatchObject({ ok: true });
    expect(await cmd(caseGroupingsSave.key, { caseId: AMAL, levelId: null, tags: { Körkort: korkort } }, amira())).toMatchObject({ ok: false, error: "archived" });
    expect(await cmd(caseGroupingsSave.key, { caseId: AMAL, levelId: "grp-finns-inte", tags: {} }, amira())).toMatchObject({ ok: false, error: "unknown" });
    expect(await cmd(caseGroupingsSave.key, { caseId: AMAL, levelId: null, tags: { Körkort: W("heltid") } }, amira())).toMatchObject({ ok: false, error: "wrong_category" });
    expect(active(AMAL)).toEqual([]);
    // Den som redan har taggen behåller den och ser den som arkiverad – och kan ta bort den.
    expect(active(MEHMET).some((m) => m.groupingId === korkort)).toBe(true);
    const v = await q(caseGroupingsView, { caseId: MEHMET }, amira());
    expect(v?.options.tags.find((t) => t.category === "Körkort")?.values).toEqual([expect.objectContaining({ id: korkort, archived: true })]);
    expect(await cmd(caseGroupingsSave.key, { caseId: MEHMET, levelId: L(3), tags: { Körkort: null } }, amira())).toMatchObject({ ok: true, removed: 1 });
  });

  it("allt eller inget: misslyckas en skrivning mitt i sparningen tas det som hann ändras tillbaka – ärendet står inte utan nivå", async () => {
    const before = active(NADIA).map((m) => m.groupingId).sort();
    expect(before).toEqual([L(4), W("heltid")].sort());
    // Nivå 4 och Heltid tas bort, Nivå 5 läggs till – sedan bryts anslutningen (Deltid).
    const restore = failInsert("grouping_members", 2);
    await expect(cmd(caseGroupingsSave.key, { caseId: NADIA, levelId: L(5), tags: { "Vill arbeta": W("deltid") } }, amira())).rejects.toThrow();
    restore();
    expect(active(NADIA).map((m) => m.groupingId).sort()).toEqual(before);
    expect(active(NADIA).filter((m) => m.kind === "level")).toHaveLength(1);
    // Nivåaktiviteterna rördes inte (synkningen körs först när sparningen gått igenom).
    expect(levelRows(NADIA)).toHaveLength(3);
    // Ett nytt försök går igenom.
    expect(await cmd(caseGroupingsSave.key, { caseId: NADIA, levelId: L(5), tags: { "Vill arbeta": W("deltid") } }, amira())).toMatchObject({ ok: true });
    expect(active(NADIA).map((m) => m.groupingId).sort()).toEqual([L(5), W("deltid")].sort());
  });

  it("behörighet: handledare, chef och systemadministratör läser men placerar inte; ekonomen och kommunen ser ingenting", async () => {
    expect((await q(caseGroupingsView, { caseId: NADIA }, petra()))?.canEdit).toBe(false);
    expect((await q(caseGroupingsView, { caseId: NADIA }, karin()))?.canEdit).toBe(false);
    // Systemadministratören sköter grupperingarna men arbetar i ärendena i läsläge – placerar ingen.
    expect((await q(caseGroupingsView, { caseId: NADIA }, robin()))?.canEdit).toBe(false);
    for (const a of [petra(), karin(), robin(), lars(), maria()]) {
      await expect(cmd(caseGroupingsSave.key, { caseId: NADIA, levelId: L(1), tags: {} }, a), a.userId).rejects.toBeInstanceOf(ApiError);
    }
    for (const a of [lars(), maria()]) {
      await expect(q(caseGroupingsView, { caseId: NADIA }, a), a.userId).rejects.toBeInstanceOf(ApiError);
      await expect(q(groupingCatalog, {}, a), a.userId).rejects.toBeInstanceOf(ApiError);
      await expect(q(groupingOverview, {}, a), a.userId).rejects.toBeInstanceOf(ApiError);
      await expect(q(massNotePage, { urval: "mina" }, a), a.userId).rejects.toBeInstanceOf(ApiError);
    }
  });

  it("den vilande spärren: ett skyddat ärende visas inte för samordnaren och kan inte ändras av henne", async () => {
    const SKYDDAD = "case-260120";
    rt.store.updateRow("persons", rt.raw().get("cases", SKYDDAD)!.personId, { protectedIdentity: true });
    expect(await q(caseGroupingsView, { caseId: SKYDDAD }, sara())).toBeNull();
    expect(await cmd(caseGroupingsSave.key, { caseId: SKYDDAD, levelId: L(1), tags: {} }, sara())).toMatchObject({ ok: false, error: "not_found" });
    expect(await cmd(caseLevelRaise.key, { caseId: SKYDDAD, fromLevelId: L(2) }, sara())).toMatchObject({ ok: false, error: "not_found" });
    const erik = as("u-erik", "coach");
    expect((await q(caseGroupingsView, { caseId: SKYDDAD }, erik))?.current.level?.id).toBe(L(2));
    // Grupper-sidan visar inte det skyddade ärendet för samordnaren.
    const o = await q(groupingOverview, {}, sara());
    expect(o?.levels.flatMap((l) => l.people.map((p) => p.caseId))).not.toContain(SKYDDAD);
  });
});

describe("Höj nivå och Byt nivå (grupper.nivaHoj, grupper.nivaByt)", () => {
  it("Höj nivå: ett klick till nästa nivå – historiken växer och nivåaktiviteterna följer med; högsta nivån och en gammal skärm nekas", async () => {
    const before = rt.store.rows("audit_log").length;
    const r = await cmd(caseLevelRaise.key, { caseId: NADIA, fromLevelId: L(4) }, amira());
    expect(r).toMatchObject({ ok: true, levelId: L(5), levelName: "Nivå 5 – Redo för arbete", invited: 1, removed: 3 });
    expect(active(NADIA).filter((m) => m.kind === "level").map((m) => m.groupingId)).toEqual([L(5)]);
    expect(levelRows(NADIA)).toEqual(["ga-ser-c-bot-niva-5-2027-02-12"]);
    const log = logsSince(before);
    expect(log.filter((x) => x.entity === "grouping_member").map((x) => [x.action, x.details])).toEqual([
      ["grouping_member.removed", { caseId: NADIA, groupingId: L(4), kind: "level" }], ["grouping_member.added", { caseId: NADIA, groupingId: L(5), kind: "level" }],
    ]);
    expect(JSON.stringify(log)).not.toMatch(/Nivå \d –|Nadia/);
    const v = await q(caseGroupingsView, { caseId: NADIA }, amira());
    expect(v?.nextLevel).toBeNull();
    expect(v?.levelHistory.map((h) => [h.name, h.until === null])).toEqual([["Nivå 3 – På väg", false], ["Nivå 4 – Nära arbete", false], ["Nivå 5 – Redo för arbete", true]]);
    // Skärmen visade nivå 4 – någon har redan höjt: inget dubbelt steg.
    expect(await cmd(caseLevelRaise.key, { caseId: NADIA, fromLevelId: L(4) }, amira())).toMatchObject({ ok: false, error: "conflict" });
    expect(await cmd(caseLevelRaise.key, { caseId: NADIA, fromLevelId: L(5) }, amira())).toMatchObject({ ok: false, error: "top" });
    expect(await cmd(caseLevelRaise.key, { caseId: AMAL, fromLevelId: L(1) }, amira())).toMatchObject({ ok: false, error: "no_level" });
    for (const a of [petra(), karin(), robin(), lars(), maria()]) {
      await expect(cmd(caseLevelRaise.key, { caseId: NADIA, fromLevelId: L(5) }, a), a.userId).rejects.toBeInstanceOf(ApiError);
    }
  });

  it("Byt nivå: vilken som helst av de fem – inte samma, inte en tagg eller en gammal grupp, och inte från en gammal skärm", async () => {
    const first = await cmd(caseLevelSet.key, { caseId: AMAL, levelId: L(1), fromLevelId: null }, amira());
    expect(first).toMatchObject({ ok: true, levelId: L(1), levelName: "Nivå 1 – Långt från arbete" });
    const level1 = levelRows(AMAL);
    expect(level1.every((id) => id.startsWith("ga-ser-c-bot-niva-1-"))).toBe(true);
    expect(await cmd(caseLevelSet.key, { caseId: AMAL, levelId: L(1), fromLevelId: L(1) }, amira())).toMatchObject({ ok: false, error: "same" });
    expect(await cmd(caseLevelSet.key, { caseId: AMAL, levelId: L(3), fromLevelId: null }, amira())).toMatchObject({ ok: false, error: "conflict" });
    expect(await cmd(caseLevelSet.key, { caseId: AMAL, levelId: W("heltid"), fromLevelId: L(1) }, amira())).toMatchObject({ ok: false, error: "wrong_kind" });
    const old = await cmd(caseLevelSet.key, { caseId: AMAL, levelId: MANDAG, fromLevelId: L(1) }, amira());
    expect(old).toMatchObject({ ok: false, error: "wrong_kind" });
    expect(old.message).toMatch(/Fria grupper finns inte längre/);
    expect(await cmd(caseLevelSet.key, { caseId: AMAL, levelId: "grp-finns-inte", fromLevelId: L(1) }, amira())).toMatchObject({ ok: false, error: "unknown" });
    const r = await cmd(caseLevelSet.key, { caseId: AMAL, levelId: L(3), fromLevelId: L(1) }, sara());
    expect(r).toMatchObject({ ok: true, levelId: L(3), removed: level1.length });
    expect(levelRows(AMAL).every((id) => id.startsWith("ga-ser-c-bot-niva-3-"))).toBe(true);
    expect(levelRows(AMAL)).toHaveLength(r.invited as number);
    expect(active(AMAL).map((m) => m.groupingId)).toEqual([L(3)]);
  });
});

describe("Grupper-sidan (grupper.oversikt)", () => {
  it("yrkesområdena med aktiva deltagare och månadens träffar, nivåerna med deltagare och återkommande aktiviteter, de utan nivå och taggarna", async () => {
    const o = (await q(groupingOverview, {}, amira()))!;
    expect(o.months).toEqual(["2027-02", "2027-03"]);
    expect(o.areas.map((a) => a.code)).toEqual(["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L"]);
    const g = o.areas.find((a) => a.code === "G")!;
    expect(g.name).toBe("G – Lager och logistik");
    expect(g.active).toBe(rt.store.rows("cases").filter((c) => c.contractId === "c-bot" && c.status === "active" && c.primaryAreaCode === "G").length);
    expect(g.meetings).toEqual([
      { month: "2027-02", items: [{ id: "ga-traff-c-bot-g-2027-02", name: "Yrkesområdesträff: lager och logistik", startsAt: "2027-02-17T14:00" }] },
      { month: "2027-03", items: [] },
    ]);
    expect(o.areas.find((a) => a.code === "D")!.meetings.map((m) => m.items.map((i) => i.id))).toEqual([[], ["ga-traff-c-bot-d-2027-03"]]);
    expect(o.areas.find((a) => a.code === "E")!.meetings.every((m) => m.items.length === 0)).toBe(true);
    expect(o.levels.map((l) => [l.id, l.nextLevel?.id ?? null])).toEqual([[L(1), L(2)], [L(2), L(3)], [L(3), L(4)], [L(4), L(5)], [L(5), null]]);
    expect(o.levels.find((l) => l.id === L(3))!.people.map((p) => p.caseId)).toContain(MEHMET);
    expect(o.levels.find((l) => l.id === L(4))!.series).toEqual([{ id: "ser-c-bot-niva-4", name: "Jobbsök och CV", schedule: "måndag och onsdag 13.30", nextId: "ga-ser-c-bot-niva-4-2027-02-08" }]);
    // Utan nivå – att kartlägga: pågående och bekräftade utan nivå, med kartläggningens läge.
    expect(o.unplaced.map((u) => u.caseId)).toContain(AMAL);
    const placed = new Set(o.levels.flatMap((l) => l.people.map((p) => p.caseId)));
    expect(o.unplaced.some((u) => placed.has(u.caseId))).toBe(false);
    expect(o.unplaced.every((u) => ["none", "draft", "approved"].includes(u.intake))).toBe(true);
    expect(o.tags.map((t) => t.category)).toEqual(["Vill arbeta"]);
    expect([o.canEdit, o.canPlace, o.canPlan]).toEqual([true, true, true]);
    // De gamla grupperna syns aldrig.
    expect(JSON.stringify(o)).not.toMatch(OLD_GROUP_NAMES);
    // Höj nivå från sidan: deltagaren flyttar till nästa nivå.
    expect(await cmd(caseLevelRaise.key, { caseId: NADIA, fromLevelId: L(4) }, amira())).toMatchObject({ ok: true });
    const after = (await q(groupingOverview, {}, amira()))!;
    expect(after.levels.find((l) => l.id === L(5))!.people.map((p) => p.caseId)).toContain(NADIA);
    // Chefen och systemadministratören läser – placerar och planerar inte.
    for (const a of [karin(), robin()]) {
      const r = (await q(groupingOverview, {}, a))!;
      expect([r.canPlace, r.canPlan], a.userId).toEqual([false, false]);
    }
  });
});

describe("avtalets grupperingar (grupper.katalog, ny, andra, arkivera, standard)", () => {
  it("katalogen: fem nivåer, yrkesområdena och taggarna per kategori med antal deltagare – inga gamla grupper", async () => {
    const c = (await q(groupingCatalog, {}, amira()))!;
    expect(c.levels.map((g) => g.name)).toHaveLength(5);
    expect(c.areas.map((a) => a.code)).toEqual(["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L"]);
    expect(c.tags.map((t) => [t.category, t.values.map((v) => v.name)])).toEqual([["Vill arbeta", ["Heltid", "Deltid", "Vet inte än"]]]);
    // Antalet: bara pågående ärenden (som raderna i Anteckningar).
    const openIn = (id: string) => OPEN.includes(rt.raw().get("cases", id)!.status);
    expect(c.levels.find((g) => g.id === L(3))?.members).toBe(rt.store.rows("grouping_members").filter((m) => m.groupingId === L(3) && !m.removedAt && openIn(m.caseId)).length);
    expect(c.areas.find((a) => a.code === "G")?.members).toBe(rt.store.rows("cases").filter((x) => x.contractId === "c-bot" && x.primaryAreaCode === "G" && OPEN.includes(x.status)).length);
    expect(Object.keys(c)).not.toContain("groups");
    expect(JSON.stringify(c)).not.toMatch(OLD_GROUP_NAMES);
    expect(JSON.stringify(await q(groupingCatalog, { arkiverade: true }, amira()))).not.toMatch(OLD_GROUP_NAMES);
    expect(c.canEdit).toBe(true);
    expect((await q(groupingCatalog, {}, petra()))?.canEdit).toBe(false);
  });

  it("ny tagg: namnet kontrolleras (dubblett, personnummer), sortering sist, loggas utan namn – en fri grupp skapas inte längre", async () => {
    const before = rt.store.rows("audit_log").length;
    expect(await cmd(groupingCreate.key, { kind: "group", name: "Tisdagsgruppen" }, amira())).toMatchObject({ ok: false, error: "group" });
    const t = await newTag("B-körkort");
    expect(rt.store.getRow("groupings", t)).toMatchObject({ kind: "tag", category: "Körkort", name: "B-körkort", createdBy: "u-sara", sortOrder: 1 });
    expect(await cmd(groupingCreate.key, { kind: "tag", category: "Körkort", name: " b-körkort " }, sara())).toMatchObject({ ok: false, error: "duplicate" });
    expect(await cmd(groupingCreate.key, { kind: "tag", category: "Körkort", name: "Tagg 850101-1234" }, sara())).toMatchObject({ ok: false, error: "invalid" });
    expect(await cmd(groupingCreate.key, { kind: "tag", name: "Utan kategori" }, sara())).toMatchObject({ ok: false, error: "invalid" });
    const log = logsSince(before);
    expect(log.map((x) => [x.action, x.details])).toEqual([["grouping.created", { kind: "tag" }]]);
    expect(JSON.stringify(log)).not.toMatch(/Tisdagsgruppen|Körkort/);
    expect(rt.store.rows("groupings").filter((g) => g.kind === "group" && !g.archivedAt)).toEqual([]);
    for (const a of [petra(), karin(), lars(), maria()]) {
      await expect(cmd(groupingCreate.key, { kind: "tag", category: "Körkort", name: "C-körkort" }, a), a.userId).rejects.toBeInstanceOf(ApiError);
    }
  });

  it("byta namn och arkivera: nivåerna byter namn men arkiveras aldrig; en tagg arkiveras och återställs; de gamla grupperna rörs inte", async () => {
    expect(await cmd(groupingRename.key, { id: L(1), name: "Nivå 1 – Behöver mycket stöd", description: "" }, sara())).toMatchObject({ ok: true });
    expect(rt.store.getRow("groupings", L(1))).toMatchObject({ name: "Nivå 1 – Behöver mycket stöd", updatedBy: "u-sara" });
    expect(await cmd(groupingRename.key, { id: L(2), name: "nivå 1 – behöver mycket stöd", description: "" }, sara())).toMatchObject({ ok: false, error: "duplicate" });
    expect(await cmd(groupingArchive.key, { id: L(1), archived: true }, sara())).toMatchObject({ ok: false, error: "level" });
    // De gamla grupperna (historik): inget namnbyte och ingen återställning.
    expect(await cmd(groupingRename.key, { id: MANDAG, name: "Måndagsgruppen 2", description: "" }, sara())).toMatchObject({ ok: false, error: "group" });
    expect(await cmd(groupingArchive.key, { id: MANDAG, archived: false }, sara())).toMatchObject({ ok: false, error: "group" });
    expect(rt.store.getRow("groupings", MANDAG)?.archivedAt).not.toBeNull();
    const t = await newTag("B-körkort");
    expect(await cmd(groupingArchive.key, { id: t, archived: true }, sara())).toMatchObject({ ok: true });
    expect(await cmd(groupingArchive.key, { id: t, archived: false }, sara())).toMatchObject({ ok: true });
    expect(rt.store.getRow("groupings", t)).toMatchObject({ archivedAt: null, archivedBy: null });
    expect(logsSince(0).filter((x) => x.action.startsWith("grouping.")).map((x) => x.action)).toEqual(["grouping.updated", "grouping.created", "grouping.archived", "grouping.restored"]);
  });

  it("Ny tagg i ett ärende hamnar i ärendets avtal – också när aktören har ett annat avtal före; katalogen visar ett avtal i taget", async () => {
    addSecondContract();
    expect(amira().contractIds.sort()).toEqual(["c-aaa", "c-bot"]);
    // Kortet i ärendet skickar ärendet: Botkyrkaavtalet (ärendets), inte aktörens första avtal.
    const t = await newTag("B-körkort", { caseId: AMAL }, amira());
    expect(rt.store.getRow("groupings", t)?.contractId).toBe("c-bot");
    expect(await cmd(caseGroupingsSave.key, { caseId: AMAL, levelId: null, tags: { Körkort: t } }, amira())).toMatchObject({ ok: true });
    // Utan ärende: det valda avtalet, annars det första (fast ordning).
    const other = await newTag("C-körkort", {}, amira());
    expect(rt.store.getRow("groupings", other)?.contractId).toBe("c-aaa");
    const chosen = await newTag("C-körkort", { contractId: "c-bot" }, amira());
    expect(rt.store.getRow("groupings", chosen)?.contractId).toBe("c-bot");
    // En tagg i ett annat avtal än ärendets kan inte väljas i ärendet.
    expect(await cmd(caseGroupingsSave.key, { caseId: AMAL, levelId: null, tags: { Körkort: other } }, amira())).toMatchObject({ ok: false, error: "unknown" });
    // Katalogen: ett avtal i taget, aktörens avtal att välja mellan.
    const first = await q(groupingCatalog, {}, amira());
    expect(first?.contractId).toBe("c-aaa");
    expect(first?.contracts.map((c) => c.id)).toEqual(["c-aaa", "c-bot"]);
    expect(first?.tags.map((x) => [x.category, x.values.map((v) => v.name)])).toEqual([["Körkort", ["C-körkort"]]]);
    expect((await q(groupingCatalog, { contractId: "c-bot" }, amira()))?.tags.map((x) => [x.category, x.values.map((v) => v.name)])).toEqual([
      ["Körkort", ["B-körkort", "C-körkort"]], ["Vill arbeta", ["Heltid", "Deltid", "Vet inte än"]],
    ]);
    // Filtret i listorna: alla avtal – ärendena filtreras på sitt eget avtals taggar, med avtalets prefix efter namnet.
    const f = await q(groupingFilterData, {}, amira());
    expect(f?.tags.map((x) => x.name)).toEqual(expect.arrayContaining(["Körkort: C-körkort (AAA)", "Körkort: B-körkort (BOT)", "Körkort: C-körkort (BOT)"]));
    expect(f?.byCase[AMAL]).toContain(t);
    // Anteckningar: ett avtal i taget.
    expect((await q(massNotePage, { urval: "niva", id: L(3) }, amira())).rows).toEqual([]);
    expect((await q(massNotePage, { urval: "niva", id: L(3), contractId: "c-bot" }, amira())).rows.length).toBeGreaterThan(0);
  });

  it("standardvärdena läggs bara in när de saknas", async () => {
    expect(await cmd(groupingDefaults.key, {}, robin())).toMatchObject({ ok: true, added: 0 });
    for (const g of rt.store.rows("groupings").filter((x) => x.kind === "level")) rt.store.removeRow("groupings", g.id);
    expect((await q(groupingCatalog, {}, robin()))?.missingDefaults).toBe(true);
    expect(await cmd(groupingDefaults.key, {}, robin())).toMatchObject({ ok: true, added: 5 });
    expect((await q(groupingCatalog, {}, robin()))?.levels).toHaveLength(5);
  });
});

describe("det tomma testdatat (MM_SEED=empty) speglar produktionen efter 0031 och 0035", () => {
  it("avtalet har de fem nivåerna och Vill arbeta – men inga grupper och inga medlemskap", () => {
    const empty = createEmptySeed();
    const ids = empty.contracts.flatMap((c) => defaultGroupings(c.id, DEMO_START).map((g) => g.id)).sort();
    expect(ids.length).toBeGreaterThan(0);
    expect(empty.groupings.map((g) => g.id).sort()).toEqual(ids);
    expect(empty.groupings.filter((g) => g.kind === "level")).toHaveLength(5 * empty.contracts.length);
    expect(empty.groupings.filter((g) => g.kind === "group")).toEqual([]);
    expect(empty.grouping_members).toEqual([]);
  });
});

describe("filtret i coachens listor (grupper.filter)", () => {
  it("yrkesområden, aktiva nivåer och taggar och ärendenas id:n – gamla grupper och borttagna inte med; ekonomen och kommunen nekas", async () => {
    const f = await q(groupingFilterData, {}, amira());
    expect(f?.levels.map((g) => g.id)).toEqual([1, 2, 3, 4, 5].map(L));
    expect(f?.areas.map((a) => a.name)).toEqual([
      "A – Administration", "B – Hälsa och sjukvård", "C – Bygg och anläggning", "D – Kök, restaurang och måltidsservice", "E – Transport och åkeri", "F – Lokalvård",
      "G – Lager och logistik", "H – Serviceyrken", "I – Fastighet, mark och park", "J – Parti- och detaljhandel", "K – Industri", "L – Övrigt",
    ]);
    expect(f?.tags.map((g) => g.name)).toEqual(["Vill arbeta: Heltid", "Vill arbeta: Deltid", "Vill arbeta: Vet inte än"]);
    expect(Object.keys(f ?? {})).not.toContain("groups");
    expect([...(f?.byCase[NADIA] ?? [])].sort()).toEqual([L(4), W("heltid")].sort());
    expect(f?.areaByCase[NADIA]).toBe("G");
    expect(f?.areaByCase[MEHMET]).toBe("E");
    // De gamla gruppernas medlemskap är avslutade – de finns inte i filtret.
    expect(Object.values(f?.byCase ?? {}).flat().some((id) => id.startsWith("grp-c-bot-g-"))).toBe(false);
    for (const a of [lars(), maria()]) await expect(q(groupingFilterData, {}, a), a.userId).rejects.toBeInstanceOf(ApiError);
  });
});

describe("massanteckningar (grupper.anteckningar och grupper.anteckningarSpara)", () => {
  it("urvalet: Mina ärenden (huvudcoach eller i teamet), ett yrkesområde och en nivå – bara öppna ärenden, nivån med", async () => {
    const mina = await q(massNotePage, { urval: "mina" }, amira());
    const amiraOpen = rt.store.rows("cases").filter((c) => OPEN.includes(c.status) && (c.leadCoachId === "u-amira" || rt.store.rows("case_team").some((t) => t.caseId === c.id && t.userId === "u-amira")));
    expect(mina.rows.map((r) => r.caseId).sort()).toEqual(amiraOpen.map((c) => c.id).sort());
    const omrade = await q(massNotePage, { urval: "omrade", id: "E" }, amira());
    expect(omrade.rows.map((r) => r.caseId).sort()).toEqual(rt.store.rows("cases").filter((c) => c.contractId === "c-bot" && c.primaryAreaCode === "E" && OPEN.includes(c.status)).map((c) => c.id).sort());
    expect(omrade.rows.find((r) => r.caseId === MEHMET)).toMatchObject({ levelName: "Nivå 3 – På väg" });
    expect(omrade.today).toBe("2027-02-01");
    const niva = await q(massNotePage, { urval: "niva", id: L(3) }, amira());
    expect(niva.rows.map((r) => r.caseId)).toContain(MEHMET);
    expect((await q(massNotePage, { urval: "omrade" }, amira())).rows).toEqual([]);
    // En gammal grupp ger inga rader (medlemskapen är avslutade).
    expect((await q(massNotePage, { urval: "tagg", id: MANDAG }, amira())).rows).toEqual([]);
  });

  it("antalet per nivå, yrkesområde och tagg räknar bara pågående ärenden – samma som raderna i Anteckningar", async () => {
    // Ett ärende i nivå 3 (yrkesområde E) avslutas (medlemskapet ligger kvar).
    rt.store.updateRow("cases", MEHMET, { status: "closed" });
    const cat = (await q(groupingCatalog, {}, amira()))!;
    const scopes = [
      ...cat.levels.map((g) => ["niva", g.id, g.name, g.members] as const),
      ...cat.areas.map((a) => ["omrade", a.code, a.name, a.members] as const),
      ...cat.tags.flatMap((t) => t.values.map((g) => ["tagg", g.id, g.name, g.members] as const)),
    ];
    for (const [urval, id, name, members] of scopes) {
      const page = await q(massNotePage, { urval, id }, amira());
      expect(page.rows.length, name).toBe(members);
    }
    expect((await q(massNotePage, { urval: "omrade", id: "E" }, amira())).rows.map((r) => r.caseId)).not.toContain(MEHMET);
  });

  it("en anteckning per ifylld rad – vanliga anteckningar i deltagarkortet, loggade med id:n", async () => {
    const before = rt.store.rows("audit_log").length;
    const notesBefore = rt.store.rows("case_notes").length;
    const r = await cmd(massNoteSave.key, {
      saveKey: KEY,
      kind: "conversation",
      rows: [{ caseId: NADIA, occurredOn: "2027-02-01", body: "Var med på gruppträffen." }, { caseId: "case-260130", occurredOn: "2027-02-01", body: " Kom sent men deltog. " }],
    }, amira());
    expect(r).toMatchObject({ ok: true, saved: 2 });
    const added = rt.store.rows("case_notes").slice(notesBefore);
    expect(added.map((n) => [n.caseId, n.authorId, n.kind, n.audience, n.occurredOn, n.body])).toEqual([
      [NADIA, "u-amira", "conversation", "full", "2027-02-01", "Var med på gruppträffen."],
      ["case-260130", "u-amira", "conversation", "full", "2027-02-01", "Kom sent men deltog."],
    ]);
    const log = logsSince(before);
    expect(log.map((x) => [x.action, x.entityId, x.details])).toEqual(added.map((n) => ["case_note.created", n.id, { caseId: n.caseId, via: "massanteckningar" }]));
    expect(JSON.stringify(log)).not.toMatch(/gruppträffen|sent/);
  });

  it("allt eller inget: ett personnummer, ett framtida datum eller ett ärende utan åtkomst stoppar – felet står vid raden och inget sparas", async () => {
    const notesBefore = rt.store.rows("case_notes").length;
    const r = await cmd(massNoteSave.key, {
      saveKey: KEY,
      kind: "other",
      rows: [
        { caseId: NADIA, occurredOn: "2027-02-01", body: "Bra dag." },
        { caseId: "case-260130", occurredOn: "2027-02-01", body: "Personnummer 19850101–1234 på lappen" },
        { caseId: "case-260126", occurredOn: "2027-02-02", body: "I morgon." },
      ],
    }, amira());
    expect(r).toMatchObject({ ok: false, error: "rows", message: "2 rader behöver rättas. Inget är sparat." });
    expect(Object.keys(r.fields ?? {}).sort()).toEqual(["case-260126", "case-260130"]);
    expect(r.fields?.["case-260130"]).toMatch(/personnummer/);
    expect(r.fields?.["case-260126"]).toMatch(/senare än i dag/);
    expect(rt.store.rows("case_notes")).toHaveLength(notesBefore);
    // Tomma rader tas inte emot (skärmen skickar bara ifyllda rader – massNoteRowsToSave).
    await expect(cmd(massNoteSave.key, { saveKey: KEY, kind: "other", rows: [{ caseId: NADIA, occurredOn: "2027-02-01", body: "   " }] }, amira())).rejects.toBeInstanceOf(ApiError);
    for (const a of [karin(), robin(), lars(), maria()]) {
      await expect(cmd(massNoteSave.key, { saveKey: KEY, kind: "other", rows: [{ caseId: NADIA, occurredOn: "2027-02-01", body: "Text" }] }, a), a.userId).rejects.toBeInstanceOf(ApiError);
    }
  });
});

describe("massanteckningar: ett avbrott mitt i sparningen ger inga dubbletter", () => {
  it("skrivning nummer två misslyckas – ett nytt försök med samma sparnyckel sparar resten; dubbelklick och ändrad text ger inga dubbletter", async () => {
    const rows = [NADIA, "case-260130", "case-260126"].map((caseId, i) => ({ caseId, occurredOn: "2027-02-01", body: `Rad ${i + 1}.` }));
    const notesBefore = rt.store.rows("case_notes").length;
    const restore = failInsert("case_notes", 2);
    await expect(cmd(massNoteSave.key, { saveKey: KEY, kind: "conversation", rows }, amira())).rejects.toThrow();
    restore();
    expect(rt.store.rows("case_notes").length).toBe(notesBefore + 1);
    // Skärmen behåller texterna och nyckeln: bara det som saknas sparas.
    expect(await cmd(massNoteSave.key, { saveKey: KEY, kind: "conversation", rows }, amira())).toMatchObject({ ok: true, saved: 3 });
    const added = () => rt.store.rows("case_notes").slice(notesBefore);
    expect(added().map((n) => [n.caseId, n.body]).sort()).toEqual(rows.map((r) => [r.caseId, r.body]).sort());
    const created = rt.store.rows("audit_log").filter((x) => x.action === "case_note.created" && (x.details as { via?: string }).via === "massanteckningar");
    expect(created.map((x) => x.entityId).sort()).toEqual(added().map((n) => n.id).sort());
    // Samma sparning igen (dubbelklick): inget nytt.
    expect(await cmd(massNoteSave.key, { saveKey: KEY, kind: "conversation", rows }, amira())).toMatchObject({ ok: true, saved: 3 });
    expect(added()).toHaveLength(3);
    // Texten rättades före det nya försöket: den egna anteckningen ändras – ingen ny.
    const fixed = rows.map((r, i) => (i === 0 ? { ...r, body: "Rad 1, rättad." } : r));
    const logBefore = rt.store.rows("audit_log").length;
    expect(await cmd(massNoteSave.key, { saveKey: KEY, kind: "conversation", rows: fixed }, amira())).toMatchObject({ ok: true });
    expect(added()).toHaveLength(3);
    expect(added().find((n) => n.caseId === NADIA)).toMatchObject({ body: "Rad 1, rättad.", updatedAt: expect.any(String) });
    expect(logsSince(logBefore).map((x) => [x.action, x.details])).toEqual([["case_note.updated", { caseId: NADIA, via: "massanteckningar" }]]);
    // En ny sparning (ny nyckel efter att den förra lyckades): nya anteckningar.
    expect(await cmd(massNoteSave.key, { saveKey: "nyckel-fedcba9876543210", kind: "conversation", rows: [rows[0]] }, amira())).toMatchObject({ ok: true, saved: 1 });
    expect(added()).toHaveLength(4);
    // Nyckeln krävs och har ett fast format.
    await expect(cmd(massNoteSave.key, { kind: "conversation", rows }, amira())).rejects.toBeInstanceOf(ApiError);
    await expect(cmd(massNoteSave.key, { saveKey: "kort", kind: "conversation", rows }, amira())).rejects.toBeInstanceOf(ApiError);
  });
});

describe("internt: inget av grupperingarna syns för kommunen, i rapporter, resultatfilen, exporter eller fakturaunderlaget", () => {
  /** Unika namn som inte kan förekomma av en slump – så att ett läckage syns direkt. */
  const mark = () => {
    for (const g of rt.store.rows("groupings")) rt.store.updateRow("groupings", g.id, { name: `HEMLIG-${g.id}`, description: `HEMLIG-BESKRIVNING-${g.id}`, category: g.category ? "HEMLIG-KATEGORI" : null });
  };
  const leak = (label: string, x: unknown) => {
    const s = JSON.stringify(x);
    // Namnen, beskrivningarna, kategorierna, id:na och standardnivåernas ord ("groupingKey" i fakturan är något annat).
    expect(s, label).not.toMatch(/HEMLIG|grp-c-bot|groupingId|grouping_member|Nivå \d –/);
  };

  it("kommunens portal (start, lista, deltagaren, rapporter, kvitto)", async () => {
    mark();
    const m = maria();
    leak("kommun.start", await rt.run("query", "kommun.start", {}, m));
    leak("kommun.deltagareLista", await rt.run("query", "kommun.deltagareLista", {}, m));
    leak("kommun.deltagare", await rt.run("query", "kommun.deltagare", { caseId: NADIA }, m));
    leak("kommun.rapporter", await rt.run("query", "kommun.rapporter", {}, m));
    leak("kommun.kvitto", await rt.run("query", "kommun.kvitto", { caseId: NADIA }, m));
  });

  it("rapporterna (månadsrapporten som dokument och sida), också för samordnaren", async () => {
    mark();
    for (const reportId of ["rep-16008", "rep-16011"]) {
      leak(`rapporter.dokument ${reportId}`, await rt.run("query", "rapporter.dokument", { reportId }, sara()));
      leak(`rapporter.visa ${reportId}`, await rt.run("query", "rapporter.visa", { reportId }, sara()));
    }
    leak("kommunens rapport", await rt.run("query", "rapporter.dokument", { reportId: "rep-16008" }, maria()));
  });

  it("resultatfilen (alla tabeller), rapportbyggarens export och fakturaunderlaget", async () => {
    mark();
    const johan = as("u-johan", "avtalsansvarig");
    for (const table of ["resultat", "progression", "handelser", "avslut", "faltbeskrivning"] as const) {
      const r = await cmd("rapporter.resultatfilExport", { contractId: "c-bot", from: "2026-09", to: "2027-01", format: "csv", table }, johan);
      expect(r.ok, table).toBe(true);
      leak(`resultatfil ${table}`, r);
    }
    for (const id of ["sr-seed-privat", "sr-seed-mb", "sr-seed-kommun"]) {
      const owner = rt.raw().get("saved_reports", id)!.ownerId;
      const actor = listPersonas(rt.raw()).find((p) => p.actor.userId === owner)!.actor;
      const r = await cmd("rapporter.byggExport", { savedReportId: id, format: "csv" }, actor);
      expect(r.ok, id).toBe(true);
      leak(`byggExport ${id}`, r);
    }
    leak("ekonomi.csv", await rt.run("query", "ekonomi.csv", { month: "2027-01" }, lars()));
    leak("ekonomi.run", await rt.run("query", "ekonomi.run", { month: "2027-01" }, lars()));
  });
});

describe("granskningen, andra rundan: Utan nivå – att kartlägga", () => {
  it("bara coachen öppnar kartläggningen; samordnaren väljer nivån direkt (Välj nivå), chefen läser", async () => {
    expect(await q(groupingOverview, {}, amira())).toMatchObject({ canIntake: true, canPlace: true });
    expect(await q(groupingOverview, {}, sara())).toMatchObject({ canIntake: false, canPlace: true });
    expect(await q(groupingOverview, {}, karin())).toMatchObject({ canIntake: false, canPlace: false });
    // Välj nivå (samma kommando som Byt nivå, utan nivå före).
    const r = await cmd(caseLevelSet.key, { caseId: AMAL, levelId: L(2), fromLevelId: null }, sara());
    expect(r).toMatchObject({ ok: true });
    const o = await q(groupingOverview, {}, sara());
    expect(o!.unplaced.some((m) => m.caseId === AMAL)).toBe(false);
  });
});
