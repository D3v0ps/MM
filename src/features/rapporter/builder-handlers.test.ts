// Rapportbyggaren (rapporter steg 4, Del D): Miljonbemannings hanterare – behörigheten, skyddade ärenden (vilande spärr),
// delningen inom Miljonbemanning, revisionsloggen, frysningen och pariteten med resultatfilen och KPI:n. Beslut 2026-10-07:
// rapporter delas aldrig med kommunen (kommunens chef är borttagen). Resultatfilen för hela avtalet: contract-result.test.ts.
// Körs genom execute() mot testdatat i minnet som testpersonerna i rollväljaren (behörighet via policy.ts).
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { dormantSupervisor } from "@/data/dormant-role.test-helper";
import type { CommandDef, ParamsOf, QueryDef, ResultOf } from "@/api/contract";
import { execute } from "@/api/handlers";
import { SYSTEM_ACTOR, type Actor, type Role } from "@/api/roles";
import { ApiError, type Ctx } from "@/api/server";
import { CASE_NUMBER_RE } from "@/core/cases";
import { requireOperational, type ContractConfig } from "@/core/config";
import { base64ToBytes } from "@/core/export/base64";
import { entryText, readZip } from "@/core/export/read-zip.test-helper";
import { resultRate } from "@/core/kpi";
import { looksLikePnr } from "@/core/validation";
import { listPersonas } from "@/data/actors";
import { MemoryRepo, type MemoryData } from "@/data/memory";
import { createMemoryRuntime, demoClock, type MemoryRuntime } from "@/data/memory-runtime";
import { POLICIES } from "@/data/policy";
import { createSeed, DEMO_START, TEST_PNR_CRYPTO } from "@/data/seed";
import type { AppRepo, SavedReport, TableName, Tables } from "@/data/schema";
import { adminAuditLog } from "@/features/admin/api";
import { navCounts } from "@/features/session/nav-api";
import {
  builderCatalog, builderExport, builderPreview, contractResultExport, contractResultPreview, savedReport, savedReportArchive, savedReportList, savedReportSave,
  savedReportShare, TEMPLATES, type BuilderView, type ReportDefinition,
} from "./api";
import { LIMITS } from "./builder/pipeline";
import { MAX_GROUPS } from "./builder/run";
import { MAX_BUILDER_RESPONSE_CHARS } from "./builder/files";

const SEED: MemoryData<Tables> = createSeed();
let rt: MemoryRuntime;
beforeEach(() => {
  rt = createMemoryRuntime({ data: structuredClone(SEED), clock: demoClock(DEMO_START) });
});
afterEach(() => {
  LIMITS.groups = MAX_GROUPS;
  LIMITS.chars = MAX_BUILDER_RESPONSE_CHARS;
});

