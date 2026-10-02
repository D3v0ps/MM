// Rapportbyggaren (rapporter steg 4, Del D): Miljonbemannings hanterare och kommunens delade rapporter – behörigheten, skyddade
// ärenden, delningen, revisionsloggen, frysningen och pariteten med steg 3 och KPI:n. Körs genom execute() mot testdatat i
// minnet som testpersonerna i rollväljaren (behörighet via policy.ts).
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
import { resultExport, resultExportPreview, sharedReport, sharedReportExport, sharedReports } from "@/features/kommun/api";
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
const eva = () => as("k-eva", "kommun_chef");
/** Testaktör: kommunens chef för en underenhet (Alby) – samma som i steg 3:s tester. */
const albyChef = (): Actor => ({ userId: "k-chef-alby", role: "kommun_chef", contractIds: ["c-bot"], customerUnit: "Arbetsmarknadsenheten Alby" });
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
const preview = (actor: Actor, p: { definition?: ReportDefinition; savedReportId?: string; audience?: "mb" | "kommun"; contractId?: string }) =>
  run(builderPreview, { audience: p.audience ?? "mb", ...(p.definition ? { definition: asDef(p.definition), contractId: p.contractId ?? "c-bot" } : {}), ...(p.savedReportId ? { savedReportId: p.savedReportId, ...(p.contractId ? { contractId: p.contractId } : {}) } : {}) }, actor);
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
const unitOf = (caseId: string) => {
  const c = row("cases", caseId)!;
  return (c.referrerId ? row("profiles", c.referrerId)?.customerUnit : null) ?? c.referrerUnit;
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
  it("coach, handledare, ekonom, admin och kommunens handläggare nekas MB:s nycklar; MB-roller nekas kommunens", async () => {
    const def = asDef(tpl("narvaro-per-manad"));
    for (const a of [as("u-amira", "coach"), as("u-petra", "handledare"), as("u-lars", "ekonom"), as("u-robin", "admin"), as("k-maria", "kommun_handlaggare"), eva()]) {
      await expect(ask(builderCatalog, {}, a), a.role).rejects.toBeInstanceOf(ApiError);
      await expect(run(builderPreview, { contractId: "c-bot", definition: def, audience: "mb" }, a), a.role).rejects.toBeInstanceOf(ApiError);
      await expect(run(builderExport, { contractId: "c-bot", definition: def, format: "csv" }, a), a.role).rejects.toBeInstanceOf(ApiError);
      await expect(ask(savedReportList, {}, a), a.role).rejects.toBeInstanceOf(ApiError);
      await expect(ask(savedReport, { savedReportId: "sr-seed-mb" }, a), a.role).rejects.toBeInstanceOf(ApiError);
      await expect(run(savedReportSave, { contractId: "c-bot", title: "Rapport", definition: def }, a), a.role).rejects.toBeInstanceOf(ApiError);
      await expect(run(savedReportShare, { savedReportId: "sr-seed-mb", visibility: "mb" }, a), a.role).rejects.toBeInstanceOf(ApiError);
      await expect(run(savedReportArchive, { savedReportId: "sr-seed-mb" }, a), a.role).rejects.toBeInstanceOf(ApiError);
      await expect(ask(contractResultPreview, {}, a), a.role).rejects.toBeInstanceOf(ApiError);
      await expect(run(contractResultExport, { contractId: "c-bot", from: "2026-10", to: "2026-12", format: "xlsx" }, a), a.role).rejects.toBeInstanceOf(ApiError);
    }
    for (const a of [sara(), johan(), karin()]) {
      await expect(ask(sharedReports, {}, a)).rejects.toBeInstanceOf(ApiError);
      await expect(run(sharedReport, { savedReportId: "sr-seed-kommun" }, a)).rejects.toBeInstanceOf(ApiError);
      await expect(run(sharedReportExport, { savedReportId: "sr-seed-kommun", format: "csv" }, a)).rejects.toBeInstanceOf(ApiError);
    }
  });
  it("templateKey är en nyckel i koden – aldrig fri text (zod)", async () => {
    await expect(run(savedReportSave, { contractId: "c-bot", title: "Rapport", definition: asDef(tpl("narvaro-per-manad")), templateKey: "anna-andersson" as never }, sara())).rejects.toBeInstanceOf(ApiError);
    // Exakt en av savedReportId och definition – och contractId krävs med definition.
    await expect(run(builderPreview, { definition: asDef(tpl("narvaro-per-manad")), audience: "mb" }, sara())).rejects.toBeInstanceOf(ApiError);
    await expect(run(builderPreview, { savedReportId: "sr-seed-mb", contractId: "c-bot", definition: asDef(tpl("narvaro-per-manad")), audience: "mb" }, sara())).rejects.toBeInstanceOf(ApiError);
  });
  it("katalogen: bara avtal i drift, mallarna, datamängderna och delningen", async () => {
    const c = await ask(builderCatalog, {}, johan());
    expect(c.contracts.map((x) => x.id)).toEqual(["c-bot"]);
    expect(c.templates.map((t) => t.key)).toEqual(TEMPLATES.map((t) => t.key));
    expect(c).toMatchObject({ contractId: "c-bot", maxMonths: 12, minN: 5, canShareWithCustomer: true, customerSharingAllowed: true });
    expect((await ask(builderCatalog, {}, sara())).canShareWithCustomer).toBe(false);
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
describe("skyddade ärenden kommer aldrig med – inte heller för avtalsansvarig (full åtkomst)", () => {
  it("listor och sammanställningar för u-johan", async () => {
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
    expect(v.rules[0]).toBe("Ärenden med skyddade personuppgifter ingår inte. Ledningsvyn räknar med dem.");
  });

  it("inga ärendenummer eller namn i svaren – alla mallar, båda lägena, sparade rapporter, listorna och kommunens svar", async () => {
    const names = participantNames();
    for (const t of TEMPLATES) {
      for (const audience of ["mb", "kommun"] as const) {
        const r = await preview(sara(), { definition: fixed(t.definition), audience });
        expect(r.ok, `${t.key} ${audience}`).toBe(true);
        noPersonalData(JSON.stringify(r), names);
      }
    }
    for (const id of ["sr-seed-privat", "sr-seed-mb", "sr-seed-kommun"]) {
      noPersonalData(JSON.stringify(await preview(sara(), { savedReportId: id })), names);
      noPersonalData(JSON.stringify(await ask(savedReport, { savedReportId: id }, sara())), names);
    }
    noPersonalData(JSON.stringify(await ask(savedReportList, {}, sara())), names);
    noPersonalData(JSON.stringify(await ask(sharedReports, {}, eva())), names);
    noPersonalData(JSON.stringify(await run(sharedReport, { savedReportId: "sr-seed-kommun" }, eva())), names);
    // Kommunen: också en delad lista (bara antal och kolumnnamn).
    const saved = await run(savedReportSave, { contractId: "c-bot", title: "Deltagarlista", definition: asDef(listDef("deltagarmanader", ["resultat.arendenummer", "resultat.namn"])), visibility: "customer" }, johan());
    if (!saved.ok) throw new Error("inte sparad");
    noPersonalData(JSON.stringify(await run(sharedReport, { savedReportId: saved.savedReportId }, eva())), names);
  }, 60_000);
});

// ================================================================ Avtalet följer den sparade rapporten
describe("avtalet följer den sparade rapporten", () => {
  it("ett annat contractId än rapportens ger not_found; utan contractId används rapportens avtal", async () => {
    expect(await exportFile(johan(), { savedReportId: "sr-seed-kommun", contractId: "c-kk", format: "csv" })).toMatchObject({ ok: false, error: "not_found" });
    expect(await preview(johan(), { savedReportId: "sr-seed-kommun", contractId: "c-kk" })).toMatchObject({ ok: false, error: "not_found" });
    const ok = await exportFile(johan(), { savedReportId: "sr-seed-kommun", format: "csv" });
    expect(ok).toMatchObject({ ok: true, filename: "rapport_bot_resultatgrad-per-omrade_2026-09_2027-01.csv" });
  });
});

// ================================================================ Spara och dela
describe("spara, dela och arkivera", () => {
  it("delning vid skapandet: mb/customer ger created och shared (sharingFrom: null) – en privat rad bara created", async () => {
    const def = asDef(tpl("narvaro-per-manad"));
    const a = await run(savedReportSave, { contractId: "c-bot", title: "Privat", definition: def, templateKey: "narvaro-per-manad" }, sara());
    const b = await run(savedReportSave, { contractId: "c-bot", title: "Inom MB", definition: def, visibility: "mb" }, sara());
    const c = await run(savedReportSave, { contractId: "c-bot", title: "Till kommunen", definition: def, visibility: "customer" }, johan());
    if (!a.ok || !b.ok || !c.ok) throw new Error("inte sparad");
    const of = (id: string) => rows("audit_log").filter((l) => l.entityId === id).map((l) => [l.action, l.details]);
    expect(of(a.savedReportId)).toEqual([["saved_report.created", { visibility: "private", template: "narvaro-per-manad" }]]);
    expect(of(b.savedReportId)).toEqual([["saved_report.created", { visibility: "mb", template: null }], ["saved_report.shared", { sharingFrom: null, sharingTo: "mb" }]]);
    expect(of(c.savedReportId)).toEqual([["saved_report.created", { visibility: "customer", template: null }], ["saved_report.shared", { sharingFrom: null, sharingTo: "customer" }]]);
    expect(row("saved_reports", b.savedReportId)).toMatchObject({ ownerId: "u-sara", sharedBy: "u-sara", sharedAt: expect.stringMatching(/^2027-02-01T09:/) });
    // Samordnaren delar aldrig med kommunen.
    expect(await run(savedReportSave, { contractId: "c-bot", title: "Nej", definition: def, visibility: "customer" }, sara())).toMatchObject({ ok: false, error: "forbidden", message: "Bara avtalsansvarig kan dela med kommunen." });
  });

  it("namnet kontrolleras på servern: personnummer, ärendenummer och formeltecken", async () => {
    const def = asDef(tpl("narvaro-per-manad"));
    expect(await run(savedReportSave, { contractId: "c-bot", title: "123456-7890", definition: def }, sara())).toMatchObject({ ok: false, error: "title", message: "Det ser ut som ett personnummer. Skriv inga namn, personnummer eller ärendenummer." });
    expect(await run(savedReportSave, { contractId: "c-bot", title: "Om bot-26-0143", definition: def }, sara())).toMatchObject({ ok: false, error: "title" });
    expect(await run(savedReportSave, { contractId: "c-bot", title: "=SUMMA(A1)", definition: def }, sara())).toMatchObject({ ok: false, error: "title" });
    expect(await run(savedReportSave, { contractId: "c-bot", title: "Bra namn", definition: { ...def, extra: 1 } }, sara())).toMatchObject({ ok: false, error: "definition" });
  });

  it("delning: samordnaren kan inte dela med kommunen; avtalsansvarig kan; ägaren kan sedan inte ändra; aldrig privat av avtalsansvarig", async () => {
    const def = asDef(tpl("narvaro-per-manad"));
    const s = await run(savedReportSave, { contractId: "c-bot", title: "Saras rapport", definition: def, visibility: "mb" }, sara());
    if (!s.ok) throw new Error("inte sparad");
    expect(await run(savedReportShare, { savedReportId: s.savedReportId, visibility: "customer" }, sara())).toMatchObject({ ok: false, error: "not_allowed", message: "Bara avtalsansvarig kan dela med kommunen." });
    expect(await run(savedReportShare, { savedReportId: s.savedReportId, visibility: "private" }, johan())).toMatchObject({ ok: false, error: "forbidden" });
    expect(await run(savedReportShare, { savedReportId: s.savedReportId, visibility: "customer" }, johan())).toEqual({ ok: true });
    // Ägaren (samordnaren) hänvisas till avtalsansvarig för att sluta dela – avtalsansvarig kan inte ändra innehållet (tillägg 2026-10-02).
    expect(await run(savedReportSave, { contractId: "c-bot", savedReportId: s.savedReportId, title: "Ändrad", definition: def }, sara())).toMatchObject({ ok: false, error: "customer_shared", message: "Rapporten är delad med kommunen. Be avtalsansvarig sluta dela den om du vill ändra den, eller gör en kopia." });
    expect(await run(savedReportSave, { contractId: "c-bot", savedReportId: s.savedReportId, title: "Ändrad", definition: def }, karin())).toMatchObject({ ok: false, error: "customer_shared", message: "Rapporten är delad med kommunen. Gör en kopia om du vill ändra något." });
    // Avtalsansvarig (inte ägaren) ändrar inte innehållet – bara delningen och arkiveringen (tillägg 2026-10-02).
    expect(await run(savedReportSave, { contractId: "c-bot", savedReportId: s.savedReportId, title: "Ändrad", definition: def }, johan())).toMatchObject({ ok: false, error: "forbidden" });
    const d = await ask(savedReport, { savedReportId: s.savedReportId }, johan());
    expect(d).toMatchObject({ found: true, isOwner: false, canEdit: false, canShareCustomer: true, canArchive: true, lockedText: "Bara den som skapade rapporten kan ändra innehållet. Du kan dela, sluta dela eller arkivera den." });
    expect(await ask(savedReport, { savedReportId: s.savedReportId }, sara())).toMatchObject({ canEdit: false, canChangeSharing: false, canArchive: false, lockedText: "Rapporten är delad med kommunen. Be avtalsansvarig sluta dela den om du vill ändra den, eller gör en kopia." });
    expect(await ask(savedReport, { savedReportId: s.savedReportId }, karin())).toMatchObject({ canEdit: false, canArchive: false, lockedText: "Rapporten är delad med kommunen. Gör en kopia om du vill ändra något." });
    // Vägen enligt tillägget: avtalsansvarig slutar dela, ägaren ändrar, avtalsansvarig delar igen.
    expect(await run(savedReportShare, { savedReportId: s.savedReportId, visibility: "mb" }, johan())).toEqual({ ok: true });
    expect(await run(savedReportSave, { contractId: "c-bot", savedReportId: s.savedReportId, title: "Ändrad", definition: def }, sara())).toEqual({ ok: true, savedReportId: s.savedReportId });
    expect(await run(savedReportShare, { savedReportId: s.savedReportId, visibility: "customer" }, johan())).toEqual({ ok: true });
    expect(await ask(savedReport, { savedReportId: "sr-seed-privat" }, sara())).toMatchObject({ isOwner: true, canEdit: true, canChangeSharing: true, canArchive: true, lockedText: null });
  });

  it("sluta dela: kommunens lista blir tom och navCounts.sharedReports 0 – rapporten finns kvar inom Miljonbemanning", async () => {
    expect((await ask(navCounts, {}, eva())).sharedReports).toBe(1);
    expect((await ask(sharedReports, {}, eva())).reports.map((r) => r.id)).toEqual(["sr-seed-kommun"]);
    expect(await run(savedReportShare, { savedReportId: "sr-seed-kommun", visibility: "mb" }, johan())).toEqual({ ok: true });
    expect(await ask(sharedReports, {}, eva())).toEqual({ allowed: true, reports: [] });
    expect((await ask(navCounts, {}, eva())).sharedReports).toBe(0);
    expect((await ask(savedReportList, {}, sara())).sharedMb.map((r) => r.id)).toContain("sr-seed-kommun");
    expect(await run(sharedReportExport, { savedReportId: "sr-seed-kommun", format: "csv" }, eva())).toMatchObject({ ok: false, error: "not_found", message: "Rapporten finns inte längre. Miljonbemanning kan ha slutat dela den." });
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

  it("arkiverad: inte i listorna, not_found vid hämtning (MB och kommunen), arkiveras i eget namn", async () => {
    expect(await run(savedReportArchive, { savedReportId: "sr-seed-kommun" }, sara())).toMatchObject({ ok: false, error: "forbidden" });
    expect(await run(savedReportArchive, { savedReportId: "sr-seed-kommun" }, johan())).toEqual({ ok: true });
    expect(row("saved_reports", "sr-seed-kommun")).toMatchObject({ archivedBy: "u-johan" });
    expect(logs("saved_report.archived")).toHaveLength(1);
    expect((await ask(savedReportList, {}, johan())).sharedCustomer).toEqual([]);
    expect(await exportFile(johan(), { savedReportId: "sr-seed-kommun", format: "csv" })).toMatchObject({ ok: false, error: "not_found" });
    expect(await run(sharedReportExport, { savedReportId: "sr-seed-kommun", format: "csv" }, eva())).toMatchObject({ ok: false, error: "not_found" });
    expect(await ask(savedReport, { savedReportId: "sr-seed-kommun" }, johan())).toMatchObject({ found: true, archived: true, canEdit: false, canArchive: false });
  });

  it("avtalet slutar tillåta delning med kommunen: en delad rapport kan bara sluta delas – ändra och arkivera kommer efter det (inga PolicyError)", async () => {
    // u-sara sparar, u-johan delar med kommunen (Saras rapport) – sedan slutar avtalet tillåta individrapporter.
    const def = asDef(tpl("narvaro-per-manad"));
    const s = await run(savedReportSave, { contractId: "c-bot", title: "Saras rapport", definition: def, visibility: "mb" }, sara());
    if (!s.ok) throw new Error("inte sparad");
    expect(await run(savedReportShare, { savedReportId: s.savedReportId, visibility: "customer" }, johan())).toEqual({ ok: true });
    setConfig("c-bot", (c) => { c.customerVisibility!.seesIndividualReports = false; });
    const ended = "Avtalet tillåter inte längre att rapporter delas med kommunen. Sluta dela rapporten med kommunen innan du arkiverar den.";
    const endedOwner = "Avtalet tillåter inte längre att rapporter delas med kommunen. Sluta dela rapporten med kommunen innan du ändrar eller arkiverar den.";
    expect(await ask(savedReport, { savedReportId: s.savedReportId }, johan())).toMatchObject({ sharingEnded: true, canEdit: false, canArchive: false, canShareCustomer: true, canChooseCustomer: false, lockedText: ended });
    expect(await run(savedReportArchive, { savedReportId: s.savedReportId }, johan())).toEqual({ ok: false, error: "forbidden", message: ended });
    // Avtalsansvarigs egen delade rapport: inte heller ändra eller arkivera – men ändra delningen och sluta dela går.
    expect(await ask(savedReport, { savedReportId: "sr-seed-kommun" }, johan())).toMatchObject({ isOwner: true, sharingEnded: true, canEdit: false, canChangeSharing: true, canArchive: false, canShareCustomer: true, lockedText: endedOwner });
    const own = row("saved_reports", "sr-seed-kommun")!;
    expect(await run(savedReportSave, { contractId: "c-bot", savedReportId: own.id, title: "Ändrad", definition: own.definition }, johan())).toEqual({ ok: false, error: "customer_shared", message: endedOwner });
    expect(await run(savedReportArchive, { savedReportId: own.id }, johan())).toEqual({ ok: false, error: "forbidden", message: endedOwner });
    // Sluta dela fungerar – sedan kan rapporten arkiveras (och ägaren ändra sin egen).
    expect(await run(savedReportShare, { savedReportId: s.savedReportId, visibility: "mb" }, johan())).toEqual({ ok: true });
    expect(await ask(savedReport, { savedReportId: s.savedReportId }, johan())).toMatchObject({ sharingEnded: false, canArchive: true, canShareCustomer: false });
    expect(await run(savedReportArchive, { savedReportId: s.savedReportId }, johan())).toEqual({ ok: true });
    expect(await run(savedReportShare, { savedReportId: own.id, visibility: "mb" }, johan())).toEqual({ ok: true });
    expect(await run(savedReportSave, { contractId: "c-bot", savedReportId: own.id, title: "Ändrad", definition: own.definition }, johan())).toEqual({ ok: true, savedReportId: own.id });
  });

  it("avtal utan individrapporter: kommunen ser inget och delning med kommunen nekas", async () => {
    setConfig("c-bot", (c) => { c.customerVisibility!.seesIndividualReports = false; });
    expect(await ask(sharedReports, {}, eva())).toEqual({ allowed: false, reports: [] });
    expect(await run(sharedReport, { savedReportId: "sr-seed-kommun" }, eva())).toMatchObject({ allowed: false, view: null });
    expect(await run(savedReportShare, { savedReportId: "sr-seed-mb", visibility: "customer" }, johan())).toMatchObject({ ok: false, error: "not_allowed", message: "Avtalet tillåter inte att rapporter delas med kommunen." });
    expect((await ask(navCounts, {}, eva()))).toMatchObject({ resultFile: false, sharedReports: 0 });
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
    await run(sharedReportExport, { savedReportId: "sr-seed-kommun", format: "xlsx" }, eva());
    const ex = logs("export.saved_report");
    expect(ex.map((l) => [l.entity, l.details.savedReportId, l.details.format, l.details.audience, l.details.output])).toEqual([
      ["saved_report", "sr-seed-privat", "csv", "mb", "sammanstallning"], ["saved_report", "sr-seed-privat", "xlsx", "mb", "sammanstallning"],
      ["contract", null, "pdf", "mb", "sammanstallning"], ["contract", null, "csv", "mb", "lista"], ["saved_report", "sr-seed-kommun", "xlsx", "kommun", "sammanstallning"],
    ]);
    expect(ex[0].details).toMatchObject({ template: "narvaro-per-manad", dataset: "deltagarmanader", schema: 1, measures: ["deltagarmanader", "narvarograd"], groupBy: null, split: "manad" });
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
    const eCtx = { ...ctx, actor: eva(), repo: new MemoryRepo<Tables>(rt.store, eva(), POLICIES) as unknown as AppRepo };
    await expect(execute("command", sharedReportExport.key, { savedReportId: "sr-seed-kommun", format: "csv" }, eCtx)).rejects.toThrow("loggen är nere");
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
    expect(await run(sharedReportExport, { savedReportId: "sr-seed-kommun", format: "csv" }, eva())).toMatchObject({ ok: false, error: "too_large", message: "Rapporten behöver ses över av Miljonbemanning." });
    const blocked = logs("saved_report.export_blocked");
    expect(blocked.map((l) => [l.entity, l.entityId, l.details])).toEqual([
      ["saved_report", s.savedReportId, { savedReportId: s.savedReportId, reason: "column_missing", column: `resultat.niva_${areas[0]}` }],
      ["saved_report", "sr-seed-privat", { savedReportId: "sr-seed-privat", reason: "too_large" }],
      ["saved_report", "sr-seed-kommun", { savedReportId: "sr-seed-kommun", reason: "too_large" }],
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
    expect((await preview(sara(), { savedReportId: "sr-seed-privat", audience: "kommun" })).ok).toBe(true);
    expect(logs("saved_report.viewed").map((l) => [l.entityId, l.details])).toEqual([["sr-seed-privat", { audience: "mb" }], ["sr-seed-privat", { audience: "kommun" }]]);
    expect(JSON.stringify(rows("reports"))).toBe(frozen);
    expect((await run(sharedReport, { savedReportId: "sr-seed-kommun" }, eva())).view).not.toBeNull();
    expect(logs("saved_report.viewed").at(-1)).toMatchObject({ entityId: "sr-seed-kommun", details: { audience: "kommun" } });
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
    const v = (await execute("command", builderPreview.key, { contractId: "c-bot", definition: asDef(def), audience: "mb" }, ctx)) as BuilderView & { ok: boolean };
    expect(v.ok).toBe(true);
    await execute("command", builderExport.key, { contractId: "c-bot", definition: asDef(def), format: "xlsx" }, ctx);
    expect(calls.filter((c) => c.op === "list" || c.op === "get" || c.op === "update")).toEqual([]);
    const facts = calls.filter((c) => c.op === "pickJson");
    expect(facts).toHaveLength(2);
    const finals = rows("reports").filter((r) => r.kind === "final" && (r.status === "delivered" || r.status === "opened") && !r.superseded && r.caseId !== PROT_CASE && r.periodEnd! >= "2026-09-01" && r.periodEnd! <= "2027-01-31");
    const monthly = rows("reports").filter((r) => r.kind === "monthly" && (r.status === "delivered" || r.status === "opened") && !r.superseded && r.caseId !== PROT_CASE && r.month! >= "2026-09" && r.month! <= "2027-01");
    for (const f of facts) expect(f.n).toBeLessThanOrEqual(finals.length + monthly.length + finals.length);
    expect(JSON.stringify(rows("reports"))).toBe(before);
  });
});

// ================================================================ Paritet med steg 3 och KPI:n
describe("paritet", () => {
  it("k-eva i kommunens läge och u-sara i MB:s läge: Deltagare och Deltagarmånader = steg 3:s förhandsvisning", async () => {
    const def: ReportDefinition = { ...fixed(tpl("narvaro-per-manad"), "2026-10", "2026-12"), split: "inget", measures: ["deltagarmanader"], chart: null };
    const pre = await ask(resultExportPreview, { from: "2026-10", to: "2026-12" }, eva());
    const s = await run(savedReportSave, { contractId: "c-bot", title: "Paritet", definition: asDef(def), visibility: "customer" }, johan());
    if (!s.ok) throw new Error("inte sparad");
    const k = await run(sharedReport, { savedReportId: s.savedReportId }, eva());
    expect(k.view!.table!.total).toMatchObject({ cases: pre.participants, cells: [pre.reports] });
    const m = view(await preview(sara(), { definition: def }));
    expect(m.table!.total).toMatchObject({ cases: pre.participants, cells: [pre.reports] });
  });

  it("resultatgraden på frysta fakta = resultRate på samma ärenden (utan skyddade), också med ett avslut utan resultatklass", async () => {
    // Inga verifieringar efter leveransen (sätt a gör att filen visar slutrapportens läge) och ett avslut utan resultatklass.
    const finals = rows("reports").filter((r) => r.kind === "final" && r.deliveredAt && !r.superseded);
    for (const f of finals) {
      const c = row("cases", f.caseId!)!;
      if (c.resultVerifiedAt && c.resultVerifiedAt > f.deliveredAt!) rt.store.updateRow("cases", c.id, { resultVerifiedAt: null });
    }
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

// ================================================================ Kommunens filer och fel
describe("kommunens delade rapporter", () => {
  it("filerna har inget internt mål – avtalsmålet finns i Excel; CSV, PDF-modellen och vy-modellen utan internt mål", async () => {
    const x = await run(sharedReportExport, { savedReportId: "sr-seed-kommun", format: "xlsx" }, eva());
    if (!x.ok || !("content" in x)) throw new Error("ingen fil");
    expect(x.filename).toBe("rapport_bot_resultatgrad-per-omrade_2026-08_2027-01.xlsx".replace("2026-08", "2026-09"));
    const es = await readZip(base64ToBytes(x.content));
    const all = [1, 2].map((n) => entryText(es, `xl/worksheets/sheet${n}.xml`)).join("");
    expect(all).toContain("Avtalets mål");
    expect(all).toContain("Resultatgrad 32,0 %");
    for (const bad of ["Internt mål", "internalTarget", "35,0", "35 %", "Ledning"]) expect(all).not.toContain(bad);
    expect(all).toContain("färre än 5 deltagare");
    const c = await run(sharedReportExport, { savedReportId: "sr-seed-kommun", format: "csv" }, eva());
    if (!c.ok || !("content" in c)) throw new Error("ingen fil");
    for (const bad of ["Internt", "internalTarget", "35,0", "35 %"]) expect(c.content).not.toContain(bad);
    expect(c.content.split("\r\n")[0]).toBe("grupp_kod;grupp;deltagare;avslut_som_raknas;verifierat_resultat;preliminara_resultat;resultatgrad_procent;anmarkning");
    const p = await run(sharedReportExport, { savedReportId: "sr-seed-kommun", format: "pdf" }, eva());
    if (!p.ok || !("pdf" in p)) throw new Error("ingen PDF");
    expect(JSON.stringify(p.pdf)).not.toMatch(/internalTarget|0\.35/);
    expect(p.pdf.chart).toMatchObject({ contractTarget: 0.32 });
    // MB:s läge har det interna målet.
    const mb = await exportFile(johan(), { savedReportId: "sr-seed-kommun", format: "xlsx" });
    if (!mb.ok || !("content" in mb)) throw new Error("ingen fil");
    expect(entryText(await readZip(base64ToBytes(mb.content)), "xl/worksheets/sheet2.xml")).toContain("Internt mål");
  });

  it("en delad lista med resultatkolumner har resultatets regler i Excel – samma texter som steg 3:s resultatfil", async () => {
    const def = listDef("avslut", ["avslut.arendenummer", "avslut.manad", "avslut.avslut_datum", "avslut.avslutsorsak", "avslut.resultat", "avslut.resultat_verifierat"], { period: { kind: "fast", from: "2026-10", to: "2026-12" } });
    const s = await run(savedReportSave, { contractId: "c-bot", title: "Avslutslista", definition: asDef(def), visibility: "customer" }, johan());
    if (!s.ok) throw new Error("inte sparad");
    const x = await run(sharedReportExport, { savedReportId: s.savedReportId, format: "xlsx" }, eva());
    if (!x.ok || !("content" in x)) throw new Error("ingen fil");
    const about = entryText(await readZip(base64ToBytes(x.content)), "xl/worksheets/sheet2.xml");
    for (const t of ["Resultatdefinitionen är inte fastställd", "preliminärt", "resultat_verifierat = 1", "Tom cell betyder"]) expect(about).toContain(t);
  });

  it("enhetsspärren: chefen för Alby får bara Albys ärenden – samma antal i visningen och filen", async () => {
    const def = listDef("deltagarmanader", ["resultat.arendenummer", "resultat.namn", "resultat.manad"]);
    const s = await run(savedReportSave, { contractId: "c-bot", title: "Deltagarlista", definition: asDef(def), visibility: "customer" }, johan());
    if (!s.ok) throw new Error("inte sparad");
    const v = await run(sharedReport, { savedReportId: s.savedReportId }, albyChef());
    const got = csvRows(csvOf(await run(sharedReportExport, { savedReportId: s.savedReportId, format: "csv" }, albyChef())));
    expect(got.length).toBe(v.view!.list!.rows);
    expect(new Set(got.map((r) => r.arendenummer)).size).toBe(v.view!.list!.cases);
    expect(got.length).toBeGreaterThan(0);
    for (const r of got) expect(unitOf(caseByNo(r.arendenummer).id)).toBe("Arbetsmarknadsenheten Alby");
    expect(got.some((r) => r.arendenummer === PROT_NO)).toBe(false);
    const all = csvRows(csvOf(await run(sharedReportExport, { savedReportId: s.savedReportId, format: "csv" }, eva())));
    expect(all.length).toBeGreaterThan(got.length);
  });

  it("felen med kommunens texter: empty, period, too_many_groups och en definition som inte klarar zod", async () => {
    // empty: urvalet på en annan enhet än chefens (Alby-chefen).
    const def = { ...fixed(tpl("narvaro-per-manad")), filters: { bestallare_enhet: ["Arbetsmarknadsenheten Tumba"] } } as ReportDefinition;
    const s = await run(savedReportSave, { contractId: "c-bot", title: "Tumba", definition: asDef(def), visibility: "customer" }, johan());
    if (!s.ok) throw new Error("inte sparad");
    expect(await run(sharedReport, { savedReportId: s.savedReportId }, albyChef())).toMatchObject({ found: true, view: null, error: "Det finns inga uppgifter för din enhet i den här rapporten." });
    expect(await run(sharedReportExport, { savedReportId: s.savedReportId, format: "csv" }, albyChef())).toMatchObject({ ok: false, error: "empty", message: "Det finns inga uppgifter för din enhet i den här rapporten." });
    // too_many_groups (gränsen sänks i testet – testdatat har för få grupper).
    LIMITS.groups = 2;
    expect(await run(sharedReport, { savedReportId: "sr-seed-kommun" }, eva())).toMatchObject({ error: "Rapporten behöver ses över av Miljonbemanning." });
    expect(await preview(johan(), { savedReportId: "sr-seed-kommun" })).toMatchObject({ ok: false, error: "too_many_groups" });
    LIMITS.groups = MAX_GROUPS;
    // En definition som inte klarar zod (raden skrivs direkt i minnet).
    rt.store.updateRow("saved_reports", "sr-seed-kommun", { definition: { v: 1, dataset: "okand" } } as Partial<SavedReport>);
    expect(await run(sharedReport, { savedReportId: "sr-seed-kommun" }, eva())).toMatchObject({ found: true, error: "Rapporten behöver ses över av Miljonbemanning." });
    expect(await run(sharedReportExport, { savedReportId: "sr-seed-kommun", format: "csv" }, eva())).toMatchObject({ ok: false, error: "definition", message: "Rapporten behöver ses över av Miljonbemanning." });
    expect(await ask(savedReport, { savedReportId: "sr-seed-kommun" }, johan())).toMatchObject({ found: true, definitionError: expect.any(String) });
    // period: "senaste N" före avtalets start.
    rt.store.updateRow("contracts", "c-bot", { startsOn: "2027-02-01" });
    expect(await run(sharedReport, { savedReportId: s.savedReportId }, eva())).toMatchObject({ error: "Rapporten har inga hela månader med uppgifter ännu. Försök igen nästa månad." });
  });

  it("en delad rapport i ett annat avtal än chefens syns inte, finns inte och räknas inte", async () => {
    setConfig("c-kk", (c) => { c.customerVisibility = { ...(c.customerVisibility ?? {}), seesIndividualReports: true } as never; });
    const kkRow = { ...row("saved_reports", "sr-seed-kommun")!, id: "sr-x-kk", contractId: "c-kk" };
    rt.store.insertRow("saved_reports", kkRow);
    const both: Actor = { ...eva(), contractIds: ["c-bot", "c-kk"] };
    // Policyn (RLS) släpper igenom raden – hanteraren filtrerar på chefens avtal (chefContract).
    expect((await new MemoryRepo<Tables>(rt.store, both, POLICIES).table("saved_reports").list()).map((r) => r.id).sort()).toEqual(["sr-seed-kommun", "sr-x-kk"]);
    expect((await ask(sharedReports, {}, both)).reports.map((r) => r.id)).toEqual(["sr-seed-kommun"]);
    expect(await run(sharedReport, { savedReportId: "sr-x-kk" }, both)).toMatchObject({ found: false });
    expect(await run(sharedReportExport, { savedReportId: "sr-x-kk", format: "csv" }, both)).toMatchObject({ ok: false, error: "not_found" });
    expect((await ask(navCounts, {}, both)).sharedReports).toBe(1);
  });
});

// ================================================================ Resultatfil för hela avtalet
describe("resultatfil för hela avtalet", () => {
  it("samma kolumner som kommunens fil för hela avtalet utan skyddade; export.results_mb påverkar inte kommunens kolumnspärr", async () => {
    const pre = await ask(contractResultPreview, { from: "2026-09", to: "2027-01" }, sara());
    expect(pre).toMatchObject({ allowed: true, contractId: "c-bot", reports: 270, participants: 169, periodError: null });
    const x = await run(contractResultExport, { contractId: "c-bot", from: "2026-10", to: "2026-12", format: "xlsx" }, sara());
    expect(x).toMatchObject({ ok: true, filename: "resultat_bot_hela-avtalet_2026-10_2026-12.xlsx", encoding: "base64" });
    const c = await run(contractResultExport, { contractId: "c-bot", from: "2026-10", to: "2026-12", format: "csv", table: "avslut" }, sara());
    if (!c.ok) throw new Error("ingen fil");
    expect(c.filename).toBe("resultat_bot_hela-avtalet_2026-10_2026-12_avslut.csv");
    expect(c.content).not.toContain(PROT_NO);
    const kom = await run(resultExport, { contractId: "c-bot", from: "2026-10", to: "2026-12", format: "csv", table: "resultat" }, eva());
    const mbRes = await run(contractResultExport, { contractId: "c-bot", from: "2026-10", to: "2026-12", format: "csv", table: "resultat" }, sara());
    if (!kom.ok || !mbRes.ok) throw new Error("ingen fil");
    expect(mbRes.content.split("\r\n")[0]).toBe(kom.content.split("\r\n")[0]);
    expect(logs("export.results_mb")).toHaveLength(3);
    expect(logs("export.results_mb")[0].details).toMatchObject({ format: "xlsx", table: "alla", schema: 1 });
    expect(JSON.stringify(logs("export.results_mb"))).not.toMatch(/BOT-\d|\d{6}-\d{4}/);
    // Kolumnspärren läser bara export.results: ändrad ordning efter MB:s fil stoppar inte kommunens första fil i en ny runtime.
    rt = createMemoryRuntime({ data: structuredClone(SEED), clock: demoClock(DEMO_START) });
    expect((await run(contractResultExport, { contractId: "c-bot", from: "2026-10", to: "2026-12", format: "xlsx" }, sara())).ok).toBe(true);
    setConfig("c-bot", (cfg) => { const a = cfg.progression!.areas; [a[0], a[1]] = [a[1], a[0]]; });
    expect((await run(resultExport, { contractId: "c-bot", from: "2026-10", to: "2026-12", format: "xlsx" }, eva())).ok).toBe(true);
  });
});
