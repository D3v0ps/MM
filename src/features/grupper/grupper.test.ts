// Nivåer, grupper och taggar och massanteckningar (coachmötet 2026-10-09) – mot testdatat i minnet (MemoryRuntime, samma
// hanterare som appen): en nivå per ärende, en tagg per kategori, arkiverade kan inte väljas, massanteckningarna (allt eller
// inget, personnummer stoppas per rad), behörigheten per roll – och att inget av grupperingarna syns för kommunen, i
// rapporterna, resultatfilen, rapportbyggarens export eller fakturaunderlaget.
import { beforeEach, describe, expect, it } from "vitest";
import type { ParamsOf, QueryDef, ResultOf } from "@/api/contract";
import type { Actor, Role } from "@/api/roles";
import { ApiError } from "@/api/server";
import { listPersonas } from "@/data/actors";
import type { MemoryData } from "@/data/memory";
import { createMemoryRuntime, demoClock, type MemoryRuntime } from "@/data/memory-runtime";
import { createSeed, DEMO_START } from "@/data/seed";
import type { Tables } from "@/data/schema";
import {
  caseGroupingsSave, caseGroupingsView, groupingArchive, groupingCatalog, groupingCreate, groupingDefaults, groupingFilterData, groupingRename, massNotePage, massNoteSave,
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
const petra = () => as("u-petra", "handledare");
const karin = () => as("u-karin", "chef");
const robin = () => as("u-robin", "admin");
const lars = () => as("u-lars", "ekonom");
const maria = () => as("k-maria", "kommun_handlaggare");

const NADIA = "case-260143";
const AMAL = "case-270012";
const L = (n: number) => `grp-c-bot-niva-${n}`;
const W = (slug: string) => `grp-c-bot-vill-arbeta-${slug}`;
const MANDAG = "grp-c-bot-g-mandag";
const LAGER = "grp-c-bot-g-lager";
const HOST = "grp-c-bot-g-host";
const active = (caseId: string) => rt.store.rows("grouping_members").filter((m) => m.caseId === caseId && m.removedAt == null);
const logsSince = (n: number) => rt.store.rows("audit_log").slice(n);

describe("ärendets nivå, grupper och taggar (grupper.arendeSpara)", () => {
  it("coachen sätter nivå, grupp och Vill arbeta i ett ärende utan – sparas direkt, loggas med id:n (aldrig namnen)", async () => {
    expect(active(AMAL)).toEqual([]);
    const before = rt.store.rows("audit_log").length;
    const r = await cmd(caseGroupingsSave.key, { caseId: AMAL, levelId: L(2), groupIds: [MANDAG], tags: { "Vill arbeta": W("deltid") } }, amira());
    expect(r).toMatchObject({ ok: true, added: 3, removed: 0 });
    expect(active(AMAL).map((m) => [m.groupingId, m.kind, m.slot, m.addedBy]).sort()).toEqual([
      [L(2), "level", "level", "u-amira"], [MANDAG, "group", null, "u-amira"], [W("deltid"), "tag", "tag:Vill arbeta", "u-amira"],
    ].sort());
    const log = logsSince(before);
    expect(log.map((x) => [x.action, x.entity, x.details])).toEqual(
      active(AMAL).map((m) => ["grouping_member.added", "grouping_member", { caseId: AMAL, groupingId: m.groupingId, kind: m.kind }]),
    );
    expect(JSON.stringify(log)).not.toMatch(/Måndagsgruppen|Nivå 2|Deltid/);
    const v = await q(caseGroupingsView, { caseId: AMAL }, amira());
    expect(v?.current).toEqual({
      level: { id: L(2), name: "Nivå 2 – Behöver stöd för att komma igång" }, groups: [{ id: MANDAG, name: "Måndagsgruppen" }],
      tags: [{ id: W("deltid"), category: "Vill arbeta", name: "Deltid" }],
    });
  });

  it("en nivå per ärende: en ny nivå tar bort den gamla; en tagg per kategori: ett nytt värde tar bort det gamla", async () => {
    const cur = active(NADIA);
    expect(cur.filter((m) => m.kind === "level")).toHaveLength(1);
    const r = await cmd(caseGroupingsSave.key, { caseId: NADIA, levelId: L(5), groupIds: [LAGER], tags: { "Vill arbeta": W("deltid") } }, sara());
    expect(r).toMatchObject({ ok: true, added: 2, removed: 2 });
    const now = active(NADIA);
    expect(now.filter((m) => m.kind === "level").map((m) => m.groupingId)).toEqual([L(5)]);
    expect(now.filter((m) => m.kind === "tag").map((m) => m.groupingId)).toEqual([W("deltid")]);
    // De gamla raderna finns kvar som borttagna (inget raderas).
    const removed = rt.store.rows("grouping_members").filter((m) => m.caseId === NADIA && m.removedAt != null);
    expect(removed.map((m) => [m.groupingId, m.removedBy])).toEqual(expect.arrayContaining([[L(4), "u-sara"], [W("heltid"), "u-sara"]]));
    // Minnets unika index stoppar en andra aktiv nivå även förbi hanteraren.
    const level = now.find((m) => m.kind === "level")!;
    expect(() => rt.store.insertRow("grouping_members", { ...level, id: "gm-x", groupingId: L(1) })).toThrow(/Dubblett/);
  });

  it("en arkiverad grupp kan inte väljas – men den kan tas bort; okänd gruppering och fel kategori nekas", async () => {
    expect(await cmd(caseGroupingsSave.key, { caseId: AMAL, levelId: null, groupIds: [HOST], tags: {} }, amira())).toMatchObject({ ok: false, error: "archived" });
    expect(await cmd(caseGroupingsSave.key, { caseId: AMAL, levelId: "grp-finns-inte", groupIds: [], tags: {} }, amira())).toMatchObject({ ok: false, error: "unknown" });
    expect(await cmd(caseGroupingsSave.key, { caseId: AMAL, levelId: null, groupIds: [], tags: { Körkort: W("heltid") } }, amira())).toMatchObject({ ok: false, error: "wrong_category" });
    expect(active(AMAL)).toEqual([]);
    // Arkivera en grupp med medlemmar: de ligger kvar, men ingen ny kan väljas.
    expect(await cmd(groupingArchive.key, { id: MANDAG, archived: true }, sara())).toMatchObject({ ok: true });
    expect(await cmd(caseGroupingsSave.key, { caseId: AMAL, levelId: null, groupIds: [MANDAG], tags: {} }, amira())).toMatchObject({ ok: false, error: "archived" });
    const mehmet = "case-260130";
    expect(active(mehmet).some((m) => m.groupingId === MANDAG)).toBe(true);
    const v = await q(caseGroupingsView, { caseId: mehmet }, amira());
    expect(v?.options.groups.find((g) => g.id === MANDAG)).toMatchObject({ archived: true });
    expect(await cmd(caseGroupingsSave.key, { caseId: mehmet, levelId: L(3), groupIds: [], tags: {} }, amira())).toMatchObject({ ok: true, removed: 1 });
  });

  it("behörighet: handledare och chef läser men ändrar inte; ekonomen och kommunen ser ingenting", async () => {
    expect((await q(caseGroupingsView, { caseId: NADIA }, petra()))?.canEdit).toBe(false);
    expect((await q(caseGroupingsView, { caseId: NADIA }, karin()))?.canEdit).toBe(false);
    expect((await q(caseGroupingsView, { caseId: NADIA }, robin()))?.canEdit).toBe(true);
    for (const a of [petra(), karin(), lars(), maria()]) {
      await expect(cmd(caseGroupingsSave.key, { caseId: NADIA, levelId: L(1), groupIds: [], tags: {} }, a), a.userId).rejects.toBeInstanceOf(ApiError);
    }
    for (const a of [lars(), maria()]) {
      await expect(q(caseGroupingsView, { caseId: NADIA }, a), a.userId).rejects.toBeInstanceOf(ApiError);
      await expect(q(groupingCatalog, {}, a), a.userId).rejects.toBeInstanceOf(ApiError);
      await expect(q(massNotePage, { urval: "mina" }, a), a.userId).rejects.toBeInstanceOf(ApiError);
    }
  });

  it("den vilande spärren: ett skyddat ärende visas inte för samordnaren och kan inte ändras av henne", async () => {
    const SKYDDAD = "case-260120";
    rt.store.updateRow("persons", rt.raw().get("cases", SKYDDAD)!.personId, { protectedIdentity: true });
    expect(await q(caseGroupingsView, { caseId: SKYDDAD }, sara())).toBeNull();
    expect(await cmd(caseGroupingsSave.key, { caseId: SKYDDAD, levelId: L(1), groupIds: [], tags: {} }, sara())).toMatchObject({ ok: false, error: "not_found" });
    const erik = as("u-erik", "coach");
    expect((await q(caseGroupingsView, { caseId: SKYDDAD }, erik))?.current.level?.id).toBe(L(2));
  });
});

describe("avtalets grupperingar (grupper.katalog, ny, andra, arkivera, standard)", () => {
  it("katalogen: fem nivåer, grupperna (aktiva – eller alla med arkiverade) och taggarna per kategori med antal deltagare", async () => {
    const c = await q(groupingCatalog, {}, amira());
    expect(c?.levels.map((g) => g.name)).toHaveLength(5);
    expect(c?.groups.map((g) => g.name)).toEqual(["Måndagsgruppen", "Lagergruppen"]);
    expect(c?.tags.map((t) => [t.category, t.values.map((v) => v.name)])).toEqual([["Vill arbeta", ["Heltid", "Deltid", "Vet inte än"]]]);
    expect(c?.groups.find((g) => g.id === MANDAG)?.members).toBe(rt.store.rows("grouping_members").filter((m) => m.groupingId === MANDAG && !m.removedAt).length);
    expect((await q(groupingCatalog, { arkiverade: true }, amira()))?.groups.map((g) => [g.name, g.archived])).toEqual([
      ["Måndagsgruppen", false], ["Lagergruppen", false], ["Höstgruppen 2026", true],
    ]);
    expect(c?.canEdit).toBe(true);
    expect((await q(groupingCatalog, {}, petra()))?.canEdit).toBe(false);
  });

  it("ny grupp och ny tagg: namnet kontrolleras (dubblett, personnummer), sortering sist, loggas utan namn", async () => {
    const before = rt.store.rows("audit_log").length;
    const g = await cmd(groupingCreate.key, { kind: "group", name: "Tisdagsgruppen" }, amira());
    expect(g).toMatchObject({ ok: true });
    expect(rt.store.getRow("groupings", g.id as string)).toMatchObject({ kind: "group", name: "Tisdagsgruppen", createdBy: "u-amira", sortOrder: 4, category: null });
    expect(await cmd(groupingCreate.key, { kind: "group", name: " tisdagsgruppen " }, sara())).toMatchObject({ ok: false, error: "duplicate" });
    expect(await cmd(groupingCreate.key, { kind: "group", name: "Grupp 850101-1234" }, sara())).toMatchObject({ ok: false, error: "invalid" });
    const t = await cmd(groupingCreate.key, { kind: "tag", category: "Körkort", name: "B-körkort" }, sara());
    expect(rt.store.getRow("groupings", t.id as string)).toMatchObject({ kind: "tag", category: "Körkort", sortOrder: 1 });
    expect(await cmd(groupingCreate.key, { kind: "tag", name: "Utan kategori" }, sara())).toMatchObject({ ok: false, error: "invalid" });
    const log = logsSince(before);
    expect(log.map((x) => [x.action, x.details])).toEqual([["grouping.created", { kind: "group" }], ["grouping.created", { kind: "tag" }]]);
    expect(JSON.stringify(log)).not.toMatch(/Tisdagsgruppen|Körkort/);
    for (const a of [petra(), karin(), lars(), maria()]) await expect(cmd(groupingCreate.key, { kind: "group", name: "X-gruppen" }, a), a.userId).rejects.toBeInstanceOf(ApiError);
  });

  it("byta namn och arkivera: nivåerna byter namn men arkiveras aldrig; en arkiverad kan återställas", async () => {
    expect(await cmd(groupingRename.key, { id: L(1), name: "Nivå 1 – Behöver mycket stöd", description: "" }, sara())).toMatchObject({ ok: true });
    expect(rt.store.getRow("groupings", L(1))).toMatchObject({ name: "Nivå 1 – Behöver mycket stöd", updatedBy: "u-sara" });
    expect(await cmd(groupingRename.key, { id: L(2), name: "nivå 1 – behöver mycket stöd", description: "" }, sara())).toMatchObject({ ok: false, error: "duplicate" });
    expect(await cmd(groupingArchive.key, { id: L(1), archived: true }, sara())).toMatchObject({ ok: false, error: "level" });
    expect(await cmd(groupingArchive.key, { id: HOST, archived: false }, sara())).toMatchObject({ ok: true });
    expect(rt.store.getRow("groupings", HOST)).toMatchObject({ archivedAt: null, archivedBy: null });
    expect(logsSince(0).filter((x) => x.action.startsWith("grouping.")).map((x) => x.action)).toEqual(["grouping.updated", "grouping.restored"]);
  });

  it("standardvärdena läggs bara in när de saknas", async () => {
    expect(await cmd(groupingDefaults.key, {}, robin())).toMatchObject({ ok: true, added: 0 });
    for (const g of rt.store.rows("groupings").filter((x) => x.kind === "level")) rt.store.removeRow("groupings", g.id);
    expect((await q(groupingCatalog, {}, robin()))?.missingDefaults).toBe(true);
    expect(await cmd(groupingDefaults.key, {}, robin())).toMatchObject({ ok: true, added: 5 });
    expect((await q(groupingCatalog, {}, robin()))?.levels).toHaveLength(5);
  });
});

describe("filtret i coachens listor (grupper.filter)", () => {
  it("aktiva nivåer, grupper och taggar och ärendenas id:n – arkiverade och borttagna inte med; ekonomen och kommunen nekas", async () => {
    const f = await q(groupingFilterData, {}, amira());
    expect(f?.levels.map((g) => g.id)).toEqual([1, 2, 3, 4, 5].map(L));
    expect(f?.groups.map((g) => g.name)).toEqual(["Måndagsgruppen", "Lagergruppen"]);
    expect(f?.tags.map((g) => g.name)).toEqual(["Vill arbeta: Heltid", "Vill arbeta: Deltid", "Vill arbeta: Vet inte än"]);
    expect([...(f?.byCase[NADIA] ?? [])].sort()).toEqual([L(4), LAGER, W("heltid")].sort());
    expect(f?.byCase["case-260148"]).not.toContain(HOST);
    for (const a of [lars(), maria()]) await expect(q(groupingFilterData, {}, a), a.userId).rejects.toBeInstanceOf(ApiError);
  });
});

describe("massanteckningar (grupper.anteckningar och grupper.anteckningarSpara)", () => {
  it("urvalet: Mina ärenden (huvudcoach eller i teamet) och en grupp – bara öppna ärenden, nivån med", async () => {
    const mina = await q(massNotePage, { urval: "mina" }, amira());
    const amiraOpen = rt.store.rows("cases").filter((c) => ["confirmed", "active", "paused"].includes(c.status) && (c.leadCoachId === "u-amira" || rt.store.rows("case_team").some((t) => t.caseId === c.id && t.userId === "u-amira")));
    expect(mina.rows.map((r) => r.caseId).sort()).toEqual(amiraOpen.map((c) => c.id).sort());
    const grupp = await q(massNotePage, { urval: "grupp", id: MANDAG }, amira());
    const members = rt.store.rows("grouping_members").filter((m) => m.groupingId === MANDAG && m.removedAt == null).map((m) => m.caseId);
    expect(grupp.rows.map((r) => r.caseId).sort()).toEqual(members.filter((id) => ["confirmed", "active", "paused"].includes(rt.raw().get("cases", id)!.status)).sort());
    expect(grupp.rows.find((r) => r.caseId === "case-260130")).toMatchObject({ levelName: "Nivå 3 – På väg" });
    expect(grupp.today).toBe("2027-02-01");
    expect((await q(massNotePage, { urval: "grupp" }, amira())).rows).toEqual([]);
  });

  it("en anteckning per ifylld rad – vanliga anteckningar i deltagarkortet, loggade med id:n", async () => {
    const before = rt.store.rows("audit_log").length;
    const notesBefore = rt.store.rows("case_notes").length;
    const r = await cmd(massNoteSave.key, {
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
    await expect(cmd(massNoteSave.key, { kind: "other", rows: [{ caseId: NADIA, occurredOn: "2027-02-01", body: "   " }] }, amira())).rejects.toBeInstanceOf(ApiError);
    for (const a of [karin(), robin(), lars(), maria()]) {
      await expect(cmd(massNoteSave.key, { kind: "other", rows: [{ caseId: NADIA, occurredOn: "2027-02-01", body: "Text" }] }, a), a.userId).rejects.toBeInstanceOf(ApiError);
    }
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