const as = (userId: string, role?: Role): Actor => {
  const p = listPersonas(rt.raw()).find((x) => x.actor.userId === userId && (!role || x.actor.role === role));
  if (!p) throw new Error(`Ingen testperson ${userId}`);
  return p.actor;
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const run = <D extends CommandDef<any, any>>(def: D, input: ParamsOf<D>, actor: Actor) => rt.run("command", def.key, input, actor) as Promise<ResultOf<D>>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ask = <D extends QueryDef<any, any>>(def: D, input: ParamsOf<D>, actor: Actor) => rt.run("query", def.key, input, actor) as Promise<ResultOf<D>>;
const rows = <N extends TableName>(name: N): Tables[N][] => rt.store.rows(name);
const row = <N extends TableName>(name: N, id: string): Tables[N] | undefined => rt.raw().get(name, id);
const logs = (action: string) => rows("audit_log").filter((l) => l.action === action);

const sara = () => as("u-sara", "samordnare");
const johan = () => as("u-johan", "avtalsansvarig");
const karin = () => as("u-karin", "chef");
const maria = () => as("k-maria", "kommun_handlaggare");
/** Ärendet som tidigare hade skyddade personuppgifter (Omars beställning) – i dag ett vanligt ärende i testdatat. */
const PROT_CASE = "case-260120";
const PROT_NO = "BOT-26-0120";
const CASE_NO_ANY = new RegExp(CASE_NUMBER_RE.source, "i");

const tpl = (key: string): ReportDefinition => structuredClone(TEMPLATES.find((t) => t.key === key)!.definition);
const fixed = (def: ReportDefinition, from = "2026-09", to = "2027-01"): ReportDefinition => ({ ...def, period: { kind: "fast", from, to } });
const listDef = (dataset: ReportDefinition["dataset"], columns: string[], p: Partial<ReportDefinition> = {}): ReportDefinition => ({
  v: 1, dataset, period: { kind: "fast", from: "2026-09", to: "2027-01" }, filters: {}, output: "lista", groupBy: null, split: "inget", measures: [], columns, chart: null, ...p,
});
const asDef = (d: ReportDefinition) => d as unknown as Record<string, unknown>;
const view = (r: Awaited<ReturnType<typeof preview>>): BuilderView => {
  if (!r.ok) throw new Error(`${r.error}: ${r.message}`);
  return r as unknown as BuilderView;
};
/** Slå på den vilande spärren för personen i PROT_CASE (testdatat har inga skyddade personer sedan 2026-10-07). */
const protect = () => rt.store.updateRow("persons", row("cases", PROT_CASE)!.personId, { protectedIdentity: true });
const preview = (actor: Actor, p: { definition?: ReportDefinition; savedReportId?: string; contractId?: string }) =>
  run(builderPreview, { ...(p.definition ? { definition: asDef(p.definition), contractId: p.contractId ?? "c-bot" } : {}), ...(p.savedReportId ? { savedReportId: p.savedReportId, ...(p.contractId ? { contractId: p.contractId } : {}) } : {}) }, actor);
async function exportFile(actor: Actor, p: { definition?: ReportDefinition; savedReportId?: string; format: "xlsx" | "csv" | "pdf"; contractId?: string }) {
  const res = await run(builderExport, { format: p.format, ...(p.definition ? { definition: asDef(p.definition), contractId: p.contractId ?? "c-bot" } : {}), ...(p.savedReportId ? { savedReportId: p.savedReportId, ...(p.contractId ? { contractId: p.contractId } : {}) } : {}) }, actor);
  return res;
}
const csvOf = (res: Awaited<ReturnType<typeof exportFile>>): string => {
  if (!res.ok || !("content" in res)) throw new Error(`Ingen fil: ${JSON.stringify(res).slice(0, 200)}`);
  return res.content;
};
const csvRows = (content: string) => {
  const [head, ...lines] = content.trimEnd().split("\r\n");
  const keys = head.split(";");
  return lines.map((l) => Object.fromEntries(l.split(";").map((v, i) => [keys[i], v])));
};
const caseByNo = (no: string) => rows("cases").find((c) => c.caseNumber === no)!;
const setConfig = (id: string, patch: (c: ContractConfig) => void) => {
  const c = row("contracts", id)!;
  const cfg = JSON.parse(JSON.stringify(c.config)) as ContractConfig;
  patch(cfg);
  rt.store.updateRow("contracts", id, { config: cfg });
};
/** Alla för- och efternamn på deltagarna i testdatat (hela ord) – utom ord som också är namn på personalen ("Skapad av"). */
const participantNames = (): RegExp => {
  const staff = new Set(rows("profiles").flatMap((p) => p.fullName.split(/\s+/)));
  const words = [...new Set(rows("persons").flatMap((p) => [p.firstName, p.lastName]).flatMap((n) => n.split(/[\s-]+/)).filter((w) => w.length > 2 && !staff.has(w)))];
  return new RegExp(`(^|[^\\p{L}])(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})(?![\\p{L}])`, "u");
};
const noPersonalData = (json: string, names: RegExp) => {
  expect(json).not.toMatch(CASE_NO_ANY);
  expect(looksLikePnr(json)).toBe(false);
  expect(json).not.toMatch(names);
};

// ================================================================ Behörighet
describe("roller", () => {
  it("coach, handledare, ekonom, admin och kommunens handläggare nekas rapportbyggarens nycklar", async () => {
    const def = asDef(tpl("narvaro-per-manad"));
    for (const a of [as("u-amira", "coach"), dormantSupervisor(), as("u-lars", "ekonom"), as("u-robin", "admin"), maria()]) {
      await expect(ask(builderCatalog, {}, a), a.role).rejects.toBeInstanceOf(ApiError);
      await expect(run(builderPreview, { contractId: "c-bot", definition: def }, a), a.role).rejects.toBeInstanceOf(ApiError);
      await expect(run(builderExport, { contractId: "c-bot", definition: def, format: "csv" }, a), a.role).rejects.toBeInstanceOf(ApiError);
      await expect(ask(savedReportList, {}, a), a.role).rejects.toBeInstanceOf(ApiError);
      await expect(ask(savedReport, { savedReportId: "sr-seed-mb" }, a), a.role).rejects.toBeInstanceOf(ApiError);
      await expect(run(savedReportSave, { contractId: "c-bot", title: "Rapport", definition: def }, a), a.role).rejects.toBeInstanceOf(ApiError);
      await expect(run(savedReportShare, { savedReportId: "sr-seed-mb", visibility: "mb" }, a), a.role).rejects.toBeInstanceOf(ApiError);
      await expect(run(savedReportArchive, { savedReportId: "sr-seed-mb" }, a), a.role).rejects.toBeInstanceOf(ApiError);
      await expect(ask(contractResultPreview, {}, a), a.role).rejects.toBeInstanceOf(ApiError);
      await expect(run(contractResultExport, { contractId: "c-bot", from: "2026-10", to: "2026-12", format: "xlsx" }, a), a.role).rejects.toBeInstanceOf(ApiError);
    }
  });
  it("templateKey är en nyckel i koden – aldrig fri text (zod)", async () => {
    await expect(run(savedReportSave, { contractId: "c-bot", title: "Rapport", definition: asDef(tpl("narvaro-per-manad")), templateKey: "anna-andersson" as never }, sara())).rejects.toBeInstanceOf(ApiError);
    // Exakt en av savedReportId och definition – och contractId krävs med definition.
    await expect(run(builderPreview, { definition: asDef(tpl("narvaro-per-manad")) }, sara())).rejects.toBeInstanceOf(ApiError);
    await expect(run(builderPreview, { savedReportId: "sr-seed-mb", contractId: "c-bot", definition: asDef(tpl("narvaro-per-manad")) }, sara())).rejects.toBeInstanceOf(ApiError);
    // Delningen med kommunen finns inte (0026): visibility "customer" klarar inte zod.
    await expect(run(savedReportSave, { contractId: "c-bot", title: "Rapport", definition: asDef(tpl("narvaro-per-manad")), visibility: "customer" as never }, johan())).rejects.toBeInstanceOf(ApiError);
    await expect(run(savedReportShare, { savedReportId: "sr-seed-kommun", visibility: "customer" as never }, johan())).rejects.toBeInstanceOf(ApiError);
  });
  it("katalogen: bara avtal i drift, mallarna och datamängderna – ingen delning med kommunen", async () => {
    const c = await ask(builderCatalog, {}, johan());
    expect(c.contracts.map((x) => x.id)).toEqual(["c-bot"]);
    expect(c.templates.map((t) => t.key)).toEqual(TEMPLATES.map((t) => t.key));
    expect(c).toMatchObject({ contractId: "c-bot", maxMonths: 12 });
    expect(c).not.toHaveProperty("canShareWithCustomer");
    expect(c).not.toHaveProperty("customerSharingAllowed");
    const dm = c.datasets.find((d) => d.key === "deltagarmanader")!;
    expect(dm.columns[0]).toMatchObject({ qualified: "resultat.arendenummer", cls: "pseudonym" });
    expect(dm.dimensions.map((d) => d.key)).toEqual(["avtalsomrade_kod", "yrkesspar", "bestallare_enhet", "fas_nr", "samlad_status_kod"]);
    expect(c.datasets.find((d) => d.key === "progression")!.measures).toEqual([expect.objectContaining({ key: "fordelning", chartable: false })]);
    // Mallkortets mening byggs av avtalets konfiguration (vad som räknas som resultat) – aldrig fast text.
    const sentence = (x: typeof c) => x.templates.find((t) => t.key === "resultatgrad-per-omrade")!.sentence;
    expect(sentence(c)).toBe("Hur många av avsluten som gav resultat (arbete och studier), per avtalsområde.");
    setConfig("c-bot", (cfg) => { cfg.result!.countsAsResult = ["arbete"]; });
    expect(sentence(await ask(builderCatalog, {}, johan()))).toBe("Hur många av avsluten som gav resultat (arbete), per avtalsområde.");
  });
});

// ================================================================ Skyddade ärenden och inga personuppgifter i svaren
describe("skyddade ärenden (vilande spärr) kommer aldrig med – inte heller för avtalsansvarig (full åtkomst)", () => {
  it("testdatat: ärendet är ett vanligt ärende och kommer med; de fasta texterna nämner inte skyddade personuppgifter", async () => {
    const csv = csvOf(await exportFile(johan(), { definition: listDef("deltagarmanader", ["resultat.arendenummer"]), format: "csv" }));
    expect(csv).toContain(PROT_NO);
    const v = view(await preview(johan(), { definition: fixed(tpl("narvaro-per-manad")) }));
    expect(v.rules).toEqual(["Bara levererade månads- och slutrapporter kommer med. Siffrorna är desamma som när rapporten lämnades."]);
    expect(JSON.stringify(v)).not.toMatch(/skyddade personuppgifter/i);
  });

  it("listor och sammanställningar för u-johan när spärren slås på", async () => {
    protect();
    expect(rows("cases").find((c) => c.id === PROT_CASE)!.caseNumber).toBe(PROT_NO);
    for (const def of [listDef("deltagarmanader", ["resultat.arendenummer", "resultat.namn"]), listDef("avslut", ["avslut.arendenummer"]), listDef("handelser", ["handelser.arendenummer"]), listDef("progression", ["progression.arendenummer"])]) {
      const csv = csvOf(await exportFile(johan(), { definition: def, format: "csv" }));
      expect(csv, def.dataset).not.toContain(PROT_NO);
      expect(csv).not.toContain("Skyddade personuppgifter");
      expect(looksLikePnr(csv)).toBe(false);
    }
    const v = view(await preview(johan(), { definition: fixed(tpl("narvaro-per-manad")) }));
    const delivered = rows("reports").filter((r) => r.kind === "monthly" && (r.status === "delivered" || r.status === "opened") && !r.superseded && r.month! >= "2026-09" && r.month! <= "2027-01");
    expect(delivered.some((r) => r.caseId === PROT_CASE)).toBe(true);
    expect(v.counts.rows).toBe(delivered.filter((r) => r.caseId !== PROT_CASE).length);
  });

  it("inga ärendenummer eller namn i svaren – alla mallar, sparade rapporter och listorna", async () => {
    const names = participantNames();
    for (const t of TEMPLATES) {
      const r = await preview(sara(), { definition: fixed(t.definition) });
      expect(r.ok, t.key).toBe(true);
      noPersonalData(JSON.stringify(r), names);
    }
    for (const id of ["sr-seed-privat", "sr-seed-mb", "sr-seed-kommun"]) {
      noPersonalData(JSON.stringify(await preview(sara(), { savedReportId: id })), names);
      noPersonalData(JSON.stringify(await ask(savedReport, { savedReportId: id }, sara())), names);
    }
    noPersonalData(JSON.stringify(await ask(savedReportList, {}, sara())), names);
    // En sparad lista: förhandsvisningen har bara antal och kolumnnamn.
    const saved = await run(savedReportSave, { contractId: "c-bot", title: "Deltagarlista", definition: asDef(listDef("deltagarmanader", ["resultat.arendenummer", "resultat.namn"])), visibility: "mb" }, johan());
    if (!saved.ok) throw new Error("inte sparad");
    noPersonalData(JSON.stringify(await preview(johan(), { savedReportId: saved.savedReportId })), names);
  }, 60_000);
});

// ================================================================ Avtalet följer den sparade rapporten
describe("avtalet följer den sparade rapporten", () => {
  it("ett annat contractId än rapportens ger not_found; utan contractId används rapportens avtal", async () => {
    expect(await exportFile(johan(), { savedReportId: "sr-seed-kommun", contractId: "c-ny", format: "csv" })).toMatchObject({ ok: false, error: "not_found" });
    expect(await preview(johan(), { savedReportId: "sr-seed-kommun", contractId: "c-ny" })).toMatchObject({ ok: false, error: "not_found" });
    const ok = await exportFile(johan(), { savedReportId: "sr-seed-kommun", format: "csv" });
    expect(ok).toMatchObject({ ok: true, filename: "rapport_bot_resultatgrad-per-omrade_2026-09_2027-01.csv" });
  });
});

// ================================================================ Spara och dela
describe("spara, dela och arkivera", () => {
  it("delning vid skapandet: mb ger created och shared (sharingFrom: null) – en privat rad bara created", async () => {
    const def = asDef(tpl("narvaro-per-manad"));
    const a = await run(savedReportSave, { contractId: "c-bot", title: "Privat", definition: def, templateKey: "narvaro-per-manad" }, sara());
    const b = await run(savedReportSave, { contractId: "c-bot", title: "Inom MB", definition: def, visibility: "mb" }, sara());
    const c = await run(savedReportSave, { contractId: "c-bot", title: "Johans", definition: def, visibility: "mb" }, johan());
    if (!a.ok || !b.ok || !c.ok) throw new Error("inte sparad");
    const of = (id: string) => rows("audit_log").filter((l) => l.entityId === id).map((l) => [l.action, l.details]);
    expect(of(a.savedReportId)).toEqual([["saved_report.created", { visibility: "private", template: "narvaro-per-manad" }]]);
    expect(of(b.savedReportId)).toEqual([["saved_report.created", { visibility: "mb", template: null }], ["saved_report.shared", { sharingFrom: null, sharingTo: "mb" }]]);
    expect(of(c.savedReportId)).toEqual([["saved_report.created", { visibility: "mb", template: null }], ["saved_report.shared", { sharingFrom: null, sharingTo: "mb" }]]);
    expect(row("saved_reports", b.savedReportId)).toMatchObject({ ownerId: "u-sara", sharedBy: "u-sara", sharedAt: expect.stringMatching(/^2027-02-01T09:/) });
  });

  it("namnet kontrolleras på servern: personnummer, ärendenummer och formeltecken", async () => {
    const def = asDef(tpl("narvaro-per-manad"));
    expect(await run(savedReportSave, { contractId: "c-bot", title: "123456-7890", definition: def }, sara())).toMatchObject({ ok: false, error: "title", message: "Det ser ut som ett personnummer. Skriv inga namn, personnummer eller ärendenummer." });
    expect(await run(savedReportSave, { contractId: "c-bot", title: "Om bot-26-0143", definition: def }, sara())).toMatchObject({ ok: false, error: "title" });
    expect(await run(savedReportSave, { contractId: "c-bot", title: "=SUMMA(A1)", definition: def }, sara())).toMatchObject({ ok: false, error: "title" });
    expect(await run(savedReportSave, { contractId: "c-bot", title: "Bra namn", definition: { ...def, extra: 1 } }, sara())).toMatchObject({ ok: false, error: "definition" });
  });

  it("delning: bara ägaren ändrar delningen; avtalsansvarig gör aldrig någon annans rapport privat men arkiverar den; ingen ändrar någon annans innehåll", async () => {
    const def = asDef(tpl("narvaro-per-manad"));
    const s = await run(savedReportSave, { contractId: "c-bot", title: "Saras rapport", definition: def, visibility: "mb" }, sara());
    if (!s.ok) throw new Error("inte sparad");
    expect(await run(savedReportShare, { savedReportId: s.savedReportId, visibility: "private" }, johan())).toMatchObject({ ok: false, error: "forbidden" });
    expect(await run(savedReportShare, { savedReportId: s.savedReportId, visibility: "private" }, karin())).toMatchObject({ ok: false, error: "forbidden" });
    // Avtalsansvarig (inte ägaren) ändrar inte innehållet – bara arkiveringen (tillägg 2026-10-02).
    expect(await run(savedReportSave, { contractId: "c-bot", savedReportId: s.savedReportId, title: "Ändrad", definition: def }, johan())).toMatchObject({ ok: false, error: "forbidden" });
    expect(await run(savedReportSave, { contractId: "c-bot", savedReportId: s.savedReportId, title: "Ändrad", definition: def }, karin())).toMatchObject({ ok: false, error: "forbidden" });
    const d = await ask(savedReport, { savedReportId: s.savedReportId }, johan());
    expect(d).toMatchObject({ found: true, isOwner: false, canEdit: false, canChangeSharing: false, canArchive: true, lockedText: "Bara den som skapade rapporten kan ändra innehållet. Du kan dela, sluta dela eller arkivera den." });
    expect(d).not.toHaveProperty("canShareCustomer");
    expect(await ask(savedReport, { savedReportId: s.savedReportId }, karin())).toMatchObject({ canEdit: false, canChangeSharing: false, canArchive: false });
    // Ägaren ändrar sin rapport och sin delning.
    expect(await run(savedReportSave, { contractId: "c-bot", savedReportId: s.savedReportId, title: "Ändrad", definition: def }, sara())).toEqual({ ok: true, savedReportId: s.savedReportId });
    expect(await run(savedReportShare, { savedReportId: s.savedReportId, visibility: "private" }, sara())).toEqual({ ok: true });
    expect(await ask(savedReport, { savedReportId: "sr-seed-privat" }, sara())).toMatchObject({ isOwner: true, canEdit: true, canChangeSharing: true, canArchive: true, lockedText: null });
  });

  it("kommunen har inga delade rapporter: navCounts för handläggaren och listorna utan kommunens del", async () => {
    expect(await ask(navCounts, {}, maria())).not.toHaveProperty("sharedReports");
    expect(await ask(savedReportList, {}, johan())).not.toHaveProperty("sharedCustomer");
    expect((await ask(savedReportList, {}, sara())).sharedMb.map((r) => r.id)).toContain("sr-seed-kommun");
  });

  it("tomma ändringar skriver inget och loggar inget; dela och sluta dela inom samma minut fungerar", async () => {
    const n = rows("audit_log").length;
    const before = JSON.stringify(row("saved_reports", "sr-seed-privat"));
    const r = row("saved_reports", "sr-seed-privat")!;
    expect(await run(savedReportSave, { contractId: "c-bot", savedReportId: r.id, title: r.title, definition: r.definition }, sara())).toEqual({ ok: true, savedReportId: r.id });
    // Samma definition med nycklarna i en annan ordning är oförändrad.
    const reordered = Object.fromEntries(Object.entries(r.definition).reverse());
    expect(await run(savedReportSave, { contractId: "c-bot", savedReportId: r.id, title: r.title, definition: reordered }, sara())).toEqual({ ok: true, savedReportId: r.id });
    expect(await run(savedReportShare, { savedReportId: r.id, visibility: "private" }, sara())).toEqual({ ok: true });
    expect(rows("audit_log").length).toBe(n);
    expect(JSON.stringify(row("saved_reports", "sr-seed-privat"))).toBe(before);
    // Samma minut: minnesläget flyttar annars klockan en minut per kommando (före kommandot – alla tre körs 10.01).
    rt.clock.set("2027-02-01T10:00");
    expect(await run(savedReportShare, { savedReportId: r.id, visibility: "mb" }, sara())).toEqual({ ok: true });
    rt.clock.set("2027-02-01T10:00");
    expect(await run(savedReportShare, { savedReportId: r.id, visibility: "private" }, sara())).toEqual({ ok: true });
    rt.clock.set("2027-02-01T10:00");
    expect(await run(savedReportShare, { savedReportId: r.id, visibility: "mb" }, sara())).toEqual({ ok: true });
    expect(row("saved_reports", r.id)).toMatchObject({ visibility: "mb", sharedAt: "2027-02-01T10:01", sharedBy: "u-sara" });
    expect(logs("saved_report.shared").map((l) => l.occurredAt)).toEqual(["2027-02-01T10:01", "2027-02-01T10:01", "2027-02-01T10:01"]);
    expect(logs("saved_report.shared").map((l) => l.details)).toEqual([{ sharingFrom: "private", sharingTo: "mb" }, { sharingFrom: "mb", sharingTo: "private" }, { sharingFrom: "private", sharingTo: "mb" }]);
  });

  it("arkiverad: inte i listorna, not_found vid hämtning, arkiveras i eget namn", async () => {
    expect(await run(savedReportArchive, { savedReportId: "sr-seed-kommun" }, sara())).toMatchObject({ ok: false, error: "forbidden" });
    expect(await run(savedReportArchive, { savedReportId: "sr-seed-kommun" }, johan())).toEqual({ ok: true });
    expect(row("saved_reports", "sr-seed-kommun")).toMatchObject({ archivedBy: "u-johan" });
    expect(logs("saved_report.archived")).toHaveLength(1);
    const lists = await ask(savedReportList, {}, johan());
    expect([...lists.mine, ...lists.sharedMb].map((r) => r.id)).not.toContain("sr-seed-kommun");
    expect(await exportFile(johan(), { savedReportId: "sr-seed-kommun", format: "csv" })).toMatchObject({ ok: false, error: "not_found" });
    expect(await ask(savedReport, { savedReportId: "sr-seed-kommun" }, johan())).toMatchObject({ found: true, archived: true, canEdit: false, canArchive: false });
  });

});

// ================================================================ Revisionsloggen
describe("revisionsloggen", () => {
  const SECRET = /BOT-\d|\d{6}-\d{4}|Progression per avtalsområde|Resultatgrad per avtalsområde|Närvaro per månad/;
  it("exakt en export.saved_report per hämtning (före svaret) – utan namn, ärendenummer, personnummer eller titlar", async () => {
    const names = participantNames();
    await exportFile(sara(), { savedReportId: "sr-seed-privat", format: "csv" });
    await exportFile(sara(), { savedReportId: "sr-seed-privat", format: "xlsx" });
    await exportFile(sara(), { definition: fixed(tpl("resultatgrad-per-omrade")), format: "pdf" });
    await exportFile(sara(), { definition: listDef("deltagarmanader", ["resultat.arendenummer", "resultat.namn"]), format: "csv" });
    const ex = logs("export.saved_report");
    expect(ex.map((l) => [l.entity, l.details.savedReportId, l.details.format, l.details.audience, l.details.output])).toEqual([
      ["saved_report", "sr-seed-privat", "csv", "mb", "sammanstallning"], ["saved_report", "sr-seed-privat", "xlsx", "mb", "sammanstallning"],
      ["contract", null, "pdf", "mb", "sammanstallning"], ["contract", null, "csv", "mb", "lista"],
    ]);
    expect(ex[0].details).toMatchObject({ template: "narvaro-per-manad", dataset: "deltagarmanader", schema: 2, measures: ["deltagarmanader", "narvarograd"], groupBy: null, split: "manad" });
    expect(ex[3].details).toMatchObject({ columns: ["resultat.arendenummer", "resultat.namn"] });
    expect(ex[3].details.measures).toBeUndefined();
    const json = JSON.stringify(ex);
    expect(json).not.toMatch(SECRET);
    expect(json).not.toMatch(names);
    expect(looksLikePnr(json)).toBe(false);
  });

  it("kastar loggningen: ingen fil och ingen PDF-modell", async () => {
    const actor = sara();
    const ctx: Ctx = {
      actor, now: () => DEMO_START, repo: new MemoryRepo<Tables>(rt.store, actor, POLICIES) as unknown as AppRepo,
      system: new MemoryRepo<Tables>(rt.store, SYSTEM_ACTOR, POLICIES, { bypass: true }) as unknown as AppRepo,
      newId: (p) => `${p}-x`, audit: async () => { throw new Error("loggen är nere"); }, notify: async () => undefined, crypto: TEST_PNR_CRYPTO,
    };
    for (const format of ["csv", "xlsx", "pdf"] as const) {
      await expect(execute("command", builderExport.key, { savedReportId: "sr-seed-privat", format }, ctx)).rejects.toThrow("loggen är nere");
    }
  });

  it("column_missing och too_large: saved_report.export_blocked och ingen fil; revisionsloggen räknar inte stopp som exporter", async () => {
    const areas = requireOperational(row("contracts", "c-bot")!.config).progression.areas;
    const def = listDef("deltagarmanader", ["resultat.arendenummer", `resultat.niva_${areas[0]}`]);
    const s = await run(savedReportSave, { contractId: "c-bot", title: "Nivåer", definition: asDef(def) }, sara());
    if (!s.ok) throw new Error("inte sparad");
    setConfig("c-bot", (c) => { c.progression!.areas = areas.slice(1); c.progression!.optionalAreas = [...c.progression!.optionalAreas, areas[0]]; });
    expect(await exportFile(sara(), { savedReportId: s.savedReportId, format: "csv" })).toMatchObject({ ok: false, error: "column_missing", message: `Kolumnen resultat.niva_${areas[0]} finns inte längre. Ändra rapporten.` });
    LIMITS.chars = 100;
    expect(await exportFile(sara(), { savedReportId: "sr-seed-privat", format: "xlsx" })).toMatchObject({ ok: false, error: "too_large", message: "Filen blir för stor. Välj en kortare period eller färre kolumner." });
    const blocked = logs("saved_report.export_blocked");
    expect(blocked.map((l) => [l.entity, l.entityId, l.details])).toEqual([
      ["saved_report", s.savedReportId, { savedReportId: s.savedReportId, reason: "column_missing", column: `resultat.niva_${areas[0]}` }],
      ["saved_report", "sr-seed-privat", { savedReportId: "sr-seed-privat", reason: "too_large" }],
    ]);
    expect(logs("export.saved_report")).toEqual([]);
    // Stopp räknas inte som export i revisionsloggen (också steg 3:s export.results_blocked).
    rt.store.insertRow("audit_log", { ...blocked[0], id: "log-x-blocked", action: "export.results_blocked" });
    const log = await ask(adminAuditLog, {}, as("u-robin", "admin"));
    expect(log.exports).toBe(log.rows.filter((r) => r.action.startsWith("export.") && !r.action.endsWith("_blocked")).length);
    expect(log.rows.some((r) => r.action === "saved_report.export_blocked")).toBe(true);
  });

  it("reportIds för datamängden avslut innehåller de kopplade månadsrapporterna (också före perioden)", async () => {
    const def = fixed(tpl("resultatgrad-per-omrade"), "2026-12", "2026-12");
    await exportFile(sara(), { definition: def, format: "csv" });
    const ids = logs("export.saved_report")[0].details.reportIds as string[];
    const reps = ids.map((id) => row("reports", id)!);
    expect(reps.some((r) => r.kind === "final")).toBe(true);
    expect(reps.some((r) => r.kind === "monthly" && r.month! < "2026-12")).toBe(true);
  });
});

// ================================================================ Förhandsvisningen: frysning, visning och läsningar
describe("förhandsvisningen", () => {
  it("skriver bara frysningen och – med en sparad rapport – exakt en saved_report.viewed; ett utkast loggar inget", async () => {
    expect(rows("reports").some((r) => r.snapshot)).toBe(false);
    const n = rows("audit_log").length;
    expect((await preview(sara(), { definition: fixed(tpl("narvaro-per-manad")) })).ok).toBe(true);
    expect(rows("audit_log").length).toBe(n);
    expect(rows("reports").filter((r) => r.snapshot).length).toBeGreaterThan(200);
    const frozen = JSON.stringify(rows("reports"));
    expect((await preview(sara(), { savedReportId: "sr-seed-privat" })).ok).toBe(true);
    expect((await preview(sara(), { savedReportId: "sr-seed-privat" })).ok).toBe(true);
    // Alltid Miljonbemannings läge (växeln "Visa som kommunens chef ser den" är borttagen).
    expect(logs("saved_report.viewed").map((l) => [l.entityId, l.details])).toEqual([["sr-seed-privat", { audience: "mb" }], ["sr-seed-privat", { audience: "mb" }]]);
    expect(JSON.stringify(rows("reports"))).toBe(frozen);
  });

  it("när allt är fryst läses rapporterna bara med pick/pickJson – högst urvalets rapporter och joinMonthly", async () => {
    const def = fixed(tpl("resultatgrad-per-omrade"));
    expect((await preview(sara(), { definition: def })).ok).toBe(true); // fryser
    const actor = sara();
    const calls: { op: string; n: number }[] = [];
    const repo = new MemoryRepo<Tables>(rt.store, actor, POLICIES) as unknown as AppRepo;
    const watched = {
      table: ((name: TableName) => {
        const t = repo.table(name as never) as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>;
        if (name !== "reports") return t;
        const spy = (op: string) => async (...a: unknown[]) => {
          const res = await t[op](...a);
          calls.push({ op, n: Array.isArray(res) ? res.length : res ? 1 : 0 });
          return res;
        };
        return { ...t, list: spy("list"), get: spy("get"), pick: spy("pick"), pickJson: spy("pickJson"), update: spy("update") };
      }) as unknown as AppRepo["table"],
    } as AppRepo;
    let seq = 0;
    const ctx: Ctx = {
      actor, now: () => DEMO_START, repo: watched, system: new MemoryRepo<Tables>(rt.store, SYSTEM_ACTOR, POLICIES, { bypass: true }) as unknown as AppRepo,
      newId: (p) => `${p}-x${++seq}`, audit: async () => undefined, notify: async () => undefined, crypto: TEST_PNR_CRYPTO,
    };
    const before = JSON.stringify(rows("reports"));
    const v = (await execute("command", builderPreview.key, { contractId: "c-bot", definition: asDef(def) }, ctx)) as BuilderView & { ok: boolean };
    expect(v.ok).toBe(true);
    await execute("command", builderExport.key, { contractId: "c-bot", definition: asDef(def), format: "xlsx" }, ctx);
    expect(calls.filter((c) => c.op === "list" || c.op === "get" || c.op === "update")).toEqual([]);
    const facts = calls.filter((c) => c.op === "pickJson");
    expect(facts).toHaveLength(2);
    const finals = rows("reports").filter((r) => r.kind === "final" && (r.status === "delivered" || r.status === "opened") && !r.superseded && r.periodEnd! >= "2026-09-01" && r.periodEnd! <= "2027-01-31");
    const monthly = rows("reports").filter((r) => r.kind === "monthly" && (r.status === "delivered" || r.status === "opened") && !r.superseded && r.month! >= "2026-09" && r.month! <= "2027-01");
    for (const f of facts) expect(f.n).toBeLessThanOrEqual(finals.length + monthly.length + finals.length);
    expect(JSON.stringify(rows("reports"))).toBe(before);
  });
});

// ================================================================ Paritet med steg 3 och KPI:n
describe("paritet", () => {
  it("u-sara och u-johan: Deltagare och Deltagarmånader = resultatfilens förhandsvisning för hela avtalet", async () => {
    const def: ReportDefinition = { ...fixed(tpl("narvaro-per-manad"), "2026-10", "2026-12"), split: "inget", measures: ["deltagarmanader"], chart: null };
    const pre = await ask(contractResultPreview, { from: "2026-10", to: "2026-12" }, johan());
    expect(pre.reports).toBeGreaterThan(0);
    for (const a of [sara(), johan()]) {
      const m = view(await preview(a, { definition: def }));
      expect(m.table!.total, a.userId).toMatchObject({ cases: pre.participants, cells: [pre.reports] });
    }
  });

  it("resultatgraden på frysta fakta = resultRate på samma ärenden (utan skyddade), också med ett avslut utan resultatklass", async () => {
    // Inga verifieringar efter leveransen (sätt a gör att filen visar slutrapportens läge) och ett avslut utan resultatklass.
    const finals = rows("reports").filter((r) => r.kind === "final" && r.deliveredAt && !r.superseded);
    for (const f of finals) {
      const c = row("cases", f.caseId!)!;
      if (c.resultVerifiedAt && c.resultVerifiedAt > f.deliveredAt!) rt.store.updateRow("cases", c.id, { resultVerifiedAt: null });
    }
    protect();
    const noClass = finals.map((f) => row("cases", f.caseId!)!).find((c) => c.id !== PROT_CASE && c.resultClass === "no_result" && c.endDate! >= "2026-10-01" && c.endDate! <= "2026-12-31")!;
    rt.store.updateRow("cases", noClass.id, { resultClass: null });
    const def: ReportDefinition = { ...fixed(tpl("resultatgrad-per-omrade"), "2026-10", "2026-12"), groupBy: null };
    const v = view(await preview(sara(), { definition: def }));
    const csv = csvRows(csvOf(await exportFile(sara(), { definition: listDef("avslut", ["avslut.arendenummer"], { period: { kind: "fast", from: "2026-10", to: "2026-12" } }), format: "csv" })));
    const ids = new Set(csv.map((r) => caseByNo(r.arendenummer).id));
    expect(ids.has(noClass.id)).toBe(true);
    expect(ids.has(PROT_CASE)).toBe(false);
    const cfg = requireOperational(row("contracts", "c-bot")!.config);
    const rr = resultRate({ cases: rows("cases").filter((c) => ids.has(c.id)) }, { from: "2026-10-01", to: "2026-12-31" }, { cfg, now: "2027-02-01T09:12", contractStart: "2026-09-10" });
    const [counted, verified, , rate] = v.table!.total.cells;
    expect({ counted, verified, rate }).toEqual({ counted: rr.den, verified: rr.num, rate: rr.value });
    expect(v.notes).toContain("1 avslut saknar uppgift om resultat och räknas som avslut utan resultat.");
  });

  it("förhandsvisningen och exporten ger samma tabell – frysta av förhandsvisningen och redan frysta", async () => {
    const def = fixed(tpl("progression-per-omrade"), "2026-11", "2027-01");
    const table = (v: BuilderView) => [...v.table!.rows, v.table!.total].map((r) => [r.group ?? "Totalt", r.cases, ...r.cells.map((c) => (c == null ? "" : (Math.round(c * 1000) / 10).toFixed(1).replace(".", ",")))]);
    const fromCsv = (csv: string) => csvRows(csv).map((r) => [r.grupp, Number(r.deltagare), r.tydlig_progression_procent, r.nagon_progression_procent]);
    const a = view(await preview(sara(), { definition: def }));
    expect(fromCsv(csvOf(await exportFile(sara(), { definition: def, format: "csv" })))).toEqual(table(a));
    // Ny körning där exporten fryser först.
    rt = createMemoryRuntime({ data: structuredClone(SEED), clock: demoClock(DEMO_START) });
    const csv = csvOf(await exportFile(sara(), { definition: def, format: "csv" }));
    const b = view(await preview(sara(), { definition: def }));
    expect(fromCsv(csv)).toEqual(table(b));
    expect(table(b)).toEqual(table(a));
  });
});

// ================================================================ Filerna: mål och regler
describe("rapportbyggarens filer", () => {
  it("Miljonbemannings fil har avtalets mål och det interna målet", async () => {
    const mb = await exportFile(johan(), { savedReportId: "sr-seed-kommun", format: "xlsx" });
    if (!mb.ok || !("content" in mb)) throw new Error("ingen fil");
    expect(mb.filename).toBe("rapport_bot_resultatgrad-per-omrade_2026-09_2027-01.xlsx");
    const all = [1, 2].map(async (n) => entryText(await readZip(base64ToBytes(mb.content)), `xl/worksheets/sheet${n}.xml`));
    const text = (await Promise.all(all)).join("");
    expect(text).toContain("Avtalets mål");
    expect(text).toContain("Internt mål");
  });

  it("en lista med resultatkolumner har resultatets regler i Excel – samma texter som resultatfilen", async () => {
    const def = listDef("avslut", ["avslut.arendenummer", "avslut.manad", "avslut.avslut_datum", "avslut.avslutsorsak", "avslut.resultat", "avslut.resultat_verifierat"], { period: { kind: "fast", from: "2026-10", to: "2026-12" } });
    const x = await exportFile(johan(), { definition: def, format: "xlsx" });
    if (!x.ok || !("content" in x)) throw new Error("ingen fil");
    const about = entryText(await readZip(base64ToBytes(x.content)), "xl/worksheets/sheet2.xml");
    for (const t of ["Resultatdefinitionen är inte fastställd", "preliminärt", "resultat_verifierat = 1", "Tom cell betyder"]) expect(about).toContain(t);
    expect(about).not.toMatch(/skyddade personuppgifter/i);
  });

  it("too_many_groups och en definition som inte klarar zod", async () => {
    LIMITS.groups = 2;
    expect(await preview(johan(), { savedReportId: "sr-seed-kommun" })).toMatchObject({ ok: false, error: "too_many_groups" });
    LIMITS.groups = MAX_GROUPS;
    rt.store.updateRow("saved_reports", "sr-seed-kommun", { definition: { v: 1, dataset: "okand" } } as Partial<SavedReport>);
    expect(await ask(savedReport, { savedReportId: "sr-seed-kommun" }, johan())).toMatchObject({ found: true, definitionError: expect.any(String) });
  });
});
